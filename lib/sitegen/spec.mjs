import { z } from "zod";

/*
  The design spec a generated scroll-film site is assembled from. Server-only.

  ── the architectural decision ──

  The model is not asked to write HTML. It is asked to make the decisions that
  require taste — the concept, the palette, the type pairing, the journey, the
  chapter copy — and returns them as data. lib/sitegen/render.mjs turns that
  data into the page.

  Two reasons, both learned the hard way on this site.

  First, a model emitting a 1500-line HTML document is one truncation away
  from a broken page, and a truncated document still looks like a document.
  The workflow planner shipped a one-step plan for exactly this reason before
  the stop_reason check was added.

  Second, scroll animation is unforgiving mechanically. ScrollTrigger pins
  must be created before ambient triggers or everything after a pin spacer is
  silently mis-positioned. A model writing that from scratch each time will
  get it right most of the time, and "most of the time" is not a product. The
  renderer gets it right every time because it is code with tests.

  So the model picks a motion from a fixed vocabulary; the renderer implements
  that vocabulary correctly.
*/

/** Scene types the renderer knows how to build. The model composes with these. */
export const MOTIONS = [
  "pin-zoom",       // pinned; the scene scales and drifts as it scrubs
  "char-reveal",    // headline splits to characters and rises
  "horizontal",     // pinned horizontal run with parallax on the cards
  "clip-reveal",    // a clip-path wipe uncovers the scene
  "layer-parallax", // stacked layers moving at different rates
  "counter",        // a figure counts up as the scene scrubs
];

export const ChapterSchema = z.object({
  /** Two or three words. Shown in the chapter readout. */
  name: z.string(),
  /** Small line above the headline — a location, a time, a state. */
  kicker: z.string(),
  /** The line that carries this beat. Short enough to read while scrolling. */
  headline: z.string(),
  /** One or two sentences underneath. May be empty on a pure-image beat. */
  body: z.string(),
  /** Which scene the renderer should build. */
  motion: z.enum(MOTIONS),
  /**
   * What the visitor is looking at, in one sentence. In the pure-code lane
   * this drives the CSS gradient world and the shapes; with a video engine
   * connected it becomes the shot prompt.
   */
  visual: z.string(),
  /** Only for the counter motion: the figure and its label. */
  counterTo: z.number().nullable(),
  counterLabel: z.string(),
});

export const SectionSchema = z.object({
  title: z.string(),
  body: z.string(),
  items: z.array(z.object({ heading: z.string(), text: z.string() })),
});

/*
  The second language.

  Every site is built bilingual: the language its audience actually reads,
  and English. A barber in Taipei needs Chinese for their customers and
  English for everyone else, and shipping only one of those halves the site.

  Mirrors the text fields and nothing else. Palette, type and motion are not
  translated — they are the same design either way — so this carries words
  only, and the renderer emits both and lets the reader choose.
*/
export const AltCopySchema = z.object({
  tagline: z.string(),
  conceptName: z.string(),
  chapters: z.array(z.object({
    name: z.string(),
    kicker: z.string(),
    headline: z.string(),
    body: z.string(),
    counterLabel: z.string(),
  })),
  /* Mirrors SectionSchema exactly. The first version guessed at this shape
     and got it wrong — {heading, body, items:string[]} against the real
     {title, body, items:[{heading,text}]} — which would have validated and
     then rendered nothing. */
  sections: z.array(z.object({
    title: z.string(),
    body: z.string(),
    items: z.array(z.object({ heading: z.string(), text: z.string() })),
  })),
  cta: z.object({ heading: z.string(), body: z.string(), label: z.string() }),
  footerNote: z.string(),
});

export const SiteSpecSchema = z.object({
  /* ── the brand ── */
  brandName: z.string(),
  tagline: z.string(),
  /** The concept, named. A title is half the sell. */
  conceptName: z.string(),
  /** The one continuous shot, top to bottom, in one sentence. */
  journey: z.string(),

  /* ── the world ── */
  palette: z.object({
    bg: z.string(),      // deepest background
    surface: z.string(), // raised panels
    ink: z.string(),     // primary text
    dim: z.string(),     // secondary text
    accent: z.string(),  // the brand colour
    accent2: z.string(), // a second, for gradients and depth
  }),
  type: z.object({
    /** A Google Font with real character. Never a system default. */
    display: z.string(),
    displayWeights: z.string(),
    body: z.string(),
    bodyWeights: z.string(),
  }),

  /* ── the film ── */
  chapters: z.array(ChapterSchema),

  /* ── language ──
     `primary` is what the business's own audience reads; `alt` is the same
     site in the other language. When the primary IS English there is nothing
     to pair it with and alt is null. */
  language: z.object({
    primary: z.string(),
    primaryLabel: z.string(),
    secondary: z.string().nullable(),
    secondaryLabel: z.string().nullable(),
  }),
  alt: AltCopySchema.nullable(),

  /* ── what comes after it ── */
  sections: z.array(SectionSchema),
  cta: z.object({ heading: z.string(), body: z.string(), label: z.string() }),
  footerNote: z.string(),
});

/**
 * Checks what the schema cannot.
 *
 * A spec can validate and still produce a bad page — four chapters that all
 * use the same motion is a slideshow, not a film, and a palette whose text
 * does not contrast with its background is unreadable however good the copy is.
 */
export function validateSpec(spec) {
  const problems = [];

  if (spec.chapters.length < 3) problems.push("fewer than three chapters is not a journey");
  if (spec.chapters.length > 7) problems.push("more than seven chapters and nobody reaches the end");

  const motions = new Set(spec.chapters.map((c) => c.motion));
  if (spec.chapters.length >= 4 && motions.size < 3) {
    problems.push("too few distinct motions — the same scene repeated is a slideshow");
  }

  for (const [key, value] of Object.entries(spec.palette)) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) problems.push(`palette.${key} is not a hex colour`);
  }

  /*
    Every pair the renderer actually puts text on, at the threshold its size
    earns.

    One check used to live here — ink on bg — and it passed palettes whose
    secondary text was unreadable, because .ch-body, .lede and .hours are all
    --dim, and .ch-kicker is --accent at .66rem. A page can meet its only
    contrast test and still be squinted at everywhere that matters.

    WCAG: 4.5:1 for normal text, 3:1 once it is large (24px+, which the
    counter and the hero comfortably are). The pairs and sizes below were
    read off render.mjs rather than assumed, so this list is a fact about
    the stylesheet and has to be revisited if the stylesheet changes.
  */
  const pairs = [
    { fg: "ink",     bg: "bg",      min: 4.5, what: "body text on the background" },
    { fg: "dim",     bg: "bg",      min: 4.5, what: "secondary text (.ch-body, .lede, .hours) on the background" },
    { fg: "accent",  bg: "bg",      min: 4.5, what: "kickers and small accent text on the background" },
    { fg: "ink",     bg: "surface", min: 4.5, what: "card text on the surface" },
    { fg: "dim",     bg: "surface", min: 4.5, what: "secondary card text on the surface" },
    // The primary button paints bg on accent, so it is the same two colours
    // read the other way and needs its own line to be honest about why.
    { fg: "bg",      bg: "accent",  min: 4.5, what: "the button label on the accent" },
    { fg: "accent2", bg: "bg",      min: 3.0, what: "the second accent on the background" },
  ];

  for (const { fg, bg, min, what } of pairs) {
    const ratio = contrast(spec.palette[fg], spec.palette[bg]);
    if (ratio < min) {
      problems.push(
        `${what} is ${ratio.toFixed(2)}:1 — needs ${min}:1 ` +
        `(palette.${fg} ${spec.palette[fg]} on palette.${bg} ${spec.palette[bg]})`,
      );
    }
  }

  /* A promised second language that did not arrive is worse than a
     monolingual site: the toggle appears and shows nothing. */
  if (spec.language?.secondary && !spec.alt) {
    problems.push(`a second language (${spec.language.secondary}) was declared but no translated copy was returned`);
  }
  if (spec.alt && spec.alt.chapters.length !== spec.chapters.length) {
    problems.push(
      `the translation has ${spec.alt.chapters.length} chapters and the design has ${spec.chapters.length} — ` +
      "every chapter must exist in both languages",
    );
  }
  if (spec.alt && spec.alt.sections.length !== spec.sections.length) {
    problems.push("the translation and the design have different numbers of content sections");
  }

  const counters = spec.chapters.filter((c) => c.motion === "counter");
  for (const c of counters) {
    if (c.counterTo === null) problems.push(`the counter chapter "${c.name}" has no figure to count to`);
  }

  return { ok: problems.length === 0, problems };
}

/* WCAG relative luminance and contrast ratio. Used to reject an unreadable
   palette before it is ever rendered, rather than after someone squints. */
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/*
  What the studio is told it is doing.

  Kept beside the schema rather than in the route that happens to call it:
  the prompt and the shape it must return are one contract, and a local
  runner reproducing the prompt from memory would drift from the tool the
  moment either changed.
*/
export const SITE_SYSTEM = `You art-direct scroll-film websites: a page whose hero IS the
page — one unbroken cinematic journey that scrubs as the visitor scrolls, then
resolves into the content below.

You return a design spec. You never write HTML, CSS or JavaScript; a renderer
builds the page from what you decide. Your job is entirely taste.

EVERY SITE IS BILINGUAL. Write the site in the language its own customers
read, and again in English. A barber in Taipei needs Chinese for the people
who walk past and English for everyone else; shipping one of those halves
the site. Set language.primary to the business's own language and
language.secondary to "en", and fill alt with the same site in English —
same number of chapters, same number of sections, in the same order.

Translate as a copywriter, not a dictionary. The English is not a gloss of
the Chinese; it is the same idea written well for someone who reads English.
Names of the business stay as they are.

The one exception: if the business's own language IS English, set
language.secondary to null and alt to null. There is nothing to pair.

What you decide:

1. THE CONCEPT. Name it — a title is half the sell. Then the journey: the one
   continuous shot, top to bottom, as a single sentence. Not a theme, a
   transformation. "Moonlit field, into a single bloom, into a drop of gold,
   pull back and you are inside the bottle" is a journey. "A modern site
   showcasing our values" is not.

2. THE WORLD. An exact palette and a type pairing with real character.

   CONTRAST IS NOT NEGOTIABLE, and a spec that fails it is rejected before it
   renders — costing the visitor the whole wait. Every one of these must hold:

     ink     on bg       >= 4.5:1     body text
     dim     on bg       >= 4.5:1     secondary text, and it is used a lot
     accent  on bg       >= 4.5:1     kickers are small, so they need the full ratio
     ink     on surface  >= 4.5:1     card text
     dim     on surface  >= 4.5:1
     bg      on accent   >= 4.5:1     the button label sits on the accent
     accent2 on bg       >= 3.0:1

   The trap is a beautiful accent that is too close in luminance to the
   background — a soft gold on cream, a dusty blue on slate. It looks
   considered in your head and is unreadable on the page. Pick the accent for
   the world, then darken or lighten it until it clears the ratio, rather
   than picking a pretty value and hoping.

   Never default system fonts — reach for expressive display faces on Google Fonts
   (Fraunces, Instrument Serif, Bodoni Moda, Syne, Unbounded, Playfair
   Display, DM Serif Display, Cormorant, Space Grotesk…) paired with a clean
   body face. Two brands must never look like the same site.

   The palette must be readable: body ink against the background needs at
   least 4.5:1. A gorgeous unreadable page is a failed page.

3. THE CHAPTERS. Four to six beats of the journey, in order, each with a
   motion from the vocabulary. Vary them — four chapters on one motion is a
   slideshow, not a film. Use "counter" at most once, and only where a real
   figure belongs. Write the copy tight: a headline is read while moving.

4. WHAT COMES AFTER. Two or three real content sections, then one call to
   action. Write these as the brand would, in its own voice.

Rules:

- Write copy for THIS brand. No filler, no "Lorem", no "Your headline here",
  no placeholder brackets. If the brief is thin, invent something specific and
  committed rather than something generic and safe.
- Never invent statistics, customer counts, awards or testimonials. If you
  want a number in a counter, it must be something the brief supports or a
  plainly non-factual unit (kilometres of coastline, hours of daylight).
- British English.
- The visual field for each chapter describes what the visitor is looking at
  in one sentence — it drives the generated world, and later the shot prompt
  if real footage is added.`;
