/*
  Builds valid schema.org JSON-LD from a short form.

  Runs in the browser and under node from the same file: the page loads it as
  a module, and scripts/test-schema-builder.mjs imports it directly. No build
  step, and no second copy to drift.

  ── the rule this tool is built around ─────────────────────────────────────

  It will not generate a rating, a review count, or a review.

  Every other generator of this kind offers an aggregateRating field with boxes
  for "rating value" and "review count", and people type numbers into them.
  That is fabricated review data in machine-readable form. It breaches Google's
  structured data policies, it is a manual-action risk for the site, and in the
  UK inventing customer reviews is a consumer protection matter rather than an
  SEO one.

  Refusing is not a limitation to apologise for. It is the difference between a
  tool that helps and a tool that gets its users penalised, and saying so is
  worth more than the field would be.

  Nothing here invents content either. Every value in the output came from the
  form. Empty fields are omitted rather than filled with something plausible —
  a description the business did not write is a lie in their own voice.
*/

/** Business types that cover most of who asks. Value is the schema.org type. */
export const BUSINESS_TYPES = [
  { value: "ProfessionalService", label: "Professional services (general)" },
  { value: "AccountingService", label: "Accountancy or bookkeeping" },
  { value: "LegalService", label: "Legal / solicitors" },
  { value: "FinancialService", label: "Financial services" },
  { value: "InsuranceAgency", label: "Insurance" },
  { value: "RealEstateAgent", label: "Estate agency" },
  { value: "MedicalBusiness", label: "Medical or dental practice" },
  { value: "HealthAndBeautyBusiness", label: "Health and beauty" },
  { value: "HomeAndConstructionBusiness", label: "Trades and construction" },
  { value: "AutomotiveBusiness", label: "Automotive" },
  { value: "FoodEstablishment", label: "Restaurant, cafe or pub" },
  { value: "Store", label: "Shop or retail" },
  { value: "EducationalOrganization", label: "Training or education" },
  { value: "Organization", label: "Not a local business — organisation only" },
];

export const DAYS = [
  { value: "Monday", short: "Mon" },
  { value: "Tuesday", short: "Tue" },
  { value: "Wednesday", short: "Wed" },
  { value: "Thursday", short: "Thu" },
  { value: "Friday", short: "Fri" },
  { value: "Saturday", short: "Sat" },
  { value: "Sunday", short: "Sun" },
];

const clean = (value) => (typeof value === "string" ? value.trim() : "");

/** Drops empty strings, empty arrays and empty objects, recursively. */
function prune(value) {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
      const pruned = prune(raw);
      if (pruned !== undefined) out[key] = pruned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return value === null || value === undefined ? undefined : value;
}

/** Adds https:// to a bare domain, so a pasted "example.com" still produces a valid URL. */
export function normaliseUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return "";
  }

  /*
    The URL parser is more forgiving than a domain is.

    "ht!tp://%%%" parses without complaint and yields a URL whose hostname is
    "ht!tp" — so relying on the constructor throwing lets obvious nonsense
    through and puts it in the published markup. A hostname has to look like a
    hostname: labels of letters, digits and hyphens, and at least one dot.
    Internationalised domains arrive here already punycoded as xn--.
  */
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(url.hostname)) {
    return "";
  }

  return url.toString();
}

/**
 * Opening hours in the shape Google expects.
 *
 * One entry per day rather than grouping consecutive days: grouping is only a
 * byte saving, and an incorrectly grouped range is a wrong opening time shown
 * to a customer standing outside a closed door.
 */
function openingHours(hours) {
  if (!Array.isArray(hours)) return undefined;
  return hours
    .filter((h) => h && h.open && h.close && h.day)
    .map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${h.day}`,
      opens: h.open,
      closes: h.close,
    }));
}

/**
 * Builds the business node.
 *
 * `@id` is a stable identifier other nodes point at, rather than repeating the
 * whole organisation inside each one. It is what makes a graph a graph.
 */
export function buildBusiness(input) {
  const url = normaliseUrl(input.url);
  const isLocal = input.businessType !== "Organization";
  const id = url ? `${url.replace(/\/$/, "")}/#business` : undefined;

  const address = prune({
    "@type": "PostalAddress",
    streetAddress: clean(input.street),
    addressLocality: clean(input.city),
    addressRegion: clean(input.region),
    postalCode: clean(input.postcode),
    addressCountry: clean(input.country) || "GB",
  });

  // A country alone is not an address worth publishing — it says nothing and
  // makes the markup look padded.
  const hasRealAddress =
    Boolean(clean(input.street) || clean(input.city) || clean(input.postcode));

  return prune({
    "@type": input.businessType || "ProfessionalService",
    "@id": id,
    name: clean(input.name),
    url: url || undefined,
    description: clean(input.description),
    telephone: clean(input.phone),
    email: clean(input.email),
    address: hasRealAddress ? address : undefined,
    priceRange: clean(input.priceRange),
    areaServed: clean(input.areaServed),
    openingHoursSpecification: isLocal ? openingHours(input.hours) : undefined,
    // Profiles that confirm this is the same organisation elsewhere.
    sameAs: (input.sameAs ?? []).map(normaliseUrl).filter(Boolean),
  });
}

/** Builds a FAQPage from question/answer pairs. */
export function buildFaq(pairs, pageUrl) {
  const usable = (pairs ?? []).filter((p) => clean(p.question) && clean(p.answer));
  if (!usable.length) return undefined;

  const url = normaliseUrl(pageUrl);

  return prune({
    "@type": "FAQPage",
    "@id": url ? `${url.replace(/\/$/, "")}/#faq` : undefined,
    mainEntity: usable.map((p) => ({
      "@type": "Question",
      name: clean(p.question),
      acceptedAnswer: { "@type": "Answer", text: clean(p.answer) },
    })),
  });
}

/** Builds the services offered, as an OfferCatalog. */
export function buildServices(services, businessId) {
  const usable = (services ?? []).map(clean).filter(Boolean);
  if (!usable.length) return undefined;

  return prune({
    "@type": "OfferCatalog",
    name: "Services",
    itemListElement: usable.map((name) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name, provider: businessId ? { "@id": businessId } : undefined },
    })),
  });
}

/** Assembles the full @graph document. */
export function buildGraph(input) {
  const business = buildBusiness(input);
  const businessId = business?.["@id"];

  const services = buildServices(input.services, businessId);
  if (services && business) business.hasOfferCatalog = services;

  const faq = buildFaq(input.faq, input.url);

  const graph = [business, faq].filter(Boolean);

  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * Checks the document before anyone pastes it into a live site.
 *
 * Errors mean it should not be published. Warnings mean it will work but is
 * weaker than it could be. The distinction matters: a tool that flags
 * everything at the same volume teaches people to ignore all of it.
 */
export function validate(input, document) {
  const errors = [];
  const warnings = [];

  if (!clean(input.name)) errors.push("A business name is required.");

  if (!clean(input.url)) {
    errors.push("A website address is required — it is what ties this markup to your site.");
  } else if (!normaliseUrl(input.url)) {
    errors.push("That website address could not be read as a URL.");
  }

  const email = clean(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("That email address does not look valid.");
  }

  for (const link of input.sameAs ?? []) {
    if (clean(link) && !normaliseUrl(link)) {
      errors.push(`"${clean(link)}" could not be read as a URL.`);
    }
  }

  for (const entry of input.hours ?? []) {
    if (!entry?.day) continue;
    const bothOrNeither = Boolean(entry.open) === Boolean(entry.close);
    if (!bothOrNeither) {
      errors.push(`${entry.day} needs both an opening and a closing time, or neither.`);
    }
    if (entry.open && entry.close && entry.open >= entry.close) {
      warnings.push(
        `${entry.day} closes at or before it opens. If you trade past midnight that is expected; otherwise check it.`,
      );
    }
  }

  const isLocal = input.businessType !== "Organization";
  const hasAddress = Boolean(clean(input.street) || clean(input.city) || clean(input.postcode));
  if (isLocal && !hasAddress) {
    warnings.push(
      "No address. For a local business this is the single most useful thing in the markup — it is what connects you to a place in local results.",
    );
  }

  if (isLocal && !(input.hours ?? []).some((h) => h?.open && h?.close)) {
    warnings.push("No opening hours. These appear directly in search results when present.");
  }

  if (!clean(input.description)) {
    warnings.push("No description. One or two sentences in your own words is enough.");
  }

  if (!(input.faq ?? []).some((p) => clean(p.question) && clean(p.answer))) {
    warnings.push(
      "No FAQ entries. These are worth adding only if the same questions and answers are visible on the page — structured data that disagrees with the page is a manual-action risk.",
    );
  }

  // The output is pasted into a live site, so it must parse. Checking rather
  // than assuming, because a generator that emits invalid JSON is worse than
  // no generator: the audit tool would then report it as broken markup.
  try {
    JSON.parse(JSON.stringify(document));
  } catch {
    errors.push("The generated markup could not be serialised. Please report this.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * The finished script tag, ready to paste into <head>.
 *
 * `<` is escaped to \u003c throughout. JSON.stringify does not escape it, so a
 * business name containing "</script>" would close the tag early and turn the
 * rest of the document into live markup — on the user's own site, pasted there
 * on our instruction. The escape is still valid JSON and parses back to the
 * identical string, so nothing is lost but the hazard.
 */
export function toScriptTag(document) {
  const json = JSON.stringify(document, null, 2).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
