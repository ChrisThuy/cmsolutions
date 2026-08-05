import dns from "node:dns/promises";
import net from "node:net";

/*
  Fetching a URL that a stranger supplied, from our own server.

  This is the whole security surface of the audit tool. Everything else here
  parses HTML; this decides whether we will make a request at all, and getting
  it wrong turns the tool into an open proxy that can reach anything our
  server can reach — cloud metadata endpoints, internal admin panels, a
  database bound to loopback.

  The defences, and what each one is actually for:

    1. Scheme allowlist. file:// reads our disk, gopher:// and dict:// have
       been used to talk to non-HTTP services through a URL parser.
    2. No credentials in the URL. http://user:pass@host is a way to smuggle
       something past a naive host check, and it puts secrets in our logs.
    3. Port allowlist (80, 443). Without it, http://internal:6379 reaches
       Redis. A website audit has no legitimate reason to want another port.
    4. DNS resolution, then an IP check on EVERY resolved address. A hostname
       that resolves to 127.0.0.1 is the simplest bypass there is, and a name
       with several A records only needs one of them to be private.
    5. Redirects followed manually, re-validating every hop. A public URL that
       302s to 169.254.169.254 defeats any check done only on the input.
    6. Response size cap, enforced while streaming. Content-Length is a claim,
       not a fact.
    7. Timeout on the whole operation, so a server that accepts and then stalls
       cannot hold our function open.

  What this does NOT defend against is DNS rebinding: the name is resolved
  here, and the runtime resolves it again when connecting, so a record with a
  one-second TTL could differ between the two. Closing that needs connecting
  to a pinned IP and sending the Host header ourselves, which fetch cannot do.
  It is recorded rather than hidden — the practical exposure is small because
  the port allowlist means a successful rebind still only reaches an HTTP
  service on 80 or 443.
*/

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);

export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 2_000_000;
export const TIMEOUT_MS = 8_000;

/** A refusal a visitor should be able to act on, plus a stable code for tests. */
export class UnsafeUrlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UnsafeUrlError";
    this.code = code;
  }
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

/*
  Ranges that must never be reached. Sourced from the IANA special-purpose
  registries rather than assembled from memory — the ones people forget are
  100.64/10 (carrier NAT) and 192.0.0/24, and 169.254/16 is the one that
  actually matters, because that is where cloud instance metadata lives.
*/
const BLOCKED_V4 = [
  ["0.0.0.0", 8],        // "this network"
  ["10.0.0.0", 8],       // private
  ["100.64.0.0", 10],    // carrier-grade NAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local — cloud metadata
  ["172.16.0.0", 12],    // private
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // TEST-NET-1
  ["192.88.99.0", 24],   // 6to4 relay anycast
  ["192.168.0.0", 16],   // private
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // TEST-NET-2
  ["203.0.113.0", 24],   // TEST-NET-3
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved, includes 255.255.255.255
];

function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(network) & mask);
  });
}

function isBlockedIpv6(ip) {
  const lower = ip.toLowerCase().split("%")[0]; // strip any zone index

  if (lower === "::1" || lower === "::") return true;

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible: judge the embedded
  // address, or loopback slips through wearing a v6 costume.
  const embedded = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isBlockedIpv4(embedded[1]);

  return (
    /^f[cd][0-9a-f]{2}:/.test(lower) || // fc00::/7 unique local
    /^fe[89ab][0-9a-f]:/.test(lower) || // fe80::/10 link-local
    /^2002:/.test(lower) ||             // 6to4
    /^100:/.test(lower)                 // discard-only
  );
}

/** True when an address must not be contacted. */
export function isBlockedAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // not an IP at all — refuse rather than guess
}

/**
 * Normalises what a visitor typed into a URL we are willing to consider.
 *
 * Accepts "example.com" as well as a full URL, because that is what people
 * paste. Throws UnsafeUrlError with a code the caller can map to a message.
 */
export function normaliseTarget(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new UnsafeUrlError("empty", "Enter a website address.");
  if (raw.length > 2000) {
    throw new UnsafeUrlError("too_long", "That address is too long.");
  }

  // A bare domain is the common case; assume https rather than rejecting it.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new UnsafeUrlError("unparseable", "That does not look like a web address.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(
      "scheme",
      "Only http and https addresses can be checked.",
    );
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError(
      "credentials",
      "Remove the username and password from the address.",
    );
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError(
      "port",
      "Only the standard web ports (80 and 443) can be checked.",
    );
  }

  if (!url.hostname || !url.hostname.includes(".")) {
    throw new UnsafeUrlError(
      "hostname",
      "That does not look like a public website address.",
    );
  }

  // An IP literal skips DNS entirely, so judge it here as well as after
  // resolution — otherwise http://127.0.0.1 never reaches the IP check.
  if (net.isIP(url.hostname) && isBlockedAddress(url.hostname)) {
    throw new UnsafeUrlError("private", "That address is not publicly reachable.");
  }

  url.hash = "";
  return url;
}

/**
 * Refuses a hostname whose DNS resolution reaches anything private.
 *
 * Every returned address is checked, not just the first: a name with several
 * A records only needs one of them pointing inward to be dangerous.
 */
export async function assertPublicHost(hostname, resolver = dns) {
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new UnsafeUrlError("private", "That address is not publicly reachable.");
    }
    return [hostname];
  }

  let records;
  try {
    records = await resolver.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(
      "dns",
      "We could not find that domain. Check the spelling.",
    );
  }

  if (!records.length) {
    throw new UnsafeUrlError("dns", "We could not find that domain.");
  }

  const addresses = records.map((r) => r.address);
  if (addresses.some(isBlockedAddress)) {
    throw new UnsafeUrlError("private", "That address is not publicly reachable.");
  }

  return addresses;
}

/** Reads a response body up to a hard byte ceiling. */
async function readCapped(response, limit) {
  // Content-Length is a claim. It is worth an early exit, but the streaming
  // count below is what actually enforces the limit.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new UnsafeUrlError("too_large", "That page is too large to check.");
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new UnsafeUrlError("too_large", "That page is too large to check.");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Fetches a page with every guard applied, following redirects by hand.
 *
 * Manual redirects are the point: `redirect: "follow"` would let a public URL
 * bounce us to a private one with no further check. Each hop is re-validated
 * exactly as the first was.
 *
 * Returns the final URL, status, headers and body — the redirect chain is
 * included because "this domain redirects to www" is itself an audit finding.
 */
export async function fetchPage(input, options = {}) {
  const {
    fetchImpl = fetch,
    resolver = dns,
    maxRedirects = MAX_REDIRECTS,
    maxBytes = MAX_BYTES,
    timeoutMs = TIMEOUT_MS,
    /*
      What content types are acceptable. Defaults to HTML, because a page
      checker asked for a web page and handed a zip file should say so rather
      than analyse it. A caller fetching a sitemap widens this deliberately.
    */
    allowContentType = /text\/html|application\/xhtml/i,
  } = options;

  let url = normaliseTarget(input);
  const chain = [];
  const startedAt = Date.now();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(url.hostname, resolver);

    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      throw new UnsafeUrlError("timeout", "That site took too long to respond.");
    }

    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
        headers: {
          // Identifies us honestly and gives a way to block us. A tool that
          // fetches other people's sites should say who it is.
          "User-Agent":
            "CMSolutionsSiteCheck/1.0 (+https://cmsolutions.tech/free-website-audit-tool)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (cause) {
      if (cause instanceof UnsafeUrlError) throw cause;
      const timedOut =
        cause?.name === "TimeoutError" || cause?.name === "AbortError";
      throw new UnsafeUrlError(
        timedOut ? "timeout" : "unreachable",
        timedOut
          ? "That site took too long to respond."
          : "We could not reach that site.",
      );
    }

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && location;

    if (!isRedirect) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !allowContentType.test(contentType)) {
        throw new UnsafeUrlError(
          "not_html",
          "That address does not return a web page.",
        );
      }

      return {
        url: url.toString(),
        status: response.status,
        headers: response.headers,
        html: await readCapped(response, maxBytes),
        redirects: chain,
        elapsedMs: Date.now() - startedAt,
      };
    }

    if (hop === maxRedirects) {
      throw new UnsafeUrlError("too_many_redirects", "That site redirects too many times.");
    }

    let next;
    try {
      next = new URL(location, url);
    } catch {
      throw new UnsafeUrlError("bad_redirect", "That site redirected somewhere invalid.");
    }

    // The redirect target goes through the same front door as the original.
    // Anything less and the first check is decoration.
    next = normaliseTarget(next.toString());

    chain.push({ from: url.toString(), to: next.toString(), status: response.status });
    url = next;
  }

  throw new UnsafeUrlError("too_many_redirects", "That site redirects too many times.");
}
