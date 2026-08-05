/*
  Methane regulation, as obligations an operator can be assessed against.

  ── why this file is written the way it is ─────────────────────────────────

  The audience for this knows the subject better than the tool does. A single
  invented requirement, a wrong date, or a penalty figure nobody can source
  destroys the credibility of everything else on the screen — and it will be
  spotted in the room, not later.

  So three rules govern every entry below:

    1. Every obligation carries a `source`. If it cannot be attributed, it does
       not go in.
    2. Dates are stated as published. Where a rule is in flux — and US federal
       methane policy is in flux — that is said rather than smoothed over.
    3. Nothing is quantified that cannot be cited. No "typical operators save
       £X", no modelled fine exposure. The regulation's own numbers, or
       nothing.

  This produces a readiness indicator, not a compliance determination and not
  legal advice. It is deliberately incapable of generating a regulatory
  submission: telling someone they are ready when they are not would be worse
  than telling them nothing, and quantifying methane is a measurement problem
  that belongs to instrumentation and qualified people, not to a web form.

  LAST REVIEWED: 2026-08-05. Methane rules are moving quickly in several
  jurisdictions. Anything here older than a quarter should be re-checked
  against the sources before it is shown to anyone.
*/

export const LAST_REVIEWED = "2026-08-05";

export const SOURCES = {
  euReg: {
    label: "EU Methane Regulation (EU) 2024/1787",
    url: "https://energy.ec.europa.eu/topics/carbon-management-and-fossil-fuels/methane-emissions_en",
  },
  euDatabase: {
    label: "EU Methane Transparency Database — launch confirmed for September 2026",
    url: "https://www.petro-online.com/news/gas-detector/191/international-environmental-technology/EU-Methane-Transparency-Database-september-2026-european-commission-confirms/68036",
  },
  euImport: {
    label: "Highwood Emissions — EU Methane Regulation: risk and opportunity for US producers",
    url: "https://www.highwoodemissions.com/bulletin/eu-methane-regulation/",
  },
  ogmp: {
    label: "OGMP 2.0 — UNEP measurement-based reporting framework",
    url: "https://www.unep.org/explore-topics/energy/what-we-do/methane/imeo-action/oil-gas-methane-partnership-ogmp-20",
  },
  epa: {
    label: "US EPA — methane rules and Greenhouse Gas Reporting Program",
    url: "https://www.epa.gov/newsreleases/epa-finalizes-rule-reduce-wasteful-methane-emissions-and-drive-innovation-oil-and-gas",
  },
  wec: {
    label: "Waste Emissions Charge — delayed to reporting year 2034",
    url: "https://eelp.law.harvard.edu/?p=7367",
  },
};

/** Where an operation sits relative to the EU, which is what drives most of this. */
export const EU_RELATIONSHIPS = [
  { value: "eu-producer", label: "We produce or operate assets inside the EU" },
  { value: "exporter", label: "We export oil, gas or LNG into the EU" },
  { value: "supplier", label: "We supply someone who exports into the EU" },
  { value: "importer", label: "We import oil, gas or LNG into the EU" },
  { value: "none", label: "No EU production, exports or imports" },
];

export const SEGMENTS = [
  { value: "upstream", label: "Upstream — production" },
  { value: "midstream", label: "Midstream — gathering, processing, transport" },
  { value: "lng", label: "LNG — liquefaction, shipping or regasification" },
  { value: "integrated", label: "Integrated across several of these" },
  { value: "services", label: "Oilfield services or equipment" },
];

export const OGMP_LEVELS = [
  { value: "none", label: "Not an OGMP 2.0 member" },
  { value: "l1-2", label: "Level 1–2 — reporting at asset level or by source category" },
  { value: "l3", label: "Level 3 — source-level, generic emission factors" },
  { value: "l4", label: "Level 4 — source-level, own measurements" },
  { value: "l5", label: "Level 5 — source-level reconciled against site-level measurement" },
  { value: "unknown", label: "Not sure" },
];

/*
  The obligations themselves.

  `applies` decides whether an obligation is in scope for a given profile —
  telling an operator about rules that do not touch them is noise, and noise is
  how a report stops being read.

  `assess` returns "ready", "gap" or "unknown" from their answers. "unknown" is
  a first-class outcome: not knowing whether you comply is itself the finding,
  and it is the most common honest answer in this space.
*/
export const OBLIGATIONS = [
  {
    id: "eu-mrv-producer",
    title: "Measurement, reporting and verification at EU producer standard",
    regime: "EU Methane Regulation",
    date: "2027-01-01",
    dateNote: "Applies to new import contracts from 2027; EU operators are already inside scope.",
    source: "euReg",
    detail:
      "The regulation requires quantification of methane at both source level and site level, with independent third-party verification. Source-level estimates alone do not meet it.",
    applies: (p) => p.euRelationship !== "none",
    assess: (p) => {
      if (p.siteLevelMeasurement === "unknown" || p.verification === "unknown") return "unknown";
      if (p.siteLevelMeasurement === "yes" && p.verification === "yes") return "ready";
      return "gap";
    },
    ifGap:
      "Site-level measurement reconciled against a source-level inventory, and an independent verifier engaged. This is the obligation with the longest lead time — instrumentation, a measurement campaign and a verification cycle are not things that can be arranged in a quarter.",
  },
  {
    id: "ogmp-l5",
    title: "OGMP 2.0 Level 5, or a demonstrably equivalent standard",
    regime: "OGMP 2.0 / EU equivalence",
    date: "2027-01-01",
    dateNote: "The practical benchmark the EU has pointed to for import equivalence.",
    source: "ogmp",
    detail:
      "Level 5 means source-level emission estimates reconciled with site-level measurements. The Commission has indicated that reporting demonstrably equivalent to Level 5, with independent verification, is the route to import equivalence.",
    applies: (p) => p.euRelationship !== "none",
    assess: (p) => {
      if (p.ogmpLevel === "unknown") return "unknown";
      if (p.ogmpLevel === "l5") return "ready";
      return "gap";
    },
    ifGap:
      "A staged path from where you are to Level 5. Operators at Level 3 are usually one measurement programme away; operators not in OGMP at all are further out than the calendar suggests.",
  },
  {
    id: "eu-database",
    title: "Data ready for the EU Methane Transparency Database",
    regime: "EU Methane Regulation",
    date: "2026-09-01",
    dateNote: "The Commission has confirmed the database launches in September 2026.",
    source: "euDatabase",
    detail:
      "Once live, the database makes the methane performance of suppliers into the EU visible and comparable. Importers and buyers will be able to see who reports what.",
    applies: (p) => p.euRelationship !== "none",
    assess: (p) => {
      if (p.inventory === "unknown") return "unknown";
      return p.inventory === "yes" ? "ready" : "gap";
    },
    ifGap:
      "A defensible source-level inventory you would be willing to have compared with your peers in public. The commercial risk here is not a fine — it is a buyer reading the comparison.",
  },
  {
    id: "ldar",
    title: "A leak detection and repair programme with documented surveys",
    regime: "EU Methane Regulation",
    date: "2027-01-01",
    dateNote: "Survey types and frequencies are set out in the regulation and its implementing acts; confirm the schedule that applies to your asset class.",
    source: "euReg",
    detail:
      "LDAR is the operational backbone of the regulation: recurring surveys, documented findings, and evidence that what was found was repaired within the required window.",
    applies: (p) => p.euRelationship !== "none" && p.segment !== "services",
    assess: (p) => {
      if (p.ldar === "unknown") return "unknown";
      if (p.ldar === "programme") return "ready";
      return "gap";
    },
    ifGap:
      "Surveys on a defined schedule, with findings and repairs recorded in a form an auditor can follow. Ad-hoc inspection does not produce the evidence trail the regulation asks for.",
  },
  {
    id: "intensity",
    title: "Knowing your methane intensity",
    regime: "EU Methane Regulation",
    date: "2028-01-01",
    dateNote: "Intensity reporting under the Commission's methodology; maximum intensity thresholds follow in 2030.",
    source: "euImport",
    detail:
      "From 2028 producers report methane intensity using an EC-established methodology, and from 2030 imported oil, gas and coal must sit below maximum intensity thresholds.",
    applies: (p) => ["eu-producer", "exporter", "importer"].includes(p.euRelationship),
    assess: (p) => {
      if (p.intensity === "unknown") return "unknown";
      return p.intensity === "yes" ? "ready" : "gap";
    },
    ifGap:
      "Intensity cannot be calculated without the inventory and the production data lined up against each other. Operators usually discover the gap is in reconciling the two, not in either one.",
  },
  {
    id: "supply-chain",
    title: "Methane data from your own suppliers",
    regime: "EU Methane Regulation",
    date: "2027-01-01",
    dateNote: "Importers must show equivalence for what they bring in, which means evidence from upstream.",
    source: "euImport",
    detail:
      "Equivalence is assessed on the imported stream. That obligation passes up the chain, and in pooled markets where several producers' gas is commingled before liquefaction it is materially harder to evidence.",
    applies: (p) => ["importer", "lng"].includes(p.euRelationship) || p.segment === "lng",
    assess: (p) => {
      if (p.supplierData === "unknown") return "unknown";
      return p.supplierData === "yes" ? "ready" : "gap";
    },
    ifGap:
      "Contractual data requirements with suppliers, and somewhere to put what comes back. This is usually a commercial and systems problem rather than a measurement one.",
  },
  {
    id: "us-ghgrp",
    title: "US Greenhouse Gas Reporting Program, Subpart W",
    regime: "US EPA",
    date: "2026-10-30",
    dateNote: "Reports for calendar year 2025 emissions, deadline extended to 30 October 2026.",
    source: "epa",
    detail:
      "Expanded Subpart W requirements apply to the CY2025 reporting cycle. Separately, the Waste Emissions Charge has been delayed to reporting year 2034, and the NSPS OOOOb / EG OOOOc position has been moving — the 2026 obligation that is firm is the reporting one.",
    applies: (p) => p.usOperations === "yes",
    assess: (p) => {
      if (p.usReporting === "unknown") return "unknown";
      return p.usReporting === "yes" ? "ready" : "gap";
    },
    ifGap:
      "This one has a fixed near date and is a reporting exercise rather than a measurement programme, which makes it the most tractable item on most operators' lists.",
  },
];

/** Obligations in scope for a profile, soonest deadline first. */
export function applicableObligations(profile) {
  return OBLIGATIONS.filter((o) => o.applies(profile)).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
