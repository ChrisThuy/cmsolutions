/*
  Turns a design spec into a complete, self-contained scroll-film page.

  No imports at all, deliberately: the page uses this to render a live preview
  in the browser, and the endpoint uses it on the server. Two consumers, one
  implementation, no bare specifiers.

  ── what this file is responsible for ──

  Everything mechanical about a scroll film, so the model never has to be:

    · ScrollTrigger creation order. Pinned scenes are created before ambient
      triggers, always. Creation order is refresh order, and an ambient
      trigger created before a pin is silently mis-positioned by the height of
      that pin's spacer. It fails quietly and looks like a mystery.
    · Lenis and ScrollTrigger driving the same scroll without fighting.
    · prefers-reduced-motion, which turns the film into a legible static page
      rather than removing the content.
    · Fonts, contrast, focus rings, and a real footer.

  The model supplies taste. This supplies correctness.
*/

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const slug = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* Whose work this is. Appears in the footer of every generated site. */
const BUILDER_NAME = "CM Solutions";
const BUILDER_URL = "https://cmsolutions.tech";

const fontParam = (name, weights) =>
  `family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@${weights}`;

/*
  Splits a headline into per-character spans for the char-reveal motion.

  The characters are grouped into words, and that grouping is the whole
  point. A .ch is display:inline-block so it can be transformed, and every
  inline-block is a line-break opportunity — so a bare run of them lets the
  browser break between any two letters. A generated hero came back reading
  "Tidew / ater", which is the kind of thing that makes the whole page look
  broken no matter how good the rest of it is.

  Wrapping each word in a nowrap box keeps the break opportunities where the
  spaces are, which is where a reader expects them.
*/
function chars(text) {
  const wordSpans = (word) => String(word).split("")
    .map((ch) => `<span class="ch">${esc(ch)}</span>`).join("");

  return String(text).split(" ")
    .map((word) => `<span class="wd">${wordSpans(word)}</span>`)
    .join('<span class="ch sp">&nbsp;</span>');
}


/*
  The client's real details, placed by code.

  Never interpolated into anything the model wrote and never asked of it.
  A model that carries "01273 555019" through a generation will one day
  write 555091, and the client publishes a page with a wrong number on it.
  Everything here comes from lib/schema/extract.mjs reading their own site.

  Rendered only when something was actually found — an empty contact block
  with placeholder dashes looks worse than no block at all.
*/
function contactMarkup(contact) {
  if (!contact) return "";
  const rows = [];
  if (contact.phone) rows.push(`<a href="tel:${esc(String(contact.phone).replace(/[^+\d]/g, ""))}">${esc(contact.phone)}</a>`);
  if (contact.email) rows.push(`<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>`);

  const address = [contact.street, contact.city, contact.region, contact.postcode]
    .filter(Boolean).map(esc).join(", ");
  // A real address earns a real map link; a partial one does not.
  if (address && contact.city) {
    rows.push(`<a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(
      [contact.street, contact.city, contact.postcode].filter(Boolean).join(" "))}" target="_blank" rel="noopener">${address}</a>`);
  } else if (address) {
    rows.push(`<span>${address}</span>`);
  }

  const hours = (contact.hours ?? [])
    .map((h) => `<li><span>${esc(h.day)}</span><span>${esc(h.open)}–${esc(h.close)}</span></li>`).join("");

  const social = (contact.sameAs ?? []).slice(0, 8).map((href) => {
    let label = href;
    try { label = new URL(href).hostname.replace(/^www\./, "").split(".")[0]; } catch { /* keep the raw href */ }
    return `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;
  }).join("");

  if (!rows.length && !hours && !social) return "";

  return `
  <section class="contact" id="contact" aria-labelledby="contact-h">
    <div class="wrap">
      <h2 id="contact-h">Find us</h2>
      ${rows.length ? `<div class="contact-rows">${rows.join("")}</div>` : ""}
      ${hours ? `<ul class="hours">${hours}</ul>` : ""}
      ${social ? `<div class="social">${social}</div>` : ""}
    </div>
  </section>`;
}

function chapterMarkup(c, i, photo = null) {
  const id = `ch-${i}-${slug(c.name)}`;
  /*
    A real photograph behind the scene, when the client gave us one.

    Two things come with it. It is loaded lazily and decoded async, because
    a scroll-film that blocks on six full-size images from someone else's
    server feels broken before it feels beautiful. And it carries a scrim:
    the palette guarantees 4.5:1 of body text against the background colour,
    and a photograph underneath destroys that guarantee unless something
    puts the darkness back.
  */
  const photoLayer = photo
    ? `<div class="scene-photo"><img src="${esc(photo)}" alt="" loading="lazy" decoding="async" /></div>`
    : "";
  const head = c.motion === "char-reveal"
    ? `<h2 class="ch-head split">${chars(c.headline)}</h2>`
    : `<h2 class="ch-head">${esc(c.headline)}</h2>`;

  const body = c.body ? `<p class="ch-body">${esc(c.body)}</p>` : "";

  if (c.motion === "horizontal") {
    // The run needs something to move. Split the body into panels so the
    // horizontal scrub has real content rather than filler.
    const panels = (c.body || c.visual).split(/(?<=\.)\s+/).filter(Boolean).slice(0, 4);
    const cards = panels.length ? panels : [c.visual];
    return `
  <section class="scene scene--horizontal" id="${id}" data-motion="horizontal" data-chapter="${esc(c.name)}">
    ${photoLayer}
    <div class="scene-inner">
      <div class="h-head"><p class="ch-kicker">${esc(c.kicker)}</p>${head}</div>
      <div class="h-track">
        ${cards.map((t, n) => `<article class="h-card" data-depth="${(n % 3) + 1}">
          <span class="h-num">${String(n + 1).padStart(2, "0")}</span>
          <p>${esc(t)}</p>
        </article>`).join("\n        ")}
      </div>
    </div>
  </section>`;
  }

  if (c.motion === "counter") {
    return `
  <section class="scene" id="${id}" data-motion="counter" data-chapter="${esc(c.name)}">
    ${photoLayer}
    <div class="scene-bg" data-layer="back"></div>
    <div class="scene-inner center">
      <p class="ch-kicker">${esc(c.kicker)}</p>
      <p class="counter" data-to="${Number(c.counterTo) || 0}">0</p>
      <p class="counter-label">${esc(c.counterLabel)}</p>
      ${head}${body}
    </div>
  </section>`;
  }

  return `
  <section class="scene" id="${id}" data-motion="${esc(c.motion)}" data-chapter="${esc(c.name)}">
    ${photoLayer}
    <div class="scene-bg" data-layer="back"></div>
    <div class="scene-bg scene-bg--mid" data-layer="mid"></div>
    <div class="scene-inner ${c.motion === "clip-reveal" ? "clip" : ""}">
      <p class="ch-kicker">${esc(c.kicker)}</p>
      ${head}${body}
    </div>
  </section>`;
}

export function renderSite(spec) {
  const p = spec.palette;

  /*
    Their photographs, spread across the chapters.

    Round-robin rather than one-per-chapter: a site that yielded two usable
    images and a film with six beats should still feel photographic
    throughout, and repeating a picture two scenes apart reads as a motif
    rather than a shortage.
  */
  const photos = Array.isArray(spec.images) ? spec.images.filter(Boolean) : [];
  const photoFor = (i) => (photos.length ? photos[i % photos.length] : null);

  const t = spec.type;
  const fonts = `https://fonts.googleapis.com/css2?${fontParam(t.display, t.displayWeights)}&${fontParam(t.body, t.bodyWeights)}&display=swap`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(spec.brandName)} — ${esc(spec.tagline)}</title>
<meta name="description" content="${esc(spec.tagline)}" />
<meta property="og:title" content="${esc(spec.brandName)}" />
<meta property="og:description" content="${esc(spec.tagline)}" />
<meta property="og:type" content="website" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${esc(fonts)}" rel="stylesheet" />

<style>
  :root{
    --bg:${esc(p.bg)}; --surface:${esc(p.surface)};
    --ink:${esc(p.ink)}; --dim:${esc(p.dim)};
    --accent:${esc(p.accent)}; --accent2:${esc(p.accent2)};
    --display:"${esc(t.display)}", Georgia, serif;
    --body:"${esc(t.body)}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --ease:cubic-bezier(.16,1,.3,1);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-text-size-adjust:100%}
  body{background:var(--bg);color:var(--ink);font-family:var(--body);font-weight:300;line-height:1.6;overflow-x:hidden;-webkit-font-smoothing:antialiased}
  a{color:var(--accent)}
  ::selection{background:var(--accent);color:var(--bg)}
  .wrap{width:min(1160px,100% - 3rem);margin-inline:auto}

  .skip{position:absolute;left:-9999px}
  .skip:focus{left:1rem;top:1rem;position:fixed;z-index:99;background:var(--ink);color:var(--bg);padding:.7rem 1rem;border-radius:3px}
  :focus-visible{outline:2px solid var(--accent);outline-offset:3px}

  /* ── the fixed film chrome ───────────────────────────────────────────── */
  .chrome{position:fixed;inset:0 0 auto 0;z-index:20;display:flex;justify-content:space-between;align-items:center;padding:1.4rem clamp(1.2rem,4vw,3rem);pointer-events:none;mix-blend-mode:difference}
  .mark{font-family:var(--display);font-size:1.05rem;letter-spacing:.02em;pointer-events:auto;color:#fff;text-decoration:none}
  .readout{font-size:.68rem;letter-spacing:.24em;text-transform:uppercase;color:#fff;opacity:.75;font-variant-numeric:tabular-nums}
  .rail{position:fixed;right:clamp(.8rem,2vw,1.6rem);top:50%;transform:translateY(-50%);z-index:20;display:flex;flex-direction:column;gap:.55rem}
  .rail i{display:block;width:2px;height:16px;background:var(--ink);opacity:.22;transition:opacity .3s,transform .3s}
  .rail i.on{opacity:1;transform:scaleY(1.5);background:var(--accent)}
  @media(max-width:700px){.rail{display:none}}

  /* ── hero ────────────────────────────────────────────────────────────── */
  .hero{position:relative;min-height:100svh;display:grid;place-items:center;text-align:center;padding:6rem 1.5rem;overflow:hidden}
  .hero-glow{position:absolute;width:120vmax;height:120vmax;border-radius:50%;background:radial-gradient(circle at 50% 50%, ${esc(p.accent)}22, transparent 60%);top:-40vmax;left:-20vmax;filter:blur(40px)}
  .hero-glow2{position:absolute;width:90vmax;height:90vmax;border-radius:50%;background:radial-gradient(circle at 50% 50%, ${esc(p.accent2)}1e, transparent 60%);bottom:-40vmax;right:-25vmax;filter:blur(40px)}
  .hero-inner{position:relative;z-index:1;max-width:22ch}
  .hero h1{font-family:var(--display);font-weight:400;font-size:clamp(2.8rem,11vw,8rem);line-height:.94;letter-spacing:-.03em}
  .hero h1 .ch{display:inline-block;will-change:transform,opacity}
  /* words break at spaces, never mid-word — see chars() */
  .wd{display:inline-block;white-space:nowrap}
  .hero .tag{margin-top:1.6rem;font-size:clamp(.95rem,2.2vw,1.15rem);color:var(--dim);max-width:40ch;margin-inline:auto}
  .cue{position:absolute;bottom:2rem;left:50%;transform:translateX(-50%);font-size:.64rem;letter-spacing:.28em;text-transform:uppercase;color:var(--dim);display:flex;flex-direction:column;align-items:center;gap:.6rem}
  .cue span{width:1px;height:34px;background:linear-gradient(var(--accent),transparent)}

  /* ── scenes ──────────────────────────────────────────────────────────── */
  .scene{position:relative;min-height:100svh;display:grid;place-items:center;overflow:hidden;padding:5rem 1.5rem}
  /* The photograph sits under everything, and the scrim sits over it. The
     gradient overlay is what keeps body text legible on top of an image we
     have never seen — without it the palette's contrast guarantee is a
     promise about a colour that is no longer there. */
  .scene-photo{position:absolute;inset:0;overflow:hidden;z-index:0}
  .scene-photo img{width:100%;height:100%;object-fit:cover;
    transform:scale(1.06);will-change:transform}
  /* A veil, not a curtain. The first version stacked 50% image opacity under
     a scrim at 60–87% and the photograph came through at about 15% — the
     client's own picture reduced to a ghost. Legibility now comes from the
     halo on the text below, which protects the words without hiding what is
     behind them. Heavier at top and bottom where the chrome and the kicker
     sit, lightest across the middle where the picture is. */
  .scene-photo::after{content:"";position:absolute;inset:0;background:
    linear-gradient(to bottom, ${esc(p.bg)}88, ${esc(p.bg)}33 40%, ${esc(p.bg)}44 60%, ${esc(p.bg)}99)}
  .scene-bg{position:absolute;inset:-20%;background:
      radial-gradient(60% 50% at 30% 30%, ${esc(p.accent)}1c, transparent 70%),
      radial-gradient(50% 60% at 75% 65%, ${esc(p.accent2)}18, transparent 70%);
    will-change:transform}
  .scene-bg--mid{inset:-10%;background:radial-gradient(40% 40% at 60% 40%, ${esc(p.accent2)}14, transparent 70%)}
  .scene-inner{position:relative;z-index:1;max-width:60ch;text-align:center;will-change:transform,opacity}
  /* The legibility guarantee over a photograph we have never seen. The
     palette promises 4.5:1 of ink against bg, and a picture underneath
     voids that promise — this puts a soft plate of bg immediately behind the
     glyphs, so the contrast holds wherever the image happens to be light or
     busy. Applied only in a scene that actually has a photo. */
  .scene:has(.scene-photo) .scene-inner{
    text-shadow:0 0 18px ${esc(p.bg)}, 0 0 36px ${esc(p.bg)}, 0 1px 2px ${esc(p.bg)}}
  .scene-inner.center{display:grid;justify-items:center}
  .ch-kicker{font-size:.66rem;letter-spacing:.3em;text-transform:uppercase;color:var(--accent);margin-bottom:1.4rem}
  .ch-head{font-family:var(--display);font-weight:400;font-size:clamp(1.9rem,5.4vw,3.6rem);line-height:1.08;letter-spacing:-.02em}
  .ch-head .ch{display:inline-block;will-change:transform,opacity}
  .ch-body{margin-top:1.4rem;color:var(--dim);font-size:clamp(1rem,2vw,1.12rem)}
  .clip{clip-path:inset(0 0 100% 0)}

  .counter{font-family:var(--display);font-size:clamp(4rem,18vw,12rem);line-height:1;color:var(--accent);font-variant-numeric:tabular-nums}
  .counter-label{font-size:.7rem;letter-spacing:.26em;text-transform:uppercase;color:var(--dim);margin-bottom:1.6rem}

  /* horizontal run */
  .scene--horizontal{display:block;padding:0}
  .scene--horizontal .scene-inner{max-width:none;text-align:left;height:100svh;display:flex;flex-direction:column;justify-content:center;gap:2.4rem}
  .h-head{padding-inline:clamp(1.5rem,6vw,5rem)}
  .h-track{display:flex;gap:1.6rem;padding-inline:clamp(1.5rem,6vw,5rem);width:max-content}
  .h-card{width:min(78vw,420px);background:var(--surface);border:1px solid ${esc(p.ink)}14;border-radius:8px;padding:2rem;will-change:transform}
  .h-num{font-family:var(--display);font-size:.9rem;color:var(--accent);display:block;margin-bottom:.9rem}
  .h-card p{color:var(--dim);font-size:1rem}

  /* ── after the film ──────────────────────────────────────────────────── */
  .after{position:relative;z-index:2;background:var(--bg);padding-block:clamp(4rem,10vw,8rem)}
  .sect+.sect{margin-top:clamp(3.5rem,8vw,6rem)}
  .sect h3{font-family:var(--display);font-weight:400;font-size:clamp(1.6rem,4vw,2.4rem);letter-spacing:-.01em}
  .sect .lede{margin-top:1rem;color:var(--dim);max-width:62ch}
  .grid{display:grid;gap:1.2rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));margin-top:2.2rem}
  .card{background:var(--surface);border:1px solid ${esc(p.ink)}12;border-radius:8px;padding:1.5rem}
  .card h4{font-family:var(--display);font-weight:400;font-size:1.15rem;margin-bottom:.5rem}
  .card p{color:var(--dim);font-size:.93rem}

  .cta{margin-top:clamp(4rem,10vw,7rem);text-align:center;padding:clamp(2.5rem,6vw,4rem) 1.5rem;border:1px solid ${esc(p.ink)}14;border-radius:10px;background:
      radial-gradient(70% 120% at 50% 0%, ${esc(p.accent)}14, transparent 70%), var(--surface)}
  .cta h3{font-family:var(--display);font-weight:400;font-size:clamp(1.8rem,5vw,3rem);letter-spacing:-.02em}
  .cta p{margin-top:1rem;color:var(--dim);max-width:52ch;margin-inline:auto}
  .btn{display:inline-flex;align-items:center;min-height:48px;margin-top:2rem;padding:.85rem 2.2rem;background:var(--accent);color:var(--bg);text-decoration:none;border-radius:4px;font-weight:500;letter-spacing:.01em;transition:transform .2s var(--ease),opacity .2s}
  .btn:hover{transform:translateY(-2px);opacity:.92}

  .contact{padding-block:clamp(3rem,8vw,6rem);border-top:1px solid ${esc(p.ink)}12}
  .contact h2{font-family:var(--display);font-weight:400;font-size:clamp(1.6rem,4vw,2.4rem);margin-bottom:1.6rem}
  .contact-rows{display:flex;flex-direction:column;gap:.5rem;font-size:1.02rem}
  .contact-rows a,.contact-rows span{color:var(--ink);text-decoration:none;border-bottom:1px solid ${esc(p.accent)}55;
    align-self:flex-start;padding-bottom:.1rem}
  .contact-rows a:hover{border-bottom-color:var(--accent)}
  .hours{list-style:none;margin:1.6rem 0 0;padding:0;max-width:22rem;font-size:.92rem;color:var(--dim)}
  .hours li{display:flex;justify-content:space-between;gap:2rem;padding:.35rem 0;border-bottom:1px solid ${esc(p.ink)}0d}
  .social{display:flex;gap:1rem;flex-wrap:wrap;margin-top:1.8rem}
  .social a{color:var(--dim);text-decoration:none;font-size:.86rem;text-transform:capitalize}
  .social a:hover{color:var(--accent)}
  footer{border-top:1px solid ${esc(p.ink)}12;padding-block:2.5rem;color:var(--dim);font-size:.85rem}
  footer .wrap{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
  footer .credit{margin-top:1.4rem;padding-top:1.1rem;border-top:1px solid ${esc(p.ink)}0f;
                 justify-content:center;font-size:.74rem;letter-spacing:.04em}
  footer .credit a{color:var(--dim);text-decoration:none;opacity:.75;transition:opacity .3s}
  footer .credit a:hover{opacity:1}

  /*
    Reduced motion turns the film into a legible page. The content is never
    removed — only the movement is.
  */
  @media (prefers-reduced-motion: reduce){
    *{animation:none!important;transition:none!important}
    .scene{min-height:auto;padding-block:4rem}
    .scene-inner,.hero h1 .ch,.ch-head .ch{opacity:1!important;transform:none!important}
    .clip{clip-path:none!important}
    .scene--horizontal .scene-inner{height:auto;padding-block:4rem}
    .h-track{flex-wrap:wrap;width:auto}
    .h-card{width:100%}
  }
</style>
</head>
<body>
<a class="skip" href="#after">Skip the film</a>

<div class="chrome">
  <a class="mark" href="#top">${esc(spec.brandName)}</a>
  <p class="readout"><span id="rd-ch">${esc(spec.chapters[0]?.name ?? "")}</span> · <span id="rd-pc">00</span></p>
</div>
<nav class="rail" aria-hidden="true">${spec.chapters.map(() => "<i></i>").join("")}</nav>

<main id="top">
  <header class="hero" id="hero">
    <div class="hero-glow" data-drift="1"></div>
    <div class="hero-glow2" data-drift="2"></div>
    <div class="hero-inner">
      <h1 class="split">${chars(spec.brandName)}</h1>
      <p class="tag">${esc(spec.tagline)}</p>
    </div>
    <p class="cue"><span></span>Scroll</p>
  </header>

${spec.chapters.map((c, i) => chapterMarkup(c, i, photoFor(i))).join("\n")}

  <div class="after" id="after">
    <div class="wrap">
${spec.sections.map((s) => `      <section class="sect">
        <h3>${esc(s.title)}</h3>
        <p class="lede">${esc(s.body)}</p>
        ${s.items.length ? `<div class="grid">
${s.items.map((it) => `          <article class="card"><h4>${esc(it.heading)}</h4><p>${esc(it.text)}</p></article>`).join("\n")}
        </div>` : ""}
      </section>`).join("\n")}

      <section class="cta">
        <h3>${esc(spec.cta.heading)}</h3>
        <p>${esc(spec.cta.body)}</p>
        <a class="btn" href="#top">${esc(spec.cta.label)}</a>
      </section>
    </div>

  ${contactMarkup(spec.contact)}

    <footer>
      <div class="wrap">
        <span>${esc(spec.brandName)}</span>
        <span>${esc(spec.footerNote)}</span>
      </div>
      <!--
        The credit.

        Every demo gets sent to somebody — that is what the link is for — so
        each one carries a way back here. Kept quiet rather than a badge: it
        is a signature on the work, and a site that shouts about who built it
        looks like it was built for the builder.
      -->
      <div class="wrap credit">
        <a href="${esc(BUILDER_URL)}" target="_blank" rel="noopener">
          Designed by ${esc(BUILDER_NAME)}
        </a>
      </div>
    </footer>
  </div>
</main>

<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js"></script>
<script>
(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !window.gsap || !window.ScrollTrigger) { window.__ready = true; return; }

  gsap.registerPlugin(ScrollTrigger);

  /* Lenis drives the scroll; ScrollTrigger is told to update from it rather
     than listening to the native event, or the two fight and the scrub
     stutters. */
  var lenis = window.Lenis ? new Lenis({ duration: 1.05, smoothWheel: true }) : null;
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  /* ── 1. PINNED SCENES FIRST ──────────────────────────────────────────
     Creation order is refresh order. An ambient trigger created before a
     pin is positioned against a layout that does not yet include that
     pin's spacer, and every trigger after it lands in the wrong place. It
     fails silently, which is why this ordering is load-bearing.            */

  gsap.utils.toArray('.scene').forEach(function (scene) {
    var motion = scene.dataset.motion;
    var inner = scene.querySelector('.scene-inner');

    if (motion === 'horizontal') {
      var track = scene.querySelector('.h-track');
      var distance = track.scrollWidth - window.innerWidth + 80;
      if (distance > 0) {
        var run = gsap.to(track, {
          x: -distance, ease: 'none',
          scrollTrigger: { trigger: scene, start: 'top top', end: '+=' + distance,
                           pin: true, scrub: 1, invalidateOnRefresh: true },
        });
        gsap.utils.toArray('.h-card', scene).forEach(function (card) {
          gsap.fromTo(card, { y: 24 * Number(card.dataset.depth || 1) }, {
            y: -24 * Number(card.dataset.depth || 1), ease: 'none',
            scrollTrigger: { trigger: card, containerAnimation: run,
                             start: 'left right', end: 'right left', scrub: true },
          });
        });
      }
      return;
    }

    var tl = gsap.timeline({
      scrollTrigger: { trigger: scene, start: 'top top', end: '+=110%',
                       pin: true, scrub: 1, invalidateOnRefresh: true },
    });

    if (motion === 'pin-zoom') {
      tl.fromTo(inner, { scale: .86, opacity: 0, y: 40 }, { scale: 1, opacity: 1, y: 0, ease: 'power2.out' })
        .to(inner, { scale: 1.12, opacity: 0, y: -40, ease: 'power2.in' }, '+=.35');
    } else if (motion === 'clip-reveal') {
      tl.fromTo(inner, { clipPath: 'inset(0 0 100% 0)', opacity: .2 },
                       { clipPath: 'inset(0 0 0% 0)', opacity: 1, ease: 'power2.out' })
        .to(inner, { clipPath: 'inset(100% 0 0 0)', opacity: 0, ease: 'power2.in' }, '+=.4');
    } else if (motion === 'char-reveal') {
      var cs = scene.querySelectorAll('.ch-head .ch');
      tl.from(cs, { yPercent: 115, opacity: 0, stagger: .012, ease: 'power3.out' })
        .from(scene.querySelectorAll('.ch-kicker, .ch-body'), { y: 18, opacity: 0, stagger: .1 }, '<.2')
        .to(inner, { opacity: 0, y: -30, ease: 'power2.in' }, '+=.4');
    } else if (motion === 'counter') {
      var el = scene.querySelector('.counter');
      var target = Number(el.dataset.to) || 0;
      var box = { v: 0 };
      tl.fromTo(inner, { opacity: 0, y: 30 }, { opacity: 1, y: 0 })
        .to(box, { v: target, ease: 'none',
                   onUpdate: function () { el.textContent = Math.round(box.v).toLocaleString(); } }, '<')
        .to(inner, { opacity: 0, y: -30, ease: 'power2.in' }, '+=.4');
    } else { /* layer-parallax */
      tl.fromTo(inner, { opacity: 0, y: 60 }, { opacity: 1, y: 0, ease: 'power2.out' })
        .to(inner, { opacity: 0, y: -60, ease: 'power2.in' }, '+=.4');
    }

    var back = scene.querySelector('[data-layer="back"]');
    var mid = scene.querySelector('[data-layer="mid"]');
    if (back) tl.fromTo(back, { yPercent: -8, scale: 1.1 }, { yPercent: 8, scale: 1, ease: 'none' }, 0);
    if (mid) tl.fromTo(mid, { yPercent: 12 }, { yPercent: -12, ease: 'none' }, 0);
  });

  /* ── 2. AMBIENT TRIGGERS, AFTER THE PINS ───────────────────────────── */

  gsap.from('.hero h1 .ch', { yPercent: 118, opacity: 0, stagger: .028, duration: 1.05, ease: 'power3.out' });
  gsap.from('.hero .tag', { y: 22, opacity: 0, duration: .9, delay: .45, ease: 'power2.out' });

  gsap.utils.toArray('[data-drift]').forEach(function (el) {
    gsap.to(el, { yPercent: 18 * Number(el.dataset.drift), ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  });

  gsap.utils.toArray('.sect, .cta').forEach(function (el) {
    gsap.from(el, { y: 36, opacity: 0, duration: .8, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 82%' } });
  });

  /* ── 3. the readout ─────────────────────────────────────────────────── */
  var scenes = gsap.utils.toArray('.scene');
  var dots = document.querySelectorAll('.rail i');
  var rdCh = document.getElementById('rd-ch'), rdPc = document.getElementById('rd-pc');

  scenes.forEach(function (scene, i) {
    ScrollTrigger.create({
      trigger: scene, start: 'top 60%', end: 'bottom 40%',
      onToggle: function (self) {
        if (!self.isActive) return;
        if (rdCh) rdCh.textContent = scene.dataset.chapter || '';
        dots.forEach(function (d, n) { d.classList.toggle('on', n === i); });
      },
    });
  });

  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: function (self) {
      if (rdPc) rdPc.textContent = String(Math.round(self.progress * 100)).padStart(2, '0');
    },
  });

  /* Dev contract: ?jump=<y> lands pre-scrolled with scroll state settled,
     and __ready fires only when the page truly is. Lets a screenshot
     harness prove a beat instead of a person eyeballing it. */
  var jump = new URLSearchParams(location.search).get('jump');
  ScrollTrigger.refresh();
  if (jump) {
    var y = Number(jump) || 0;
    if (lenis) lenis.scrollTo(y, { immediate: true });
    window.scrollTo(0, y);
    ScrollTrigger.update();
  }
  /*
    __ready must fire even when requestAnimationFrame does not. Browsers
    throttle rAF in background tabs and in hidden iframes — which is exactly
    where a screenshot harness or a preview pane runs the page — so a contract
    that depends on rAF alone silently never resolves and the harness waits
    forever for a page that is perfectly fine.
  */
  var settled = false;
  function markReady() {
    if (settled) return;
    settled = true;
    window.__ready = true;
    document.documentElement.setAttribute('data-ready', 'true');
  }
  requestAnimationFrame(markReady);
  setTimeout(markReady, 400);
})();
</script>
</body>
</html>
`;
}

/** A compact summary for the tool's own UI — what was decided, at a glance. */
export function describeSpec(spec) {
  return {
    concept: spec.conceptName,
    journey: spec.journey,
    chapters: spec.chapters.map((c) => ({ name: c.name, motion: c.motion })),
    palette: spec.palette,
    fonts: [spec.type.display, spec.type.body],
    sections: spec.sections.length,
  };
}
