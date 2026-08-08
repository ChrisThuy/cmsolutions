/*
  Serves a generated site demo at /demo/<slug>.

  ── why this is a function and not a static file ──

  The page was generated for one prospect, expires on its own, and must never
  be enumerable. A file on disk is none of those things.

  ── the header block is the point of this file ──

  We are serving HTML that a stranger's prompt caused to be generated, from
  our own origin. Even with the generator escaping everything it interpolates,
  that is exactly the shape of a stored-XSS hole, and the consequence of being
  wrong is a script running on cmsolutions.tech.

  So the document is served with a Content-Security-Policy that permits the
  fonts and the animation library the generator actually uses and nothing
  else — no XHR, no frames, no form posts anywhere. Even a successful
  injection would have nothing to reach and nowhere to send it.

  The generator's escaping is the first line. This is the second, and it is
  the one that holds if the first is wrong.
*/

import { rpc } from "../lib/audit/watch-store.mjs";
import { isPresenter } from "../lib/presenter.mjs";

const CACHE_SECONDS = 300;

/*
  Updating a demo lives here rather than in its own function.

  Not tidiness: Vercel's Hobby plan allows twelve serverless functions and
  this would have been the thirteenth, so the deploy failed outright. Reading
  and replacing the same resource through one route is the better shape
  anyway — GET returns the page, POST replaces it.

  ── what this must not become ──

  It takes a slug and a document and writes the document. Left open that is a
  way to overwrite anyone's demo with anything, on our origin, at a URL they
  are currently sending to clients. Three things stop it: the row must
  already exist and not have expired, so this can only replace and never
  plant a page at a chosen address; the same per-IP allowance as building;
  and the size cap, checked before the body crosses the network.

  It does not verify the caller built the demo, because there are no
  accounts. The slug is unguessable and holding it is the only claim anyone
  has — honest for a thirty-day sales artefact, not enough for anything that
  mattered more.
*/
const MAX_HTML = 400_000;
const SAVES_PER_IP_HOUR = 40;

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? null;
}

async function consumeAllowance(key) {
  const url = process.env.AUDIT_SUPABASE_URL;
  const anonKey = process.env.AUDIT_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[demo-update] rate limiting is not configured; refusing");
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
        p_bucket: "sitegen:demo-update:ip",
        p_key: key,
        p_max: SAVES_PER_IP_HOUR,
        p_window: "1 hour",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.allowed === true;
  } catch {
    // Fail closed, same rule as everywhere else: a database blip must not
    // turn this into an unlimited write endpoint.
    return false;
  }
}

async function handleUpdate(req, res) {
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "That request could not be read." });
  }

  const slug = String(body?.slug ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) {
    return res.status(400).json({ error: "That demo link is not valid." });
  }

  const html = String(body?.html ?? "");
  if (!html.startsWith("<!doctype html")) {
    return res.status(400).json({ error: "That does not look like a page." });
  }
  if (html.length > MAX_HTML) {
    return res.status(413).json({ error: "That page is larger than a demo can hold." });
  }

  const ip = clientIp(req);
  if (!ip) return res.status(400).json({ error: "We could not process that request." });
  if (!isPresenter(req) && !(await consumeAllowance(ip))) {
    return res.status(429).json({ error: "That is a lot of saves from one connection. Try again shortly." });
  }

  try {
    const updated = await rpc("update_site_demo", {
      p_slug: slug,
      p_html: html,
      p_concept: String(body?.concept ?? "").slice(0, 200) || null,
      p_spec: body?.spec ?? null,
    }, { withSecret: false });
    if (updated !== true) {
      return res.status(404).json({ error: "That demo has expired or never existed." });
    }
  } catch (cause) {
    console.error("[demo] update failed:", cause?.message);
    return res.status(502).json({ error: "That could not be saved. Try again." });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, slug });
}



async function handleImage(req, res) {
  const id = String(req.query?.img ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]{16,48}$/.test(id)) return res.status(404).end();

  try {
    const rows = await rpc("read_site_image", { p_id: id }, { withSecret: false });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.data) return res.status(404).end();

    const buffer = Buffer.from(row.data, "base64");
    res.setHeader("Content-Type", row.mime || "image/png");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Immutable: the id is content-addressed by randomness and the row is
    // never rewritten, so this can be cached hard for the demo's whole life.
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.setHeader("X-Robots-Tag", "noindex");
    return res.status(200).send(buffer);
  } catch (cause) {
    console.error("[demo] image read failed:", cause?.message);
    return res.status(502).end();
  }
}

async function handleSpec(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const slug = String(req.query?.slug ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) {
    return res.status(400).json({ error: "That demo link is not valid." });
  }
  try {
    const rows = await rpc("read_site_demo_spec", { p_slug: slug }, { withSecret: false });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return res.status(404).json({ error: "That demo has expired or never existed." });
    if (!row.spec) {
      // Built before the design was kept. Readable, not editable, and saying
      // so is better than opening an editor with nothing in it.
      return res.status(409).json({ error: "This demo was built before designs were saved, so it cannot be edited. Building it again will produce an editable one." });
    }
    return res.status(200).json({ slug, brandName: row.brand_name, spec: row.spec, expiresAt: row.expires_at });
  } catch (cause) {
    console.error("[demo] spec read failed:", cause?.message);
    return res.status(502).json({ error: "That could not be loaded." });
  }
}

function bad(res, status, message) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${status === 404 ? "Demo not found" : "Demo unavailable"} — CM Solutions</title>
<style>
  body{background:#07080c;color:#e8e6df;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       font-weight:300;display:grid;place-items:center;min-height:100vh;margin:0;padding:2rem;text-align:center}
  .box{max-width:32rem}
  h1{font-family:Georgia,serif;font-weight:400;font-size:1.6rem;margin:0 0 .8rem}
  p{color:#a09d93;line-height:1.6;margin:0 0 1.4rem}
  a{color:#7ab8d4}
</style></head>
<body><div class="box"><h1>${message}</h1>
<p>Demos are live for 30 days. If you need this one back, or you want it on
your own domain permanently, get in touch and we will sort it.</p>
<p><a href="https://cmsolutions.tech/ai-website-builder">Build another one</a>
 &nbsp;·&nbsp; <a href="https://cmsolutions.tech/#contact">Contact</a></p>
</div></body></html>`);
}

export default async function handler(req, res) {
  if (req.method === "POST") return handleUpdate(req, res);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD, POST");
    return res.status(405).json({ error: "Use GET to read a demo, POST to replace one." });
  }

  /* ?spec=1 hands back the design rather than the page, so the builder can
     load an existing demo into its editor. Same slug-as-credential model as
     everything else here: holding the link is the only claim anyone has, and
     it is what already lets them overwrite the page. */
  // Folded in rather than given its own route: Vercel's Hobby plan allows
  // twelve functions and this project sits at exactly twelve.
  if (req.query?.img) return handleImage(req, res);
  if (req.query?.spec) return handleSpec(req, res);

  const slug = String(req.query?.slug ?? "").trim().toLowerCase();
  // Validated here as well as in the database. A slug that cannot match is
  // not worth a round trip, and the shape is cheap to assert.
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) {
    return bad(res, 404, "That demo link is not valid");
  }

  const url = process.env.AUDIT_SUPABASE_URL;
  const anonKey = process.env.AUDIT_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[demo] storage is not configured");
    return bad(res, 503, "Demos are not available right now");
  }

  let row;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/read_site_demo`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_slug: slug }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error("[demo] read failed:", response.status);
      return bad(res, 503, "Demos are not available right now");
    }
    const rows = await response.json();
    row = Array.isArray(rows) ? rows[0] : rows;
  } catch (cause) {
    console.error("[demo] read threw:", cause?.message);
    return bad(res, 503, "Demos are not available right now");
  }

  if (!row?.html) return bad(res, 404, "That demo has expired or never existed");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Someone else's brand on our origin: not ours to hand to a search engine,
  // and a prospect's unlaunched site should not turn up in results.
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      // The generator inlines its own CSS and uses Google Fonts.
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      /* Any https image, because a rebuilt site carries the client's own
         photographs and those live on their server. This was 'self' data:
         when generated pages had no imagery, and it silently blocked every
         picture the moment they did — the markup was right and the header
         was refusing it.

         Widened only for images. Scripts, styles, fonts and connections
         stay pinned, and connect-src is still 'none', so a page still
         cannot send anything anywhere. */
      "img-src 'self' data: https:",
      /* Exactly the two CDNs lib/sitegen/render.mjs loads: GSAP and
         ScrollTrigger from cdnjs, Lenis from jsdelivr. Checked against the
         generator rather than guessed — the first draft of this allowed
         unpkg, which would have blocked Lenis and killed the smooth scroll
         on every demo while looking fine in review. */
      "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
      // Nothing may be sent anywhere, framed, or submitted.
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; "),
  );

  return res.status(200).send(row.html);
}
