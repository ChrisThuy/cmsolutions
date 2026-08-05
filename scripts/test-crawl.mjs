/*
  Tests the multi-page crawl.

    node scripts/test-crawl.mjs

  One request in, several out. That is amplification, so the containment rules
  are the point of this file: same origin only, a hard page cap, a shared
  deadline, and no page fetched twice. A crawl that follows outbound links is
  not a website checker, it is a scanner pointed at whoever the page links to.

  fetchPage is injected throughout, so nothing here touches the network.
*/

import { crawlSite, sameOriginLinks, sitemapUrls } from "../lib/audit/crawl.mjs";
import { UnsafeUrlError } from "../lib/audit/safe-fetch.mjs";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BASE = "https://example.com/";

console.log("\nLink discovery stays on the origin");
{
  const html = `
    <a href="/services">Services</a>
    <a href="/about/">About</a>
    <a href="https://example.com/contact">Contact</a>
    <a href="https://evil.example/steal">Off site</a>
    <a href="http://example.com/insecure">Other scheme, same host</a>
    <a href="//cdn.example.net/thing">Protocol relative, other host</a>
    <a href="mailto:x@example.com">Mail</a>
    <a href="tel:+441170000000">Phone</a>
    <a href="javascript:alert(1)">Script</a>
    <a href="#top">Fragment</a>
    <a href="/brochure.pdf">PDF</a>
    <a href="/logo.png">Image</a>
  `;
  const links = sameOriginLinks(html, BASE);

  check("same-origin paths are found", links.includes("https://example.com/services"));
  check("a trailing slash is normalised away", links.includes("https://example.com/about"));
  check("an absolute same-origin URL is found", links.includes("https://example.com/contact"));

  check("an off-site link is never queued", !links.some((l) => l.includes("evil.example")));
  check("a protocol-relative off-host link is never queued", !links.some((l) => l.includes("cdn.example.net")));
  // http://example.com is a different origin from https://example.com.
  check("a different scheme on the same host is a different origin",
    !links.some((l) => l.startsWith("http://")), links.join(" "));

  check("mailto is ignored", !links.some((l) => l.includes("mailto")));
  check("tel is ignored", !links.some((l) => l.includes("tel:")));
  check("javascript: is ignored", !links.some((l) => l.includes("javascript")));
  check("a bare fragment is ignored", !links.some((l) => l.includes("#")));
  check("a PDF is not a page", !links.some((l) => l.endsWith(".pdf")));
  check("an image is not a page", !links.some((l) => l.endsWith(".png")));
}

console.log("\nDeduplication");
{
  const html = `
    <a href="/services">A</a>
    <a href="/services/">B</a>
    <a href="/services#pricing">C</a>
    <a href="/services?utm_source=x">D</a>
    <a href="/">Home</a>
    <a href="https://example.com/">Home again</a>
  `;
  const links = sameOriginLinks(html, BASE);
  check("four spellings of one page yield one entry",
    links.filter((l) => l.includes("/services")).length === 1, links.join(" "));
  check("the page we are already on is not queued",
    !links.includes("https://example.com/"), links.join(" "));
}

// ── crawl harness ────────────────────────────────────────────────────────
const htmlWith = (links, extra = "") => `<!DOCTYPE html><html lang="en"><head>
<title>A perfectly reasonable page title here</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
${extra}</head><body><h1>Heading</h1>
${links.map((l) => `<a href="${l}">link</a>`).join("")}
<p>${"Some words of body copy. ".repeat(20)}</p></body></html>`;

function fakeFetcher(pages, log = []) {
  return async (url) => {
    log.push(url);
    const html = pages[url];
    if (html === undefined) {
      throw new UnsafeUrlError("unreachable", "We could not reach that site.");
    }
    return {
      url,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      html,
      redirects: [],
      elapsedMs: 50,
    };
  };
}

console.log("\nThe crawl is bounded");
{
  const many = Array.from({ length: 40 }, (_, i) => `/page-${i}`);
  const pages = { "https://example.com/": htmlWith(many) };
  for (const p of many) pages[`https://example.com${p}`] = htmlWith([]);

  const log = [];
  const result = await crawlSite("example.com", {
    fetchPageImpl: fakeFetcher(pages, log),
    maxPages: 6,
  });

  check("no more pages than the cap are checked", result.counts.pages === 6, `${result.counts.pages}`);
  /*
    Discovery costs two extra requests — robots.txt and sitemap.xml — so a
    scan is up to eight outbound requests, not six. Asserted explicitly rather
    than left implicit, because this is the amplification bound and it changed
    when sitemap support was added.
  */
  check("total outbound requests stay within pages + discovery",
    log.length <= 8, `fetched ${log.length}`);
  check("the requested page is first", result.pagesChecked[0] === "https://example.com/");
}

console.log("\nThe deadline is shared across the whole crawl");
{
  const many = Array.from({ length: 20 }, (_, i) => `/p${i}`);
  const pages = { "https://example.com/": htmlWith(many) };
  for (const p of many) pages[`https://example.com${p}`] = htmlWith([]);

  // A clock that jumps 9 seconds per call exhausts a 22s budget quickly.
  let t = 0;
  const log = [];
  const result = await crawlSite("example.com", {
    fetchPageImpl: fakeFetcher(pages, log),
    budgetMs: 22_000,
    now: () => (t += 9_000),
  });

  check("a slow site stops early rather than running on",
    result.counts.pages < 6, `fetched ${result.counts.pages}`);
  check("but the first page is still reported", result.counts.pages >= 1);
}

console.log("\nOne bad page does not fail the report");
{
  const pages = {
    "https://example.com/": htmlWith(["/good", "/gone"]),
    "https://example.com/good": htmlWith([]),
    // "/gone" is deliberately absent, so the fetcher throws for it.
  };
  const result = await crawlSite("example.com", { fetchPageImpl: fakeFetcher(pages) });

  check("the reachable pages are still checked", result.counts.pages === 2, `${result.counts.pages}`);
  check("the unreachable one is reported rather than dropped",
    result.unreachable.length === 1 && result.unreachable[0].url === "https://example.com/gone",
    JSON.stringify(result.unreachable));
}

console.log("\nSystemic issues are grouped, not repeated");
{
  // Three pages, none with a meta description: one issue affecting three
  // pages, rather than three separate findings.
  const pages = {
    "https://example.com/": htmlWith(["/a", "/b"]),
    "https://example.com/a": htmlWith([]),
    "https://example.com/b": htmlWith([]),
  };
  const result = await crawlSite("example.com", { fetchPageImpl: fakeFetcher(pages) });

  const description = result.issues.find((i) => i.id === "description");
  check("a missing description appears once", Boolean(description));
  check("and names every page it affects", description?.pages.length === 3, JSON.stringify(description?.pages));
  check("it carries the fix", Boolean(description?.fix));

  check("issues are sorted with failures first",
    result.issues[0].status === "fail", result.issues[0]?.status);

  const ids = result.issues.map((i) => i.id);
  check("no issue id appears twice", new Set(ids).size === ids.length, ids.join(","));

  check("passing checks are not listed as issues",
    !result.issues.some((i) => i.status === "pass"));

  check("per-page detail is retained", result.perPage.length === 3);
}

console.log("\nLinks come from where we landed, not where we aimed");
{
  // A redirect from apex to www changes the origin. Following links found on
  // the landed page is what keeps the crawl on the site that actually exists.
  const pages = { "https://www.example.com/": htmlWith(["/inner"]), "https://www.example.com/inner": htmlWith([]) };
  const fetcher = async (url) => {
    const target = url === "https://example.com/" ? "https://www.example.com/" : url;
    const html = pages[target];
    if (html === undefined) throw new UnsafeUrlError("unreachable", "no");
    return { url: target, status: 200, headers: new Headers(), html, redirects: [], elapsedMs: 10 };
  };

  const result = await crawlSite("example.com", { fetchPageImpl: fetcher });
  check("the crawl follows the redirected origin",
    result.pagesChecked.includes("https://www.example.com/inner"), JSON.stringify(result.pagesChecked));
}

console.log("\nA bad address costs nothing");
{
  let fetched = 0;
  try {
    await crawlSite("http://169.254.169.254/", {
      fetchPageImpl: async () => { fetched++; throw new Error("should not be called"); },
    });
    check("cloud metadata is refused", false, "it was allowed");
  } catch (cause) {
    check("cloud metadata is refused", cause instanceof UnsafeUrlError);
  }
  check("and nothing was fetched", fetched === 0);
}

console.log("\nSitemap parsing stays on the origin");
{
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://example.com/</loc></url>
    <url><loc>https://example.com/services</loc></url>
    <url><loc>https://example.com/about/</loc></url>
    <url><loc>https://evil.example/steal</loc></url>
    <url><loc>  https://example.com/spaced  </loc></url>
    <url><loc>not a url at all</loc></url>
  </urlset>`;
  const { isIndex, urls } = sitemapUrls(xml, "https://example.com/");

  check("it is not an index", isIndex === false);
  check("same-origin entries are kept", urls.includes("https://example.com/services"));
  check("a trailing slash is normalised", urls.includes("https://example.com/about"));
  check("whitespace inside <loc> is trimmed", urls.includes("https://example.com/spaced"));
  check("an off-origin entry is dropped", !urls.some((u) => u.includes("evil.example")));
  check("an unparseable entry is dropped", urls.length === 4, urls.join(" "));
}

{
  const index = `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
  </sitemapindex>`;
  check("a sitemap index is identified", sitemapUrls(index, "https://example.com/").isIndex === true);
}

console.log("\nThe sitemap is preferred over guessing from the nav");
{
  // The real case this fixes: our own site declared six pages and link
  // discovery found three, so the audit was missing half of what it was
  // pointed at.
  const pages = {
    "https://example.com/": htmlWith(["/only-linked"]),
    "https://example.com/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml",
    "https://example.com/sitemap.xml":
      `<urlset><url><loc>https://example.com/</loc></url>
       <url><loc>https://example.com/deep-page</loc></url>
       <url><loc>https://example.com/another</loc></url></urlset>`,
    "https://example.com/only-linked": htmlWith([]),
    "https://example.com/deep-page": htmlWith([]),
    "https://example.com/another": htmlWith([]),
  };

  const result = await crawlSite("example.com", { fetchPageImpl: fakeFetcher(pages) });

  check("a page only in the sitemap is checked",
    result.pagesChecked.includes("https://example.com/deep-page"), JSON.stringify(result.pagesChecked));
  check("a page only in the nav is still checked",
    result.pagesChecked.includes("https://example.com/only-linked"), JSON.stringify(result.pagesChecked));
  check("the home page is not queued twice",
    result.pagesChecked.filter((u) => u === "https://example.com/").length === 1);
  check("discovery reports the sitemap was used", result.discovery === "sitemap", result.discovery);
}

console.log("\nNo sitemap is normal, not a fault");
{
  const pages = {
    "https://example.com/": htmlWith(["/a"]),
    "https://example.com/a": htmlWith([]),
    // robots.txt and sitemap.xml deliberately absent — the fetcher throws.
  };
  const result = await crawlSite("example.com", { fetchPageImpl: fakeFetcher(pages) });

  check("the crawl still works", result.counts.pages === 2, `${result.counts.pages}`);
  check("it falls back to links", result.discovery === "links", result.discovery);
  check("a missing sitemap is not reported as unreachable",
    !result.unreachable.some((u) => u.url.includes("sitemap")), JSON.stringify(result.unreachable));
}

console.log("\nA sitemap cannot be used to reach another origin");
{
  let fetched = [];
  const pages = {
    "https://example.com/": htmlWith([]),
    "https://example.com/robots.txt": "Sitemap: https://evil.example/sitemap.xml",
    "https://example.com/sitemap.xml": `<urlset><url><loc>https://evil.example/secret</loc></url></urlset>`,
  };
  const result = await crawlSite("example.com", { fetchPageImpl: fakeFetcher(pages, fetched) });

  check("an off-origin Sitemap: directive is ignored",
    !fetched.some((u) => u.includes("evil.example")), fetched.join(" "));
  check("an off-origin <loc> is never fetched",
    !result.pagesChecked.some((u) => u.includes("evil.example")));
}

console.log(
  failures === 0
    ? "\nAll crawl tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
