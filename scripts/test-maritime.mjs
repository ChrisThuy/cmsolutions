/*
  Tests the FuelEU Maritime and EU ETS calculation.

    node scripts/test-maritime.mjs

  This tool prints euro figures, so the tests are arithmetic first. The one
  that matters most is the calibration check: the regulation's own reference
  value of 91,16 gCO2eq/MJ is the 2020 fleet average, and the 2020 fleet ran
  mostly on heavy fuel oil. So computing HFO from Annex II factors and the
  Annex I structure has to land near 91,16. If the formula, the emission
  factors or the greenhouse gas weightings were wrong, that number would come
  out somewhere else — it is the closest thing available to an answer key
  published by the regulator.
*/

import {
  FUELS, GWP, REFERENCE_INTENSITY, SOURCES, etsShareForYear, limitForYear,
} from "../lib/maritime/framework.mjs";
import { assess, fuelComparison, fuelIntensity } from "../lib/maritime/calculate.mjs";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

console.log("\nThe formula is calibrated against the regulation's own reference");
{
  const hfo = FUELS.find((f) => f.id === "hfo");
  const intensity = fuelIntensity(hfo);

  // 91,744 against a published 2020 fleet average of 91,16. The fleet was not
  // 100 % HFO, so exact equality would be suspicious rather than reassuring.
  check("HFO lands within 1 gCO2eq/MJ of the 91,16 reference",
    near(intensity, REFERENCE_INTENSITY, 1), `${intensity.toFixed(3)}`);

  // The weightings are the AR4 values the Renewable Energy Directive names.
  // Using AR5 or AR6 instead is the most likely silent error in this file.
  check("greenhouse gas weightings are the ones RED II names",
    GWP.co2 === 1 && GWP.ch4 === 25 && GWP.n2o === 298, JSON.stringify(GWP));
}

console.log("\nThe limits are the regulation's, computed not hard-coded");
{
  check("2024 is before the regime bites", limitForYear(2024) === null);
  check("2025 is 2 % below the reference",
    near(limitForYear(2025), 91.16 * 0.98, 1e-9), `${limitForYear(2025)}`);
  check("2030 is 6 % below", near(limitForYear(2030), 91.16 * 0.94, 1e-9));
  check("2050 is 80 % below", near(limitForYear(2050), 91.16 * 0.2, 1e-9));
  check("a year between steps keeps the earlier step",
    limitForYear(2029) === limitForYear(2025));
  check("limits only ever fall", (() => {
    const years = [2025, 2030, 2035, 2040, 2045, 2050].map(limitForYear);
    return years.every((v, i) => i === 0 || v < years[i - 1]);
  })());
}

console.log("\nMethane slip is what separates the LNG engines");
{
  const otto = fuelIntensity(FUELS.find((f) => f.id === "lng-otto-ms"));
  const diesel = fuelIntensity(FUELS.find((f) => f.id === "lng-diesel-ss"));

  check("the same fuel in different engines gives different answers",
    Math.abs(otto - diesel) > 10, `${otto.toFixed(2)} vs ${diesel.toFixed(2)}`);
  check("more slip means a worse intensity", otto > diesel);

  // The finding that makes the tool worth opening: LNG in a medium-speed Otto
  // engine sits on top of the 2025 limit and fails from 2030.
  check("LNG Otto medium speed is marginal in 2025",
    Math.abs(otto - limitForYear(2025)) < 1.5, `${otto.toFixed(2)} vs ${limitForYear(2025).toFixed(2)}`);
  check("and is in deficit from 2030", otto > limitForYear(2030));
  // Clears 2035 at 76,08 against 77,94 and fails 2040 against 62,90. Even the
  // best fossil LNG pathway runs out of road one step later than HFO, which
  // is the point worth making to anyone treating LNG as a destination.
  check("LNG diesel slow speed clears 2035",
    diesel < limitForYear(2035), `${diesel.toFixed(2)} vs ${limitForYear(2035).toFixed(2)}`);
  check("but is in deficit by 2040",
    diesel > limitForYear(2040), `${diesel.toFixed(2)} vs ${limitForYear(2040).toFixed(2)}`);
}

console.log("\nA deficit produces the Annex IV penalty, not an invented one");
{
  const r = assess({ year: 2025, mix: [{ fuelId: "hfo", tonnes: 10_000 }], crossBorderShare: 0 });

  check("HFO in 2025 is a deficit", r.status === "deficit", JSON.stringify(r.status));
  check("a penalty is produced", r.penalty?.total > 0, JSON.stringify(r.penalty));

  // Recompute the Annex IV formula independently of the implementation.
  const expected =
    (Math.abs(r.complianceBalance) / (r.actualIntensity * 41_000)) * 2_400;
  // Tolerance is proportional, not absolute: the reported intensity is rounded
  // to three decimals for display while the penalty uses the full value, so a
  // hand recomputation lands a euro or so away on a six-figure sum.
  check("the penalty matches the Annex IV formula recomputed by hand",
    near(r.penalty.base, expected, expected * 1e-5),
    `${r.penalty.base} vs ${expected.toFixed(2)}`);

  check("first year of deficit carries no escalation", r.penalty.multiplier === 1);

  const third = assess({
    year: 2025, mix: [{ fuelId: "hfo", tonnes: 10_000 }], consecutiveDeficit: 3,
  });
  check("a third consecutive year is multiplied by 1,2",
    third.penalty.multiplier === 1.2, `${third.penalty.multiplier}`);
  check("and the total rises with it", third.penalty.total > r.penalty.total);
}

console.log("\nCompliant fuel produces a surplus and no penalty");
{
  const r = assess({ year: 2025, mix: [{ fuelId: "lng-diesel-ss", tonnes: 10_000 }] });
  check("status is surplus", r.status === "surplus");
  check("no penalty is attached", r.penalty === undefined);
  check("the headline says surplus rather than warning", /surplus/.test(r.headline), r.headline);
}

console.log("\nScope halves the energy that crosses the border");
{
  const inside = assess({ year: 2025, mix: [{ fuelId: "hfo", tonnes: 1000 }], crossBorderShare: 0 });
  const outside = assess({ year: 2025, mix: [{ fuelId: "hfo", tonnes: 1000 }], crossBorderShare: 100 });

  check("all-crossing counts half the energy",
    near(outside.scopedEnergyMJ, inside.scopedEnergyMJ / 2, 1),
    `${outside.scopedEnergyMJ} vs ${inside.scopedEnergyMJ}`);
  check("and halves the penalty with it",
    near(outside.penalty.total, inside.penalty.total / 2, 1),
    `${outside.penalty.total} vs ${inside.penalty.total}`);
  check("but does not change the intensity, which is per MJ",
    outside.actualIntensity === inside.actualIntensity);
}

console.log("\nThe ETS is a separate bill on the same voyages");
{
  check("2024 surrendered 40 %", etsShareForYear(2024) === 40);
  check("2025 surrendered 70 %", etsShareForYear(2025) === 70);
  check("2026 onward is 100 %", etsShareForYear(2026) === 100 && etsShareForYear(2031) === 100);
  check("before 2024 there is nothing to surrender", etsShareForYear(2023) === 0);

  const r = assess({ year: 2026, mix: [{ fuelId: "hfo", tonnes: 1000 }] });
  // 1 000 t of HFO at 3,114 t CO2 per tonne of fuel.
  check("CO2 follows the Annex II carbon factor",
    near(r.ets.co2Tonnes, 3114, 1), `${r.ets.co2Tonnes}`);
  check("allowances equal emissions once phase-in completes",
    near(r.ets.allowances, r.ets.co2Tonnes, 0.1));
}

console.log("\nNo market price is ever invented");
{
  const without = assess({ year: 2026, mix: [{ fuelId: "hfo", tonnes: 1000 }] });
  check("with no allowance price given, no cost is shown", without.ets.cost === null);
  check("and the omission is explained rather than left blank",
    without.notes.some((n) => /not priced/.test(n)), JSON.stringify(without.notes));

  const with80 = assess({ year: 2026, mix: [{ fuelId: "hfo", tonnes: 1000 }], euaPrice: 80 });
  check("a supplied price is used as given",
    near(with80.ets.cost, with80.ets.allowances * 80, 1), `${with80.ets.cost}`);
}

console.log("\nNothing is claimed that cannot be cited");
{
  check("every source resolves to the Official Journal",
    Object.values(SOURCES).every((s) => /^https:\/\/eur-lex\.europa\.eu\//.test(s.url)),
    Object.values(SOURCES).map((s) => s.url).join(" "));

  const text = JSON.stringify(assess({ year: 2025, mix: [{ fuelId: "hfo", tonnes: 5000 }] }));
  const invented = /\b\d+\s*%\s*(saving|reduction|cheaper|faster)|typical operators?|industry average|ROI/i;
  check("no invented savings, averages or ROI", !invented.test(text), text.match(invented)?.[0]);

  // Biofuel factors depend on the certified production pathway, so there is
  // no honest single number for them and none is offered.
  check("no biofuel is given a made-up emission factor",
    !FUELS.some((f) => /(^|-)(bio|hvo|ethanol)/i.test(f.id)), FUELS.map((f) => f.id).join(","));
}

console.log("\nBad input does not produce a confident wrong answer");
for (const [name, input] of [
  ["empty object", {}],
  ["no mix", { year: 2025 }],
  ["unknown fuel", { year: 2025, mix: [{ fuelId: "banana", tonnes: 100 }] }],
  ["negative tonnes", { year: 2025, mix: [{ fuelId: "hfo", tonnes: -50 }] }],
  ["nulls", { year: null, mix: null, crossBorderShare: null }],
  ["absurd share", { year: 2025, mix: [{ fuelId: "hfo", tonnes: 10 }], crossBorderShare: 5000 }],
]) {
  try {
    const r = assess(input);
    const sane = r.inScope === false || (Number.isFinite(r.actualIntensity) && r.crossBorderShare <= 100);
    check(`${name} is handled`, sane, JSON.stringify(r).slice(0, 120));
  } catch (cause) {
    check(`${name} is handled`, false, cause.message);
  }
}

console.log("\nThe comparison table is ordered and honest");
{
  const table = fuelComparison(2030);
  check("every fuel appears", table.length === FUELS.length);
  check("cleanest first", table.every((f, i) => i === 0 || table[i - 1].intensity <= f.intensity));
  check("compliance is stated against the year's limit",
    table.every((f) => f.compliant === (f.intensity <= f.limit)));
  check("a pre-2025 year has no limit to compare against",
    fuelComparison(2024).every((f) => f.limit === null && f.compliant === null));
}

console.log(
  failures === 0
    ? "\nAll maritime-calculation tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);

process.exit(failures === 0 ? 0 : 1);
