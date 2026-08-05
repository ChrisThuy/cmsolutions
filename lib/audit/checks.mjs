/*
  What the audit actually checks.

  Deliberately regex over the raw HTML rather than a DOM parser. Three reasons,
  in order: a parser is another dependency on a static site that currently has
  none; a malformed page should still produce findings rather than an exception;
  and everything here is a shallow head/attribute check where a parser buys
  little. If this ever needs to reason about document structure — heading
  nesting, landmark roles — that trade stops being worth it and a parser should
  be added.

  Every check reports one of four states:

    pass    — verified present and sane
    warn    — present but likely to underperform
    fail    — absent or wrong, with a concrete consequence
    info    — worth knowing, not a defect

  There is no overall score out of 100. A single number invites gaming and
  implies a precision this does not have; a list of specific, checkable facts
  is more useful and more honest. What is reported instead is a count by
  severity, which is a summary rather than a verdict.
*/

const text = (html, pattern) => html.match(pattern)?.[1]?.trim() ?? null;

/** Strips tags and collapses whitespace, for word counting. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, "i"),
  ];
  for (const p of patterns) {
    const found = html.match(p)?.[1];
    if (found !== undefined) return found.trim();
  }
  return null;
}

function propertyContent(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"),
  ];
  for (const p of patterns) {
    const found = html.match(p)?.[1];
    if (found !== undefined) return found.trim();
  }
  return null;
}

/*
  What to do about each finding, keyed by `id:status`.

  `why` says what it costs; this says what to do. A report that only diagnoses
  gets filed. The difference between a checker and something an agency can hand
  to a client — or straight to a developer — is that every finding ends with an
  instruction someone can act on without going away to research it first.

  Deliberately concrete: the actual tag, the actual header, the actual number.
  "Improve your meta description" is advice; the line to paste is a fix.
*/
const FIXES = {
  "title:fail": 'Add <title>Primary keyword | Brand</title> inside <head>. Aim for 50–60 characters.',
  "title:warn": "Aim for 50–60 characters — what the page is, then the brand. Distinctive words first, because the end is what gets truncated.",
  "description:fail": 'Add <meta name="description" content="…"> to <head>. Around 140–160 characters, written as a reason to click rather than a summary.',
  "description:warn": "Aim for 140–160 characters. Below that wastes the space; above it gets cut off.",
  "h1:fail": "Wrap the main page heading in <h1>. The visible headline usually already exists and is marked up as a <div> or an <h2>.",
  "h1:warn": "Keep the most important one as <h1> and demote the rest to <h2>.",
  "canonical:warn": 'Add <link rel="canonical" href="https://…"> to <head>, pointing at the preferred address of this page.',
  "viewport:fail": 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.',
  "lang:warn": 'Set it on the opening tag: <html lang="en">.',
  "social:fail": "Add og:title, og:description and og:image to <head>. The image should be an absolute URL, 1200×630 or larger.",
  "social:warn": 'Add <meta property="og:image" content="https://…"> with an absolute URL, 1200×630 or larger.',
  "schema:warn": "Generate it at cmsolutions.tech/schema-generator and paste the result into <head>.",
  "schema:fail": "Paste each block into a JSON validator to find the syntax error — usually a trailing comma or an unescaped quote.",
  "alt:fail": 'Add alt="…" describing each image. For purely decorative images use alt="" — present but empty, which tells a screen reader to skip it.',
  "https:fail": "Install a TLS certificate — free through Let's Encrypt, and automatic on most hosts — then redirect all http traffic to https.",
  "mixed:warn": "Change those src and href values from http:// to https://.",
  "hsts:warn": "Send Strict-Transport-Security: max-age=31536000; includeSubDomains from the server or CDN.",
  "xcto:warn": "Send X-Content-Type-Options: nosniff from the server or CDN.",
  "content:warn": "Add substantive copy to the served HTML. If the page is rendered by JavaScript, enable server-side rendering or prerendering so a crawler sees it on first pass.",
  "status:warn": "Check the server or CDN configuration for why this address does not return 200.",
  "speed:warn": "Look at server response time first — caching, a CDN, or a slow database query on the page are the usual causes.",
  "redirects:info": "One hop is normal. Several chained is worth flattening so every visit does not pay for them.",
};

/** Attaches the fix for this finding, when there is one to give. */
const check = (id, label, status, finding, why) => ({
  id,
  label,
  status,
  finding,
  why,
  fix: FIXES[`${id}:${status}`] ?? null,
});

/**
 * Runs every check against one fetched page.
 *
 * `page` is what fetchPage returned. Nothing here performs I/O — it is a pure
 * function of the response, which is what makes it testable without a network.
 */
export function runChecks(page) {
  const { html, headers, url, status, redirects, elapsedMs } = page;
  const results = [];
  const body = visibleText(html);

  // ── title ───────────────────────────────────────────────────────────────
  const title = text(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!title) {
    results.push(check("title", "Page title", "fail",
      "No <title> element.",
      "The title is the clickable line in search results and the browser tab. Without one, search engines invent one from the page content."));
  } else if (title.length < 15) {
    results.push(check("title", "Page title", "warn",
      `"${title}" — ${title.length} characters.`,
      "Short titles waste the most valuable line you get in search results. Around 50–60 characters is the usual sweet spot."));
  } else if (title.length > 65) {
    results.push(check("title", "Page title", "warn",
      `${title.length} characters — likely truncated.`,
      "Google truncates around 60 characters. The end of a long title is usually invisible where it matters."));
  } else {
    results.push(check("title", "Page title", "pass", `"${title}"`, null));
  }

  // ── meta description ────────────────────────────────────────────────────
  const description = metaContent(html, "description");
  if (!description) {
    results.push(check("description", "Meta description", "fail",
      "No meta description.",
      "Search engines will assemble a snippet from whatever text they find. Writing it yourself is the cheapest control you have over how the result reads."));
  } else if (description.length < 70) {
    results.push(check("description", "Meta description", "warn",
      `${description.length} characters.`,
      "Short descriptions leave usable space empty. Around 140–160 characters gives room to make the case for the click."));
  } else if (description.length > 165) {
    results.push(check("description", "Meta description", "warn",
      `${description.length} characters — likely truncated.`,
      "Anything past roughly 160 characters is usually cut off."));
  } else {
    results.push(check("description", "Meta description", "pass", `${description.length} characters.`, null));
  }

  // ── h1 ──────────────────────────────────────────────────────────────────
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );
  if (h1s.length === 0) {
    results.push(check("h1", "Main heading", "fail",
      "No <h1> on the page.",
      "The h1 states what the page is about, for both readers and search engines. Its absence is one of the most common findings on a business site."));
  } else if (h1s.length > 1) {
    results.push(check("h1", "Main heading", "warn",
      `${h1s.length} <h1> elements.`,
      "More than one main heading makes the page's subject ambiguous. Use one h1 and h2s beneath it."));
  } else {
    results.push(check("h1", "Main heading", "pass", `"${h1s[0].slice(0, 80)}"`, null));
  }

  // ── canonical ───────────────────────────────────────────────────────────
  const canonical = text(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    ?? text(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (!canonical) {
    results.push(check("canonical", "Canonical URL", "warn",
      "No canonical link.",
      "Without one, the same page reachable at several addresses — with and without www, with tracking parameters — can be treated as several competing pages."));
  } else {
    results.push(check("canonical", "Canonical URL", "pass", canonical, null));
  }

  // ── viewport ────────────────────────────────────────────────────────────
  const viewport = metaContent(html, "viewport");
  if (!viewport) {
    results.push(check("viewport", "Mobile viewport", "fail",
      "No viewport meta tag.",
      "Mobile browsers will render the page at desktop width and zoom out. On a phone the text is unreadable, and most first visits are on a phone."));
  } else {
    results.push(check("viewport", "Mobile viewport", "pass", viewport, null));
  }

  // ── language ────────────────────────────────────────────────────────────
  const lang = text(html, /<html[^>]+lang=["']([^"']+)["']/i);
  results.push(lang
    ? check("lang", "Declared language", "pass", lang, null)
    : check("lang", "Declared language", "warn",
        "No lang attribute on <html>.",
        "Screen readers use it to choose a pronunciation. Without it they guess, and a English page read in a French voice is unusable."));

  // ── social preview ──────────────────────────────────────────────────────
  const ogTitle = propertyContent(html, "og:title");
  const ogImage = propertyContent(html, "og:image");
  const ogDescription = propertyContent(html, "og:description");
  const ogCount = [ogTitle, ogImage, ogDescription].filter(Boolean).length;

  if (ogCount === 0) {
    results.push(check("social", "Link preview", "fail",
      "No Open Graph tags.",
      "Shared in Slack, WhatsApp or LinkedIn, this page shows a bare URL with no title or image. Everything shared about you looks unfinished."));
  } else if (!ogImage) {
    results.push(check("social", "Link preview", "warn",
      "Open Graph tags present, but no image.",
      "A preview without an image takes a fraction of the space in a feed and gets a fraction of the clicks."));
  } else {
    results.push(check("social", "Link preview", "pass",
      `og:title, og:image${ogDescription ? ", og:description" : ""} present.`, null));
  }

  // ── structured data ─────────────────────────────────────────────────────
  const ldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (ldBlocks.length === 0) {
    results.push(check("schema", "Structured data", "warn",
      "No JSON-LD found.",
      "Structured data is how a search engine — and increasingly an AI assistant — knows what kind of thing this page describes. Without it they infer, and inference is where the wrong answer comes from."));
  } else {
    let invalid = 0;
    const types = new Set();
    for (const block of ldBlocks) {
      try {
        const parsed = JSON.parse(block[1]);
        const nodes = parsed["@graph"] ?? (Array.isArray(parsed) ? parsed : [parsed]);
        for (const node of nodes) if (node?.["@type"]) types.add(node["@type"]);
      } catch {
        invalid++;
      }
    }
    results.push(invalid > 0
      ? check("schema", "Structured data", "fail",
          `${invalid} of ${ldBlocks.length} JSON-LD block(s) do not parse.`,
          "Invalid structured data is ignored entirely, so the effort spent adding it returns nothing.")
      : check("schema", "Structured data", "pass",
          `${ldBlocks.length} valid block(s): ${[...types].join(", ") || "no @type"}.`, null));
  }

  // ── images ──────────────────────────────────────────────────────────────
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const missingAlt = imgs.filter((tag) => !/\balt\s*=/i.test(tag));
  if (imgs.length === 0) {
    results.push(check("alt", "Image alt text", "info", "No images found on the page.", null));
  } else if (missingAlt.length > 0) {
    results.push(check("alt", "Image alt text", "fail",
      `${missingAlt.length} of ${imgs.length} images have no alt attribute.`,
      "A screen reader reads the filename instead, and search engines learn nothing from the image. An empty alt=\"\" is correct for decorative images — omitting it entirely is not."));
  } else {
    results.push(check("alt", "Image alt text", "pass", `All ${imgs.length} images have alt text.`, null));
  }

  // ── https ───────────────────────────────────────────────────────────────
  const isHttps = url.startsWith("https://");
  results.push(isHttps
    ? check("https", "HTTPS", "pass", "Served over HTTPS.", null)
    : check("https", "HTTPS", "fail", "Served over plain HTTP.",
        "Browsers mark the page as Not Secure, and any form on it warns the visitor before they type."));

  // ── mixed content ───────────────────────────────────────────────────────
  if (isHttps) {
    const insecure = [...html.matchAll(/(?:src|href)=["']http:\/\/[^"']+["']/gi)].length;
    if (insecure > 0) {
      results.push(check("mixed", "Mixed content", "warn",
        `${insecure} resource(s) referenced over plain http.`,
        "Browsers block insecure scripts and images on a secure page, so these either fail to load or downgrade the padlock."));
    }
  }

  // ── security headers ────────────────────────────────────────────────────
  const hsts = headers.get("strict-transport-security");
  results.push(hsts
    ? check("hsts", "HSTS", "pass", hsts, null)
    : check("hsts", "HSTS", "warn", "No Strict-Transport-Security header.",
        "Without it, a visitor's first request over http can be intercepted before the redirect to https happens."));

  const xcto = headers.get("x-content-type-options");
  if (!xcto) {
    results.push(check("xcto", "MIME sniffing", "warn",
      "No X-Content-Type-Options header.",
      "Browsers may guess a file's type from its contents, which is a route to executing something you served as data."));
  }

  // ── content depth ───────────────────────────────────────────────────────
  const words = body ? body.split(" ").length : 0;
  if (words < 100) {
    results.push(check("content", "Content depth", "warn",
      `About ${words} words of visible text.`,
      "Very little text gives search engines almost nothing to match a query against. If the content is loaded by JavaScript, this is what a crawler sees on first pass."));
  } else {
    results.push(check("content", "Content depth", "pass", `About ${words} words of visible text.`, null));
  }

  // ── response ────────────────────────────────────────────────────────────
  if (status !== 200) {
    results.push(check("status", "HTTP status", "warn", `Returned ${status}.`,
      "Anything other than 200 on the page you want indexed is worth understanding."));
  }

  if (redirects.length > 0) {
    results.push(check("redirects", "Redirects", "info",
      `${redirects.length} redirect(s) before the final page.`,
      "Each hop costs time on every visit. One is normal — www to apex, or http to https. Several chained is worth flattening."));
  }

  results.push(check("speed", "Server response", elapsedMs > 2500 ? "warn" : "pass",
    `HTML returned in ${elapsedMs} ms.`,
    elapsedMs > 2500
      ? "This is the time to first byte from our server, not a full page load, so a real visitor waits longer than this."
      : null));

  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  return {
    url,
    checkedAt: new Date().toISOString(),
    counts: { pass: counts.pass ?? 0, warn: counts.warn ?? 0, fail: counts.fail ?? 0, info: counts.info ?? 0 },
    results,
  };
}
