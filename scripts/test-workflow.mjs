/*
  Tests the workflow planner.

    node scripts/test-workflow.mjs

  Weighted heavily toward the arithmetic, because that is the deliberate split
  in this tool: the model reads the process and classifies the steps, and the
  code works out what it saves. "This saves you 14 hours a month" is the
  sentence a client repeats to their board and the only number anybody checks,
  so it is a function with tests rather than a sentence a model produced.

  The other half is the refusal: with no volume figures there must be no
  estimate at all. Not a range, not an illustration.
*/

import {
  CADENCES, EXAMPLES, TIME_REMOVED, cadenceById, estimateSaving, exampleById,
} from "../lib/workflow/schema.mjs";
import { tally, validatePlan } from "../lib/workflow/plan.mjs";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;

const step = (over = {}) => ({
  name: "Type the invoice into the ledger",
  detail: "Rekeys supplier, number, date and total.",
  handling: "automated",
  reasoning: "Deterministic transcription, checkable against the source.",
  shareOfEffort: 50,
  failureMode: "Unreadable scan — route to a person rather than guess.",
  ...over,
});

const plan = (over = {}) => ({
  trigger: "Invoice arrives by email",
  steps: [step(), step({ name: "Approve payment", handling: "human", shareOfEffort: 50 })],
  outcome: "Invoice in the ledger, approved for payment",
  keepHuman: ["Approve payment"],
  risks: ["Supplier changes their invoice layout"],
  prerequisites: ["Read access to the accounts inbox"],
  startWith: "Type the invoice into the ledger",
  unclear: [],
  ...over,
});

console.log("\nThe arithmetic is arithmetic, not a guess");
{
  // Two steps, 50/50 effort, 60 minutes a run, daily.
  // Automated removes 90 % of its half: 30 x 0.9 = 27 minutes.
  // Human removes nothing. So 27 minutes a run.
  const s = estimateSaving({
    steps: plan().steps, cadenceId: "daily", minutesPerRun: 60,
  });

  check("minutes removed per run are computed from the shares",
    near(s.minutesRemovedPerRun, 27), `${s.minutesRemovedPerRun}`);

  // 27 min x 21.7 runs / 60 = 9.765 hours
  check("monthly hours follow from the cadence",
    near(s.hoursSavedMonthly, 9.8, 0.1), `${s.hoursSavedMonthly}`);
  check("yearly is twelve times monthly",
    near(s.hoursSavedYearly, s.hoursSavedMonthly * 12, 0.5));
  check("hours now is the whole run, not the saving",
    near(s.hoursNowMonthly, (60 * 21.7) / 60, 0.1), `${s.hoursNowMonthly}`);
}

console.log("\nHandling changes the answer in the right direction");
{
  const base = { cadenceId: "weekly", minutesPerRun: 100 };
  const allAuto = estimateSaving({ ...base, steps: [step({ shareOfEffort: 100 })] });
  const allAssisted = estimateSaving({ ...base, steps: [step({ handling: "assisted", shareOfEffort: 100 })] });
  const allHuman = estimateSaving({ ...base, steps: [step({ handling: "human", shareOfEffort: 100 })] });

  check("automated removes the most", allAuto.minutesRemovedPerRun > allAssisted.minutesRemovedPerRun);
  check("assisted removes some", allAssisted.minutesRemovedPerRun > 0);
  check("human removes none", allHuman.minutesRemovedPerRun === 0, `${allHuman.minutesRemovedPerRun}`);

  check("automated matches the published factor",
    near(allAuto.minutesRemovedPerRun, 100 * TIME_REMOVED.automated));
  check("assisted matches the published factor",
    near(allAssisted.minutesRemovedPerRun, 100 * TIME_REMOVED.assisted));

  // Nothing claims to remove all of a step's time. An automated step still
  // needs somebody to notice when it breaks.
  check("no handling claims to remove 100 % of a step",
    Object.values(TIME_REMOVED).every((v) => v < 1), JSON.stringify(TIME_REMOVED));
}

console.log("\nEffort shares are normalised, never trusted to sum to 100");
{
  const lopsided = estimateSaving({
    steps: [step({ shareOfEffort: 30 }), step({ handling: "human", shareOfEffort: 30 })],
    cadenceId: "monthly", minutesPerRun: 60,
  });
  // Shares sum to 60, not 100. Normalised they are still 50/50.
  check("shares that do not sum to 100 still split correctly",
    near(lopsided.minutesRemovedPerRun, 27), `${lopsided.minutesRemovedPerRun}`);

  const perStepTotal = lopsided.perStep.reduce((a, s) => a + s.minutesNow, 0);
  check("per-step minutes add back up to the run",
    near(perStepTotal, 60, 0.2), `${perStepTotal}`);

  const noShares = estimateSaving({
    steps: [step({ shareOfEffort: 0 }), step({ handling: "human", shareOfEffort: 0 })],
    cadenceId: "monthly", minutesPerRun: 60,
  });
  check("with no usable shares it falls back to an even split",
    near(noShares.minutesRemovedPerRun, 27) && noShares.evenFallback === true,
    `${noShares.minutesRemovedPerRun} fallback=${noShares.evenFallback}`);
  check("and says so in the assumptions",
    noShares.assumptions.some((a) => /evenly/.test(a)), JSON.stringify(noShares.assumptions));
}

console.log("\nWith nothing to multiply, nothing is claimed");
{
  const steps = plan().steps;
  check("no cadence means no estimate",
    estimateSaving({ steps, minutesPerRun: 60 }) === null);
  check("no minutes means no estimate",
    estimateSaving({ steps, cadenceId: "daily" }) === null);
  check("no steps means no estimate",
    estimateSaving({ steps: [], cadenceId: "daily", minutesPerRun: 60 }) === null);
  check("zero minutes means no estimate",
    estimateSaving({ steps, cadenceId: "daily", minutesPerRun: 0 }) === null);
  check("nonsense minutes mean no estimate",
    estimateSaving({ steps, cadenceId: "daily", minutesPerRun: "soon" }) === null);
  check("an unknown cadence means no estimate",
    estimateSaving({ steps, cadenceId: "hourly", minutesPerRun: 60 }) === null);
}

console.log("\nMoney is only mentioned when a rate was given");
{
  const steps = plan().steps;
  const without = estimateSaving({ steps, cadenceId: "daily", minutesPerRun: 60 });
  check("no hourly rate means no cost figure",
    without.costSavedMonthly === null && without.costSavedYearly === null);

  const with40 = estimateSaving({ steps, cadenceId: "daily", minutesPerRun: 60, hourlyCost: 40 });
  check("a supplied rate is used as given",
    near(with40.costSavedMonthly, with40.hoursSavedMonthly * 40, 1), `${with40.costSavedMonthly}`);
  check("and the yearly figure follows",
    near(with40.costSavedYearly, with40.costSavedMonthly * 12, 12));

  check("a zero or negative rate is ignored rather than used",
    estimateSaving({ steps, cadenceId: "daily", minutesPerRun: 60, hourlyCost: 0 }).costSavedMonthly === null);
}

console.log("\nEvery figure is shown with the inputs it came from");
{
  const s = estimateSaving({ steps: plan().steps, cadenceId: "weekly", minutesPerRun: 90 });
  check("the assumptions name the cadence", s.assumptions.some((a) => /runs a month/.test(a)));
  check("and the minutes as entered", s.assumptions.some((a) => /90 minutes per run/.test(a)));
  check("and the removal factors, so the only assumption we add is visible",
    s.assumptions.some((a) => /90 % of their time/.test(a)), JSON.stringify(s.assumptions));
}

console.log("\nA plan must be usable, not just well formed");
{
  check("a sound plan passes", validatePlan(plan()).ok, JSON.stringify(validatePlan(plan()).problems));

  const noFailure = validatePlan(plan({ steps: [step({ failureMode: "" })] , keepHuman: ["x"] }));
  check("a step with no failure mode is rejected",
    !noFailure.ok && noFailure.problems.some((p) => /failure mode/.test(p)), JSON.stringify(noFailure.problems));

  const noReason = validatePlan(plan({ steps: [step({ reasoning: "  " })], keepHuman: ["x"] }));
  check("a classification with no reasoning is rejected",
    !noReason.ok && noReason.problems.some((p) => /explaining why/.test(p)));

  // The overpromise shape: everything automated, nobody left in the loop, and
  // no acknowledgement that the question was even asked.
  const allAuto = validatePlan(plan({
    steps: [step(), step({ name: "Second" })], keepHuman: [],
  }));
  check("automating everything without saying why is flagged",
    !allAuto.ok && allAuto.problems.some((p) => /without saying why/.test(p)),
    JSON.stringify(allAuto.problems));

  const stillFine = validatePlan(plan({
    steps: [step(), step({ name: "Second" })],
    keepHuman: ["Nothing here needs a person — every step is deterministic transcription."],
  }));
  check("but automating everything and saying so explicitly is allowed", stillFine.ok);

  const badStart = validatePlan(plan({ startWith: "A step that does not exist" }));
  check("pointing at a step that is not in the plan is rejected",
    !badStart.ok && badStart.problems.some((p) => /not in the plan/.test(p)));

  check("an empty plan is rejected outright", !validatePlan(plan({ steps: [] })).ok);
}

console.log("\nCounts and cadences");
{
  const t = tally(plan().steps);
  check("the tally counts by handling", t.total === 2 && t.automated === 1 && t.human === 1,
    JSON.stringify(t));
  check("every cadence has a positive monthly rate",
    CADENCES.every((c) => c.perMonth > 0));
  check("daily is the most frequent",
    Math.max(...CADENCES.map((c) => c.perMonth)) === cadenceById("daily").perMonth);
  check("an unknown cadence resolves to null", cadenceById("hourly") === null);
}

console.log("\nThe examples are real processes, not sales copy");
{
  for (const ex of EXAMPLES) {
    check(`${ex.id} is described in enough detail to plan from`, ex.text.length > 300,
      `${ex.text.length}`);
    check(`${ex.id} carries its own volume figures`,
      cadenceById(ex.cadenceId) !== null && ex.minutesPerRun > 0);
  }
  // An example that already sounds like a finished case study teaches the
  // visitor nothing about describing their own mess.
  const combined = EXAMPLES.map((e) => e.text).join(" ");
  check("no example claims a saving or an outcome",
    !/saved|efficien|ROI|streamlin/i.test(combined),
    combined.match(/saved|efficien|ROI|streamlin/i)?.[0]);
  check("lookup by id works", exampleById("invoices")?.cadenceId === "daily");
  check("an unknown id is null", exampleById("nope") === null);
}

console.log(
  failures === 0
    ? "\nAll workflow-planner tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
