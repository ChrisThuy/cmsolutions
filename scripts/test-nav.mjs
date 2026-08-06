/*
  Checks the navigation on every page.

    node scripts/test-nav.mjs

  The nav's whole job is that any page reaches any other page. That is a
  property worth asserting rather than spot-checking, because it fails
  silently: a tool added to the site but not to the manifest is simply
  unreachable, and the page still looks fine.

  So this checks reachability directly — every destination, present on every
  page — rather than checking that the file contains some markup.
*/

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BAR, GROUPS, PAGES, pagesIn } from "../lib/nav/manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const files = (await readdir(root)).filter((f) => f.endsWith(".html")).sort();
const html = new Map();
for (const f of files) html.set(f, await readFile(join(root, f), "utf8"));

/*
  Assertions about the nav have to look at the nav.

  The first version of this counted aria-current across the whole document and
  reported every page as broken — the pages have breadcrumbs, and those mark
  the current page too, correctly. Same for the spacer: "sitenav-gap" appears
  in the stylesheet on every page whether or not the element is rendered.

  `block` is the injected markup and nothing else.
*/
const block = new Map();
for (const [f, source] of html) {
  const m = source.match(/<header class="sitenav"[\s\S]*?<!-- nav:end -->/);
  block.set(f, m ? m[0] : "");
}

/* ── the manifest describes reality ──────────────────────────────── */

for (const p of PAGES) {
  check(`manifest: ${p.file} exists`, files.includes(p.file));
}

const listed = new Set(PAGES.map((p) => p.file));
for (const f of files) {
  check(`every page is in the manifest: ${f}`, listed.has(f),
    "add it to lib/nav/manifest.mjs or it will be unreachable");
}

const hrefs = PAGES.map((p) => p.href);
check("no duplicate hrefs", new Set(hrefs).size === hrefs.length);

for (const p of PAGES) {
  const expected = p.file === "index.html" ? "/" : "/" + p.file.replace(/\.html$/, "");
  check(`href matches the file: ${p.href}`, p.href === expected, `expected ${expected}`);
}

for (const g of GROUPS) {
  check(`group "${g.key}" has pages`, pagesIn(g.key).length > 0);
}

/* ── every page carries the nav, exactly once ─────────────────────── */

for (const [file, source] of html) {
  const bars = (source.match(/<header class="sitenav"/g) ?? []).length;
  check(`${file}: one nav`, bars === 1, `found ${bars}`);

  const primary = (source.match(/aria-label="Primary"/g) ?? []).length;
  check(`${file}: one primary landmark`, primary === 1, `found ${primary}`);

  check(`${file}: no leftover old header`, !source.includes('<header class="site-head">'));
  check(`${file}: styles injected`, source.includes(".sitenav-panel"));
  check(`${file}: script injected`, source.includes("sitenav-tools"));
}

/* ── reachability: the actual claim ───────────────────────────────── */

for (const [file, source] of html) {
  const missing = PAGES
    .filter((p) => p.group)                    // the home link is the wordmark
    .filter((p) => !source.includes(`href="${p.href}"`))
    .map((p) => p.href);
  check(`${file}: reaches every tool`, missing.length === 0, missing.join(", "));

  const barMissing = BAR.filter((b) => !source.includes(`href="${b.href}"`)).map((b) => b.href);
  check(`${file}: carries the bar links`, barMissing.length === 0, barMissing.join(", "));

  check(`${file}: links home`, /class="sitenav-mark" href="\/"/.test(source));
}

/* ── the nav says where you are ───────────────────────────────────── */

for (const p of PAGES) {
  if (!p.group) continue;
  const source = html.get(p.file);
  check(`${p.file}: marks itself current`,
    new RegExp(`href="${p.href}" aria-current="page"`).test(source));
}

// Exactly one current marker inside the nav, or "you are here" means nothing.
for (const [file, source] of block) {
  const marks = (source.match(/aria-current="page"/g) ?? []).length;
  const expected = PAGES.find((p) => p.file === file)?.group ? 1 : 0;
  check(`${file}: ${expected} current marker(s) in the nav`, marks === expected, `found ${marks}`);
}

/* ── the home page floats, the rest reserve space ─────────────────── */

check("index.html has no spacer", !block.get("index.html").includes('class="sitenav-gap"'));
for (const [file, source] of block) {
  if (file === "index.html") continue;
  check(`${file}: reserves the bar's height`, source.includes('class="sitenav-gap"'));
}

/* ── accessibility basics that regress quietly ────────────────────── */

for (const [file, source] of html) {
  check(`${file}: disclosure is a summary`, /<summary class="sitenav-toggle"/.test(source));
  check(`${file}: panel survives no-JS`, source.includes("<details class=\"sitenav-tools\">"));
  check(`${file}: hidden at print`, /@media print \{ \.sitenav/.test(source));
  check(`${file}: honours reduced motion`, source.includes("prefers-reduced-motion"));
}

/* ── nothing on the bar can collide with the film ─────────────────── */

const home = html.get("index.html");
const progress = home.match(/\.scroll-progress \{[\s\S]*?z-index: (\d+)/);
check("index: progress bar sits above the nav", progress && Number(progress[1]) > 50,
  progress ? `z-index ${progress[1]}` : "not found");

/* ── the pages match the manifest ─────────────────────────────────
   Everything above checks the HTML as it stands. This checks that the HTML
   is what the manifest would produce — the failure mode being a page edited
   by hand, which looks right until the next build silently reverts it. */

const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const drift = await promisify(execFile)("node", [join(root, "scripts/build-nav.mjs"), "--check"])
  .then(() => null)
  .catch((e) => e);
check("no page has drifted from the manifest", drift === null,
  drift ? "run: node scripts/build-nav.mjs" : "");

console.log(`\n  ${failures === 0 ? "All nav checks passed." : `${failures} failure(s).`}\n`);
process.exit(failures === 0 ? 1 * 0 : 1);
