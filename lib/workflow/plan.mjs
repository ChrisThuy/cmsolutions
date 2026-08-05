import { z } from "zod";

/*
  The shape a workflow plan must take. Server-only.

  Two design decisions carry the honesty of this tool.

  First, there is no field anywhere in this schema for hours saved or money
  saved. The model is not asked for them and cannot supply them. Those numbers
  are computed in lib/workflow/schema.mjs from what the user entered, because
  they are the figures a client repeats to their board and the ones that get
  checked. A model that multiplies silently is wrong occasionally, confidently,
  and undetectably.

  Second, every step must carry a failure mode. An automation plan that only
  describes the happy path is a sales document. The question a competent buyer
  asks is "what happens when it breaks at 2am on a Friday", and a plan that
  cannot answer it is not a plan.
*/

export const StepSchema = z.object({
  /** Short imperative name — "Read the invoice", not "Invoice reading step". */
  name: z.string(),

  /** What actually happens, in one or two sentences. */
  detail: z.string(),

  /**
   * automated — runs unattended; deterministic, or checkable afterwards
   * assisted  — drafted by machine, approved by a person
   * human     — judgement, relationship or liability; automating is worse
   */
  handling: z.enum(["automated", "assisted", "human"]),

  /** Why this handling and not a more aggressive one. This is the reasoning
   *  a buyer is paying for; "because AI" is not an answer. */
  reasoning: z.string(),

  /**
   * Roughly what share of the total effort this step takes, 0-100. Used to
   * weight the time arithmetic, which happens in code. People estimate
   * "chasing the PO is about half of it" far better than minutes per step.
   */
  shareOfEffort: z.number(),

  /** What goes wrong here, and what should happen when it does. Required —
   *  a step with no failure mode has not been thought about. */
  failureMode: z.string(),
});

export const PlanSchema = z.object({
  /** What sets the process off. */
  trigger: z.string(),

  /** The steps, in the order they happen. */
  steps: z.array(StepSchema),

  /** What the process produces when it finishes. */
  outcome: z.string(),

  /**
   * The steps that should stay human, named again with the reason, so this
   * cannot be skimmed past. A plan that automates everything is a sales
   * instrument and the room can tell.
   */
  keepHuman: z.array(z.string()),

  /**
   * What could go wrong with the automation as a whole — not per step. The
   * dependency that breaks, the edge case that is rarer than it sounds.
   */
  risks: z.array(z.string()),

  /** What has to exist before any of this can be built: access, data, a
   *  decision someone has been avoiding. */
  prerequisites: z.array(z.string()),

  /**
   * Where to start, if only one thing gets done. Must be exactly one of the
   * step names above, so it can be matched rather than read.
   */
  startWith: z.string(),

  /**
   * Why start there. Split from startWith because the first version asked for
   * a step name and got a paragraph of reasoning — which was the more useful
   * answer, and made the consistency check fire on good output. Both are
   * wanted; they are two fields.
   */
  startWhy: z.string(),

  /** Honest note on anything the description did not make clear. */
  unclear: z.array(z.string()),
});

/**
 * Checks the invariants zod cannot express.
 *
 * These are the states that would let a plan look complete while being
 * unusable — or worse, while quietly overpromising.
 */
export function validatePlan(plan) {
  const problems = [];

  if (!plan.steps || plan.steps.length === 0) {
    problems.push("produced a plan with no steps");
    return { ok: false, problems };
  }

  const missingFailure = plan.steps.filter((s) => !s.failureMode?.trim());
  if (missingFailure.length) {
    problems.push(`${missingFailure.length} step(s) have no failure mode`);
  }

  const missingReasoning = plan.steps.filter((s) => !s.reasoning?.trim());
  if (missingReasoning.length) {
    problems.push(`${missingReasoning.length} step(s) classify without explaining why`);
  }

  /*
    A plan where nothing is left to a person, and which does not say plainly
    that it examined that question, is the shape of an overpromise. Not an
    error — some processes genuinely are fully mechanical — but it must be
    stated rather than silently arrived at.
  */
  const humanSteps = plan.steps.filter((s) => s.handling === "human");
  if (humanSteps.length === 0 && (!plan.keepHuman || plan.keepHuman.length === 0)) {
    problems.push("automates every step without saying why nothing needs a person");
  }

  if (!plan.startWith?.trim()) {
    problems.push("does not say where to start");
  } else if (!plan.steps.some((s) => s.name === plan.startWith)) {
    problems.push("says to start with a step that is not in the plan");
  }

  const shares = plan.steps.map((s) => Number(s.shareOfEffort)).filter(Number.isFinite);
  if (shares.length !== plan.steps.length) {
    problems.push("some steps have no effort share, so the arithmetic would be guesswork");
  }

  return { ok: problems.length === 0, problems };
}

/** Counts by handling, for the summary line. */
export function tally(steps) {
  return {
    total: steps.length,
    automated: steps.filter((s) => s.handling === "automated").length,
    assisted: steps.filter((s) => s.handling === "assisted").length,
    human: steps.filter((s) => s.handling === "human").length,
  };
}
