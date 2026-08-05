/*
  Tests the methane readiness assessment.

    node scripts/test-methane.mjs

  This one is shown to people who know the subject better than the tool does.
  So the tests are less about arithmetic and more about the properties that
  keep it credible in a room: nothing is asserted without a source, scope is
  actually narrowed rather than everything shown to everyone, "unknown" stays
  distinct from "gap", and an operator with everything in hand is told so
  rather than sold to.

  The clock is injected everywhere, so results are pinned rather than drifting
  with the calendar.
*/

import { assess, daysUntil, describeHorizon, timeline } from "../lib/methane/assess.mjs";
import { applicableObligations, OBLIGATIONS, ROLES, SOURCES } from "../lib/methane/framework.mjs";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TODAY = new Date("2026-08-05T12:00:00Z");

const profile = (over = {}) => ({
  role: "operator",
  euRelationship: "exporter",
  segment: "upstream",
  ogmpLevel: "l3",
  siteLevelMeasurement: "no",
  verification: "no",
  inventory: "yes",
  ldar: "adhoc",
  intensity: "no",
  supplierData: "no",
  usOperations: "no",
  usReporting: "no",
  cargoEvidence: "no",
  contractClauses: "no",
  counterpartyView: "no",
  thresholdExposure: "no",
  ...over,
});

console.log("\nEvery obligation is attributable");
{
  check("all have a source key", OBLIGATIONS.every((o) => o.source));
  check("every source key resolves", OBLIGATIONS.every((o) => SOURCES[o.source]));
  check("every source has a URL", Object.values(SOURCES).every((s) => /^https:\/\//.test(s.url)));

  /*
    Sources must be primary. This tool gets shown to people who have read the
    regulation, and citing a trade newsletter for a date they know from the
    Official Journal costs more credibility than the citation buys. An earlier
    version did exactly that for two obligations, so the rule is a test now.
  */
  // Government, IGO, or the body that actually sets the standard being cited —
  // OGMP 2.0 is the authority on OGMP 2.0 levels in a way no regulator is.
  const PRIMARY = /(^|\.)(europa\.eu|unep\.org|ogmpartnership\.org|epa\.gov|federalregister\.gov|congress\.gov|ecfr\.gov|govinfo\.gov|iea\.org)$/;
  for (const [key, src] of Object.entries(SOURCES)) {
    check(`${key} cites a primary source`, PRIMARY.test(new URL(src.url).hostname), src.url);
  }

  // An unused source is an unreviewed source: it survives edits nobody checks
  // and then gets cited by a later obligation on the assumption it was vetted.
  const used = new Set(OBLIGATIONS.map((o) => o.source));
  check("no source is defined but never cited",
    Object.keys(SOURCES).every((k) => used.has(k)),
    Object.keys(SOURCES).filter((k) => !used.has(k)).join(","));
  check("every obligation has a date", OBLIGATIONS.every((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date)));
  check("every obligation explains what to do when it is open",
    OBLIGATIONS.every((o) => o.ifGap && o.ifGap.length > 40));
}

console.log("\nNothing is quantified that cannot be cited");
{
  // No modelled savings, no invented fine exposure. The regulation's own
  // numbers or nothing — a figure nobody can source is the fastest way to
  // lose a room that knows the subject.
  const text = OBLIGATIONS.map((o) => `${o.detail} ${o.ifGap}`).join(" ");
  const invented = /\b\d+%\s*(saving|reduction|faster|cheaper)|save (you )?[£$€]|typical operators? (save|lose)|ROI/i;
  check("no invented savings or ROI claims", !invented.test(text), text.match(invented)?.[0]);
}

console.log("\nScope is genuinely narrowed");
{
  const none = applicableObligations(profile({ euRelationship: "none", usOperations: "no" }));
  check("no EU exposure and no US operations means nothing in scope", none.length === 0, `${none.length}`);

  const usOnly = applicableObligations(profile({ euRelationship: "none", usOperations: "yes" }));
  check("US operations alone bring in the US reporting obligation",
    usOnly.length === 1 && usOnly[0].id === "us-ghgrp", usOnly.map((o) => o.id).join(","));

  const services = applicableObligations(profile({ segment: "services" }));
  check("LDAR is not put on a services company",
    !services.some((o) => o.id === "ldar"), services.map((o) => o.id).join(","));

  const supplier = applicableObligations(profile({ euRelationship: "supplier" }));
  check("a supplier is not asked about their own importers' supply chain",
    !supplier.some((o) => o.id === "supply-chain"));

  const lng = applicableObligations(profile({ euRelationship: "exporter", segment: "lng" }));
  check("an LNG operator does get the supply-chain obligation",
    lng.some((o) => o.id === "supply-chain"));
}

console.log("\nObligations are ordered by when they fall due");
{
  const dates = applicableObligations(profile()).map((o) => o.date);
  check("scope order is soonest first",
    dates.every((d, i) => i === 0 || dates[i - 1] <= d), dates.join(" "));
}

console.log("\nUnknown is a finding, not a blank");
{
  const unsure = assess(profile({
    ogmpLevel: "unknown", siteLevelMeasurement: "unknown", verification: "unknown",
    inventory: "unknown", ldar: "unknown", intensity: "unknown", supplierData: "unknown",
  }), TODAY);

  check("unknowns are counted separately from gaps", unsure.counts.unknown > 0 && unsure.counts.gap === 0,
    JSON.stringify(unsure.counts));
  check("and the headline says why that matters",
    unsure.headline.includes("not able to answer"), unsure.headline);
  check("an unknown is never reported as ready",
    !unsure.findings.some((f) => f.status === "ready"));
}

console.log("\nA well-prepared operator is told so");
{
  const ready = assess(profile({
    ogmpLevel: "l5", siteLevelMeasurement: "yes", verification: "yes",
    inventory: "yes", ldar: "programme", intensity: "yes", supplierData: "yes",
  }), TODAY);

  check("nothing is manufactured to worry them", ready.counts.gap === 0 && ready.counts.unknown === 0,
    JSON.stringify(ready.counts));
  check("the headline says it plainly", ready.headline.includes("in hand"), ready.headline);
  check("no action is attached to a ready finding",
    ready.findings.every((f) => f.status !== "ready" || f.action === null));
  check("but it still advises re-testing rather than declaring victory",
    /re-?test|revisit/i.test(ready.headline), ready.headline);
}

console.log("\nOut of scope is answered honestly, not padded");
{
  const out = assess(profile({ euRelationship: "none", usOperations: "no" }), TODAY);
  check("nothing is in scope", out.inScope === false && out.counts.total === 0);
  check("there is no next deadline to invent", out.nextDeadline === null);
  check("and it says exposure follows the molecule", out.headline.includes("molecule"), out.headline);
}

console.log("\nUrgency reflects the clock as well as the gap");
{
  const result = assess(profile(), TODAY);
  const open = result.findings.filter((f) => f.status !== "ready");
  check("open findings sort above ready ones",
    result.findings.slice(0, open.length).every((f) => f.status !== "ready"));

  const soon = result.findings.find((f) => f.id === "eu-database");
  const later = result.findings.find((f) => f.id === "intensity");
  if (soon && later && soon.status !== "ready" && later.status !== "ready") {
    check("a nearer open deadline outranks a distant one", soon.urgency >= later.urgency,
      `${soon.urgency} vs ${later.urgency}`);
  }

  check("the next deadline is one that has not passed",
    result.nextDeadline === null || result.findings.find((f) => f.title === result.nextDeadline.title).daysRemaining >= 0);
}

console.log("\nDates are computed, not hard-coded");
{
  check("a future date counts forward", daysUntil("2026-09-01", TODAY) === 27,
    `${daysUntil("2026-09-01", TODAY)}`);
  check("a past date goes negative", daysUntil("2026-01-01", TODAY) < 0);
  check("today is zero", daysUntil("2026-08-05", TODAY) === 0);

  check("a near date reads in days", describeHorizon(27) === "in 27 days");
  check("a mid date reads in months", describeHorizon(150).includes("months"));
  check("a far date reads in years", describeHorizon(1200).includes("years"));
  check("a passed date says so", describeHorizon(-5) === "already passed");

  // The report is dated because the rules move. A stale framework shown as
  // current is the failure mode that matters most here.
  const result = assess(profile(), TODAY);
  check("the report carries the framework review date",
    /^\d{4}-\d{2}-\d{2}$/.test(result.frameworkReviewed), result.frameworkReviewed);
}

console.log("\nMalformed profiles must not throw");
for (const [name, p] of [
  ["empty object", {}],
  ["nulls throughout", { euRelationship: null, segment: null, ogmpLevel: null }],
  ["unexpected values", { euRelationship: "banana", segment: "banana", ogmpLevel: "banana" }],
]) {
  try {
    const r = assess(p, TODAY);
    check(`${name} is handled`, typeof r.headline === "string");
  } catch (cause) {
    check(`${name} is handled`, false, cause.message);
  }
}

console.log("\nA trading desk is not treated like an operator");
{
  const trader = applicableObligations(profile({ role: "trader" })).map((o) => o.id);

  check("a trader is not asked about LDAR", !trader.includes("ldar"), trader.join(","));
  check("nor about running a site-level measurement campaign",
    !trader.includes("eu-mrv-producer"), trader.join(","));
  check("nor about their own OGMP level", !trader.includes("ogmp-l5"), trader.join(","));

  check("but they are asked whether cargo methane can be evidenced",
    trader.includes("cargo-evidence"), trader.join(","));
  check("and whether their contracts require the data",
    trader.includes("contract-clauses"));
  check("and about 2030 threshold exposure", trader.includes("intensity-threshold"));
  check("and whether they can see where counterparties stand",
    trader.includes("counterparty-view"));
}

console.log("\nOther roles get what belongs to them");
{
  const operator = applicableObligations(profile({ role: "operator" })).map((o) => o.id);
  check("an operator still gets the operational obligations",
    operator.includes("ldar") && operator.includes("eu-mrv-producer"), operator.join(","));
  check("but is not asked about their trading book",
    !operator.includes("intensity-threshold"), operator.join(","));

  const shipping = applicableObligations(profile({ role: "shipping" })).map((o) => o.id);
  check("a shipowner is asked about cargo evidence", shipping.includes("cargo-evidence"));
  check("but not about purchase contract clauses",
    !shipping.includes("contract-clauses"), shipping.join(","));

  const financier = applicableObligations(profile({ role: "financier" })).map((o) => o.id);
  check("a financier gets counterparty and threshold exposure",
    financier.includes("counterparty-view") && financier.includes("intensity-threshold"));
  check("but is not asked to evidence cargo they never handle",
    !financier.includes("cargo-evidence"), financier.join(","));
}

console.log("\nEvery role has something to be told");
{
  for (const role of ROLES) {
    const scoped = applicableObligations(profile({ role: role.value }));
    check(`${role.value} has obligations in scope`, scoped.length > 0, `${scoped.length}`);
  }
}

console.log("\nThe timeline is a picture of real dates, not decoration");
{
  const result = assess(profile(), TODAY);
  const t = timeline(result, TODAY);

  check("a timeline is produced", t !== null);
  check("it starts today", t.from === "2026-08-05", t.from);
  check("every mark sits within the track",
    t.marks.every((m) => m.position >= 0 && m.position <= 100),
    JSON.stringify(t.marks.map((m) => m.position)));
  check("marks are ordered left to right",
    t.marks.every((m, i) => i === 0 || t.marks[i - 1].position <= m.position));

  // Several obligations fall on 2027-01-01; collapsing them is what stops the
  // labels colliding.
  const shared = t.marks.find((m) => m.date === "2027-01-01");
  check("obligations sharing a date are grouped", shared && shared.count > 1,
    JSON.stringify(shared));

  check("a date with any open item is not shown as ready",
    t.marks.every((m) => m.open === 0 || m.status !== "ready"));

  const dates = result.findings.map((f) => f.date);
  check("no date is invented for the picture",
    t.marks.every((m) => dates.includes(m.date)), t.marks.map((m) => m.date).join(","));
}

console.log("\nThe timeline degrades safely");
{
  const empty = assess(profile({ euRelationship: "none", usOperations: "no" }), TODAY);
  check("nothing in scope means no timeline", timeline(empty, TODAY) === null);

  // A single near deadline must not collapse the track to a point.
  const near = assess(profile({ role: "operator", euRelationship: "none", usOperations: "yes" }), TODAY);
  const t = timeline(near, TODAY);
  check("one deadline still produces a usable span", t && t.marks.length === 1);
  check("and the span is at least a year", t && t.to >= "2027-08-05", t?.to);
}

console.log(
  failures === 0
    ? "\nAll methane-assessment tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
