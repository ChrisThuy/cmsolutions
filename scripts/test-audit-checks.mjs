/*
  Tests the audit checks against pages built to trigger them.

    node scripts/test-audit-checks.mjs

  The checks are what a visitor judges the tool by, so a wrong finding is worse
  than a missing one: telling someone their title tag is absent when it is
  there destroys trust in every other line of the report.
*/

import { runChecks } from "../lib/audit/checks.mjs";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const page = (html, extra = {}) => ({
  url: "https://example.com/",
  status: 200,
  headers: new Headers(extra.headers ?? {}),
  html,
  redirects: extra.redirects ?? [],
  elapsedMs: extra.elapsedMs ?? 300,
});

const find = (report, id) => report.results.find((r) => r.id === id);
const statusOf = (html, id, extra) => find(runChecks(page(html, extra)), id)?.status;

// A page that should pass nearly everything.
const GOOD = `<!DOCTYPE html><html lang="en"><head>
<title>Bristol Accountants for Owner-Managed Businesses | Harbour</title>
<meta name="description" content="Harbour &amp; Co are chartered accountants in Bristol working with owner-managed businesses on year-end accounts, tax and planning. Fixed fees agreed up front." />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="canonical" href="https://example.com/" />
<meta property="og:title" content="Harbour &amp; Co" />
<meta property="og:description" content="Chartered accountants in Bristol." />
<meta property="og:image" content="https://example.com/og.png" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Harbour"}</script>
</head><body>
<h1>Chartered accountants in Bristol</h1>
<img src="/team.jpg" alt="The Harbour team" />
<p>${"We work with owner-managed businesses across the South West. ".repeat(12)}</p>
</body></html>`;

console.log("\nA well-built page");
const good = runChecks(page(GOOD, { headers: { "strict-transport-security": "max-age=31536000", "x-content-type-options": "nosniff" } }));
check("title passes", find(good, "title").status === "pass", find(good, "title").finding);
check("description passes", find(good, "description").status === "pass", find(good, "description").finding);
check("h1 passes", find(good, "h1").status === "pass");
check("canonical passes", find(good, "canonical").status === "pass");
check("viewport passes", find(good, "viewport").status === "pass");
check("language passes", find(good, "lang").status === "pass");
check("social passes", find(good, "social").status === "pass");
check("structured data passes", find(good, "schema").status === "pass", find(good, "schema").finding);
check("alt text passes", find(good, "alt").status === "pass");
check("https passes", find(good, "https").status === "pass");
check("no failures reported", good.counts.fail === 0, JSON.stringify(good.counts));

console.log("\nMissing essentials are caught");
check("no title is a failure", statusOf("<html><body><p>x</p></body></html>", "title") === "fail");
check("no description is a failure", statusOf("<html><head><title>A reasonable title here</title></head></html>", "description") === "fail");
check("no h1 is a failure", statusOf("<html><body><h2>Sub</h2></body></html>", "h1") === "fail");
check("no viewport is a failure", statusOf("<html><head></head></html>", "viewport") === "fail");
check("no canonical is a warning", statusOf("<html><head></head></html>", "canonical") === "warn");
check("no lang is a warning", statusOf("<html><head></head></html>", "lang") === "warn");
check("no Open Graph is a failure", statusOf("<html><head></head></html>", "social") === "fail");
check("no JSON-LD is a warning", statusOf("<html><head></head></html>", "schema") === "warn");

console.log("\nDegrees of wrong");
check("a short title warns", statusOf("<html><head><title>Home</title></head></html>", "title") === "warn");
check(
  "a long title warns",
  statusOf(`<html><head><title>${"a".repeat(90)}</title></head></html>`, "title") === "warn",
);
check(
  "a short description warns",
  statusOf('<html><head><meta name="description" content="Too short."></head></html>', "description") === "warn",
);
check(
  "a long description warns",
  statusOf(`<html><head><meta name="description" content="${"a".repeat(200)}"></head></html>`, "description") === "warn",
);
check("two h1s warn", statusOf("<html><body><h1>A</h1><h1>B</h1></body></html>", "h1") === "warn");
check(
  "Open Graph without an image warns",
  statusOf('<html><head><meta property="og:title" content="X"></head></html>', "social") === "warn",
);
check(
  "invalid JSON-LD is a failure, not a pass",
  statusOf('<html><head><script type="application/ld+json">{not json}</script></head></html>', "schema") === "fail",
);

console.log("\nAttribute order and quoting must not matter");
check(
  "content before name is still read",
  statusOf('<html><head><meta content="A description long enough to be judged as reasonable by the checker here." name="description"></head></html>', "description") === "pass",
);
check(
  "single quotes are read",
  statusOf("<html><head><meta name='viewport' content='width=device-width'></head></html>", "viewport") === "pass",
);
check(
  "content before property is still read",
  statusOf('<html><head><meta content="https://x/og.png" property="og:image"><meta property="og:title" content="X"></head></html>', "social") !== "fail",
);

console.log("\nImages");
check(
  "a missing alt is caught",
  statusOf('<html><body><img src="a.jpg"><img src="b.jpg" alt="B"></body></html>', "alt") === "fail",
);
check(
  'an empty alt="" counts as present',
  statusOf('<html><body><img src="a.jpg" alt=""></body></html>', "alt") === "pass",
);
check(
  "a page with no images is info, not a failure",
  statusOf("<html><body><p>x</p></body></html>", "alt") === "info",
);

console.log("\nTransport and headers");
check(
  "plain http is a failure",
  find(runChecks({ ...page("<html></html>"), url: "http://example.com/" }), "https").status === "fail",
);
check("missing HSTS warns", statusOf("<html></html>", "hsts") === "warn");
check(
  "present HSTS passes",
  statusOf("<html></html>", "hsts", { headers: { "strict-transport-security": "max-age=63072000" } }) === "pass",
);
check(
  "mixed content is caught on an https page",
  statusOf('<html><body><script src="http://cdn.example.com/a.js"></script></body></html>', "mixed") === "warn",
);
check(
  "mixed content is not reported on an http page",
  find(runChecks({ ...page('<html><body><img src="http://x/a.png"></body></html>'), url: "http://example.com/" }), "mixed") === undefined,
);

console.log("\nContent and timing");
check("a thin page warns", statusOf("<html><body><p>Hello</p></body></html>", "content") === "warn");
check(
  "script and style text is not counted as content",
  statusOf(`<html><body><script>${"var x = 1; ".repeat(80)}</script><p>Hello</p></body></html>`, "content") === "warn",
);
check("a slow response warns", statusOf("<html></html>", "speed", { elapsedMs: 4000 }) === "warn");
check("a fast response passes", statusOf("<html></html>", "speed", { elapsedMs: 200 }) === "pass");
check(
  "redirects are reported as info",
  statusOf("<html></html>", "redirects", { redirects: [{ from: "a", to: "b", status: 301 }] }) === "info",
);

console.log("\nReport shape");
{
  const report = runChecks(page(GOOD));
  check("counts add up to the number of results",
    report.counts.pass + report.counts.warn + report.counts.fail + report.counts.info === report.results.length,
    `${JSON.stringify(report.counts)} vs ${report.results.length}`);
  check("every result has a label and a status",
    report.results.every((r) => r.label && r.status));
  check("every non-pass result explains why it matters",
    report.results.filter((r) => r.status === "fail" || r.status === "warn").every((r) => r.why),
    "a finding without a reason is just a scold");
  check("no overall score is invented", !("score" in report));
}

console.log("\nMalformed input must not throw");
for (const [name, html] of [
  ["empty string", ""],
  ["not html at all", "just some text"],
  ["an unclosed tag", "<html><head><title>x"],
  ["a broken meta", '<meta name="description" content='],
  ["nested nonsense", "<html><<>><title></title></html>"],
]) {
  try {
    runChecks(page(html));
    check(`${name} is handled`, true);
  } catch (cause) {
    check(`${name} is handled`, false, cause.message);
  }
}

console.log(
  failures === 0
    ? "\nAll audit-check tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
