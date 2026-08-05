import { normaliseTarget, UnsafeUrlError } from "../lib/audit/safe-fetch.mjs";
import { crawlSite } from "../lib/audit/crawl.mjs";

/*
  POST /api/audit  { "url": "example.com" }

  Fetches a public page and reports what is wrong with it. No account, no
  stored result, no AI call — the checks are deterministic, so the whole thing
  costs one outbound HTTP request and runs in about a second.

  ── why this endpoint needs a rate limit more than most ────────────────────

  It makes requests to arbitrary addresses on behalf of whoever calls it. Even
  with the SSRF guards in lib/audit/safe-fetch.mjs, an unlimited version is a
  free scanning and amplification service pointed at third parties, with our
  IP on every request. The limit is not about our cost; it is about not being
  the tool someone else uses.

  The counter is the same consume_rate_limit function the proposal
  demonstration uses: RLS-sealed table, security-definer function, atomic
  check-and-consume under an advisory lock. Reused rather than reinvented,
  because that one has tests against it.

  ── why it shares a database with another product ──────────────────────────

  CM Solutions products deliberately do not share Supabase stacks, to stop
  auth.users merging across unrelated products. This tool has no accounts at
  all, so that reason does not apply — what it stores is one integer per IP
  per hour. Standing up a stack, DNS record, backup job and restore drill for
  that would be ceremony. If this tool ever gains user accounts, it gets its
  own stack before it gets its first user.
*/

/*
  Lower than it was, because a scan is no longer one request.

  Each one now fetches up to six pages, so ten scans an hour would be sixty
  outbound requests from one visitor. Five keeps the outbound volume roughly
  where it was while the report gained a great deal.
*/
const SCANS_PER_IP_HOUR = 5;

/** Same first-entry rule as the proposal app: a prepending proxy puts the real client first. */
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers["x-real-ip"];
  return typeof real === "string" && real.trim() ? real.trim() : null;
}

/**
 * Consumes one unit of allowance.
 *
 * Returns false on any failure. Allowing on error would mean a database blip
 * turns this into the unlimited proxy the limit exists to prevent — the same
 * fail-closed rule the rest of the estate uses.
 */
async function consumeAllowance(key) {
  const url = process.env.AUDIT_SUPABASE_URL;
  const anonKey = process.env.AUDIT_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[audit] rate limiting is not configured; refusing the request");
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
        p_bucket: "audit:scan:ip",
        p_key: key,
        p_max: SCANS_PER_IP_HOUR,
        p_window: "1 hour",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error("[audit] rate limit check failed:", response.status);
      return false;
    }

    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.allowed === true;
  } catch (cause) {
    console.error("[audit] rate limit check threw:", cause?.message);
    return false;
  }
}

/*
  The crawl fetches several pages against a shared budget, so the function
  needs to outlive a single request. maxDuration is set above CRAWL_BUDGET_MS
  with room for the rate-limit round trip either side.
*/
export const config = { maxDuration: 60 };

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
    return res.status(400).json({ error: "Enter a website address." });
  }

  const ip = clientIp(req);
  if (!ip) {
    // Unattributable means unlimited, which is the one thing this must not be.
    console.error("[audit] no client address on the request");
    return res.status(400).json({ error: "We could not process that request." });
  }

  /*
    Shape-check the URL before spending allowance.

    normaliseTarget does no I/O — it parses, and applies the scheme, port and
    literal-address rules. Running it first means a typo, or a deliberately
    malformed address, costs the visitor nothing out of their ten. The counter
    guards the outbound request, which is the part that actually has a cost and
    a blast radius.
  */
  try {
    normaliseTarget(target);
  } catch (cause) {
    if (cause instanceof UnsafeUrlError) {
      console.warn(`[audit] refused before counting (${cause.code}) for ${ip}`);
      return res.status(400).json({ error: cause.message, code: cause.code });
    }
    throw cause;
  }

  if (!(await consumeAllowance(ip))) {
    return res.status(429).json({
      error:
        "That is as many checks as we run from one connection each hour. " +
        "This is a demonstration of what CM Solutions builds, rather than a monitoring service — " +
        "if you want this running continuously against your own sites, that is worth a conversation.",
    });
  }

  try {
    const report = await crawlSite(target);

    // Nothing is stored. There is no reason to keep a record of which
    // stranger looked at which site, so there is no table for it.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(report);
  } catch (cause) {
    if (cause instanceof UnsafeUrlError) {
      // The message is written for the visitor; the code is for us.
      console.warn(`[audit] refused (${cause.code}) for ${ip}`);
      return res.status(400).json({ error: cause.message, code: cause.code });
    }

    console.error("[audit] unexpected failure:", cause);
    return res.status(500).json({
      error: "Something went wrong checking that page. Please try again.",
    });
  }
}
