import { fetchPage, normaliseTarget, UnsafeUrlError } from "./safe-fetch.mjs";
import { runChecks } from "./checks.mjs";

/*
  Checks a handful of pages rather than one.

  A single-page checker is a toy. Nobody's homepage is the problem — the
  problem is the four service pages nobody has looked at since launch, which is
  exactly what an agency needs to know before a client conversation. Reporting
  "4 of your 6 pages have no meta description" is a different statement from
  "your homepage has one".

  ── what changes about the risk ────────────────────────────────────────────

  One request in, several requests out. That is amplification, so the limits
  here are tighter than the per-page ones and they are structural rather than
  advisory:

    - Same origin only. A link to another domain is never followed. This is a
      security property, not a scoping preference: without it, the crawl
      follows outbound links and becomes a general-purpose scanner pointed at
      whoever a page happens to link to.
    - A hard page cap, so a site with a thousand links costs the same as one
      with ten.
    - One shared deadline across the whole crawl, so a slow site cannot hold a
      function open by being slow five times in a row.
    - Deduplication, including the trailing-slash and fragment variants of the
      same page, so a nav that links "/" and "/index.html" does not burn the
      budget on one page twice.

  Every fetch still goes through fetchPage, so all the per-request SSRF
  defences apply unchanged to each hop.
*/

export const MAX_PAGES = 6;
export const CRAWL_BUDGET_MS = 22_000;

/** Strips the fragment and any trailing slash, so one page is one entry. */
function canonicalise(url) {
  const copy = new URL(url.toString());
  copy.hash = "";
  copy.search = "";
  if (copy.pathname !== "/" && copy.pathname.endsWith("/")) {
    copy.pathname = copy.pathname.slice(0, -1);
  }
  return copy.toString();
}

/** File extensions that are not pages, so are never worth queueing. */
const NON_PAGE = /\.(pdf|jpg|jpeg|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|zip|gz|mp4|mp3|woff2?|ttf|eot)$/i;

/**
 * Same-origin page links found in the HTML, in document order.
 *
 * Document order matters: the first links on a page are almost always the
 * primary navigation, which is exactly the set worth checking. Sorting by
 * anything cleverer would mostly find footer boilerplate.
 */
export function sameOriginLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set([canonicalise(base)]);
  const found = [];

  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith("#")) continue;
    if (/^(mailto|tel|javascript|data):/i.test(raw)) continue;

    let candidate;
    try {
      candidate = new URL(raw, base);
    } catch {
      continue;
    }

    // The security property: never leave the origin we were asked about.
    if (candidate.origin !== base.origin) continue;
    if (NON_PAGE.test(candidate.pathname)) continue;

    const key = canonicalise(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(key);
  }

  return found;
}

/**
 * Fetches and checks up to MAX_PAGES pages of one site.
 *
 * The first page is whatever was asked for. The rest come from its own links,
 * in document order, which in practice means the primary navigation.
 *
 * A page that fails individually does not fail the crawl: a broken link in a
 * nav is a finding, not a reason to abandon the report.
 */
export async function crawlSite(target, options = {}) {
  const {
    maxPages = MAX_PAGES,
    budgetMs = CRAWL_BUDGET_MS,
    fetchPageImpl = fetchPage,
    now = () => Date.now(),
  } = options;

  const startedAt = now();
  const remaining = () => budgetMs - (now() - startedAt);

  // Validated before anything is fetched, so a bad address costs nothing.
  const first = normaliseTarget(target);

  const home = await fetchPageImpl(first.toString(), {
    timeoutMs: Math.min(8_000, Math.max(1_000, remaining())),
  });

  const pages = [{ page: home, report: runChecks(home) }];
  const failures = [];

  // Links come from the page we actually landed on, which may differ from the
  // one asked for — a redirect from apex to www changes what "same origin"
  // means, and following the original would leave the site immediately.
  const queue = sameOriginLinks(home.html, home.url).slice(0, maxPages - 1);

  for (const url of queue) {
    if (remaining() <= 2_000) break;

    try {
      const page = await fetchPageImpl(url, {
        timeoutMs: Math.min(6_000, Math.max(1_000, remaining())),
      });
      pages.push({ page, report: runChecks(page) });
    } catch (cause) {
      // Recorded rather than swallowed: a nav link that does not resolve is
      // one of the more useful things a report can tell someone.
      failures.push({
        url,
        reason: cause instanceof UnsafeUrlError ? cause.message : "Could not be reached.",
      });
    }
  }

  return summarise(pages, failures, home.url, now() - startedAt);
}

/**
 * Turns per-page reports into the site-level view.
 *
 * The headline is which issues are systemic. "Missing on 4 of 6 pages" is a
 * template problem with one fix; the same finding listed six times reads as
 * six problems and gets triaged as none.
 */
function summarise(pages, failures, siteUrl, elapsedMs) {
  const byCheck = new Map();

  for (const { page, report } of pages) {
    for (const result of report.results) {
      if (result.status === "pass" || result.status === "info") continue;

      const existing = byCheck.get(result.id);
      if (existing) {
        existing.pages.push(page.url);
        // Keep the worst status seen: one failing page is not softened by
        // five that merely warn.
        if (result.status === "fail") existing.status = "fail";
      } else {
        byCheck.set(result.id, {
          id: result.id,
          label: result.label,
          status: result.status,
          why: result.why,
          fix: result.fix,
          pages: [page.url],
        });
      }
    }
  }

  const issues = [...byCheck.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === "fail" ? -1 : 1;
    return b.pages.length - a.pages.length;
  });

  return {
    site: siteUrl,
    checkedAt: new Date().toISOString(),
    pagesChecked: pages.map((p) => p.page.url),
    unreachable: failures,
    elapsedMs,
    counts: {
      pages: pages.length,
      fail: issues.filter((i) => i.status === "fail").length,
      warn: issues.filter((i) => i.status === "warn").length,
    },
    issues,
    // The per-page detail is kept so a report can show which page to open,
    // rather than only that something is wrong somewhere.
    perPage: pages.map(({ page, report }) => ({
      url: page.url,
      counts: report.counts,
    })),
  };
}
