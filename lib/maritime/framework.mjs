/*
  FuelEU Maritime and EU ETS — the constants, and where each one comes from.

  Every number in this file was read out of the primary text, not a summary.
  That matters more here than in most places, because this tool does
  arithmetic: a wrong emission factor does not produce a vague finding, it
  produces a confident euro figure that is wrong.

  One thing to know about the sources. Annex I of the FuelEU Regulation — the
  equations themselves — is published in the Official Journal as JPEG images,
  so the formulas cannot be read as text from EUR-Lex. The greenhouse gas
  weightings are not stated in FuelEU at all; Annex I incorporates them by
  reference from the Renewable Energy Directive, and that is where the values
  below were read from. The chain is cited so anyone can walk it.

  LAST_REVIEWED is shown on every result. The rules move.
*/

export const LAST_REVIEWED = "2026-08-05";

export const SOURCES = {
  fuelEU: {
    label: "Regulation (EU) 2023/1805 — FuelEU Maritime",
    url: "https://eur-lex.europa.eu/eli/reg/2023/1805/oj/eng",
  },
  fuelEUAnnexII: {
    label: "Regulation (EU) 2023/1805, Annex II — default emission factors",
    url: "https://eur-lex.europa.eu/eli/reg/2023/1805/oj/eng",
  },
  fuelEUAnnexIV: {
    label: "Regulation (EU) 2023/1805, Annex IV — compliance balance and penalty formulas",
    url: "https://eur-lex.europa.eu/eli/reg/2023/1805/oj/eng",
  },
  redII: {
    label: "Directive (EU) 2018/2001, Annex V Part C(4) — CO2-equivalent weightings",
    url: "https://eur-lex.europa.eu/eli/dir/2018/2001/oj/eng",
  },
  etsMaritime: {
    label: "Directive (EU) 2023/959, Articles 3ga and 3gb — EU ETS for maritime transport",
    url: "https://eur-lex.europa.eu/eli/dir/2023/959/oj/eng",
  },
};

/*
  Global warming potentials over 100 years.

  FuelEU Annex I says these "are defined in Directive (EU) 2018/2001,
  paragraph 4 of Part C of Annex V". Read there verbatim: "CO2 : 1  N2O : 298
  CH4 : 25". They are the IPCC AR4 values; note they are NOT the AR5 or AR6
  ones, which is a live way to get this wrong, because most modern carbon
  accounting uses a later assessment report.
*/
export const GWP = { co2: 1, ch4: 25, n2o: 298 };

/*
  Article 4(2). The limit is the 2020 fleet reference of 91,16 gCO2eq/MJ
  reduced by a set percentage. Stored as the percentage rather than the
  resulting limit so the arithmetic in the report matches the arithmetic in
  the regulation, and so a reader can check one number instead of six.
*/
export const REFERENCE_INTENSITY = 91.16;

export const REDUCTIONS = [
  { from: 2025, reduction: 2 },
  { from: 2030, reduction: 6 },
  { from: 2035, reduction: 14.5 },
  { from: 2040, reduction: 31 },
  { from: 2045, reduction: 62 },
  { from: 2050, reduction: 80 },
];

/** The GHG intensity limit that applies in a given year, gCO2eq/MJ. */
export function limitForYear(year) {
  let applicable = null;
  for (const step of REDUCTIONS) {
    if (year >= step.from) applicable = step;
  }
  if (!applicable) return null; // Before 2025 the regime does not bite.
  return REFERENCE_INTENSITY * (1 - applicable.reduction / 100);
}

/*
  Annex II default emission factors.

    lcv      Lower calorific value, MJ/g
    wtt      Well-to-tank, gCO2eq/MJ
    cf_co2   Tank-to-wake CO2, g per g of fuel
    cf_ch4   Tank-to-wake CH4, g per g of fuel
    cf_n2o   Tank-to-wake N2O, g per g of fuel
    slip     Unburned fuel as % of the mass used by the engine

  LNG is split by engine because that is the whole story for LNG: the same
  molecule in a medium-speed Otto engine and a slow-speed diesel engine gives
  materially different answers, and it is the single most consequential
  decision a shipowner ordering an LNG newbuild makes under this regulation.

  Biofuels are deliberately absent. Annex II does not give them a single
  well-to-tank figure — it points at the production pathway values in Annex V
  of the Renewable Energy Directive, so the answer depends on the specific
  batch and its certification. Inventing a representative number here would
  produce exactly the confident-and-wrong euro figure this file exists to
  avoid.
*/
export const FUELS = [
  {
    id: "hfo", name: "HFO", detail: "ISO 8217 grades RME to RMK",
    lcv: 0.0405, wtt: 13.5, cf_co2: 3.114, cf_ch4: 0.00005, cf_n2o: 0.00018, slip: 0,
  },
  {
    id: "lfo", name: "LFO", detail: "ISO 8217 grades RMA to RMD",
    lcv: 0.041, wtt: 13.2, cf_co2: 3.151, cf_ch4: 0.00005, cf_n2o: 0.00018, slip: 0,
  },
  {
    id: "mgo", name: "MGO / MDO", detail: "ISO 8217 grades DMX to DMB",
    lcv: 0.0427, wtt: 14.4, cf_co2: 3.206, cf_ch4: 0.00005, cf_n2o: 0.00018, slip: 0,
  },
  {
    id: "lng-otto-ms", name: "LNG — Otto, dual fuel medium speed", detail: "Methane slip 3,1 %",
    lcv: 0.0491, wtt: 18.5, cf_co2: 2.750, cf_ch4: 0, cf_n2o: 0.00011, slip: 3.1,
  },
  {
    id: "lng-otto-ss", name: "LNG — Otto, dual fuel slow speed", detail: "Methane slip 1,7 %",
    lcv: 0.0491, wtt: 18.5, cf_co2: 2.750, cf_ch4: 0, cf_n2o: 0.00011, slip: 1.7,
  },
  {
    id: "lng-diesel-ss", name: "LNG — Diesel, dual fuel slow speed", detail: "Methane slip 0,2 %",
    lcv: 0.0491, wtt: 18.5, cf_co2: 2.750, cf_ch4: 0, cf_n2o: 0.00011, slip: 0.2,
  },
  {
    id: "lng-lbsi", name: "LNG — LBSI", detail: "Methane slip 2,6 %",
    lcv: 0.0491, wtt: 18.5, cf_co2: 2.750, cf_ch4: 0, cf_n2o: 0.00011, slip: 2.6,
  },
  {
    id: "methanol", name: "Methanol (from natural gas)", detail: "Fossil methanol",
    lcv: 0.0199, wtt: 31.3, cf_co2: 1.375, cf_ch4: 0, cf_n2o: 0, slip: 0,
  },
];

/*
  Annex IV Part B. The penalty is not a fine at the regulator's discretion —
  it is a formula, which is why it can be shown honestly:

    penalty (EUR) = |compliance balance| / (GHGIEactual x 41 000) x 2 400

  where 41 000 MJ is one tonne of VLSFO equivalent and 2 400 EUR is the
  amount per such tonne. Article 23(2) then multiplies it by 1 + (n-1)/10
  where n counts consecutive reporting periods in deficit.
*/
export const PENALTY = {
  vlsfoEnergyMJ: 41_000,
  eurPerVlsfoTonne: 2_400,
  /** Article 23(2) escalation for repeat deficits. */
  escalation: (consecutiveYears) => 1 + (Math.max(1, consecutiveYears) - 1) / 10,
};

/*
  EU ETS, Directive 2003/87/EC as amended by (EU) 2023/959.

  Article 3gb phases surrender in: 40 % of 2024 emissions, 70 % of 2025,
  100 % from 2026. Article 3ga sets the geographic scope, which is the same
  shape as FuelEU's: everything inside, half of what crosses the border.
*/
export const ETS_PHASE_IN = [
  { year: 2024, share: 40 },
  { year: 2025, share: 70 },
  { year: 2026, share: 100 },
];

export function etsShareForYear(year) {
  if (year < 2024) return 0;
  let share = 0;
  for (const step of ETS_PHASE_IN) if (year >= step.year) share = step.share;
  return share;
}

/*
  Article 2 of FuelEU and Article 3ga of the ETS Directive both count all of
  the energy or emissions on voyages between EU ports and at berth, and half
  of it on voyages with one end outside the Union.
*/
export const VOYAGE_SCOPE = { intraEuOrAtBerth: 1, crossingTheBorder: 0.5 };

/** Both regimes apply to ships above 5 000 gross tonnage, whatever the flag. */
export const GT_THRESHOLD = 5000;
