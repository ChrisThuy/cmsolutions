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

  if (contrast(spec.palette.ink, spec.palette.bg) < 4.5) {
    problems.push("body text does not meet 4.5:1 against the background");
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
