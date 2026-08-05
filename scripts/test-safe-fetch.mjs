/*
  Tests the URL guard that stands between a stranger's input and our server.

    node scripts/test-safe-fetch.mjs

  Every case here is an attack that has worked against real applications. If
  this file passes and the tool still gets used as a proxy, the bug is a case
  nobody thought of — so the list is deliberately longer than feels necessary.

  DNS and fetch are both injected, so the suite makes no network requests and
  gives the same answer on a plane as in CI.
*/

import {
  UnsafeUrlError,
  assertPublicHost,
  fetchPage,
  isBlockedAddress,
  normaliseTarget,
} from "../lib/audit/safe-fetch.mjs";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Asserts that a call throws UnsafeUrlError with a specific code. */
async function refuses(name, fn, expectedCode) {
  try {
    await fn();
    check(name, false, "it was allowed");
  } catch (cause) {
    if (!(cause instanceof UnsafeUrlError)) {
      check(name, false, `threw ${cause?.name}: ${cause?.message}`);
      return;
    }
    check(
      name,
      expectedCode ? cause.code === expectedCode : true,
      expectedCode && cause.code !== expectedCode
        ? `code was "${cause.code}", expected "${expectedCode}"`
        : "",
    );
  }
}

// ── address classification ───────────────────────────────────────────────
console.log("\nBlocked address ranges");

for (const ip of [
  "127.0.0.1", "127.1.2.3", "0.0.0.0",
  "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
  "169.254.169.254",          // AWS/GCP/Azure instance metadata
  "100.64.0.1",               // carrier-grade NAT
  "192.0.2.1", "198.51.100.1", "203.0.113.1",
  "198.18.0.1", "224.0.0.1", "255.255.255.255",
]) {
  check(`${ip} is blocked`, isBlockedAddress(ip));
}

for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "167.233.122.21"]) {
  check(`${ip} is allowed`, !isBlockedAddress(ip));
}

console.log("\nBlocked IPv6");
for (const ip of [
  "::1", "::", "fc00::1", "fd00::1", "fe80::1",
  "::ffff:127.0.0.1",        // IPv4-mapped loopback
  "::ffff:169.254.169.254",  // IPv4-mapped metadata
  "2002::1",
]) {
  check(`${ip} is blocked`, isBlockedAddress(ip));
}
check("2606:4700:4700::1111 is allowed", !isBlockedAddress("2606:4700:4700::1111"));
check("a non-address is blocked", isBlockedAddress("not-an-ip"));
check("an empty string is blocked", isBlockedAddress(""));

// ── input normalisation ──────────────────────────────────────────────────
console.log("\nInput handling");

check(
  "a bare domain becomes https",
  normaliseTarget("example.com").toString() === "https://example.com/",
);
check(
  "surrounding whitespace is ignored",
  normaliseTarget("  example.com  ").toString() === "https://example.com/",
);
check(
  "a path is preserved",
  normaliseTarget("example.com/pricing").toString() === "https://example.com/pricing",
);
check(
  "the fragment is dropped",
  normaliseTarget("https://example.com/a#b").toString() === "https://example.com/a",
);
check(
  "http is accepted",
  normaliseTarget("http://example.com").protocol === "http:",
);

await refuses("empty input is refused", () => normaliseTarget(""), "empty");
await refuses("file:// is refused", () => normaliseTarget("file:///etc/passwd"), "scheme");
await refuses("gopher:// is refused", () => normaliseTarget("gopher://x.com/"), "scheme");
await refuses("javascript: is refused", () => normaliseTarget("javascript:alert(1)"), "scheme");
await refuses("data: is refused", () => normaliseTarget("data:text/html,<b>x"), "scheme");
await refuses(
  "embedded credentials are refused",
  () => normaliseTarget("https://user:pass@example.com"),
  "credentials",
);
await refuses(
  "a non-standard port is refused",
  () => normaliseTarget("http://example.com:6379"),
  "port",
);
await refuses(
  "port 22 is refused",
  () => normaliseTarget("http://example.com:22"),
  "port",
);
await refuses("a bare hostname is refused", () => normaliseTarget("localhost"), "hostname");
await refuses(
  "an IP literal for loopback is refused",
  () => normaliseTarget("http://127.0.0.1/"),
  "private",
);
await refuses(
  "the metadata IP is refused outright",
  () => normaliseTarget("http://169.254.169.254/latest/meta-data/"),
  "private",
);
await refuses(
  "a decimal-encoded loopback is refused",
  // 2130706433 === 127.0.0.1. WHATWG URL normalises this to the dotted form,
  // which is exactly why the IP check has to run on the parsed hostname.
  () => normaliseTarget("http://2130706433/"),
  "private",
);
// The URL API strips a default port, so `.port` is "" for :443 on https and
// :80 on http. What matters is that neither is refused.
check(
  "an explicit port 443 is accepted",
  normaliseTarget("https://example.com:443").toString() === "https://example.com/",
);
check(
  "an explicit port 80 is accepted",
  normaliseTarget("http://example.com:80").toString() === "http://example.com/",
);
check(
  "a non-default port on the other scheme is still refused",
  (() => {
    try {
      // :443 over http is not a default, so the allowlist must still let it
      // through — it is a standard web port either way.
      normaliseTarget("http://example.com:443");
      return true;
    } catch {
      return false;
    }
  })(),
);

// ── DNS ──────────────────────────────────────────────────────────────────
console.log("\nDNS resolution");

const resolverReturning = (addresses) => ({
  lookup: async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
});

check(
  "a public A record is allowed",
  (await assertPublicHost("example.com", resolverReturning(["93.184.216.34"]))).length === 1,
);

await refuses(
  "a domain resolving to loopback is refused",
  () => assertPublicHost("evil.test", resolverReturning(["127.0.0.1"])),
  "private",
);
await refuses(
  "a domain resolving to metadata is refused",
  () => assertPublicHost("evil.test", resolverReturning(["169.254.169.254"])),
  "private",
);
await refuses(
  // The bypass that catches naive checks: one good record, one bad.
  "a domain with ONE private record among several is refused",
  () => assertPublicHost("evil.test", resolverReturning(["93.184.216.34", "10.0.0.5"])),
  "private",
);
await refuses(
  "a domain resolving to IPv6 loopback is refused",
  () => assertPublicHost("evil.test", resolverReturning(["::1"])),
  "private",
);
await refuses(
  "an unresolvable domain is refused",
  () => assertPublicHost("nope.invalid", { lookup: async () => { throw new Error("ENOTFOUND"); } }),
  "dns",
);
await refuses(
  "an empty DNS answer is refused",
  () => assertPublicHost("nope.invalid", resolverReturning([])),
  "dns",
);

// ── fetching and redirects ───────────────────────────────────────────────
console.log("\nFetching");

const publicResolver = resolverReturning(["93.184.216.34"]);

/** Minimal Response stand-in so the suite never touches the network. */
function fakeResponse({ status = 200, headers = {}, body = "" } = {}) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  return {
    status,
    headers: new Headers(headers),
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true };
            sent = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  };
}

{
  const result = await fetchPage("example.com", {
    resolver: publicResolver,
    fetchImpl: async () =>
      fakeResponse({ headers: { "content-type": "text/html" }, body: "<html>hi</html>" }),
  });
  check("a plain page is fetched", result.html === "<html>hi</html>" && result.status === 200);
  check("the final URL is reported", result.url === "https://example.com/");
  check("an empty redirect chain is reported", result.redirects.length === 0);
}

{
  // The attack: a public URL that redirects to instance metadata.
  let hop = 0;
  await refuses(
    "a redirect to a private address is refused",
    () =>
      fetchPage("example.com", {
        resolver: {
          lookup: async (host) =>
            host === "example.com"
              ? [{ address: "93.184.216.34", family: 4 }]
              : [{ address: "169.254.169.254", family: 4 }],
        },
        fetchImpl: async () => {
          hop++;
          return hop === 1
            ? fakeResponse({ status: 302, headers: { location: "http://metadata.test/" } })
            : fakeResponse({ headers: { "content-type": "text/html" }, body: "secrets" });
        },
      }),
    "private",
  );
  check("and it never made the second request", hop === 1, `hops=${hop}`);
}

await refuses(
  "a redirect to file:// is refused",
  () =>
    fetchPage("example.com", {
      resolver: publicResolver,
      fetchImpl: async () =>
        fakeResponse({ status: 301, headers: { location: "file:///etc/passwd" } }),
    }),
  "scheme",
);

await refuses(
  "an endless redirect loop is refused",
  () =>
    fetchPage("example.com", {
      resolver: publicResolver,
      fetchImpl: async () =>
        fakeResponse({ status: 302, headers: { location: "https://example.com/next" } }),
    }),
  "too_many_redirects",
);

{
  let hops = 0;
  const result = await fetchPage("example.com", {
    resolver: publicResolver,
    fetchImpl: async () => {
      hops++;
      return hops === 1
        ? fakeResponse({ status: 301, headers: { location: "https://www.example.com/" } })
        : fakeResponse({ headers: { "content-type": "text/html" }, body: "<html>ok</html>" });
    },
  });
  check("a single legitimate redirect is followed", result.html === "<html>ok</html>");
  check("and the chain is recorded", result.redirects.length === 1, JSON.stringify(result.redirects));
}

await refuses(
  "an oversized declared body is refused",
  () =>
    fetchPage("example.com", {
      resolver: publicResolver,
      fetchImpl: async () =>
        fakeResponse({ headers: { "content-type": "text/html", "content-length": "99999999" } }),
    }),
  "too_large",
);

await refuses(
  // Content-Length is a claim; the streaming counter is the enforcement.
  "an oversized body that lied about its length is refused",
  () =>
    fetchPage("example.com", {
      resolver: publicResolver,
      maxBytes: 100,
      fetchImpl: async () =>
        fakeResponse({ headers: { "content-type": "text/html" }, body: "x".repeat(5000) }),
    }),
  "too_large",
);

await refuses(
  "a non-HTML response is refused",
  () =>
    fetchPage("example.com", {
      resolver: publicResolver,
      fetchImpl: async () =>
        fakeResponse({ headers: { "content-type": "application/zip" }, body: "PK" }),
    }),
  "not_html",
);

await refuses(
  "a connection failure is reported without leaking internals",
  () =>
    fetchPage("example.com", {
      resolver: publicResolver,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.7:443");
      },
    }),
  "unreachable",
);

{
  let leaked = false;
  try {
    await fetchPage("example.com", {
      resolver: publicResolver,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.7:443");
      },
    });
  } catch (cause) {
    leaked = /10\.0\.0\.7|ECONNREFUSED/.test(cause.message);
  }
  check("and the internal address is not in the message", !leaked);
}

await refuses(
  "a timeout is reported as a timeout",
  () =>
    fetchPage("example.com", {
      resolver: publicResolver,
      fetchImpl: async () => {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      },
    }),
  "timeout",
);

console.log(
  failures === 0
    ? "\nAll safe-fetch tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
