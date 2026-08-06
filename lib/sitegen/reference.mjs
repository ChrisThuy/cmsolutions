/*
  Reading a site the client admires, and turning it into art direction.

  ── what this deliberately does not do ──

  It does not clone. The request behind this feature is usually "make mine
  look like theirs", and the honest version of that is not a copy: taking
  another business's layout, wording or marks and reproducing them is a
  copyright and passing-off problem that lands on the person who published
  it, not on us.

  What designers actually do with a reference is read its register — the
  palette, the type pairing, how loud it is, how it paces — and then make
  something original in that register. So this extracts signals, and the
  signals are what reach the studio. The reference site's sentences, images
  and marks never do.

  ── why the split between here and the studio ──

  Colours and font stacks are mechanical: they are in the markup, and code
  reads them exactly. Tone is a judgement, so a short sample of visible text
  goes to the studio to characterise. The house rule again — code does
  arithmetic, the model does taste.

  ── why Firecrawl rather than fetching it ourselves ──

  We already own a hardened fetcher (lib/audit/safe-fetch.mjs) and it is
  still used here to validate the target before anything leaves. But the
  page itself is fetched by Firecrawl, which means arbitrary user-supplied
  URLs are dereferenced on their infrastructure rather than from inside our
  serverless function — the SSRF surface moves off our network entirely.
  It also renders JavaScript, and a modern site fetched without that is a
  blank div with no palette in it.
*/

import { normaliseTarget, assertPublicHost } from "../audit/safe-fetch.mjs";

const FIRECRAWL = "https://api.firecrawl.dev/v2/scrape";

export const referenceAvailable = () => Boolean(process.env.FIRECRAWL_API_KEY);

/* Colours that carry no design signal: pure black and white appear in every
   reset stylesheet, and fully transparent is not a colour choice. */
const NEUTRAL = new Set(["#000000", "#ffffff", "#fff", "#000", "transparent"]);

const expand = (hex) => {
  const h = hex.toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
};

/**
 * Pulls the colours a page actually uses, most-used first.
 *
 * Frequency matters more than presence: a brand colour appears dozens of
 * times, while a one-off border tint appears once and means nothing.
 */
export function extractPalette(html, limit = 8) {
  const counts = new Map();

  for (const m of html.matchAll(/#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/g)) {
    const hex = expand(m[0]);
    if (NEUTRAL.has(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  // rgb()/rgba() are as common as hex in compiled CSS, and ignoring them
  // loses the palette on any site built with a modern toolchain.
  for (const m of html.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if ([r, g, b].some((v) => v > 255)) continue;
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    if (NEUTRAL.has(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, n]) => n > 1)          // a colour used once is an accident
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex, n]) => ({ hex, uses: n }));
}

/**
 * The typefaces the page asks for.
 *
 * Generic families are dropped — "sans-serif" is what you fall back to, not
 * a decision anyone made.
 */
export function extractFonts(html, limit = 6) {
  const generic = /^(sans-serif|serif|monospace|system-ui|ui-\w+|inherit|initial|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Helvetica|Arial|cursive|fantasy)$/i;
  const found = new Map();

  const add = (name) => {
    const clean = name.replace(/["']/g, "").trim();
    if (!clean || generic.test(clean) || clean.length > 40) return;
    // A CSS variable names nothing: "var(--font-monospace)" tells the studio
    // less than saying nothing at all, and sites built with a modern
    // toolchain are full of them.
    if (/^var\(|^--/.test(clean)) return;
    found.set(clean, (found.get(clean) ?? 0) + 1);
  };

  for (const m of html.matchAll(/font-family\s*:\s*([^;}"']+)/gi)) {
    m[1].split(",").forEach(add);
  }
  // Google Fonts links name the family in the URL, and on many sites that is
  // the only place it appears un-minified.
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>]+)/gi)) {
    for (const f of m[1].matchAll(/family=([^:&]+)/g)) add(decodeURIComponent(f[1].replace(/\+/g, " ")));
  }

  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name);
}

/**
 * Reads a reference site and returns design signals.
 *
 * Throws with a `.reason` a person can act on, because "that did not work"
 * on a URL someone just typed is a dead end — they need to know whether to
 * fix the address or try a different site.
 */
export async function readReference(rawUrl, { signal } = {}) {
  if (!process.env.FIRECRAWL_API_KEY) {
    const e = new Error("Reference reading is not configured.");
    e.reason = "unconfigured";
    throw e;
  }

  /* Validated with our own guard before the address is handed to anyone —
     a private or malformed target should not become someone else's request.
     normaliseTarget throws an UnsafeUrlError and returns a URL; it does not
     return a result object, which the first version of this assumed and so
     rejected every valid address. */
  let target;
  try {
    target = normaliseTarget(rawUrl);
    await assertPublicHost(target.hostname);
  } catch (cause) {
    const e = new Error(cause?.message ?? "That does not look like a website address.");
    e.reason = "bad_url";
    throw e;
  }

  const response = await fetch(FIRECRAWL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: target.href,
      formats: ["markdown", "rawHtml"],
      onlyMainContent: false,   // the palette lives in the chrome, not the article
      timeout: 45000,
    }),
    signal,
  });

  if (!response.ok) {
    const e = new Error(`Could not read that site (${response.status}).`);
    e.reason = response.status === 402 ? "out_of_credits" : "fetch_failed";
    throw e;
  }

  const payload = await response.json();
  if (!payload?.success) {
    const e = new Error(String(payload?.error ?? "That site could not be read.").slice(0, 200));
    e.reason = "fetch_failed";
    throw e;
  }

  const data = payload.data ?? {};
  const html = String(data.rawHtml ?? data.html ?? "");
  const markdown = String(data.markdown ?? "");
  const meta = data.metadata ?? {};

  return {
    url: target.href,
    title: meta.title ?? null,
    description: meta.description ?? null,
    palette: extractPalette(html),
    fonts: extractFonts(html),
    // A sample, not the text. Enough for the studio to hear the register;
    // far too little to reassemble anything of theirs.
    sample: markdown.replace(/\s+/g, " ").slice(0, 1200),
  };
}

/**
 * Turns signals into a line of art direction.
 *
 * Phrased as a register to work in, never as a thing to reproduce, because
 * the prompt is where that distinction is actually enforced.
 */
export function referenceBrief(ref) {
  if (!ref) return "";
  const bits = [];
  if (ref.palette?.length) bits.push(`colours in this range: ${ref.palette.map((c) => c.hex).join(", ")}`);
  if (ref.fonts?.length) bits.push(`type in the spirit of: ${ref.fonts.slice(0, 3).join(", ")}`);
  if (ref.title) bits.push(`the reference is titled "${ref.title}"`);

  return [
    "",
    "<reference>",
    "The client showed a site whose FEEL they want — not its content, and not its layout.",
    bits.length ? `Signals read from it: ${bits.join("; ")}.` : "",
    ref.sample ? `A sample of how it reads, for register only: "${ref.sample.slice(0, 600)}"` : "",
    "Work in that register. Choose your own concept, your own words, your own structure.",
    "Never reuse their sentences, their brand name, or their imagery. This is a mood, not a template.",
    "</reference>",
  ].filter(Boolean).join("\n");
}
