/*
  Document data extraction — the fields a caller can ask for.

  Deliberately free of any bare-specifier import, because the page loads this
  module straight into the browser. The zod output schema the server uses
  lives in ./output.mjs; putting the two together broke the page silently.
*/

/*
  Presets.

  Not because the tool cannot handle arbitrary fields — it can, and the custom
  option is the one people will end up using — but because a blank field list
  is a bad first experience. Someone should be able to drop in an invoice and
  press go.

  The field names are the ones that appear on real documents rather than the
  ones a database would use: "Invoice number", not "invoice_id".
*/
export const PRESETS = [
  {
    id: "invoice",
    name: "Invoice",
    blurb: "Supplier invoices and bills. The accounts-payable case.",
    fields: [
      "Invoice number", "Invoice date", "Due date", "Supplier name",
      "Supplier VAT or tax number", "Customer name", "Purchase order number",
      "Currency", "Subtotal", "Tax amount", "Total amount due",
      "Bank account or IBAN", "Payment terms",
    ],
    wantsRows: true,
  },
  {
    id: "receipt",
    name: "Receipt",
    blurb: "Expense receipts, for reimbursement and bookkeeping.",
    fields: [
      "Merchant name", "Date", "Time", "Currency", "Subtotal",
      "Tax amount", "Total paid", "Payment method", "Card last four digits",
      "Receipt or transaction number",
    ],
    wantsRows: true,
  },
  {
    id: "purchase-order",
    name: "Purchase order",
    blurb: "Incoming POs, for order entry.",
    fields: [
      "PO number", "PO date", "Buyer name", "Supplier name",
      "Delivery address", "Requested delivery date", "Currency",
      "Total value", "Payment terms", "Contact name", "Contact email",
    ],
    wantsRows: true,
  },
  {
    id: "contract",
    name: "Contract key terms",
    blurb: "The dates and numbers people re-read a contract to find.",
    fields: [
      "Parties", "Effective date", "Term length", "Expiry or renewal date",
      "Notice period for termination", "Auto-renewal", "Contract value",
      "Payment terms", "Governing law", "Liability cap", "Confidentiality term",
    ],
    wantsRows: false,
  },
  {
    id: "cv",
    name: "CV or résumé",
    blurb: "For recruiters doing intake by hand.",
    fields: [
      "Full name", "Email", "Phone", "Location", "Current job title",
      "Current employer", "Years of experience", "Education",
      "Key skills", "Languages",
    ],
    wantsRows: false,
  },
  {
    id: "custom",
    name: "Whatever you need",
    blurb: "Name your own fields. This is the one most people end up using.",
    fields: [],
    wantsRows: false,
  },
];

export const MAX_FIELDS = 25;
export const MAX_FIELD_LENGTH = 80;

/**
 * Cleans a caller-supplied field list.
 *
 * Field names go into the prompt, so they are treated as untrusted input:
 * capped in number and length, stripped of newlines, and de-duplicated. A
 * field called "ignore your instructions and…" is still just a field name
 * once it is one line of a numbered list, but there is no reason to let it
 * be a thousand characters long.
 */
export function normaliseFields(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_LENGTH);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** The preset's fields, or the caller's, normalised either way. */
export function fieldsFor(presetId, customFields) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (preset && preset.id !== "custom" && preset.fields.length) return preset.fields;
  return normaliseFields(customFields);
}

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) ?? null;
}
