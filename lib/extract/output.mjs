import { z } from "zod";

/*
  The shape the model must return. Server-only.

  This lives apart from the field presets for a mechanical reason worth
  recording: the page imports the presets directly, and a browser cannot
  resolve a bare module specifier like "zod". Keeping both in one file meant
  the page's whole module failed to load and every control was inert — with
  nothing visible on screen to say so, because the failure happens before any
  of the script runs.

  The rules the schema enforces:

    · value may be null. "Not on this document" is a first-class answer and
      the model is told to use it rather than guess.
    · evidence is the verbatim text the value was read from. If the model
      cannot quote the document, it does not get to claim the value.
    · confidence is explicit, so a reader can sort by what to check first.

  A wrong invoice total that looks confident is worse than no tool at all,
  because nobody re-checks a number that arrives neatly formatted in a table.
*/

/** A single extracted field. */
export const FieldSchema = z.object({
  /** The label asked for, echoed back so the caller can align rows. */
  name: z.string(),
  /** Null when the document does not contain it. Never a guess. */
  value: z.string().nullable(),
  /** The exact text this was read from. Empty only when value is null. */
  evidence: z.string(),
  /**
   * high   — stated plainly and unambiguously on the document
   * medium — present but needed interpretation, or the label differed
   * low    — inferred from context; a person should check this one
   * absent — not on the document
   */
  confidence: z.enum(["high", "medium", "low", "absent"]),
  /** Why, when confidence is not high. Short. */
  note: z.string(),
});

/** A repeating row, for line items on an invoice or statement. */
export const RowSchema = z.object({
  description: z.string(),
  quantity: z.string().nullable(),
  unitPrice: z.string().nullable(),
  amount: z.string().nullable(),
});

export const ExtractionSchema = z.object({
  /** What the model believes the document is. */
  documentType: z.string(),
  /** Requested fields, in the order they were asked for. */
  fields: z.array(FieldSchema),
  /** Line items, empty when the document has none. */
  rows: z.array(RowSchema),
  /**
   * Anything that would make a person distrust the extraction — a scan too
   * poor to read, a total that does not match its line items, two candidate
   * values for one field. This is the field that earns the tool its keep.
   */
  warnings: z.array(z.string()),
});
