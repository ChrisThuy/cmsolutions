/*
  Everything that talks to the database, and the email it sends.

  Kept apart from the request handlers so the handlers stay about HTTP and this
  stays about the two things that can hurt somebody: sending mail to an address
  a stranger typed, and reaching a database with a shared secret.
*/

const ENDPOINT = "https://api.resend.com/emails";

function config() {
  const url = process.env.AUDIT_SUPABASE_URL;
  const key = process.env.AUDIT_SUPABASE_ANON_KEY;
  const secret = process.env.AUDIT_SERVICE_SECRET;
  if (!url || !key || !secret) {
    throw new Error("Monitoring is not configured in this environment.");
  }
  return { url, key, secret };
}

/** Calls one security-definer function. Throws on anything but a clean result. */
export async function rpc(name, body, { withSecret = true } = {}) {
  const { url, key, secret } = config();

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(withSecret ? { ...body, p_secret: secret } : body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const failure = await response.json();
      if (failure?.message) detail = failure.message;
    } catch {
      // Non-JSON body; the status is all there is.
    }
    // The message can carry a Postgres error. Logged, never returned to a
    // visitor — "not authorised" tells an attacker they found the right shape.
    console.error(`[watch] ${name} failed: ${detail}`);
    throw new Error(`${name} failed`);
  }

  /*
    A void-returning function replies with an empty body, and response.json()
    throws on that. Reading the text first and only parsing when there is
    something to parse is what stops a successful call — mark_audit_notified,
    say — being counted as a failure after it has already done its work.
  */
  const raw = await response.text();
  if (!raw.trim()) return null;

  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    console.error(`[watch] ${name} returned unparseable body`);
    throw new Error(`${name} failed`);
  }
  return Array.isArray(rows) ? rows[0] : rows;
}

export function siteOrigin() {
  return process.env.SITE_ORIGIN?.trim() || "https://cmsolutions.tech";
}

/**
 * Sends one email. Never throws.
 *
 * Callers here are doing something more important than sending mail —
 * recording a watch, finishing a scheduled run — and none should fail because
 * a provider did.
 */
export async function sendEmail({ to, subject, text, unsubscribeUrl }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(`[watch] RESEND_API_KEY unset; not sent: ${subject}`);
    return { ok: false, reason: "unconfigured" };
  }

  const from = process.env.EMAIL_FROM?.trim()
    || "CM Solutions <notifications@send.cmsolutions.tech>";

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        // One-click unsubscribe, honoured by the mail client itself. Required
        // by Gmail and Yahoo for bulk senders, and the right thing regardless:
        // the fastest way to stop being wanted is to be hard to stop.
        ...(unsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.message) detail = body.message;
      } catch { /* keep the status */ }
      console.error(`[watch] send failed (${subject}): ${detail}`);
      return { ok: false, reason: "failed", message: detail };
    }

    const body = await response.json();
    return { ok: true, id: body?.id ?? "unknown" };
  } catch (cause) {
    console.error(`[watch] send threw (${subject}):`, cause?.message);
    return { ok: false, reason: "failed", message: cause?.message };
  }
}

/**
 * A stable identity for a set of findings.
 *
 * Only the check id and its status go in, sorted. Not the page list, not the
 * counts, not the prose: a site that adds a page, or renders its nav in a
 * different order, has not regressed and must not read as though it has. What
 * this answers is "are these the same problems as last time".
 */
export function fingerprint(issues) {
  return issues
    .map((issue) => `${issue.id}:${issue.status}`)
    .sort()
    .join("|");
}

/** What changed between two runs, in the terms a reader cares about. */
export function diffIssues(previousFingerprint, issues) {
  const before = new Set((previousFingerprint ?? "").split("|").filter(Boolean));
  const now = new Set(issues.map((i) => `${i.id}:${i.status}`));

  const appeared = issues.filter((i) => !before.has(`${i.id}:${i.status}`));
  const resolved = [...before].filter((key) => !now.has(key));

  return { appeared, resolvedCount: resolved.length };
}
