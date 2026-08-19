/* ============================================================
   PARTICLE CONSTELLATIONS
   ------------------------------------------------------------
   Each project mark on this page is already an SVG. This script
   reads that SVG, samples where it has ink, and rebuilds it as a
   cloud of tiny outlined triangles in the Dala spectrum.

   The clock is scroll. A field is a loose cloud when its section
   is far from the centre of the viewport and resolves into the
   mark as the section arrives. Particles settle and then stop, so
   a still page is a still page. The pointer pushes them apart.
   ============================================================ */
(() => {
  "use strict";

  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* The vivid spectrum the reference uses for its point field.
     Weighted, so violet leads and the rest punctuate. */
  const SPECTRUM = [
    "#8052ff", "#8052ff", "#8052ff", "#8052ff",   /* electric iris  */
    "#ffb829", "#ffb829",                          /* saffron spark  */
    "#15846e",                                     /* deep verdant   */
    "#5b7cff",                                     /* blue           */
    "#c65cff"                                      /* magenta        */
  ];

  const SAMPLE_SIZE   = 300;   /* offscreen raster edge, in px      */
  const SAMPLE_STEP   = 1;     /* read every Nth pixel              */
  const ALPHA_FLOOR   = 36;    /* below this the pixel is not ink   */
  const MAX_PARTICLES = 1600;
  const POINTER_R     = 150;   /* repulsion radius, in css px       */
  const POINTER_FORCE = 130;

  /* deterministic shuffle, so a reload gives the same constellation */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------- */
  /* 1. turn one inline <svg> into a list of ink points          */
  /* ---------------------------------------------------------- */
  function samplePoints(svg) {
    return new Promise((resolve, reject) => {
      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", "0 0 400 400");
      clone.setAttribute("width", SAMPLE_SIZE);
      clone.setAttribute("height", SAMPLE_SIZE);

      const markup = new XMLSerializer().serializeToString(clone);
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);

      const img = new Image();
      img.onload = () => {
        const off = document.createElement("canvas");
        off.width = off.height = SAMPLE_SIZE;
        const ctx = off.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        let data;
        try {
          data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
        } catch (err) {
          reject(err);
          return;
        }

        const pts = [];
        for (let y = 0; y < SAMPLE_SIZE; y += SAMPLE_STEP) {
          for (let x = 0; x < SAMPLE_SIZE; x += SAMPLE_STEP) {
            const i = (y * SAMPLE_SIZE + x) * 4;
            const a = data[i + 3];
            if (a < ALPHA_FLOOR) continue;
            const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
            pts.push({
              x: x / SAMPLE_SIZE,          /* 0..1, resolution independent */
              y: y / SAMPLE_SIZE,
              bright: lum * (a / 255)
            });
          }
        }
        resolve(pts);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /* ---------------------------------------------------------- */
  /* 2. one field                                                */
  /* ---------------------------------------------------------- */
  function createField(host, svg, points, seedIndex) {
    const rand = mulberry32(0x9e37 + seedIndex * 7919);

    /* thin the point list down, keeping an even spread */
    if (points.length > MAX_PARTICLES) {
      for (let i = points.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [points[i], points[j]] = [points[j], points[i]];
      }
      points.length = MAX_PARTICLES;
    }

    const canvas = document.createElement("canvas");
    canvas.className = "particle-field";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", host.dataset.artLabel || "Project mark, drawn as a particle constellation");
    host.appendChild(canvas);

    const ctx = canvas.getContext("2d");

    const parts = points.map((p) => {
      const ang = rand() * Math.PI * 2;
      const rad = 0.42 + rand() * 0.72;
      return {
        tx: p.x, ty: p.y,                       /* target, normalised   */
        cx: 0.5 + Math.cos(ang) * rad,          /* scattered, normalised */
        cy: 0.5 + Math.sin(ang) * rad,
        x: 0, y: 0,                             /* current, in css px    */
        vx: 0, vy: 0,
        size: 1.5 + rand() * 2.4,
        rot: rand() * Math.PI * 2,
        colour: p.bright > 0.62 && rand() > 0.45
          ? "#ffffff"
          : SPECTRUM[Math.floor(rand() * SPECTRUM.length)],
        lag: 0.6 + rand() * 0.55,               /* per particle easing   */
        seeded: false
      };
    });

    let W = 0, H = 0, dpr = 1;
    let progress = 0;          /* 0 scattered, 1 resolved */
    let pointer = { x: -9999, y: -9999, on: false };
    let running = false, inView = false, settled = false;

    function resize() {
      const rect = host.getBoundingClientRect();
      const side = Math.max(120, Math.round(rect.width));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = side; H = side;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = W + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!parts[0].seeded) {
        for (const p of parts) {
          p.x = p.cx * W; p.y = p.cy * H; p.seeded = true;
        }
      }
      settled = false;
    }

    /* how centred is this field in the viewport */
    function readProgress() {
      const r = host.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const centre = window.innerHeight / 2;
      const reach = window.innerHeight * 0.78;
      const d = Math.min(1, Math.abs(mid - centre) / reach);
      /* smoothstep, so the resolve eases in rather than tracking linearly */
      const t = 1 - d;
      return t * t * (3 - 2 * t);
    }

    /* outlined triangle, 1px stroke, the reference's particle shape */
    function drawTriangle(p, size, alpha) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = p.rot + (k * 2 * Math.PI) / 3;
        const px = p.x + Math.cos(a) * size;
        const py = p.y + Math.sin(a) * size;
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    /* one synchronous pass. Split out from the rAF loop so the field
       can still be painted where rAF is throttled, and so it can be
       driven directly from a test. */
    function renderOnce() {
      const target = REDUCE ? 1 : progress;
      let moved = 0;

      ctx.clearRect(0, 0, W, H);

      for (const p of parts) {
        const gx = (p.cx + (p.tx - p.cx) * target) * W;
        const gy = (p.cy + (p.ty - p.cy) * target) * H;

        let dx = gx - p.x, dy = gy - p.y;

        if (pointer.on) {
          const px = p.x - pointer.x, py = p.y - pointer.y;
          const dist = Math.hypot(px, py);
          if (dist < POINTER_R && dist > 0.01) {
            const push = (1 - dist / POINTER_R) * POINTER_FORCE;
            dx += (px / dist) * push;
            dy += (py / dist) * push;
          }
        }

        const k = 0.14 * p.lag;
        p.vx = (p.vx + dx * k) * 0.72;
        p.vy = (p.vy + dy * k) * 0.72;
        p.x += p.vx;
        p.y += p.vy;
        moved += Math.abs(p.vx) + Math.abs(p.vy);

        /* scattered points are dimmer and smaller, resolved ones sharp */
        const alpha = 0.28 + target * 0.62;
        drawTriangle(p, p.size * (0.68 + target * 0.42), alpha);
      }

      ctx.globalAlpha = 1;

      /* at rest once nothing is driving the cloud any more */
      settled = moved / parts.length < 0.012 && !pointer.on;
      return settled;
    }

    function frame() {
      if (!inView) { running = false; return; }
      if (renderOnce()) { running = false; return; }
      requestAnimationFrame(frame);
    }

    function kick() {
      if (!inView || running) return;
      running = true;
      requestAnimationFrame(frame);
    }

    /* IntersectionObserver is the cheap path, but it does not fire in
       every context (a prerendered or hidden document, for one). Fall
       back to the rect so a field is never left blank. */
    function checkView() {
      const r = host.getBoundingClientRect();
      const pad = window.innerHeight * 0.2;
      const next = r.bottom > -pad && r.top < window.innerHeight + pad;
      if (next !== inView) {
        inView = next;
        if (inView) { progress = readProgress(); kick(); }
      }
      return inView;
    }

    function onScroll() {
      checkView();
      const next = readProgress();
      if (Math.abs(next - progress) > 0.001) { progress = next; kick(); }
    }

    /* pointer, on the canvas only */
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = true;
      kick();
    });
    canvas.addEventListener("pointerleave", () => {
      pointer.on = false;
      kick();
    });

    const io = new IntersectionObserver((entries) => {
      const next = entries[0].isIntersecting;
      if (next !== inView) {
        inView = next;
        if (inView) { progress = readProgress(); kick(); }
      }
    }, { rootMargin: "20% 0px 20% 0px" });
    io.observe(host);

    const ro = new ResizeObserver(() => { resize(); kick(); });
    ro.observe(host);

    resize();
    checkView();
    progress = readProgress();
    /* paint once immediately, so the field is never an empty box even
       if animation frames never arrive */
    renderOnce();

    return { onScroll, kick, checkView, renderOnce, host, count: parts.length };
  }

  /* ---------------------------------------------------------- */
  /* 3. wire every project mark on the page                      */
  /* ---------------------------------------------------------- */
  const hosts = Array.from(document.querySelectorAll(".chapter-visual"));
  if (!hosts.length) return;

  const fields = [];
  window.__particleFields = fields;   /* handle for verification */

  hosts.forEach((host, i) => {
    const svg = host.querySelector("svg");
    if (!svg) return;
    samplePoints(svg)
      .then((points) => {
        if (!points.length) throw new Error("no ink sampled");
        fields.push(createField(host, svg, points, i));
      })
      .catch(() => {
        /* sampling failed: put the original mark back rather than
           leaving an empty box where a project used to be */
        svg.style.display = "block";
      });
  });

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      for (const f of fields) f.onScroll();
      ticking = false;
    });
  }, { passive: true });

  window.addEventListener("resize", () => { for (const f of fields) f.kick(); }, { passive: true });
})();
