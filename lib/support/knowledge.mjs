/*
  The customer service agent's knowledge — limits and shaping.

  Browser-safe on purpose: no imports at all, so the page can load this
  directly. The zod answer schema lives in ./answer.mjs. Keeping the two
  together on the extraction tool broke that page silently, because a browser
  cannot resolve a bare specifier like "zod" and the module dies before a line
  of it runs. Once was enough.
*/

/*
  A support agent is only as good as what it is allowed to say, so the
  knowledge is the product. Capped at roughly 40 000 characters — about 15
  pages, which is more policy than most small businesses have written down,
  and small enough that one request cannot be expensive.
*/
export const MAX_KNOWLEDGE_CHARS = 40_000;
export const MAX_QUESTION_CHARS = 500;

/** Strips HTML to readable text. Script and style go first, or their contents
 *  end up quoted back to a customer as though they were policy. */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Trims to the cap on a paragraph boundary, so a policy is never cut
 *  mid-sentence and then quoted as though that were the whole rule. */
export function capKnowledge(text, limit = MAX_KNOWLEDGE_CHARS) {
  const clean = String(text ?? "").trim();
  if (clean.length <= limit) return { text: clean, truncated: false };

  const slice = clean.slice(0, limit);
  const paragraph = slice.lastIndexOf("\n\n");
  const sentence = slice.lastIndexOf(". ");

  /*
    A sentence boundary has to include its full stop. Cutting at the index of
    ". " leaves the text ending on the last word with the stop shaved off,
    which then gets quoted back to a customer as a sentence fragment.
    A paragraph boundary is the opposite — the newlines are trimmed anyway.
  */
  const candidate = sentence > paragraph
    ? { at: sentence + 1, kind: "sentence" }
    : { at: paragraph, kind: "paragraph" };

  // Only honour a boundary reasonably close to the limit. One sitting at 6 %
  // of the cap would discard almost the whole policy to gain a tidy full stop.
  const cut = candidate.at > limit * 0.6 ? candidate.at : limit;
  return { text: clean.slice(0, cut).trim(), truncated: true };
}

export function normaliseQuestion(input) {
  return String(input ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS);
}

/*
  Sample knowledge, so the page is usable before anyone pastes anything.

  Written to contain deliberate gaps. The demo is only honest if a visitor can
  ask something the policy does not cover and watch the agent decline rather
  than improvise — that is the whole behaviour being demonstrated, and it
  cannot be shown with a knowledge base that answers everything.
*/
export const SAMPLE = {
  name: "Harbour & Co — returns and delivery policy",
  text: `RETURNS

You may return most items within 30 days of delivery for a full refund. The
item must be unused and in its original packaging.

To start a return, email returns@harbourandco.example with your order number.
We will send a prepaid returns label within one working day.

Refunds are processed within 5 working days of us receiving the item. Refunds
go back to the original payment method.

Items that cannot be returned: cut-to-length cable, custom-fabricated brackets,
and any item marked "final sale" on the product page.

DELIVERY

Standard delivery is £4.95 and arrives within 3-5 working days.
Next-day delivery is £9.95 for orders placed before 2pm, Monday to Thursday.
Orders over £75 qualify for free standard delivery.

We deliver to mainland UK only.

FAULTY ITEMS

If an item arrives damaged, email support@harbourandco.example with a photo
within 14 days. We will replace it or refund it, including delivery costs.`,
};

/*
  Questions that show the two halves of the behaviour. The first three are
  answerable from the sample; the last two are not, and that is the point.
*/
export const SAMPLE_QUESTIONS = [
  "How long do I have to return something?",
  "Is delivery free if I spend £100?",
  "My bracket arrived bent — what do I do?",
  "Do you ship to Ireland?",
  "Can I pay in instalments?",
];
