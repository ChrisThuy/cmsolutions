/*
  Tests reading a business out of a page.

    node scripts/test-schema-extract.mjs

  Pre-filling a form with someone's own details is only an improvement while
  the details are right. A wrong phone number, silently placed in a field the
  visitor then publishes as structured data, is worse than an empty box — so
  the rules here are that declared data beats inference, and that anything not
  found stays empty rather than being guessed.
*/

import { extractBusiness, jsonLdNodes } from "../lib/schema/extract.mjs";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const URL_ = "https://harbourandco.example/";

console.log("\nJSON-LD discovery");
{
  const html = `
    <script type="application/ld+json">{"@type":"Organization","name":"A"}</script>
    <script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"B"},{"@type":"Person","name":"C"}]}</script>
    <script type="application/ld+json">[{"@type":"Service","name":"D"}]</script>
    <script type="application/ld+json">{ this is not json }</script>
  `;
  const nodes = jsonLdNodes(html);
  check("a plain object is read", nodes.some((n) => n.name === "A"));
  check("an @graph is flattened", nodes.some((n) => n.name === "B") && nodes.some((n) => n.name === "C"));
  check("a top-level array is flattened", nodes.some((n) => n.name === "D"));
  check("invalid JSON is skipped rather than thrown on", nodes.length === 4, `${nodes.length}`);
}

console.log("\nDeclared data beats inference");
{
  const html = `<!DOCTYPE html><html><head>
<title>Harbour &amp; Co | Chartered Accountants</title>
<meta name="description" content="A description from the meta tag." />
<meta property="og:site_name" content="Harbour and Co (OG)" />
<script type="application/ld+json">{
  "@type":"AccountingService",
  "name":"Harbour & Co",
  "description":"The description the business declared.",
  "telephone":"0117 555 0100",
  "email":"declared@harbourandco.example",
  "priceRange":"££",
  "address":{"@type":"PostalAddress","streetAddress":"12 Queen Square","addressLocality":"Bristol","postalCode":"BS1 4NT","addressCountry":"GB"},
  "openingHoursSpecification":[
    {"@type":"OpeningHoursSpecification","dayOfWeek":"https://schema.org/Monday","opens":"09:00","closes":"17:30"},
    {"@type":"OpeningHoursSpecification","dayOfWeek":["Tuesday","Wednesday"],"opens":"09:00:00","closes":"17:00:00"}
  ],
  "sameAs":["https://linkedin.com/company/harbour"]
}</script>
</head><body>
<a href="tel:+441170000000">Call</a>
<a href="mailto:footer@harbourandco.example">Mail</a>
<a href="https://facebook.com/someoneelse">FB</a>
</body></html>`;

  const b = extractBusiness(html, URL_);

  check("the declared name is used", b.name === "Harbour & Co", b.name);
  check("the declared description wins over the meta tag",
    b.description === "The description the business declared.", b.description);
  check("the declared phone wins over the tel: link", b.phone === "0117 555 0100", b.phone);
  check("the declared email wins over the mailto: link",
    b.email === "declared@harbourandco.example", b.email);
  check("the declared sameAs wins over scraped social links",
    b.sameAs.length === 1 && b.sameAs[0].includes("linkedin"), JSON.stringify(b.sameAs));

  check("the address is unpacked", b.street === "12 Queen Square" && b.city === "Bristol" && b.postcode === "BS1 4NT");
  check("the price range is carried", b.priceRange === "££");

  check("hours come through", b.hours.length === 3, JSON.stringify(b.hours));
  check("a schema.org day URI is reduced to the day",
    b.hours[0].day === "Monday", b.hours[0]?.day);
  check("an array of days is expanded",
    b.hours.some((h) => h.day === "Tuesday") && b.hours.some((h) => h.day === "Wednesday"));
  check("seconds are trimmed off times",
    b.hours.every((h) => h.open.length === 5 && h.close.length === 5), JSON.stringify(b.hours));

  check("existing types are reported", b.existingTypes.includes("AccountingService"));
}

console.log("\nFalling back when nothing is declared");
{
  const html = `<!DOCTYPE html><html><head>
<title>Harbour &amp; Co | Chartered Accountants in Bristol</title>
<meta name="description" content="Chartered accountants working with owner-managed businesses." />
</head><body>
<a href="tel:+44%20117%20555%200100">Call us</a>
<a href="mailto:hello@harbourandco.example">Email</a>
<a href="https://www.linkedin.com/company/harbour?trk=nav">LinkedIn</a>
<a href="https://instagram.com/harbour">Instagram</a>
<a href="https://someoneelse.example/page">Not a profile</a>
</body></html>`;

  const b = extractBusiness(html, URL_);

  check("the brand is taken from before the separator", b.name === "Harbour & Co", b.name);
  check("the meta description is used", b.description.startsWith("Chartered accountants"));
  check("a tel: link is decoded", b.phone === "+44 117 555 0100", b.phone);
  check("a mailto: link is used", b.email === "hello@harbourandco.example");
  check("social profiles are found", b.sameAs.length === 2, JSON.stringify(b.sameAs));
  check("tracking parameters are stripped",
    b.sameAs.some((s) => s === "https://www.linkedin.com/company/harbour"), JSON.stringify(b.sameAs));
  check("a non-profile outbound link is ignored",
    !b.sameAs.some((s) => s.includes("someoneelse")));
  check("nothing is reported as existing", b.existingTypes.length === 0);
}

console.log("\nNothing is invented");
{
  const b = extractBusiness("<html><head><title>Just A Title</title></head><body></body></html>", URL_);
  check("no description is made up", b.description === "", b.description);
  check("no phone is made up", b.phone === "");
  check("no email is made up", b.email === "");
  check("no address is made up", b.street === "" && b.city === "" && b.postcode === "");
  check("no hours are made up", b.hours.length === 0);
  check("no profiles are made up", b.sameAs.length === 0);
  check("the country still defaults to GB", b.country === "GB");
  check("the url is carried through", b.url === URL_);
}

console.log("\nMalformed input must not throw");
for (const [name, html] of [
  ["empty", ""],
  ["not html", "hello"],
  ["json-ld that is a bare string", '<script type="application/ld+json">"nope"</script>'],
  ["json-ld that is null", '<script type="application/ld+json">null</script>'],
  ["address as a string not an object", '<script type="application/ld+json">{"@type":"Organization","address":"12 Queen Sq"}</script>'],
  ["hours with missing fields", '<script type="application/ld+json">{"@type":"Store","openingHoursSpecification":[{"dayOfWeek":"Monday"}]}</script>'],
  ["type as an array", '<script type="application/ld+json">{"@type":["LocalBusiness","Organization"],"name":"X"}</script>'],
]) {
  try {
    const b = extractBusiness(html, URL_);
    check(`${name} is handled`, typeof b.name === "string");
  } catch (cause) {
    check(`${name} is handled`, false, cause.message);
  }
}

{
  const b = extractBusiness(
    '<script type="application/ld+json">{"@type":["LocalBusiness","Organization"],"name":"X"}</script>',
    URL_,
  );
  check("an array @type still identifies the business", b.name === "X", b.name);
}

console.log("\nEntities are decoded, not left raw");
{
  const b = extractBusiness(
    '<html><head><title>Ben &amp; Jerry&#39;s | Ice Cream</title></head></html>',
    URL_,
  );
  check("&amp; and &#39; are decoded", b.name === "Ben & Jerry's", b.name);
}

console.log(
  failures === 0
    ? "\nAll schema-extract tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
