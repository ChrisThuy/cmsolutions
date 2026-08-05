import {
  ETS_PHASE_IN, FUELS, GWP, LAST_REVIEWED, PENALTY, REFERENCE_INTENSITY,
  SOURCES, VOYAGE_SCOPE, etsShareForYear, limitForYear,
} from "./framework.mjs";

/*
  The arithmetic, kept apart from the page and from the constants.

  Pure functions, no clock of its own, no I/O. Everything a reader sees is
  derived here and can be checked line by line against the regulation, which
  is the only reason a number in euros is defensible at all.

  What this is NOT: a compliance submission. Verified compliance uses actual
  bunker delivery notes, a verifier, and the FuelEU database. This uses the
  Annex II default factors and the figures a person can give you standing at a
  conference stand. The gap between those two things is stated in the result
  rather than buried, because someone will otherwise take a euro figure from a
  web page into a budget meeting.
*/

/**
 * Well-to-wake GHG intensity of one fuel, in gCO2eq/MJ.
 *
 * Structure follows Annex I: well-to-tank plus tank-to-wake, with the
 * unburned fraction counted as methane rather than as combustion products.
 *
 *   intensity = wtt + [ (1 - slip)(CF_CO2·GWP_CO2 + CF_CH4·GWP_CH4
 *                                  + CF_N2O·GWP_N2O) + slip·GWP_CH4 ] / lcv
 *
 * The slip term is what makes LNG interesting: unburned methane is counted at
 * 25 times the weight of CO2, so an engine that slips 3,1 % of its fuel gives
 * back most of what the molecule saved.
 */
export function fuelIntensity(fuel) {
  const slip = (fuel.slip ?? 0) / 100;
  const combusted =
    fuel.cf_co2 * GWP.co2 + fuel.cf_ch4 * GWP.ch4 + fuel.cf_n2o * GWP.n2o;
  const tankToWake = ((1 - slip) * combusted + slip * GWP.ch4) / fuel.lcv;
  return fuel.wtt + tankToWake;
}

/** Energy in MJ from a mass in tonnes. LCV is MJ/g, so tonnes go to grams. */
export function energyFromTonnes(tonnes, fuel) {
  return tonnes * 1_000_000 * fuel.lcv;
}

const round = (value, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
};

/**
 * Assesses a fuel mix for a year.
 *
 * @param {object} input
 *   year               reporting year
 *   mix                [{ fuelId, tonnes }] — as bunkered, before scope
 *   crossBorderShare   0–100, share of energy on voyages with one end outside
 *                      the EU, which Article 2 counts at half
 *   consecutiveDeficit how many reporting periods in a row have been in
 *                      deficit, for the Article 23(2) escalation
 *   euaPrice           EUR per EU allowance, supplied by the user — this is a
 *                      market price and the tool must never invent one
 */
export function assess(input) {
  const year = Number(input?.year) || new Date().getUTCFullYear();
  const crossBorderShare = clamp(Number(input?.crossBorderShare) || 0, 0, 100);
  const consecutiveDeficit = Math.max(1, Number(input?.consecutiveDeficit) || 1);
  const euaPrice = Number(input?.euaPrice);

  const lines = [];
  for (const entry of input?.mix ?? []) {
    const fuel = FUELS.find((f) => f.id === entry?.fuelId);
    const tonnes = Number(entry?.tonnes);
    if (!fuel || !Number.isFinite(tonnes) || tonnes <= 0) continue;
    const energy = energyFromTonnes(tonnes, fuel);
    lines.push({
      fuelId: fuel.id,
      name: fuel.name,
      detail: fuel.detail,
      tonnes,
      energyMJ: energy,
      intensity: fuelIntensity(fuel),
      slip: fuel.slip ?? 0,
      // Tonnes of CO2 for the ETS, which counts CO2 at the stack rather than
      // well-to-wake CO2 equivalent. Different regime, different number.
      co2Tonnes: (tonnes * 1_000_000 * fuel.cf_co2) / 1_000_000,
    });
  }

  if (!lines.length) {
    return { inScope: false, year, reviewed: LAST_REVIEWED, lines: [], notes: [] };
  }

  /*
    Article 2: all of the energy on intra-EU voyages and at berth, half of the
    energy on voyages with one end in a third country. Applied as a single
    factor over the mix, because nobody standing at a stand has it split by
    voyage — and saying so is better than pretending the input was finer than
    it was.
  */
  const scopeFactor =
    VOYAGE_SCOPE.intraEuOrAtBerth * (1 - crossBorderShare / 100) +
    VOYAGE_SCOPE.crossingTheBorder * (crossBorderShare / 100);

  const totalEnergy = lines.reduce((sum, l) => sum + l.energyMJ, 0);
  const scopedEnergy = totalEnergy * scopeFactor;

  // Energy-weighted, which is what Annex I does — a heavy fuel burned in
  // small quantity does not drag the average the way its intensity suggests.
  const actualIntensity =
    lines.reduce((sum, l) => sum + l.intensity * l.energyMJ, 0) / totalEnergy;

  const limit = limitForYear(year);
  const inScope = limit !== null;

  const result = {
    inScope,
    year,
    reviewed: LAST_REVIEWED,
    lines,
    totalEnergyMJ: totalEnergy,
    scopedEnergyMJ: scopedEnergy,
    scopeFactor,
    crossBorderShare,
    actualIntensity: round(actualIntensity, 3),
    limit: limit === null ? null : round(limit, 4),
    referenceIntensity: REFERENCE_INTENSITY,
    sources: SOURCES,
  };

  if (!inScope) {
    result.headline = `FuelEU Maritime applies from 2025. For ${year} there is no GHG intensity limit to be measured against.`;
    return result;
  }

  /*
    Annex IV Part A: compliance balance = (limit - actual) x energy, in
    gCO2eq. Negative is a deficit. Note the sign convention is the
    regulation's, not a presentational choice.
  */
  const balance = (limit - actualIntensity) * scopedEnergy;
  result.complianceBalance = balance;
  result.status = balance >= 0 ? "surplus" : "deficit";

  if (balance < 0) {
    // Annex IV Part B.
    const base =
      (Math.abs(balance) / (actualIntensity * PENALTY.vlsfoEnergyMJ)) *
      PENALTY.eurPerVlsfoTonne;
    const multiplier = PENALTY.escalation(consecutiveDeficit);
    result.penalty = {
      base: round(base),
      multiplier: round(multiplier, 2),
      total: round(base * multiplier),
      consecutiveDeficit,
    };
  }

  /*
    The EU ETS runs alongside and is a separate bill on the same voyages.
    Emissions are CO2 at the stack; the phase-in in Article 3gb decides how
    much of it must be surrendered.
  */
  const scopedCo2 = lines.reduce((sum, l) => sum + l.co2Tonnes, 0) * scopeFactor;
  const share = etsShareForYear(year);
  result.ets = {
    share,
    co2Tonnes: round(scopedCo2, 1),
    allowances: round((scopedCo2 * share) / 100, 1),
    // Only priced when the user supplies a price. A market price is not ours
    // to assume, and a made-up one would be the first thing challenged.
    cost: Number.isFinite(euaPrice) && euaPrice > 0
      ? round((scopedCo2 * share / 100) * euaPrice)
      : null,
    euaPrice: Number.isFinite(euaPrice) && euaPrice > 0 ? euaPrice : null,
  };

  result.headline = headlineFor(result);
  result.notes = notesFor(result);
  return result;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function headlineFor(r) {
  const gap = round(Math.abs(r.actualIntensity - r.limit), 2);
  if (r.status === "surplus") {
    return `On these figures the mix comes in at ${r.actualIntensity} gCO2eq/MJ against a ${r.year} limit of ${r.limit} — ${gap} below, so a compliance surplus rather than a penalty.`;
  }
  return `On these figures the mix comes in at ${r.actualIntensity} gCO2eq/MJ against a ${r.year} limit of ${r.limit} — ${gap} over, which is a FuelEU penalty of about €${r.penalty.total.toLocaleString("en-GB")}.`;
}

/*
  The notes are where the tool earns trust: they say what the number does not
  cover. Each one is a real limitation rather than a disclaimer, and they are
  generated from the input so they are specific to what was actually entered.
*/
function notesFor(r) {
  const notes = [];

  const lngWithSlip = r.lines.filter((l) => l.slip > 0);
  if (lngWithSlip.length) {
    const worst = lngWithSlip.reduce((a, b) => (a.slip > b.slip ? a : b));
    notes.push(
      `Methane slip is doing a lot of work here. ${worst.name} slips ${String(worst.slip).replace(".", ",")} % of its fuel unburned, and Annex I counts that as methane at 25 times the weight of CO2. The same molecule in a different engine gives a materially different answer, which is worth knowing before an engine is specified rather than after.`,
    );
  }

  if (r.crossBorderShare > 0) {
    notes.push(
      `${r.crossBorderShare} % of the energy was treated as voyages with one end outside the EU, which Article 2 counts at half. That single figure stands in for a voyage-by-voyage split; the real calculation is per voyage.`,
    );
  }

  notes.push(
    "Annex II default factors are used throughout. Verified compliance uses your actual bunker delivery notes, a verifier and the FuelEU database, and the answer will move.",
  );

  if (r.ets?.cost === null) {
    notes.push(
      "The ETS allowance cost is not priced because no allowance price was given. The number of allowances is fixed by the regulation; what they cost is a market question and not one this tool should answer for you.",
    );
  }

  return notes;
}

/** Every fuel's intensity against a year's limit — the comparison table. */
export function fuelComparison(year) {
  const limit = limitForYear(year);
  return FUELS.map((fuel) => {
    const intensity = fuelIntensity(fuel);
    return {
      id: fuel.id,
      name: fuel.name,
      detail: fuel.detail,
      intensity: round(intensity, 2),
      limit: limit === null ? null : round(limit, 2),
      compliant: limit === null ? null : intensity <= limit,
      margin: limit === null ? null : round(limit - intensity, 2),
    };
  }).sort((a, b) => a.intensity - b.intensity);
}

export { ETS_PHASE_IN, FUELS, limitForYear };
