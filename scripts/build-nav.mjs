#!/usr/bin/env node
/*
  Puts the navigation on every page.

    node scripts/build-nav.mjs          write
    node scripts/build-nav.mjs --check  fail if any page is out of date

  Re-runnable. Each of the three regions it owns is delimited by markers, so
  running it twice replaces rather than stacks, and --check in the test suite
  catches a page edited by hand and left behind.

  It also removes the old hand-written <header class="site-head">. That header
  is what this replaces; leaving it would give every page two primary landmarks
  and two rows of links.
*/

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { navHtml, navScript, navStyles, NAV_END, NAV_START } from "../lib/nav/render.mjs";
import { pageOf } from "../lib/nav/manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const CSS_START = "<!-- nav:css — generated, do not edit by hand -->";
const CSS_END = "<!-- /nav:css -->";
const JS_START = "<!-- nav:js — generated, do not edit by hand -->";
const JS_END = "<!-- /nav:js -->";

const between = (start, end) => new RegExp(
  `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
);

/** Replace an existing marked region, or insert a fresh one at `at`. */
function splice(html, start, end, block, at) {
  const re = between(start, end);
  if (re.test(html)) return html.replace(re, `${block}\n`);
  return at(html, `${block}\n`);
}

function build(html, file) {
  const page = pageOf(file);
  const currentHref = page?.href ?? null;
  // The front page is a full-bleed film; the bar floats over it rather than
  // pushing it down. Every other page reserves the height it occupies.
  const isHome = file === "index.html";

  let out = html;

  /* ── the old header goes ── */
  out = out.replace(/[ \t]*<header class="site-head">[\s\S]*?<\/header>\n?/g, "");

  /* ── styles, last in <head> so they settle over the page's own rules ── */
  const css = `${CSS_START}\n<style>${navStyles()}</style>\n${CSS_END}`;
  out = splice(out, CSS_START, CSS_END, css, (h, b) => {
    if (!h.includes("</head>")) throw new Error(`${file} has no </head>`);
    return h.replace("</head>", `${b}</head>`);
  });

  /* ── the bar, after <body> and after any skip link ── */
  const markup = navHtml({ currentHref, withGap: !isHome });
  out = splice(out, NAV_START, NAV_END, markup, (h, b) => {
    const skip = h.match(/<a[^>]*class="[^"]*\bskip\b[^"]*"[^>]*>[\s\S]*?<\/a>\n?/);
    if (skip) return h.replace(skip[0], `${skip[0]}\n${b}`);
    const body = h.match(/<body[^>]*>\n?/);
    if (!body) throw new Error(`${file} has no <body>`);
    return h.replace(body[0], `${body[0]}\n${b}`);
  });

  /* ── behaviour, at the end so it never blocks paint ── */
  const js = `${JS_START}\n<script>${navScript()}</script>\n${JS_END}`;
  out = splice(out, JS_START, JS_END, js, (h, b) => {
    if (!h.includes("</body>")) throw new Error(`${file} has no </body>`);
    return h.replace("</body>", `${b}</body>`);
  });

  return out;
}

const files = (await readdir(root)).filter((f) => f.endsWith(".html")).sort();
if (!files.length) {
  console.error("  No pages found.");
  process.exit(1);
}

let changed = 0;
const stale = [];

for (const file of files) {
  const before = await readFile(join(root, file), "utf8");
  const after = build(before, file);
  if (before === after) {
    console.log(`  ·  ${file}`);
    continue;
  }
  changed++;
  stale.push(file);
  if (check) { console.log(`  ✗  ${file} — out of date`); continue; }

  await writeFile(join(root, file), after);
  const had = /<header class="site-head">/.test(before);
  console.log(`  ✓  ${file}${had ? "  (replaced the old header)" : ""}`);
}

if (check && changed) {
  console.error(`\n  ${changed} page(s) out of date. Run: node scripts/build-nav.mjs\n`);
  process.exit(1);
}
console.log(`\n  ${files.length} pages, ${changed} updated.\n`);
