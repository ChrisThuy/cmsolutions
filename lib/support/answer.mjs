import { z } from "zod";

/*
  The shape a support answer must take. Server-only — see ./knowledge.mjs for
  why the zod half lives apart from the browser half.

  The design decision that matters:

  `answered` is a required boolean and `quotes` must be non-empty whenever it
  is true. That makes "I answered from the policy" and "I made something up"
  structurally different outcomes rather than a difference of tone. A chatbot
  that hallucinates a returns window does not sound less confident when it is
  wrong — it sounds exactly the same — so the difference has to be enforced by
  the shape of the output, not by asking nicely in a prompt.

  When answered is false the agent must produce an escalation instead: a
  drafted message to a human with the customer's question and what the policy
  does and does not cover. That turns the failure case into work someone can
  action rather than a dead end.
*/

export const QuoteSchema = z.object({
  /** Verbatim from the supplied knowledge. Not a paraphrase. */
  text: z.string(),
  /** Where in the knowledge it came from, as a heading or opening words. */
  locator: z.string(),
});

export const AnswerSchema = z.object({
  /**
   * True only when the supplied knowledge actually contains the answer.
   * General knowledge about how businesses usually work does not count.
   */
  answered: z.boolean(),

  /**
   * The reply to send the customer. When answered is false this is what to
   * tell them while the question goes to a human — never a guess dressed up
   * as an answer.
   */
  reply: z.string(),

  /** The passages the reply rests on. Non-empty whenever answered is true. */
  quotes: z.array(QuoteSchema),

  /**
   * complete — the policy fully answers the question
   * partial  — the policy answers part of it and a person must cover the rest
   * none     — the policy does not cover it
   */
  coverage: z.enum(["complete", "partial", "none"]),

  /** For partial and none: a drafted handover for a human colleague. */
  escalation: z.object({
    needed: z.boolean(),
    /** What a person has to find out or decide. One sentence. */
    reason: z.string(),
    /** A message the human can send or act on, already written. */
    draft: z.string(),
  }),

  /**
   * Gaps in the knowledge this question exposed. Over a week of real
   * questions this list is the most valuable thing the tool produces — it is
   * the documentation backlog, written by customers.
   */
  gaps: z.array(z.string()),
});

/**
 * Checks the invariants zod cannot express.
 *
 * The model can return a shape that validates and still contradicts itself —
 * answered true with nothing quoted, or coverage "none" with escalation not
 * needed. Those are the exact states that would let an unsupported claim
 * reach a customer, so they are rejected here rather than rendered.
 */
export function validateAnswer(answer) {
  const problems = [];

  if (answer.answered && answer.quotes.length === 0) {
    problems.push("claimed an answer without quoting the policy");
  }
  if (answer.coverage === "none" && answer.answered) {
    problems.push("said the policy does not cover it and answered anyway");
  }
  if (answer.coverage !== "complete" && !answer.escalation.needed) {
    problems.push("left a gap without raising an escalation");
  }
  if (answer.escalation.needed && !answer.escalation.draft.trim()) {
    problems.push("raised an escalation with nothing written in it");
  }

  return { ok: problems.length === 0, problems };
}

/*
  Quote verification.

  A fabricated quotation is the failure that would fool a reader completely,
  because it looks like evidence. So it is checked against the supplied text
  rather than trusted.

  Comparison is on collapsed whitespace and folded case: a model will reflow a
  line break inside a quotation without meaning to, and that is not a
  fabrication. Anything beyond that is.
*/
export const flattenForCompare = (s) =>
  String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The quotes that do not appear in the knowledge. Empty is the good case. */
export function unsupportedQuotes(quotes, knowledge) {
  const haystack = flattenForCompare(knowledge);
  return (quotes ?? []).filter((q) => {
    const needle = flattenForCompare(q?.text);
    return needle.length > 0 && !haystack.includes(needle);
  });
}
