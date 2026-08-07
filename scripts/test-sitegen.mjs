/*
  Tests the scroll-film site generator.

    node scripts/test-sitegen.mjs

  The renderer exists so that the mechanically unforgiving parts of a scroll
  film are correct every time rather than most of the time. These tests are
  about those parts — the ones that fail silently.

  The load-bearing one is ScrollTrigger creation order. Creation order is
  refresh order: an ambient trigger created before a pinned scene is measured
  against a layout that does not yet include that pin's spacer, and every
  trigger after it lands in the wrong place. Nothing errors. The page just
  scrolls wrong, in a way that takes an afternoon to trace.
*/

import { MOTIONS, contrast, validateSpec } from "../lib/sitegen/spec.mjs";
import { describeSpec, renderSite } from "../lib/sitegen/render.mjs";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const chapter = (over = {}) => ({
  name: "Descent", kicker: "0300 hours", headline: "Down through the dark",
  body: "The camera falls. Nothing below but water.", motion: "pin-zoom",
  visual: "A black sea from above", counterTo: null, counterLabel: "",
  ...over,
});

const spec = (over = {}) => ({
  brandName: "VOLTA", tagline: "An electric race team.",
  conceptName: "Night Circuit", journey: "From the dark into the light of the grid.",
  palette: { bg: "#07080c", surface: "#11131b", ink: "#eceae4", dim: "#9a978f",
             accent: "#d4af6a", accent2: "#7ab8d4" },
  type: { display: "Fraunces", displayWeights: "300;400", body: "Inter", bodyWeights: "300;400;500" },
  chapters: [
    chapter(),
    chapter({ name: "Ignition", motion: "char-reveal", headline: "Then everything at once" }),
    chapter({ name: "The Run", motion: "horizontal", body: "First corner. Second corner. The straight." }),
    chapter({ name: "Result", motion: "counter", counterTo: 1420, counterLabel: "kilometres" }),
  ],
  sections: [{ title: "The team", body: "Who we are.", items: [{ heading: "Drivers", text: "Two." }] }],
  cta: { heading: "Come to a race", body: "Tickets open in March.", label: "Join the list" },
  footerNote: "Built by CM Solutions",
  ...over,
});

console.log("\nPinned scenes are created before ambient triggers");
{
  const html = renderSite(spec());
  const script = html.slice(html.lastIndexOf("<script>"));

  const pinBlock = script.indexOf("PINNED SCENES FIRST");
  const ambientBlock = script.indexOf("AMBIENT TRIGGERS");
  check("both blocks exist and are labelled", pinBlock > -1 && ambientBlock > -1);
  check("the pinned block comes first", pinBlock < ambientBlock, `${pinBlock} vs ${ambientBlock}`);

  // The specific failure: a hero drift trigger created before the scene pins.
  const firstPin = script.indexOf("pin: true");
  const firstDrift = script.indexOf("data-drift");
  check("the first pin is created before the first ambient scrub",
    firstPin > -1 && firstDrift > firstPin, `pin@${firstPin} drift@${firstDrift}`);
}

console.log("\nLenis and ScrollTrigger are wired to each other, not competing");
{
  const html = renderSite(spec());
  check("Lenis pushes scroll into ScrollTrigger", html.includes("lenis.on('scroll', ScrollTrigger.update)"));
  check("Lenis is driven from the gsap ticker", html.includes("gsap.ticker.add"));
  check("lag smoothing is off, or the scrub jumps after a stall",
    html.includes("lagSmoothing(0)"));
}

console.log("\nEvery motion in the vocabulary is actually implemented");
{
  for (const motion of MOTIONS) {
    const html = renderSite(spec({
      chapters: [chapter({ motion, counterTo: motion === "counter" ? 10 : null })],
    }));
    check(`${motion} renders a scene`, html.includes(`data-motion="${motion}"`));
    if (motion !== "layer-parallax") {
      const script = html.slice(html.lastIndexOf("<script>"));
      check(`${motion} is handled in the timeline`, script.includes(`'${motion}'`) || motion === "pin-zoom");
    }
  }
}

console.log("\nReduced motion keeps the content and drops only the movement");
{
  const html = renderSite(spec());
  const i = html.indexOf("prefers-reduced-motion");
  const block = html.slice(i, i + 700);
  check("a reduced-motion block exists", i > -1);
  check("it forces content visible rather than hiding it",
    block.includes("opacity:1!important"), block.slice(0, 120));
  check("it un-clips the clip-reveal scenes", block.includes("clip-path:none"));
  check("the horizontal run wraps instead of scrolling sideways", block.includes("flex-wrap:wrap"));
  // And the script bails before building any of it.
  check("the script exits early under reduced motion",
    html.includes("if (reduced || !window.gsap"), "");
}

console.log("\nUser text cannot break out of the document");
{
  const nasty = spec({
    brandName: '</script><script>alert(1)</script>',
    tagline: '"><img src=x onerror=alert(1)>',
    sections: [{ title: "<svg onload=alert(1)>", body: "&", items: [] }],
  });
  const html = renderSite(nasty);
  /*
    What matters is that no TAG is formed and no attribute is broken out of.
    The literal characters of an attempted payload surviving as inert text is
    correct — it is what the user typed and it cannot execute. An earlier
    version of this test searched for the substring "onerror=alert" and failed
    on output that was perfectly safe, which is the kind of check people learn
    to switch off.
  */
  /*
    Counted, not searched. The renderer legitimately emits four script tags —
    three CDN libraries and one inline — so searching the whole document for
    "<script" matches its own output. An injection would push the count above
    four; nothing else can.
  */
  const clean = renderSite(spec());
  const scriptCount = (html.match(/<script\b/gi) || []).length;
  check("user text adds no script tag",
    scriptCount === (clean.match(/<script\b/gi) || []).length, `${scriptCount}`);
  check("user text adds no img or svg tag", !/<(img|svg)\b/i.test(html),
    (html.match(/<(img|svg)\b[^>]*/i) || [""])[0]);
  check("no attribute is broken out of",
    !/content="[^"]*"[^>]*\son\w+=/i.test(html));
  check("angle brackets are encoded", html.includes("&lt;") && html.includes("&gt;"));
  check("quotes are encoded inside attributes", html.includes("&quot;"));
  check("the ampersand is encoded", html.includes("&amp;"));
}

console.log("\nA spec that would render badly is rejected before it renders");
{
  check("a sound spec passes", validateSpec(spec()).ok, JSON.stringify(validateSpec(spec()).problems));

  const oneNote = validateSpec(spec({
    chapters: [chapter(), chapter({ name: "B" }), chapter({ name: "C" }), chapter({ name: "D" })],
  }));
  check("four chapters on one motion is called a slideshow",
    !oneNote.ok && oneNote.problems.some((p) => /slideshow/.test(p)), JSON.stringify(oneNote.problems));

  const tooShort = validateSpec(spec({ chapters: [chapter(), chapter({ name: "B" })] }));
  check("two chapters is not a journey", !tooShort.ok);

  const unreadable = validateSpec(spec({
    palette: { ...spec().palette, ink: "#0a0b0f" },   // near-black on black
  }));
  check("an unreadable palette is rejected",
    !unreadable.ok && unreadable.problems.some((p) => /4\.5:1/.test(p)),
    JSON.stringify(unreadable.problems));

  const badHex = validateSpec(spec({ palette: { ...spec().palette, accent: "gold" } }));
  check("a colour that is not a hex is rejected", !badHex.ok);

  const noFigure = validateSpec(spec({
    chapters: [chapter(), chapter({ name: "B", motion: "char-reveal" }),
               chapter({ name: "C", motion: "counter", counterTo: null })],
  }));
  check("a counter chapter with nothing to count to is rejected",
    !noFigure.ok && noFigure.problems.some((p) => /count to/.test(p)));
}

console.log("\nContrast maths matches the WCAG definition");
{
  check("black on white is 21:1", Math.round(contrast("#000000", "#ffffff")) === 21);
  check("a colour against itself is 1:1", Math.round(contrast("#3d5a80", "#3d5a80")) === 1);
  check("order does not matter",
    Math.abs(contrast("#111111", "#eeeeee") - contrast("#eeeeee", "#111111")) < 1e-9);
}

console.log("\nThe document is complete and self-contained");
{
  const html = renderSite(spec());
  check("it is a full document", html.startsWith("<!doctype html>") && html.trim().endsWith("</html>"));
  check("it declares a language", html.includes('<html lang="en">'));
  check("it has a title and a description", /<title>.+<\/title>/.test(html) && html.includes('name="description"'));
  check("it carries a skip link past the film", html.includes('class="skip"') && html.includes('href="#after"'));
  check("both fonts are requested", html.includes("Fraunces") && html.includes("Inter"));
  check("the dev contract is present", html.includes("__ready") && html.includes("jump"));
  /*
    Browsers throttle requestAnimationFrame in background tabs and hidden
    iframes — precisely where a screenshot harness or a preview pane runs the
    page. A ready signal that depends on rAF alone never resolves there, and
    the harness waits forever for a page that is fine.
  */
  check("readiness does not depend on rAF alone", html.includes("setTimeout(markReady"));
  check("and it is idempotent", html.includes("if (settled) return"));

  // Every chapter must reach the page — a dropped one is a silent content loss.
  for (const c of spec().chapters) {
    check(`chapter "${c.name}" is in the output`, html.includes(c.name));
  }
}

console.log("\nThe summary reflects the spec");
{
  const d = describeSpec(spec());
  check("it names the concept", d.concept === "Night Circuit");
  check("it lists every chapter with its motion", d.chapters.length === 4 && d.chapters[2].motion === "horizontal");
  check("it reports both fonts", d.fonts.length === 2);
}

/* ── contrast, on every pair the renderer actually paints ──────────────
   The gate used to check one pair and pass palettes whose secondary text
   was unreadable. These cases lock that shut: two palettes that shipped
   must keep passing, and each failure mode must still be caught. */
{
  const chapters = Array.from({ length: 5 }, (_, i) => ({
    name: `C${i}`,
    motion: ["pin-zoom", "char-reveal", "counter", "clip-reveal", "horizontal"][i],
    counterTo: 5,
  }));

  const shipped = {
    "light palette that shipped": { bg: "#f4efe6", surface: "#e8e0d2", ink: "#221c14", dim: "#6b6053", accent: "#9c3b23", accent2: "#7f8a6b" },
    "dark palette that shipped": { bg: "#141210", surface: "#1b1815", ink: "#efe9df", dim: "#a09789", accent: "#b98a5e", accent2: "#7f9a8b" },
  };
  for (const [name, palette] of Object.entries(shipped)) {
    const r = validateSpec({ chapters, palette });
    check(`${name} still passes`, r.ok, r.problems.join("; "));
  }

  const bad = {
    "unreadable secondary text": { bg: "#141210", surface: "#1b1815", ink: "#efe9df", dim: "#3a352e", accent: "#b98a5e", accent2: "#7f9a8b" },
    "pale accent on a light background": { bg: "#f4efe6", surface: "#e8e0d2", ink: "#221c14", dim: "#6b6053", accent: "#e8c9a0", accent2: "#7f8a6b" },
    "text the same colour as its card": { bg: "#141210", surface: "#1b1815", ink: "#1c1916", dim: "#a09789", accent: "#b98a5e", accent2: "#7f9a8b" },
  };
  for (const [name, palette] of Object.entries(bad)) {
    const r = validateSpec({ chapters, palette });
    check(`rejected: ${name}`, !r.ok);
    check(`  ...and says which pair`, r.problems.some((p) => p.includes(":1")));
  }
}

/* ── bilingual output ──────────────────────────────────────────────────
   The first version wired only the chapters, so a Chinese site toggled to
   English and kept its Chinese tagline, sections, call to action and
   footer. These assert that every user-facing string has both languages,
   and that a monolingual site carries none of the machinery. */
{
  const zh = {
    brandName: "醉漢理髮店", tagline: "好椅子", conceptName: "刀鋒", journey: "j", footerNote: "台北",
    cta: { heading: "預約", body: "內文", label: "預約" },
    palette: { bg: "#0b1620", surface: "#12222e", ink: "#eef3f6", dim: "#9db2c0", accent: "#99d3de", accent2: "#4e99bc" },
    type: { display: "Noto Serif TC", displayWeights: "400", body: "Josefin Sans", bodyWeights: "300" },
    chapters: Array.from({ length: 3 }, (_, i) => ({
      name: `C${i}`, kicker: "刻", headline: "標題", body: "內文", visual: "v",
      motion: ["pin-zoom", "clip-reveal", "counter"][i], counterTo: 1, counterLabel: "年",
    })),
    sections: [{ title: "服務", body: "服務內文", items: [{ heading: "剪髮", text: "說明" }] }],
    language: { primary: "zh-hant", primaryLabel: "中文", secondary: "en", secondaryLabel: "English" },
    alt: {
      tagline: "A good chair", conceptName: "The Blade",
      chapters: Array.from({ length: 3 }, () => ({ name: "C", kicker: "Cut", headline: "A headline", body: "Body", counterLabel: "years" })),
      sections: [{ title: "Services", body: "Service body", items: [{ heading: "Cuts", text: "Detail" }] }],
      cta: { heading: "Book", body: "CTA body", label: "Book" }, footerNote: "Taipei",
    },
  };

  const html = renderSite(zh);
  const english = [...html.matchAll(/data-l="b">([^<]*)</g)].map((m) => m[1]);

  for (const [what, str] of [
    ["the tagline", "A good chair"], ["a section title", "Services"], ["a section body", "Service body"],
    ["a card heading", "Cuts"], ["a card body", "Detail"], ["the cta heading", "Book"],
    ["the cta body", "CTA body"], ["the footer", "Taipei"], ["a chapter headline", "A headline"],
  ]) check(`translated: ${what}`, english.includes(str));

  check("the document declares the primary language", /<html lang="zh-hant"/.test(html));
  check("a language toggle is offered", /<button class="langtog"/.test(html));
  check("the secondary language is hidden by default", html.includes('[data-l="b"]{display:none}'));
  check("CJK gets looser leading", /\.hero h1\{[^}]*line-height:1\.16/.test(html));

  const mono = renderSite({ ...zh, language: { primary: "en", primaryLabel: "English", secondary: null, secondaryLabel: null }, alt: null });
  check("a monolingual site carries no language spans", !/<span lang=/.test(mono));
  check("a monolingual site offers no toggle", !/<button class="langtog"/.test(mono));
  check("latin keeps its tight leading", /\.hero h1\{[^}]*line-height:\.94/.test(mono));
}

/* ── how many photographs earn a place ────────────────────────────────
   One image round-robinned is the same picture behind every scene, top to
   bottom. That shipped, and it looks like a bug because it is one. */
{
  const base = {
    brandName: "M", tagline: "t", conceptName: "c", journey: "j", footerNote: "f",
    cta: { heading: "h", body: "b", label: "l" },
    palette: { bg: "#0f1210", surface: "#1b1815", ink: "#efe9df", dim: "#a09789", accent: "#b98a5e", accent2: "#7f9a8b" },
    type: { display: "Fraunces", displayWeights: "400", body: "Karla", bodyWeights: "300" },
    chapters: Array.from({ length: 6 }, (_, i) => ({
      name: `C${i}`, kicker: "k", headline: "h", body: "b", visual: "v",
      motion: ["pin-zoom", "clip-reveal", "char-reveal", "counter", "horizontal", "layer-parallax"][i],
      counterTo: 1, counterLabel: "l",
    })),
    sections: [{ title: "t", body: "b", items: [{ heading: "h", text: "x" }] }],
  };
  const count = (imgs) => {
    const h = renderSite({ ...base, images: imgs });
    return {
      hero: (h.match(/hero-photo"><img/g) ?? []).length,
      scenes: (h.match(/class="scene-photo"><img/g) ?? []).length,
    };
  };

  const one = count(["a.jpg"]);
  check("a single image goes behind the hero", one.hero === 1);
  check("a single image is NOT repeated across the scenes", one.scenes === 0);

  const two = count(["a.jpg", "b.jpg"]);
  check("two images still stay off the scenes", two.scenes === 0);

  const six = count(["a", "b", "c", "d", "e", "f"].map((x) => `${x}.jpg`));
  check("six images light every scene", six.scenes === 6 && six.hero === 1);

  const none = count([]);
  check("no images means no photo layers at all", none.hero === 0 && none.scenes === 0);
}

console.log(
  failures === 0 ? "\nAll site-generator tests passed.\n" : `\n${failures} test(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
