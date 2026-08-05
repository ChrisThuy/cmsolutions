/*
  Workflow automation — inputs, limits and the arithmetic.

  Browser-safe: no imports at all, so the page can load this directly. The zod
  plan schema lives in ./plan.mjs. Splitting them is not stylistic — a browser
  cannot resolve a bare specifier like "zod", and putting the two together
  killed the document-extraction page silently, before a line of its script
  ran. Twice would be careless.

  ── the decision that matters in this file ──

  The model identifies the steps and classifies each one. It does not do the
  arithmetic. Every hour-and-pound figure below is computed here, in code,
  from numbers the user supplied.

  That is not tidiness. "This saves you 14 hours a month" is the sentence a
  client repeats to their board, and it is the one number in the whole output
  that will be checked. A language model doing that multiplication silently
  gets it wrong occasionally and confidently, and there is no way to tell
  which time from reading the answer. So it is arithmetic, in a function,
  with tests.
*/

export const MAX_DESCRIPTION_CHARS = 4000;
export const MIN_DESCRIPTION_CHARS = 60;

/** How a step can be handled, worst to best for the person doing it today. */
export const HANDLING = {
  automated: {
    id: "automated",
    label: "Automated",
    blurb: "Runs without a person. Deterministic, or checkable after the fact.",
  },
  assisted: {
    id: "assisted",
    label: "Assisted",
    blurb: "A machine drafts it, a person approves it. Faster, still supervised.",
  },
  human: {
    id: "human",
    label: "Keep human",
    blurb: "Judgement, relationship or liability. Automating it would be worse.",
  },
};

/*
  How much of a step's time each handling actually removes.

  These are deliberately conservative and deliberately visible, because they
  are the only assumption in the arithmetic and they are ours rather than the
  regulation's or the client's. An automated step still needs someone to
  notice when it breaks; an assisted step still needs reading and approving.
  Claiming 100 % and 50 % would produce a better-looking number and a worse
  estimate.
*/
export const TIME_REMOVED = {
  automated: 0.9,
  assisted: 0.5,
  human: 0,
};

export const CADENCES = [
  { id: "daily", label: "Every working day", perMonth: 21.7 },
  { id: "weekly", label: "Weekly", perMonth: 4.33 },
  { id: "fortnightly", label: "Fortnightly", perMonth: 2.17 },
  { id: "monthly", label: "Monthly", perMonth: 1 },
  { id: "quarterly", label: "Quarterly", perMonth: 0.33 },
];

export function cadenceById(id) {
  return CADENCES.find((c) => c.id === id) ?? null;
}

const isPositive = (n) => Number.isFinite(n) && n > 0;

/**
 * Works out what the plan saves, from the user's own numbers.
 *
 * Returns null when the user did not give enough to compute anything. That is
 * the important branch: a workflow tool with nothing to multiply must produce
 * no figure at all rather than a plausible one. Every other tool on this site
 * follows the same rule — the methane report has no score, the FuelEU
 * calculator will not price an allowance, the extractor returns null rather
 * than guessing a total.
 */
export function estimateSaving({ steps, cadenceId, minutesPerRun, hourlyCost }) {
  const cadence = cadenceById(cadenceId);
  const minutes = Number(minutesPerRun);

  if (!cadence || !isPositive(minutes) || !Array.isArray(steps) || steps.length === 0) {
    return null;
  }

  /*
    The model is asked for each step's share of the total effort, because
    people can estimate "chasing the PO takes about half of it" far better
    than they can estimate minutes per step. Shares are normalised here rather
    than trusted to sum to 100 — they never do.
  */
  const weights = steps.map((s) => {
    const share = Number(s?.shareOfEffort);
    return isPositive(share) ? share : 0;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // With no usable shares, fall back to treating steps as equal. Stated in the
  // output rather than hidden, because it materially changes the answer.
  const evenFallback = totalWeight <= 0;
  const normalised = evenFallback
    ? steps.map(() => 1 / steps.length)
    : weights.map((w) => w / totalWeight);

  let minutesRemoved = 0;
  const perStep = steps.map((step, i) => {
    const stepMinutes = minutes * normalised[i];
    const removed = stepMinutes * (TIME_REMOVED[step?.handling] ?? 0);
    minutesRemoved += removed;
    return {
      name: step?.name ?? `Step ${i + 1}`,
      handling: step?.handling ?? "human",
      minutesNow: round(stepMinutes, 1),
      minutesRemoved: round(removed, 1),
    };
  });

  const runsPerMonth = cadence.perMonth;
  const hoursNowMonthly = (minutes * runsPerMonth) / 60;
  const hoursSavedMonthly = (minutesRemoved * runsPerMonth) / 60;

  const cost = Number(hourlyCost);
  const costSavedMonthly = isPositive(cost) ? hoursSavedMonthly * cost : null;

  return {
    cadence: cadence.label,
    runsPerMonth: round(runsPerMonth, 2),
    minutesPerRun: round(minutes, 0),
    minutesRemovedPerRun: round(minutesRemoved, 1),
    hoursNowMonthly: round(hoursNowMonthly, 1),
    hoursSavedMonthly: round(hoursSavedMonthly, 1),
    hoursSavedYearly: round(hoursSavedMonthly * 12, 1),
    costSavedMonthly: costSavedMonthly === null ? null : round(costSavedMonthly, 0),
    costSavedYearly: costSavedMonthly === null ? null : round(costSavedMonthly * 12, 0),
    perStep,
    evenFallback,
    // Repeated back so the figure can never be read without its inputs.
    assumptions: [
      `${round(runsPerMonth, 2)} runs a month (${cadence.label.toLowerCase()})`,
      `${round(minutes, 0)} minutes per run, as you entered it`,
      `automated steps remove ${TIME_REMOVED.automated * 100} % of their time, assisted ${TIME_REMOVED.assisted * 100} %, human steps none`,
      evenFallback
        ? "effort split evenly across steps, because no per-step split was available"
        : "effort split across steps as weighted in the plan",
    ],
  };
}

function round(value, dp) {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/*
  Examples, so the page is usable before anyone types anything.

  Each is a process a small business actually runs by hand, described the way
  someone would describe it out loud rather than the way a consultant would
  write it up.
*/
export const EXAMPLES = [
  {
    id: "invoices",
    label: "Supplier invoices",
    cadenceId: "daily",
    minutesPerRun: 45,
    text: `Invoices arrive by email to accounts@. Someone opens each one, types the supplier, invoice number, date and total into our accounting system, checks it against the purchase order if there is one, and files the PDF in the shared drive under the supplier folder. If the total does not match the PO, they email the supplier and put it in a pending folder until it is resolved. At the end of the week someone runs a list of what is due and passes it to the director to approve payment.`,
  },
  {
    id: "onboarding",
    label: "New client onboarding",
    cadenceId: "weekly",
    minutesPerRun: 120,
    text: `When a client signs, we send a welcome email, set up a folder structure in the shared drive, create a project in our tracker, add the client to the invoicing system, book a kick-off call, and send a questionnaire asking for their brand assets, logins and key contacts. We chase the questionnaire if it has not come back in three days. Once it is back, someone reads it and writes a short brief for whoever is delivering the work.`,
  },
  {
    id: "quotes",
    label: "Quoting from enquiries",
    cadenceId: "daily",
    minutesPerRun: 35,
    text: `Enquiries come in through the website form and go to a shared inbox. Someone reads it, works out whether it is something we do, looks up similar past jobs to see what we charged, writes a quote in a Word template, converts it to PDF and emails it. If we have not heard back in a week we send a follow-up. We do not track which quotes turn into work in any organised way.`,
  },
];

export function exampleById(id) {
  return EXAMPLES.find((e) => e.id === id) ?? null;
}
