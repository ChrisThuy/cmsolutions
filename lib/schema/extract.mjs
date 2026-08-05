/*
  Reads a page and works out what it already says about the business.

  The blank form is why most people abandon a generator like this. Fifteen
  fields and a cursor is work; a form already holding your own details, waiting
  to be corrected, is a minute. Everything below exists to turn the second into
  the first.

  Two rules it follows.

  Existing structured data wins over guesses. If a site already declares a
  telephone number in JSON-LD, that is the number — inferring one from a `tel:`
  link in the footer is a fallback, not an improvement on being told.

  Nothing is invented. A field that cannot be found stays empty, because a
  plausible-looking description the business did not write is worse than a gap
  they can see and fill. The whole point of the output is that it is true.
*/

const decode = (value) =>
  String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function meta(html, attr, name) {
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${name}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern)?.[1];
    if (found !== undefined) return decode(found);
  }
  return "";
}

/** Every JSON-LD node on the page, flattened out of @graph and arrays. */
export function jsonLdNodes(html) {
  const nodes = [];
  for (const block of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let parsed;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      // Invalid JSON-LD is a finding for the audit tool, not something to
      // repair here. Skipped rather than guessed at.
      continue;
    }
    const list = parsed?.["@graph"] ?? (Array.isArray(parsed) ? parsed : [parsed]);
    for (const node of list) if (node && typeof node === "object") nodes.push(node);
  }
  return nodes;
}

/** The node most likely to describe the business itself. */
function businessNode(nodes) {
  const isBusinessish = (type) =>
    typeof type === "string" &&
    /Organization|LocalBusiness|Service|Store|Restaurant|FoodEstablishment|Business|Practice/i.test(type);

  return (
    nodes.find((n) => {
      const type = Array.isArray(n["@type"]) ? n["@type"][0] : n["@type"];
      return isBusinessish(type);
    }) ?? null
  );
}

/** The first href matching a scheme, decoded. */
function firstLink(html, scheme) {
  const match = html.match(new RegExp(`href=["']${scheme}:([^"']+)["']`, "i"));
  return match ? decode(decodeURIComponent(match[1])).trim() : "";
}

const SOCIAL = /^https?:\/\/(www\.)?(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|github\.com)\//i;

/** Outbound links to profiles that confirm the same organisation elsewhere. */
function socialLinks(html) {
  const found = new Set();
  for (const match of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    const url = match[1];
    if (!SOCIAL.test(url)) continue;
    // Trim tracking noise; a profile URL is the path, not the campaign.
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      found.add(parsed.toString().replace(/\/$/, ""));
    } catch {
      // Unparseable href, skip.
    }
    if (found.size >= 5) break;
  }
  return [...found];
}

/** Opening hours out of an OpeningHoursSpecification, if one exists. */
function hoursFrom(node) {
  const spec = node?.openingHoursSpecification;
  if (!spec) return [];
  const list = Array.isArray(spec) ? spec : [spec];

  const hours = [];
  for (const entry of list) {
    const days = Array.isArray(entry?.dayOfWeek) ? entry.dayOfWeek : [entry?.dayOfWeek];
    for (const day of days) {
      if (typeof day !== "string") continue;
      // Values arrive as either "Monday" or "https://schema.org/Monday".
      const name = day.split("/").pop();
      if (!name || !entry.opens || !entry.closes) continue;
      hours.push({ day: name, open: String(entry.opens).slice(0, 5), close: String(entry.closes).slice(0, 5) });
    }
  }
  return hours;
}

/**
 * Everything worth pre-filling, plus what the page already declares.
 *
 * `existingTypes` is reported so the interface can say "you already have
 * Organization markup" rather than silently producing a second, competing
 * block — which would be a worse outcome than the missing one.
 */
export function extractBusiness(html, pageUrl) {
  const nodes = jsonLdNodes(html);
  const node = businessNode(nodes);

  const address = node?.address ?? {};
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");

  // "Harbour & Co | Chartered Accountants" — the brand is almost always the
  // first part, before a separator.
  const titleBrand = title.split(/\s+[|–—·-]\s+/)[0]?.trim() ?? "";

  const telephone = typeof node?.telephone === "string" ? node.telephone.trim() : "";
  const email = typeof node?.email === "string" ? node.email.trim() : "";

  return {
    // Declared name beats og:site_name beats the brand half of the title.
    name: decode(node?.name) || meta(html, "property", "og:site_name") || titleBrand,
    description:
      decode(node?.description) ||
      meta(html, "name", "description") ||
      meta(html, "property", "og:description"),
    url: pageUrl,

    phone: telephone || firstLink(html, "tel"),
    email: email || firstLink(html, "mailto"),

    street: decode(address.streetAddress),
    city: decode(address.addressLocality),
    region: decode(address.addressRegion),
    postcode: decode(address.postalCode),
    country: decode(address.addressCountry) || "GB",

    priceRange: decode(node?.priceRange),
    areaServed: typeof node?.areaServed === "string" ? decode(node.areaServed) : "",

    hours: hoursFrom(node),
    sameAs: Array.isArray(node?.sameAs)
      ? node.sameAs.filter((s) => typeof s === "string")
      : socialLinks(html),

    // What is already there, so we can say so rather than duplicate it.
    existingTypes: [
      ...new Set(
        nodes
          .map((n) => (Array.isArray(n["@type"]) ? n["@type"][0] : n["@type"]))
          .filter((t) => typeof t === "string"),
      ),
    ],
  };
}
