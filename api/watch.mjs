import { normaliseTarget, UnsafeUrlError } from "../lib/audit/safe-fetch.mjs";
import { rpc, sendEmail, siteOrigin } from "../lib/audit/watch-store.mjs";
import { isPresenter } from "../lib/presenter.mjs";

/*
  POST /api/watch  { "url": "example.com", "email": "you@example.com" }

  Registers a weekly check and sends one confirmation email. Nothing is
  monitored, and no further mail is ever sent, until that link is clicked.

  ── the rule this endpoint exists to enforce ───────────────────────────────

  Anyone can type anyone's address into a form. So exactly one email may leave
  here per request, it must be a confirmation rather than content, and the
  token that activates the watch is generated inside the database and never
  reaches a browser. Someone abusing this can, at worst, cause one confirmation
  email that the recipient ignores — and the per-IP limit bounds even that.
*/

/** Confirmation emails one address may cause per day. */
const SUBSCRIBES_PER_IP_DAY = 5;

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
  try {
    const row = await rpc(
      "consume_rate_limit",
      { p_bucket: "audit:watch:ip", p_key: key, p_max: SUBSCRIBES_PER_IP_DAY, p_window: "1 day" },
      { withSecret: false },
    );
    return row?.allowed === true;
  } catch {
    // Deny on error. An unmetered path here is an unmetered path to sending
    // mail to strangers.
    return false;
  }
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  let target;
  let email;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    target = body?.url;
    email = typeof body?.email === "string" ? body.email.trim() : "";
  } catch {
    return res.status(400).json({ error: "That request could not be read." });
  }

  if (!EMAIL_SHAPE.test(email) || email.length > 320) {
    return res.status(400).json({ error: "Enter an email address we can send the confirmation to." });
  }

  let url;
  try {
    url = normaliseTarget(target).toString();
  } catch (cause) {
    if (cause instanceof UnsafeUrlError) {
      return res.status(400).json({ error: cause.message });
    }
    throw cause;
  }

  const ip = clientIp(req);
  if (!ip) {
    console.error("[watch] no client address on a subscribe request");
    return res.status(400).json({ error: "We could not process that request." });
  }

  if (!isPresenter(req) && !(await consumeAllowance(ip))) {
    return res.status(429).json({
      error:
        "That is as many confirmations as we send from one connection each day. " +
        "If you are setting this up across a lot of sites, that is exactly the version worth talking to us about.",
    });
  }

  let watch;
  try {
    watch = await rpc("create_audit_watch", { p_url: url, p_email: email });
  } catch {
    return res.status(503).json({ error: "We could not set that up just now. Please try again shortly." });
  }

  /*
    An already-confirmed watch gets no second email.

    Otherwise this is a way to mail someone repeatedly: submit their address
    again and again, and each attempt lands in their inbox. The response is
    deliberately the same either way, so it does not answer "is this address
    already watching this site?" for someone who should not know.
  */
  if (!watch?.already_verified) {
    const confirmUrl = `${siteOrigin()}/api/watch-confirm?t=${encodeURIComponent(watch.verify_token)}`;

    await sendEmail({
      to: email,
      subject: `Confirm weekly checks for ${new URL(url).hostname}`,
      text: [
        `You asked CM Solutions to check ${url} every week and tell you if anything breaks.`,
        "",
        "Confirm that here — nothing is monitored until you do:",
        confirmUrl,
        "",
        "If you did not ask for this, ignore this message. Nothing has been set up,",
        "and you will not hear from us again.",
        "",
        "— CM Solutions",
        "https://cmsolutions.tech",
      ].join("\n"),
    });
  }

  // Same answer whether or not mail went out, and whether or not the watch
  // already existed. The inbox is the channel that tells the truth.
  return res.status(200).json({
    ok: true,
    message: `Check ${email} and click the link to start weekly monitoring.`,
  });
}
