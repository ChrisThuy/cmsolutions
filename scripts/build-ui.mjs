#!/usr/bin/env node
/*
  Puts the shared UI kit on every page that generates something.

    node scripts/build-ui.mjs          write
    node scripts/build-ui.mjs --check  fail if any page is out of date

  Same shape as build-nav.mjs: marker-delimited regions, re-runnable, and a
  --check mode the test suite calls so a hand-edited page fails loudly rather
  than being silently reverted by the next build.

  Only pages that actually run a request get the kit. A progress bar on a
  page with nothing to wait for is decoration, and decoration that implies
  work is happening is the thing this codebase keeps having to remove.
*/

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kitScript, kitStyles, UI_END, UI_START } from "../lib/ui/kit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

/** Pages with an async action worth showing progress for. */
export const UI_PAGES = [
  "ai-customer-service-software.html",
  "ai-document-data-extraction.html",
  "ai-social-media-content-planner.html",
  "ai-website-builder.html",
  "ai-workflow-automation.html",
  "free-website-audit-tool.html",
  "methane-readiness.html",
  "schema-generator.html",
];

const CSS_START = "<!-- ui:css — generated, do not edit by hand -->";
const CSS_END = "<!-- /ui:css -->";

const between = (start, end) => new RegExp(
  `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
);

function splice(html, start, end, block, at) {
  const re = between(start, end);
  if (re.test(html)) return html.replace(re, `${block}\n`);
  return at(html, `${block}\n`);
}

function build(html, file) {
  let out = html;

  const css = `${CSS_START}\n<style>${kitStyles()}</style>\n${CSS_END}`;
  out = splice(out, CSS_START, CSS_END, css, (h, b) => {
    if (!h.includes("</head>")) throw new Error(`${file} has no </head>`);
    return h.replace("</head>", `${b}</head>`);
  });

  // Before the page's own scripts, so a page can call CMProgress at parse time.
  const js = `${UI_START}\n<script>${kitScript()}</script>\n${UI_END}`;
  out = splice(out, UI_START, UI_END, js, (h, b) => {
    const first = h.match(/<script(?![^>]*\bsrc=)[^>]*>/);
    if (first) return h.replace(first[0], `${b}${first[0]}`);
    if (!h.includes("</body>")) throw new Error(`${file} has no </body>`);
    return h.replace("</body>", `${b}</body>`);
  });

  return out;
}

const present = new Set((await readdir(root)).filter((f) => f.endsWith(".html")));
let changed = 0;

for (const file of UI_PAGES) {
  if (!present.has(file)) {
    console.error(`  ✗  ${file} — listed in UI_PAGES but not on disk`);
    process.exit(1);
  }
  const before = await readFile(join(root, file), "utf8");
  const after = build(before, file);
  if (before === after) { console.log(`  ·  ${file}`); continue; }
  changed++;
  if (check) { console.log(`  ✗  ${file} — out of date`); continue; }
  await writeFile(join(root, file), after);
  console.log(`  ✓  ${file}`);
}

if (check && changed) {
  console.error(`\n  ${changed} page(s) out of date. Run: node scripts/build-ui.mjs\n`);
  process.exit(1);
}
console.log(`\n  ${UI_PAGES.length} pages, ${changed} updated.\n`);
