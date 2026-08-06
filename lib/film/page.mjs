/*
  The scroll-film page: 240 stills scrubbed on a canvas as the visitor scrolls.

  No imports, so it can run either side.

  ── why frames and not a video element ──

  The obvious implementation is an <video> whose currentTime is set from
  scroll position. It stutters, badly, and not because of the code: a browser
  decoder is built for linear playback and every seek costs a keyframe hunt
  plus a decode. On a trackpad that is dozens of seeks a second.

  A bounded set of stills, decoded once into ImageBitmaps and drawn to a
  canvas, has no seek at all — drawing frame 137 costs the same as frame 3.
  That is the whole trick, and it is why the pipeline extracts frames.

  ── the sliding window ──

  240 full-size bitmaps is more memory than a phone should hold, so only a
  window around the current frame is decoded, and it moves with the scroll.
  Frames outside it are closed, which is what stops a long film from growing
  until the tab dies.
*/

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderFilmPage({ manifest, spec, framePath = "frames", frameExt = "jpg" }) {
  const chapters = manifest.chapters ?? [];
  const total = manifest.frames;
  const p = spec?.palette ?? {
    bg: "#07080c", ink: "#e8e6df", dim: "#a09d93", accent: "#d4af6a",
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(spec?.brandName ?? manifest.concept ?? "Film")}</title>
<meta name="description" content="${esc(spec?.tagline ?? manifest.concept ?? "")}" />
<style>
  :root{
    --bg:${esc(p.bg)}; --ink:${esc(p.ink)}; --dim:${esc(p.dim)}; --accent:${esc(p.accent)};
    --beat-h:${Math.round((total / Math.max(1, chapters.length)) * 9)}px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-weight:300;-webkit-font-smoothing:antialiased}
  a{color:var(--accent)}

  .skip{position:absolute;left:-9999px}
  .skip:focus{position:fixed;left:1rem;top:1rem;z-index:99;background:var(--ink);color:var(--bg);padding:.7rem 1rem;border-radius:3px}

  /* The film is a fixed canvas; the scroll happens against a tall spacer
     behind it. Pinning with position:fixed rather than a scroll library
     keeps this page dependency-free. */
  .stage{position:fixed;inset:0;z-index:0;background:#000}
  .stage canvas{width:100%;height:100%;display:block;object-fit:cover}
  .spacer{position:relative;z-index:1;pointer-events:none}

  /*
    Beat height is derived from the film, not fixed at one viewport.

    With a fixed 100svh per chapter, a two-chapter film gave 240 frames about
    960px of scroll — four pixels a frame, so a single flick skipped most of
    the film. The scrub has to have room to be a scrub. Roughly nine pixels
    per frame is enough to feel deliberate without turning a short film into
    an endless page, and it never goes below a full viewport.
  */
  .beat{height:max(100svh, var(--beat-h));display:grid;place-items:center;text-align:center;padding:2rem}
  .beat-inner{max-width:22ch;opacity:0;transform:translateY(18px);transition:opacity .5s ease,transform .5s ease}
  .beat.on .beat-inner{opacity:1;transform:none}
  .beat h2{font-size:clamp(1.8rem,6vw,3.6rem);font-weight:300;letter-spacing:-.02em;line-height:1.1;
           text-shadow:0 2px 40px rgba(0,0,0,.8)}
  .beat p{margin-top:.9rem;color:var(--dim);text-shadow:0 2px 30px rgba(0,0,0,.9)}

  .hud{position:fixed;z-index:3;left:0;right:0;top:0;display:flex;justify-content:space-between;
       padding:1.2rem clamp(1rem,4vw,2.5rem);font-size:.7rem;letter-spacing:.22em;text-transform:uppercase;
       color:#fff;mix-blend-mode:difference;pointer-events:none}
  .bar{position:fixed;z-index:3;left:0;bottom:0;height:2px;background:var(--accent);width:0}

  .loading{position:fixed;inset:0;z-index:4;display:grid;place-items:center;background:var(--bg);
           transition:opacity .6s ease}
  .loading.gone{opacity:0;pointer-events:none}
  .loading p{font-size:.7rem;letter-spacing:.24em;text-transform:uppercase;color:var(--dim)}

  .after{position:relative;z-index:2;background:var(--bg);padding:clamp(3rem,8vw,6rem) 1.5rem}
  .after .wrap{width:min(70ch,100%);margin-inline:auto}
  .after h3{font-size:1.5rem;font-weight:300;margin-bottom:.8rem}
  .after p{color:var(--dim)}

  /*
    Without motion, the film becomes a contact sheet: the beats are readable
    as a normal page and a few stills stand in for the movement. The content
    is never removed, only the scrubbing.
  */
  @media (prefers-reduced-motion: reduce){
    .stage{display:none}
    .spacer{background:var(--bg)}
    .beat{height:auto;padding-block:3rem}
    .beat-inner{opacity:1;transform:none}
    .still{display:block;width:100%;max-width:60ch;margin:1.5rem auto 0;border-radius:4px}
  }
  .still{display:none}
</style>
</head>
<body>
<a class="skip" href="#after">Skip the film</a>

<div class="loading" id="loading"><p>Loading the film…</p></div>

<div class="stage" aria-hidden="true"><canvas id="film"></canvas></div>

<div class="hud">
  <span>${esc(spec?.brandName ?? manifest.concept ?? "")}</span>
  <span id="hud-chapter">${esc(chapters[0]?.name ?? "")}</span>
</div>
<div class="bar" id="bar"></div>

<main class="spacer">
${chapters.map((c, i) => `  <section class="beat" data-beat="${i}">
    <div class="beat-inner">
      <h2>${esc(c.name)}</h2>
      <p>${esc(c.visual)}</p>
      <img class="still" src="${esc(framePath)}/f-${String(Math.max(1, Math.round((i + 0.5) / chapters.length * total))).padStart(4, "0")}.${esc(frameExt)}" alt="" loading="lazy" />
    </div>
  </section>`).join("\n")}
</main>

<div class="after" id="after">
  <div class="wrap">
    <h3>${esc(manifest.concept ?? "")}</h3>
    <p>${esc(spec?.journey ?? "")}</p>
  </div>
</div>

<script>
(function () {
  var TOTAL = ${total};
  var PATH = ${JSON.stringify(framePath)};
  var EXT = ${JSON.stringify(frameExt)};
  var WINDOW = 24;            // bitmaps held either side of the current frame
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var canvas = document.getElementById('film');
  var loading = document.getElementById('loading');
  var bar = document.getElementById('bar');
  var hudChapter = document.getElementById('hud-chapter');
  var ctx = canvas.getContext('2d', { alpha: false });

  if (reduced) { loading.classList.add('gone'); window.__ready = true; return; }

  function src(n) {
    return PATH + '/f-' + String(n).padStart(4, '0') + '.' + EXT;
  }

  /* Decoded frames, keyed by index. Only a window is kept; the rest are
     closed so a long film does not grow until the tab is killed. */
  var bitmaps = new Map();
  var pending = new Map();

  function load(n) {
    if (n < 1 || n > TOTAL) return;
    if (bitmaps.has(n) || pending.has(n)) return;
    var p = fetch(src(n))
      .then(function (r) { return r.blob(); })
      .then(createImageBitmap)
      .then(function (bmp) {
        bitmaps.set(n, bmp);
        pending.delete(n);
        /*
          Draw on arrival if this is the frame we are actually waiting for.

          Without this the canvas goes stale on any fast scroll: draw() is
          called for a frame that has not decoded yet, finds nothing, and
          holds the last one — and when the frame finally arrives, nothing
          asks for it to be painted. The scrub looked frozen for exactly as
          long as the network took.
        */
        if (n === Math.round(shown) || n === target) draw(n);
        return bmp;
      })
      .catch(function () { pending.delete(n); });
    pending.set(n, p);
  }

  function trim(current) {
    bitmaps.forEach(function (bmp, n) {
      if (Math.abs(n - current) > WINDOW) {
        if (bmp.close) bmp.close();
        bitmaps.delete(n);
      }
    });
  }

  function fit() {
    var dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  }

  var lastDrawn = -1;
  function draw(n) {
    var bmp = bitmaps.get(n);
    if (!bmp) {
      // Nearest already-decoded frame rather than a blank canvas — a held
      // frame reads as slow, an empty one reads as broken.
      var best = null, bestDist = Infinity;
      bitmaps.forEach(function (_b, k) {
        var d = Math.abs(k - n);
        if (d < bestDist) { bestDist = d; best = k; }
      });
      if (best === null) return;
      bmp = bitmaps.get(best);
    }
    var cw = canvas.width, ch = canvas.height;
    var scale = Math.max(cw / bmp.width, ch / bmp.height);
    var w = bmp.width * scale, h = bmp.height * scale;
    ctx.drawImage(bmp, (cw - w) / 2, (ch - h) / 2, w, h);
    lastDrawn = n;
  }

  var target = 1, shown = 1, ticking = false;

  function onScroll() {
    var max = document.body.scrollHeight - innerHeight;
    var progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    target = Math.min(TOTAL, Math.max(1, Math.round(progress * (TOTAL - 1)) + 1));
    bar.style.width = (progress * 100) + '%';

    for (var i = target - 4; i <= target + WINDOW; i++) load(i);

    if (!ticking) { ticking = true; schedule(tick); }
  }

  /*
    requestAnimationFrame with a timer behind it.

    rAF is throttled to nothing in a background tab or an unfocused pane, and
    an easing loop that only advances on rAF simply stops there — the canvas
    freezes on whatever frame it last drew while the scroll position carries
    on moving. The timer is slower and that is fine; it only ever runs when
    rAF is not.
  */
  function schedule(fn) {
    var done = false;
    function once() { if (!done) { done = true; fn(); } }
    requestAnimationFrame(once);
    setTimeout(once, 32);
  }

  function tick() {
    // Eased towards the target rather than snapped, so a flicked scroll
    // reads as motion instead of a jump.
    shown += (target - shown) * 0.25;
    var n = Math.round(shown);
    if (n !== lastDrawn) draw(n);
    trim(n);
    if (Math.abs(target - shown) > 0.5) schedule(tick);
    else { ticking = false; shown = target; draw(target); }
  }

  var beats = [].slice.call(document.querySelectorAll('.beat'));
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('on');
        var i = Number(e.target.dataset.beat);
        if (hudChapter) hudChapter.textContent = CHAPTERS[i] || '';
      }
    });
  }, { threshold: 0.45 });
  beats.forEach(function (b) { io.observe(b); });

  var CHAPTERS = ${JSON.stringify(chapters.map((c) => c.name))};

  addEventListener('resize', function () { fit(); draw(lastDrawn > 0 ? lastDrawn : 1); });
  addEventListener('scroll', onScroll, { passive: true });

  fit();

  /* Decode a first run before revealing anything, so the page does not open
     on an empty canvas. */
  var warm = [];
  for (var i = 1; i <= Math.min(WINDOW, TOTAL); i++) { load(i); warm.push(pending.get(i)); }

  Promise.all(warm).then(function () {
    draw(1);
    loading.classList.add('gone');
    onScroll();
    // Fires even if rAF is throttled — see the note in the site renderer.
    var settled = false;
    function ready() { if (!settled) { settled = true; window.__ready = true; } }
    requestAnimationFrame(ready);
    setTimeout(ready, 400);
  });
})();
</script>
</body>
</html>
`;
}
