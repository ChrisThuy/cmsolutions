#!/usr/bin/env node
/*
  Audits a list of sites in one go, ranked worst first.

    node scripts/audit-batch.mjs prospects.txt
    node scripts/audit-batch.mjs harbourandco.co.uk example.com
    node scripts/audit-batch.mjs prospects.txt --reports ./out

  For us, not for visitors. There is no endpoint and no rate limit here,
  because the constraint it exists to remove is ours: opening a conversation
  with ten agencies means auditing ten sites, and doing that through a web form
  one URL at a time is the kind of task that does not survive a busy afternoon.

  Ranked worst first on purpose. The sites with the most wrong are the ones
  where there is most to say, so that is the order worth working down.

  With --reports it also writes a standalone HTML file per site — the same
  client-ready shape as the web tool, printable to PDF, with nothing that
  depends on our server still being up when someone opens it.

  ── the one rule ──

  Everything it prints is a fact the crawler observed. No estimates of lost
  revenue, no invented traffic figures, no "you could be losing customers".
  A factual finding opens a conversation; a made-up number ends one, because
  the first thing a competent reader does is check it.
*/

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { crawlSite } from "../lib/audit/crawl.mjs";
import { UnsafeUrlError } from "../lib/audit/safe-fetch.mjs";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help")) {
  console.log(`
  Audit several sites at once.

    node scripts/audit-batch.mjs prospects.txt
    node scripts/audit-batch.mjs example.com another.com
    node scripts/audit-batch.mjs prospects.txt --reports ./out
    node scripts/audit-batch.mjs cmsolutions.tech --pages 20

  --pages raises the six-page crawl cap. The default is deliberate restraint
  toward sites we do not own; raise it for our own.

  A list file is one address per line. Blank lines and lines starting with #
  are ignored, so it doubles as a notes file.
`);
  process.exit(0);
}

const reportsIndex = args.indexOf("--reports");
const reportsDir = reportsIndex !== -1 ? args[reportsIndex + 1] : null;
/*
  Guard the -1. Without it, an absent --reports makes reportsIndex + 1 equal 0
  and the filter silently eats the first address — so the single most common
  invocation, one site and no flags, reported "No addresses given."
*/
const skipValueAt = reportsIndex === -1 ? -1 : reportsIndex + 1;

/*
  The six-page default is politeness toward sites we do not own — a prospect
  did not ask to be crawled, and six pages is enough to tell whether a problem
  is systemic. Auditing our own site is the case where that restraint costs
  something: the first self-audit checked six of eight pages and the page it
  skipped had the worst title on the site.
*/
const pagesIndex = args.indexOf("--pages");
const maxPages = pagesIndex !== -1 ? Number(args[pagesIndex + 1]) : undefined;
if (pagesIndex !== -1 && (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50)) {
  console.error("  --pages needs a whole number between 1 and 50.");
  process.exit(1);
}
const skipPagesAt = pagesIndex === -1 ? -1 : pagesIndex + 1;

const inputs = args.filter(
  (a, i) => a !== "--reports" && a !== "--pages" && i !== skipValueAt && i !== skipPagesAt,
);

/** A list file, or the addresses themselves. */
function collectTargets(values) {
  const targets = [];
  for (const value of values) {
    if (value.endsWith(".txt") || value.includes("/")) {
      try {
        const lines = readFileSync(value, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) targets.push(trimmed);
        }
        continue;
      } catch {
        // Not a readable file, so treat it as an address after all.
      }
    }
    targets.push(value);
  }
  return [...new Set(targets)];
}

const targets = collectTargets(inputs);
if (targets.length === 0) {
  console.error("  No addresses given.");
  process.exit(1);
}

const escape = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** A standalone report file, printable and independent of our server. */
function reportHtml(report) {
  const host = new URL(report.site).hostname;
  const rows = report.issues.map((issue) => `
    <li>
      <div class="head"><span class="label">${escape(issue.label)}</span>
        <span class="status ${issue.status}">${escape(issue.status)}</span></div>
      <p class="scope">${report.counts.pages > 1
        ? `On ${issue.pages.length} of ${report.counts.pages} pages checked.`
        : "On the page checked."}</p>
      ${issue.why ? `<p class="why">${escape(issue.why)}</p>` : ""}
      ${issue.fix ? `<p class="fix"><b>Fix:</b> ${escape(issue.fix)}</p>` : ""}
      ${report.counts.pages > 1
        ? `<ul class="pages">${issue.pages.map((p) => `<li>${escape(p)}</li>`).join("")}</ul>`
        : ""}
    </li>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>Website report — ${escape(host)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       font-weight:300;line-height:1.6;color:#111;background:#fff;padding:2.5rem 2rem;max-width:52rem;margin:0 auto}
  h1{font-family:Georgia,serif;font-weight:400;font-size:1.6rem;letter-spacing:-0.01em}
  .meta{color:#777;font-size:0.85rem;margin-top:0.4rem}
  .tally{margin-top:1rem;font-size:0.9rem;color:#333}
  ul.issues{list-style:none;margin-top:1.8rem}
  ul.issues>li{border-top:1px solid #ddd;padding-block:1.1rem;break-inside:avoid;page-break-inside:avoid}
  ul.issues>li:last-child{border-bottom:1px solid #ddd}
  .head{display:flex;gap:0.8rem;align-items:baseline}
  .label{font-size:1rem}
  .status{font-size:0.68rem;letter-spacing:0.12em;text-transform:uppercase}
  .status.fail{color:#a33}.status.warn{color:#8a6a1f}
  .scope{color:#333;font-size:0.9rem;margin-top:0.3rem}
  .why{color:#555;font-size:0.87rem;margin-top:0.45rem}
  .fix{font-size:0.87rem;margin-top:0.5rem;padding-left:0.8rem;border-left:2px solid #999}
  ul.pages{list-style:none;margin-top:0.5rem}
  ul.pages li{font-size:0.78rem;color:#777;word-break:break-all}
  footer{margin-top:2.5rem;border-top:1px solid #ddd;padding-top:1rem;font-size:0.8rem;color:#777}
</style></head><body>
<h1>Website report — ${escape(host)}</h1>
<p class="meta">${escape(report.site)} · ${new Date(report.checkedAt).toLocaleDateString("en-GB",
  { day: "numeric", month: "long", year: "numeric" })} · ${report.counts.pages} page(s) checked</p>
<p class="tally">${report.counts.fail} to fix · ${report.counts.warn} worth a look</p>
<ul class="issues">${rows || "<li><p class='scope'>Nothing to flag. That is unusual.</p></li>"}</ul>
<footer>Prepared by CM Solutions · cmsolutions.tech · Every finding above was observed on the pages listed.</footer>
</body></html>`;
}

if (reportsDir) mkdirSync(reportsDir, { recursive: true });

console.log(`\n  Auditing ${targets.length} site(s)…\n`);

const results = [];

for (const target of targets) {
  process.stdout.write(`  ${target.padEnd(38)} `);
  try {
    const report = await crawlSite(target, maxPages ? { maxPages } : undefined);
    results.push({ target, report });
    console.log(
      `${report.counts.pages}p · ${report.counts.fail} fail · ${report.counts.warn} warn`,
    );

    if (reportsDir) {
      const host = new URL(report.site).hostname.replace(/[^a-z0-9.-]/gi, "_");
      writeFileSync(`${reportsDir}/${host}.html`, reportHtml(report));
    }
  } catch (cause) {
    const reason = cause instanceof UnsafeUrlError ? cause.message : "could not be reached";
    results.push({ target, error: reason });
    console.log(`— ${reason}`);
  }
}

// Worst first: most failures, then most warnings. That is the order in which
// there is most to talk about.
const ranked = results
  .filter((r) => r.report)
  .sort((a, b) =>
    b.report.counts.fail - a.report.counts.fail ||
    b.report.counts.warn - a.report.counts.warn);

console.log("\n  ── Ranked, worst first ──\n");

for (const { report } of ranked) {
  const host = new URL(report.site).hostname;
  const headline = report.issues.slice(0, 3).map((i) => i.label).join(", ");
  console.log(`  ${host}`);
  console.log(`    ${report.counts.fail} to fix, ${report.counts.warn} worth a look, across ${report.counts.pages} page(s)`);
  if (headline) console.log(`    Top findings: ${headline}`);
  console.log("");
}

const failed = results.filter((r) => r.error);
if (failed.length) {
  console.log("  ── Could not be checked ──\n");
  for (const { target, error } of failed) console.log(`  ${target} — ${error}`);
  console.log("");
}

if (reportsDir) {
  console.log(`  Reports written to ${reportsDir}/ — open one and print to PDF.\n`);
}
