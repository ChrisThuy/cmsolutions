/*
  Tests the schema builder.

    node scripts/test-schema-builder.mjs

  The output of this tool gets pasted into other people's live websites. Broken
  markup there is worse than none — our own audit tool reports invalid JSON-LD
  as a failure, and a search engine ignores the lot. So the bar is that every
  document this produces parses, validates, and contains nothing the user did
  not type.
*/

import {
  buildBusiness,
  buildFaq,
  buildGraph,
  buildServices,
  normaliseUrl,
  toScriptTag,
  validate,
} from "../lib/schema/build.mjs";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const FULL = {
  name: "Harbour & Co",
  businessType: "AccountingService",
  url: "harbourandco.example",
  description: "Chartered accountants in Bristol working with owner-managed businesses.",
  phone: "0117 555 0100",
  email: "hello@harbourandco.example",
  street: "12 Queen Square",
  city: "Bristol",
  region: "Bristol",
  postcode: "BS1 4NT",
  country: "GB",
  priceRange: "££",
  areaServed: "South West England",
  services: ["Year-end accounts", "Corporation tax", "Payroll"],
  hours: [
    { day: "Monday", open: "09:00", close: "17:30" },
    { day: "Tuesday", open: "09:00", close: "17:30" },
  ],
  sameAs: ["linkedin.com/company/harbour", "https://x.com/harbour"],
  faq: [{ question: "Do you work with sole traders?", answer: "Yes, alongside limited companies." }],
};

console.log("\nURL handling");
check("a bare domain gains https", normaliseUrl("example.com") === "https://example.com/");
check("an existing scheme is kept", normaliseUrl("http://example.com/") === "http://example.com/");
check("whitespace is trimmed", normaliseUrl("  example.com  ") === "https://example.com/");
check("an empty value yields empty", normaliseUrl("") === "");
check("nonsense yields empty rather than throwing", normaliseUrl("ht!tp://%%%") === "");

console.log("\nA complete business");
{
  const doc = buildGraph(FULL);
  const business = doc["@graph"][0];
  check("the type is the one chosen", business["@type"] === "AccountingService");
  check("the name is carried", business.name === "Harbour & Co");
  check("the id is derived from the url", business["@id"] === "https://harbourandco.example/#business");
  check("the address is nested correctly", business.address["@type"] === "PostalAddress");
  check("the postcode is carried", business.address.postalCode === "BS1 4NT");
  check("opening hours use the schema.org day URI",
    business.openingHoursSpecification[0].dayOfWeek === "https://schema.org/Monday");
  check("both opening-hours entries survive", business.openingHoursSpecification.length === 2);
  check("sameAs entries are normalised to URLs",
    business.sameAs[0] === "https://linkedin.com/company/harbour", business.sameAs?.[0]);
  check("services become an OfferCatalog", business.hasOfferCatalog["@type"] === "OfferCatalog");
  check("all three services are present", business.hasOfferCatalog.itemListElement.length === 3);
  check("a service points back at the business",
    business.hasOfferCatalog.itemListElement[0].itemOffered.provider["@id"] === business["@id"]);
  check("the FAQ is a separate graph node", doc["@graph"][1]["@type"] === "FAQPage");
  check("the document declares a context", doc["@context"] === "https://schema.org");
}

console.log("\nNothing is invented");
{
  const minimal = buildGraph({ name: "Solo Consultant", businessType: "ProfessionalService", url: "solo.example" });
  const business = minimal["@graph"][0];
  const serialised = JSON.stringify(minimal);
  check("no address appears when none was given", business.address === undefined);
  check("no opening hours appear when none were given", business.openingHoursSpecification === undefined);
  check("no description is invented", business.description === undefined);
  check("no telephone is invented", business.telephone === undefined);
  check("no price range is invented", business.priceRange === undefined);
  check("no empty strings survive anywhere", !/:\s*""/.test(serialised), serialised.slice(0, 120));
  check("the graph has exactly one node", minimal["@graph"].length === 1);
}

console.log("\nRatings and reviews are never generated");
{
  // The whole point. Even when the caller tries to push them through.
  const doc = buildGraph({
    ...FULL,
    aggregateRating: { ratingValue: "4.9", reviewCount: "127" },
    review: [{ author: "A Customer", reviewRating: 5 }],
    ratingValue: "4.9",
    reviewCount: "127",
  });
  const serialised = JSON.stringify(doc);
  check("aggregateRating is absent", !serialised.includes("aggregateRating"));
  check("review is absent", !serialised.includes('"review"'));
  check("ratingValue is absent", !serialised.includes("ratingValue"));
  check("reviewCount is absent", !serialised.includes("reviewCount"));
  check("the fabricated numbers appear nowhere", !serialised.includes("127") && !serialised.includes("4.9"));
}

console.log("\nAddress handling");
{
  // A country alone says nothing and makes the markup look padded.
  const countryOnly = buildBusiness({ name: "X", url: "x.example", businessType: "ProfessionalService", country: "GB" });
  check("a country with no other address detail is dropped", countryOnly.address === undefined);

  const cityOnly = buildBusiness({ name: "X", url: "x.example", businessType: "ProfessionalService", city: "Bristol" });
  check("a city alone is enough to publish an address", cityOnly.address?.addressLocality === "Bristol");
  check("and the country defaults to GB", cityOnly.address?.addressCountry === "GB");
}

console.log("\nOrganization mode");
{
  const org = buildBusiness({
    name: "CM Solutions", businessType: "Organization", url: "cmsolutions.tech",
    hours: [{ day: "Monday", open: "09:00", close: "17:00" }],
  });
  check("the type is Organization", org["@type"] === "Organization");
  check("opening hours are omitted for a non-local organisation",
    org.openingHoursSpecification === undefined);
}

console.log("\nFAQ");
{
  check("an empty FAQ yields nothing", buildFaq([], "x.example") === undefined);
  check("a half-filled pair is skipped",
    buildFaq([{ question: "Q only", answer: "" }], "x.example") === undefined);
  const faq = buildFaq([{ question: "Q", answer: "A" }, { question: "", answer: "orphan" }], "x.example");
  check("only complete pairs survive", faq.mainEntity.length === 1);
  check("the answer is nested as an Answer", faq.mainEntity[0].acceptedAnswer["@type"] === "Answer");
}

console.log("\nServices");
{
  check("an empty list yields nothing", buildServices([], "id") === undefined);
  check("blank entries are dropped", buildServices(["", "  ", "Real"], "id").itemListElement.length === 1);
}

console.log("\nValidation — errors block publishing");
{
  const noName = validate({ url: "x.example" }, {});
  check("a missing name is an error", !noName.valid && noName.errors.some((e) => e.includes("name")));

  const noUrl = validate({ name: "X" }, {});
  check("a missing url is an error", !noUrl.valid);

  const badUrl = validate({ name: "X", url: "ht!tp://%%%" }, {});
  check("an unreadable url is an error", !badUrl.valid);

  const badEmail = validate({ name: "X", url: "x.example", email: "not-an-email" }, {});
  check("an invalid email is an error", !badEmail.valid);

  const halfHours = validate(
    { name: "X", url: "x.example", hours: [{ day: "Monday", open: "09:00", close: "" }] }, {});
  check("an opening time with no closing time is an error", !halfHours.valid);

  const good = validate(FULL, buildGraph(FULL));
  check("a complete business validates", good.valid, JSON.stringify(good.errors));
}

console.log("\nValidation — warnings guide without blocking");
{
  const sparse = validate(
    { name: "X", url: "x.example", businessType: "ProfessionalService" },
    buildGraph({ name: "X", url: "x.example", businessType: "ProfessionalService" }),
  );
  check("a sparse business is still valid", sparse.valid);
  check("but it warns about the missing address", sparse.warnings.some((w) => w.includes("address")));
  check("and about missing hours", sparse.warnings.some((w) => w.includes("hours")));
  check("and about the missing description", sparse.warnings.some((w) => w.includes("description")));
  check("the FAQ warning explains it must match the page",
    sparse.warnings.some((w) => w.includes("visible on the page")));

  const backwards = validate(
    { name: "X", url: "x.example", hours: [{ day: "Monday", open: "17:00", close: "09:00" }] }, {});
  check("closing before opening is a warning, not an error", backwards.valid);
  check("and it allows for trading past midnight",
    backwards.warnings.some((w) => w.includes("past midnight")));
}

console.log("\nThe output is safe to paste");
{
  const doc = buildGraph(FULL);
  const tag = toScriptTag(doc);
  check("it is a complete script tag", tag.startsWith('<script type="application/ld+json">') && tag.endsWith("</script>"));

  const inner = tag.replace(/^<script[^>]*>\n/, "").replace(/\n<\/script>$/, "");
  check("the contents parse as JSON", (() => { try { JSON.parse(inner); return true; } catch { return false; } })());

  // A name containing </script> would otherwise close the tag early and turn
  // the rest of the document into markup.
  const hostile = buildGraph({ ...FULL, name: 'Evil</script><img src=x onerror=alert(1)>' });
  const hostileTag = toScriptTag(hostile);
  check("a name containing a closing script tag does not break out",
    !hostileTag.includes("</script><img"), hostileTag.slice(0, 160));
}

console.log(
  failures === 0
    ? "\nAll schema-builder tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
