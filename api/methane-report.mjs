import { sendEmail, rpc } from "../lib/audit/watch-store.mjs";
import { isPresenter } from "../lib/presenter.mjs";

/*
  POST /api/methane-report  { email, result }

  Emails a readiness report to the person who just generated it.

  This is the only part of the methane tool that touches a server, and the page
  says so above the field rather than in a footer. Two things follow from that
  promise being worth keeping:

    - The REPORT is sent, not the answers. The recipient gets what they saw on
      screen. We are not quietly collecting a compliance questionnaire after
      telling someone their answers stay in their browser.
    - Nothing is stored. There is no table here. The email address is used to
      address the message and then it is gone.

  What CM Solutions gets out of it is a person who asked to be emailed, which
  is a better qualified conversation than a form fill and does not require
  keeping anything.
*/

const REPORTS_PER_IP_HOUR = 10;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
      { p_bucket: "methane:report:ip", p_key: key, p_max: REPORTS_PER_IP_HOUR, p_window: "1 hour" },
      { withSecret: false },
    );
    return row?.allowed === true;
  } catch {
    // Deny on error. This sends mail to an address someone typed, so an
    // unmetered path is an unmetered path to somebody else's inbox.
    return false;
  }
}

/** The report as plain text. Read on a phone, at a conference, standing up. */
function formatReport(result) {
  const lines = [
    "METHANE COMPLIANCE READINESS",
    "",
    result.headline,
    "",
    `Assessed ${new Date(result.assessedAt).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    })} · framework reviewed ${result.frameworkReviewed}`,
    "",
    "─".repeat(56),
    "",
  ];

  for (const f of result.findings) {
    const status = f.status === "gap" ? "OPEN" : f.status === "unknown" ? "NOT KNOWN" : "IN HAND";
    lines.push(`${status} — ${f.title}`);
    lines.push(`  ${f.regime} · ${f.date} · ${f.horizon}`);
    lines.push(`  ${f.detail}`);
    if (f.action) lines.push(`  What closing this needs: ${f.action}`);
    if (f.source?.url) lines.push(`  Source: ${f.source.url}`);
    lines.push("");
  }

  lines.push(
    "─".repeat(56),
    "",
    "This is a readiness indicator generated from your own answers. It is not",
    "a compliance determination, not a regulatory submission and not legal",
    "advice, and it does not quantify emissions. Every obligation above links",
    "to its source so you can check it. Confirm the detail that applies to",
    "your asset class with your own advisers.",
    "",
    "Re-run it any time: https://cmsolutions.tech/methane-readiness",
    "",
    "— CM Solutions · contact@cmsolutions.tech",
  );

  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  let email;
  let result;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    email = typeof body?.email === "string" ? body.email.trim() : "";
    result = body?.result;
  } catch {
    return res.status(400).json({ error: "That request could not be read." });
  }

  if (!EMAIL_SHAPE.test(email) || email.length > 320) {
    return res.status(400).json({ error: "Enter an email address we can send it to." });
  }

  // Shape-checked rather than trusted: this comes from a browser, and what it
  // sends ends up rendered into an email.
  if (!result || !Array.isArray(result.findings) || typeof result.headline !== "string") {
    return res.status(400).json({ error: "Run the assessment first." });
  }
  if (result.findings.length > 40) {
    return res.status(400).json({ error: "That report is larger than we can send." });
  }

  const ip = clientIp(req);
  if (!ip) {
    console.error("[methane-report] no client address on the request");
    return res.status(400).json({ error: "We could not process that request." });
  }

  if (!isPresenter(req) && !(await consumeAllowance(ip))) {
    return res.status(429).json({
      error: "That is as many reports as we send from one connection each hour. The report is still on screen — print it instead.",
    });
  }

  const sent = await sendEmail({
    to: email,
    subject: "Your methane compliance readiness report",
    text: formatReport(result),
  });

  if (!sent.ok) {
    // Honest about what happened: the report is not lost, it is on their
    // screen, and telling them to print it is more useful than an apology.
    console.error(`[methane-report] send failed: ${sent.message ?? sent.reason}`);
    return res.status(502).json({
      error: "We could not send that just now. The report is still on screen — print it instead.",
    });
  }

  console.info(`[methane-report] sent to ${email} — message ${sent.id}`);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, message: `Sent to ${email}. Check your inbox.` });
}
