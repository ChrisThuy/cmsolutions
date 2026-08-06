/*
  The credits ledger.

  Browser-safe: no imports, because the page shows a balance and a price
  before anyone spends anything, and the endpoint enforces the same numbers.
  One table, two readers — a price shown that differs from the price charged
  is the fastest way to lose somebody's trust.

  ── what this file is and is not ──

  It is the accounting: what an operation costs, whether a balance covers it,
  and the debit and refund entries that result. It is deliberately pure — no
  database, no network — so the arithmetic can be tested exhaustively and the
  storage can be swapped without touching it.

  It is NOT a payment processor. Nothing here takes money. Granting credits is
  an explicit call, and wiring that to a checkout is a separate decision with
  its own care — webhooks, idempotency, refunds, tax.

  ── the rule that matters ──

  Nobody is charged for a failure. The debit happens before generation because
  otherwise a concurrent request could spend the same balance twice, and it is
  reversed the moment generation fails. A user who paid a credit and got
  nothing will not use the tool again, and would be right not to.
*/

/*
  Prices in credits.

  Chosen so one credit is a round, explicable unit rather than a fraction of a
  penny nobody can reason about. Images are near-free at provider cost — the
  whole month of a social plan is pennies — so they are priced to cover
  overhead rather than to earn. Video is where the actual money goes and where
  the pricing has to be honest.

  Reviewed with the provider prices, because those move: a cost table that has
  quietly drifted below what generation actually costs loses money on every
  request, silently, until somebody checks.
*/
export const PRICES_REVIEWED = "2026-08-06";

export const PRICES = {
  "image.draft": { credits: 1, label: "Draft image" },
  "image.final": { credits: 4, label: "Final image" },
  /* Video is per second, so the cost of a clip scales with its length. */
  "video.cheap": { creditsPerSecond: 3, label: "Video clip" },
  "video.chain": { creditsPerSecond: 12, label: "Cinematic clip (chained)" },
};

/** What one operation costs, in credits. Throws on anything unpriced. */
export function priceOf(operation, { seconds = 0 } = {}) {
  const price = PRICES[operation];
  if (!price) throw new Error(`No price for "${operation}"`);

  if (price.creditsPerSecond) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) {
      throw new Error(`"${operation}" is priced per second and needs a duration`);
    }
    // Rounded up: a 5.5-second clip is charged as six, never as five.
    return Math.ceil(price.creditsPerSecond * s);
  }
  return price.credits;
}

/** A readable price for the UI, so what is shown is what is charged. */
export function quote(operation, options = {}) {
  const price = PRICES[operation];
  if (!price) return null;
  return {
    operation,
    label: price.label,
    credits: priceOf(operation, options),
    perSecond: price.creditsPerSecond ?? null,
  };
}

/** Every price, for a pricing table. */
export function priceList() {
  return Object.entries(PRICES).map(([operation, p]) => ({
    operation,
    label: p.label,
    credits: p.credits ?? null,
    creditsPerSecond: p.creditsPerSecond ?? null,
  }));
}

/**
 * Can this balance afford it?
 *
 * Separated from the debit so a caller can quote before committing, and so
 * the page can grey out what a user cannot afford rather than letting them
 * press a button that fails.
 */
export function canAfford(balance, operation, options = {}) {
  const cost = priceOf(operation, options);
  const have = Number(balance);
  return {
    ok: Number.isFinite(have) && have >= cost,
    cost,
    balance: Number.isFinite(have) ? have : 0,
    short: Math.max(0, cost - (Number.isFinite(have) ? have : 0)),
  };
}

/*
  Ledger entries.

  Append-only by design: a balance is the sum of its entries rather than a
  number that gets overwritten. That makes a wrong balance traceable to the
  entry that caused it, which a mutable counter never is.
*/
export function debitEntry({ operation, seconds = 0, reference }) {
  const credits = priceOf(operation, { seconds });
  return {
    kind: "debit",
    operation,
    credits: -credits,
    reference,           // ties the debit to the refund that may reverse it
    note: `${PRICES[operation].label}${seconds ? ` — ${seconds}s` : ""}`,
  };
}

export function refundEntry({ debit, reason }) {
  if (!debit || debit.kind !== "debit") throw new Error("A refund needs the debit it reverses");
  return {
    kind: "refund",
    operation: debit.operation,
    credits: Math.abs(debit.credits),
    reference: debit.reference,
    note: `Refunded — ${reason}`,
  };
}

export function grantEntry({ credits, reason }) {
  const amount = Number(credits);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("A grant must be a positive whole number of credits");
  return { kind: "grant", operation: null, credits: amount, reference: null, note: reason };
}

/** The balance is the sum of the entries. Never stored as a mutable number. */
export function balanceOf(entries) {
  return (entries ?? []).reduce((total, e) => total + (Number(e?.credits) || 0), 0);
}

/**
 * Has this debit already been reversed?
 *
 * A retry that refunds twice hands out free credits. Matching on the
 * reference makes the refund idempotent.
 */
export function alreadyRefunded(entries, reference) {
  return (entries ?? []).some((e) => e.kind === "refund" && e.reference === reference);
}
