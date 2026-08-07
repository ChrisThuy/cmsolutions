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
import { extractBusiness } from "../schema/extract.mjs";

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


/*
  Reading the client's OWN site, which is a different act entirely.

  The reference reader above takes the feel off a site somebody admires and
  is careful to leave their content alone. This takes the facts off a site
  the client already owns, and reusing them is the entire point: their real
  number, their real address, their real opening hours, their real social
  links.

  ── why the facts never go near the model ──

  A language model asked to carry "01273 555019" through a generation will
  one day write 555091, and a client publishes a page with a wrong number on
  it. So the facts are extracted by code here and placed by code in the
  renderer. The model gets told what kind of business it is and writes the
  concept, the palette and the words — it is never handed a digit to copy.
*/

/*
  What language the site is written in.

  Declared lang first, because a site that states it is authoritative and
  free. Falling back to counting characters is only for the many sites that
  declare nothing or lie with a copy-pasted lang="en" — CJK, Greek, Cyrillic,
  Hebrew, Arabic and Thai are each distinguishable by script alone, which is
  enough to pick the pair without pretending to detect language properly.
*/
const SCRIPTS = [
  { code: "zh-TW", label: "中文", test: /[\u4e00-\u9fff]/g, hint: /繁體|台灣|臺灣|香港/ },
  { code: "ja",    label: "日本語", test: /[\u3040-\u30ff]/g },
  { code: "ko",    label: "한국어", test: /[\uac00-\ud7af]/g },
  { code: "el",    label: "Ελληνικά", test: /[\u0370-\u03ff]/g },
  { code: "ru",    label: "Русский", test: /[\u0400-\u04ff]/g },
  { code: "he",    label: "עברית", test: /[\u0590-\u05ff]/g },
  { code: "ar",    label: "العربية", test: /[\u0600-\u06ff]/g },
  { code: "th",    label: "ไทย",  test: /[\u0e00-\u0e7f]/g },
];

export function detectLanguage(html, markdown = "") {
  const declared = html.match(/<html[^>]+lang=["']([a-zA-Z-]+)["']/i)?.[1];
  const text = markdown || html.replace(/<[^>]+>/g, " ");

  for (const s of SCRIPTS) {
    const hits = (text.match(s.test) ?? []).length;
    // A handful of CJK glyphs in an English page is a brand name, not a
    // language. A page written in the script has hundreds.
    if (hits < 40) continue;
    let code = s.code;
    if (s.code === "zh-TW" && declared && /^zh/i.test(declared)) code = declared;
    else if (s.code === "zh-TW" && !s.hint.test(text)) code = "zh";
    return { code, label: s.label, declared: declared ?? null };
  }

  return { code: declared && !/^en/i.test(declared) ? declared : "en", label: "English", declared: declared ?? null };
}

/** Photographs already on the site, most likely to be usable first. */
export function extractImages(html, pageUrl, limit = 12) {
  const seen = new Set();
  const out = [];
  const push = (raw) => {
    if (!raw || out.length >= limit) return;
    let abs;
    try { abs = new URL(raw, pageUrl).href; } catch { return; }
    if (!/^https?:/.test(abs)) return;
    // Sprites, icons, tracking pixels and data URIs are not photographs.
    if (/\.svg($|\?)|sprite|icon|favicon|logo-?mark|pixel|1x1|spacer/i.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  };

  // og:image first — it is the one image the site chose to represent itself.
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) push(og[1]);

  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  // Lazy-loaded sites keep the real file in data-src and a placeholder in src.
  for (const m of html.matchAll(/<img[^>]+data-src=["']([^"']+)["']/gi)) push(m[1]);

  return out;
}

/**
 * Reads a site the client owns and returns what is reusable.
 *
 * Same guard and same fetcher as the reference reader — a URL somebody types
 * is a URL somebody types, whoever they say owns it.
 */
export async function readOwnSite(rawUrl, { signal } = {}) {
  if (!process.env.FIRECRAWL_API_KEY) {
    const e = new Error("Site reading is not configured.");
    e.reason = "unconfigured";
    throw e;
  }

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
      onlyMainContent: false,
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

  /* The same extractor the schema generator uses. One implementation of
     "what are this business's details", already covered by its own tests. */
  const business = extractBusiness(html, target.href);

  return {
    url: target.href,
    language: detectLanguage(html, markdown),
    business,
    images: extractImages(html, target.href),
    palette: extractPalette(html),
    fonts: extractFonts(html),
    // Their existing words, for the studio to hear the register — and to
    // know what the business actually does rather than guess from a name.
    sample: markdown.replace(/\s+/g, " ").slice(0, 2000),
  };
}

/** Counts what was found, for telling the visitor before they commit. */
export function summariseOwnSite(read) {
  const b = read?.business ?? {};
  return {
    name: b.name || null,
    phone: b.phone || null,
    email: b.email || null,
    address: [b.street, b.city, b.postcode].filter(Boolean).join(", ") || null,
    hours: (b.hours ?? []).length,
    social: (b.sameAs ?? []).length,
    images: (read?.images ?? []).length,
  };
}

/**
 * Art direction from the client's own site.
 *
 * Tells the studio what the business IS, and explicitly not to write contact
 * details — those are placed by the renderer from the extraction, so a
 * hallucinated digit can never reach the page.
 */
export function ownSiteBrief(read) {
  if (!read) return "";
  const b = read.business ?? {};
  const bits = [];
  if (b.name) bits.push(`the business is called ${b.name}`);
  if (b.description) bits.push(`it describes itself as: "${b.description}"`);
  if (b.city) bits.push(`it is in ${[b.city, b.region].filter(Boolean).join(", ")}`);
  if (read.palette?.length) bits.push(`its current colours are ${read.palette.slice(0, 5).map((c) => c.hex).join(", ")}`);
  if (read.fonts?.length) bits.push(`its current type is ${read.fonts.slice(0, 2).join(", ")}`);

  return [
    "",
    "<their-current-site>",
    "This is the client's OWN existing website. You are rebuilding it better.",
    bits.length ? `${bits.join("; ")}.` : "",
    read.sample ? `How it currently reads: "${read.sample.slice(0, 900)}"` : "",
    "Write a stronger version of this business's story. Keep what is true about",
    "them and improve how it is told. You may move away from their current",
    "colours and type if a better choice serves them.",
    "DO NOT write a phone number, an email address, a postal address or opening",
    "hours anywhere. Those are placed from their real records, and anything you",
    "invent would be wrong.",
    "</their-current-site>",
  ].filter(Boolean).join("\n");
}
