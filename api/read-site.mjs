import { fetchPage, normaliseTarget, UnsafeUrlError } from "../lib/audit/safe-fetch.mjs";
import { extractBusiness } from "../lib/schema/extract.mjs";
import { isPresenter } from "../lib/presenter.mjs";

/*
  POST /api/read-site  { "url": "example.com" }

  Reads one page and returns what it already says about the business, so the
  schema form can start filled in rather than blank. The blank form is why most
  people abandon a generator like this.

  ── what this costs the privacy claim, stated plainly ──────────────────────

  The generator page says nothing you type leaves your browser, and that stays
  true for everything on the form. This endpoint is the one exception and it is
  opt-in: pressing the button sends the ADDRESS to our server so the page can
  be fetched. Nothing else does, nothing is stored, and the extraction happens
  here rather than in a database.

  That distinction is worth keeping precise on the page rather than quietly
  broadening "nothing leaves your browser" until it is no longer true.
*/

const READS_PER_IP_HOUR = 15;

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real.trim() ? real.trim() : null;
}

async function consumeAllowance(key) {
  const url = process.env.AUDIT_SUPABASE_URL;
  const anonKey = process.env.AUDIT_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[read-site] rate limiting is not configured; refusing");
    return false;
  }

  try {
    const response = await fetch(`${url}/rest/v1/rpc/consume_rate_limit`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_bucket: "schema:read:ip",
        p_key: key,
        p_max: READS_PER_IP_HOUR,
        p_window: "1 hour",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.allowed === true;
  } catch (cause) {
    // Deny on error. This makes outbound requests on a stranger's behalf, so
    // an unmetered path here is the same amplification problem as the audit.
    console.error("[read-site] rate limit check threw:", cause?.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  let target;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    target = body?.url;
  } catch {
    return res.status(400).json({ error: "That request could not be read." });
  }

  if (typeof target !== "string" || !target.trim()) {
    return res.status(400).json({ error: "Enter a website address first." });
  }

  const ip = clientIp(req);
  if (!ip) {
    console.error("[read-site] no client address on the request");
    return res.status(400).json({ error: "We could not process that request." });
  }

  // Shape-checked before spending allowance: a typo should cost nothing.
  try {
    normaliseTarget(target);
  } catch (cause) {
    if (cause instanceof UnsafeUrlError) {
      return res.status(400).json({ error: cause.message, code: cause.code });
    }
    throw cause;
  }

  if (!isPresenter(req) && !(await consumeAllowance(ip))) {
    return res.status(429).json({
      error: "That is as many reads as we run from one connection each hour. Fill the form in by hand, or try again later.",
    });
  }

  try {
    const page = await fetchPage(target);
    const business = extractBusiness(page.html, page.url);

    // Nothing is stored. There is no table here, and no reason for one.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(business);
  } catch (cause) {
    if (cause instanceof UnsafeUrlError) {
      console.warn(`[read-site] refused (${cause.code}) for ${ip}`);
      return res.status(400).json({ error: cause.message, code: cause.code });
    }
    console.error("[read-site] unexpected failure:", cause);
    return res.status(500).json({ error: "We could not read that page. Fill the form in by hand." });
  }
}
