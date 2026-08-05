import { rpc } from "../lib/audit/watch-store.mjs";

/*
  GET /api/watch-confirm?t=<verify token>
  GET /api/watch-confirm?u=<unsubscribe token>

  Both arrive as a click from an email, so both answer with a page rather than
  JSON, and neither asks anyone to sign in. The token is the proof: it reached
  the mailbox in question.

  Unsubscribing is one click with no confirmation step. Anything else is a dark
  pattern — nobody created an account here, and they should not need one to
  make the mail stop.
*/

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);

function page({ title, heading, body, cta }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escape(title)} | CM Solutions</title>
<meta name="robots" content="noindex" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet" />
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#07080c;color:#e8e6df;font-family:Inter,-apple-system,sans-serif;font-weight:300;line-height:1.65;
       min-height:100vh;display:grid;place-items:center;padding:2rem}
  main{max-width:34rem}
  h1{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:clamp(1.8rem,5vw,2.6rem);
     line-height:1.12;letter-spacing:-0.02em}
  p{margin-top:1.2rem;color:#a09d93}
  .actions{margin-top:2rem;display:flex;flex-wrap:wrap;gap:0.7rem}
  a{display:inline-flex;padding:0.7rem 1.4rem;border-radius:999px;text-decoration:none;
    border:1px solid rgba(232,230,223,0.25);color:inherit;font-size:0.9rem}
  a.primary{background:#e8e6df;color:#07080c;border-color:#e8e6df}
</style>
</head><body><main>
<h1>${escape(heading)}</h1>
${body.map((line) => `<p>${escape(line)}</p>`).join("\n")}
<div class="actions">${cta}</div>
</main></body></html>`;
}

const HOME = '<a class="primary" href="/website-audit">Check another site</a><a href="/">CM Solutions</a>';

export default async function handler(req, res) {
  const verifyToken = typeof req.query?.t === "string" ? req.query.t : null;
  const unsubToken = typeof req.query?.u === "string" ? req.query.u : null;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // A token in a URL should never be cached by anything in between.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  const send = (status, html) => res.status(status).send(html);

  const expired = page({
    title: "Link not recognised",
    heading: "That link is not recognised.",
    body: [
      "It may already have been used, or the monitoring may have been stopped since.",
      "Setting it up again takes a moment.",
    ],
    cta: HOME,
  });

  if (!verifyToken && !unsubToken) return send(400, expired);

  try {
    if (unsubToken) {
      const result = await rpc(
        "unsubscribe_audit_watch",
        { p_token: unsubToken },
        { withSecret: false },
      );
      if (!result?.ok) return send(404, expired);

      return send(200, page({
        title: "Monitoring stopped",
        heading: "Stopped. No more email.",
        body: [
          `We will not check ${new URL(result.url).hostname} again, and you will not hear from us about it.`,
          "Nothing was kept beyond the record that you asked us to stop.",
        ],
        cta: HOME,
      }));
    }

    const result = await rpc(
      "verify_audit_watch",
      { p_token: verifyToken },
      { withSecret: false },
    );
    if (!result?.ok) return send(404, expired);

    return send(200, page({
      title: "Monitoring confirmed",
      heading: "Confirmed. We will keep an eye on it.",
      body: [
        `We will check ${new URL(result.url).hostname} every week.`,
        "You will only hear from us when something changes — a new problem appearing, or an old one fixed. A week where nothing changed is a week with no email, because a report that always says the same thing is one nobody reads.",
        "Every message has a one-click unsubscribe.",
      ],
      cta: HOME,
    }));
  } catch (cause) {
    console.error("[watch-confirm] failed:", cause?.message);
    return send(503, page({
      title: "Something went wrong",
      heading: "Something went wrong at our end.",
      body: ["Please try that link again in a moment. Nothing has been lost."],
      cta: HOME,
    }));
  }
}
