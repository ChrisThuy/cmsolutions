/*
  Checks every link on the site.

    node scripts/test-links.mjs          internal only, offline, fast
    node scripts/test-links.mjs --external   also checks outbound links

  Written because a dead link sat on the site's single most valuable CTA and
  nothing caught it. "Book a call — 30 minutes, free" pointed at a Cal.com
  page that returned 404, so every prospect who wanted to book a call landed
  on an error page. It was found by reading the HTML by hand, months after it
  shipped, which is not a process.

  Internal links are checked against the files on disk, so this runs offline
  and belongs in the test suite. External links need the network and are
  opt-in, because a suite that fails when somebody else's server has a bad
  afternoon is a suite people learn to ignore.

  What it deliberately does not do: follow mailto:, tel: or anchor-only links.
  Those cannot 404.
*/

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkExternal = process.argv.includes("--external");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const files = (await readdir(root)).filter((f) => f.endsWith(".html"));
const pages = new Set(files.map((f) => "/" + (f === "index.html" ? "" : f.replace(/\.html$/, ""))));

/* Redirects declared in vercel.json are legitimate internal destinations —
   the old audit URL still resolves and should not be reported as broken. */
let redirects = [];
try {
  const cfg = JSON.parse(await readFile(resolve(root, "vercel.json"), "utf8"));
  redirects = (cfg.redirects ?? []).map((r) => r.source);
} catch { /* no config, no redirects */ }

const internal = new Map();   // href -> [pages that link to it]
const external = new Map();

for (const file of files) {
  const html = await readFile(resolve(root, file), "utf8");
  const from = "/" + (file === "index.html" ? "" : file.replace(/\.html$/, ""));
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(mailto:|tel:|#|javascript:)/.test(href)) continue;
    if (href.startsWith("http")) {
      /*
        Only the marketing host is this site. proposal.cmsolutions.tech is a
        separate application with its own routes — treating any cmsolutions
        subdomain as internal reported its live /demo and /enquiry pages as
        broken, which is the false positive that teaches people to skip the
        check.
      */
      const host = new URL(href).hostname;
      if (host === "cmsolutions.tech" || host === "www.cmsolutions.tech") {
        const path = new URL(href).pathname.replace(/\/$/, "") || "/";
        if (!/\.(png|jpg|svg|xml|txt|ico|webmanifest)$/.test(path)) {
          internal.set(path, [...(internal.get(path) ?? []), from]);
        }
        continue;
      }
      if (/fonts\.(googleapis|gstatic)\.com|schema\.org|w3\.org/.test(href)) continue;
      external.set(href.split("#")[0], [...(external.get(href.split("#")[0]) ?? []), from]);
      continue;
    }
    const path = href.split("#")[0].split("?")[0].replace(/\/$/, "") || "/";
    if (!path.startsWith("/")) continue;
    if (/\.(png|jpg|svg|xml|txt|ico|mjs|js|css|webmanifest)$/.test(path)) continue;
    internal.set(path, [...(internal.get(path) ?? []), from]);
  }
}

console.log(`\nInternal links (${internal.size} distinct)`);
for (const [path, from] of [...internal].sort()) {
  const ok = pages.has(path) || redirects.includes(path);
  check(`${path}`, ok, ok ? "" : `linked from ${[...new Set(from)].join(", ")}`);
}

console.log("\nEvery page is reachable from another page");
{
  const linked = new Set([...internal.keys()]);
  const orphans = [...pages].filter((p) => p !== "/" && !linked.has(p));
  check("no orphaned pages", orphans.length === 0, orphans.join(", "));
}

if (!checkExternal) {
  console.log(`\n${external.size} external link(s) not checked — run with --external to include them.\n`);
} else {
  console.log(`\nExternal links (${external.size} distinct)`);
  for (const [url, from] of [...external].sort()) {
    let status = null, error = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal,
        headers: { "user-agent": "Mozilla/5.0 (CMSolutionsLinkCheck)" } });
      if (res.status === 405 || res.status === 501 || res.status === 403) {
        res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal,
          headers: { "user-agent": "Mozilla/5.0 (CMSolutionsLinkCheck)" } });
      }
      clearTimeout(timer);
      status = res.status;
    } catch (cause) {
      error = cause.name === "AbortError" ? "timed out" : cause.message;
    }
    const ok = status !== null && status < 400;
    check(`${url} (${status ?? error})`, ok,
      ok ? "" : `linked from ${[...new Set(from)].join(", ")}`);
  }
}

console.log(
  failures === 0 ? "\nAll link checks passed.\n" : `\n${failures} link check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
