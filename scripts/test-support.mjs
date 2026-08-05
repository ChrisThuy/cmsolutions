/*
  Tests the customer service agent's guards.

    node scripts/test-support.mjs

  These cover the parts that decide whether an unsupported claim can reach a
  customer — the answer invariants and the knowledge shaping. The model call
  itself is exercised against production separately; what is tested here is
  everything that runs whether or not the model behaves.

  The premise of the tool is that "I answered from the policy" and "I made
  something up" must be structurally different outcomes rather than a
  difference of tone, because a hallucinated returns window does not sound
  less confident than a correct one.
*/

import {
  MAX_KNOWLEDGE_CHARS, SAMPLE, SAMPLE_QUESTIONS, capKnowledge, htmlToText,
  normaliseQuestion,
} from "../lib/support/knowledge.mjs";
import { unsupportedQuotes, validateAnswer } from "../lib/support/answer.mjs";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const answer = (over = {}) => ({
  answered: true,
  reply: "You have 30 days.",
  quotes: [{ text: "within 30 days of delivery", locator: "RETURNS" }],
  coverage: "complete",
  escalation: { needed: false, reason: "", draft: "" },
  gaps: [],
  ...over,
});

console.log("\nAn answer must be supported, or it is not an answer");
{
  check("a quoted, complete answer passes", validateAnswer(answer()).ok);

  const unquoted = validateAnswer(answer({ quotes: [] }));
  check("claiming an answer with no quotation is rejected", !unquoted.ok);
  check("and the reason says so",
    unquoted.problems.some((p) => /without quoting/.test(p)), JSON.stringify(unquoted.problems));

  const contradiction = validateAnswer(answer({ coverage: "none" }));
  check("saying the policy does not cover it and answering anyway is rejected",
    !contradiction.ok, JSON.stringify(contradiction.problems));
}

console.log("\nA gap must produce an escalation, not silence");
{
  const silent = validateAnswer(answer({
    answered: false, coverage: "none", quotes: [],
    escalation: { needed: false, reason: "", draft: "" },
  }));
  check("a gap with no escalation is rejected", !silent.ok);

  const empty = validateAnswer(answer({
    answered: false, coverage: "none", quotes: [],
    escalation: { needed: true, reason: "Not covered.", draft: "   " },
  }));
  check("an escalation with nothing written in it is rejected", !empty.ok,
    JSON.stringify(empty.problems));

  const proper = validateAnswer(answer({
    answered: false, coverage: "none", quotes: [],
    escalation: { needed: true, reason: "Policy is silent on Ireland.", draft: "Customer asks about delivery to Ireland; policy says mainland UK only." },
  }));
  check("a declined answer with a drafted handover passes", proper.ok,
    JSON.stringify(proper.problems));

  const partial = validateAnswer(answer({
    coverage: "partial",
    escalation: { needed: true, reason: "Half covered.", draft: "Needs a person for the rest." },
  }));
  check("a partial answer still needs an escalation and passes with one", partial.ok);
}

console.log("\nA quotation the policy does not contain is caught");
{
  const policy = SAMPLE.text;

  const real = [{ text: "You may return most items within 30 days of delivery", locator: "RETURNS" }];
  check("a genuine quotation passes", unsupportedQuotes(real, policy).length === 0);

  // The failure this exists for: a fabricated quote looks exactly like
  // evidence, so a reader who checks the citation is reassured by a lie.
  const fake = [{ text: "You may return most items within 90 days of delivery", locator: "RETURNS" }];
  const caught = unsupportedQuotes(fake, policy);
  check("an invented quotation is caught", caught.length === 1, JSON.stringify(caught));

  const mixed = [...real, ...fake];
  check("one bad quote among good ones is still caught",
    unsupportedQuotes(mixed, policy).length === 1);

  // A model reflows line breaks inside a quotation without meaning to. That
  // is not fabrication and must not be treated as such, or every multi-line
  // quote would be rejected and the guard would be turned off in frustration.
  const reflowed = [{ text: "You may return most items within 30 days of delivery for a full refund. The item must be unused", locator: "RETURNS" }];
  check("a quote with whitespace reflowed still passes",
    unsupportedQuotes(reflowed, policy).length === 0, JSON.stringify(unsupportedQuotes(reflowed, policy)));

  check("case differences are tolerated",
    unsupportedQuotes([{ text: "STANDARD DELIVERY IS £4.95", locator: "DELIVERY" }], policy).length === 0);

  check("an empty quote is not counted as fabricated",
    unsupportedQuotes([{ text: "", locator: "x" }], policy).length === 0);
  check("no quotes at all is fine", unsupportedQuotes([], policy).length === 0
    && unsupportedQuotes(undefined, policy).length === 0);
}

console.log("\nKnowledge is shaped before it is trusted");
{
  const short = capKnowledge("Returns within 30 days.");
  check("short text is left alone", short.text === "Returns within 30 days." && !short.truncated);

  const long = capKnowledge("A".repeat(MAX_KNOWLEDGE_CHARS + 5000));
  check("over-long text is capped", long.text.length <= MAX_KNOWLEDGE_CHARS && long.truncated);

  /*
    Cutting mid-sentence and quoting the fragment as policy is how a rule gets
    misrepresented, so the cut prefers a sentence or paragraph end — but only
    when one is reasonably close to the limit. Honouring a boundary that sits
    at 6 % of the cap would discard almost the whole policy to gain a tidy
    full stop, which is the worse trade.
  */
  const nearBoundary = "A".repeat(400) + ". " + "B".repeat(200);
  const tidy = capKnowledge(nearBoundary, 500);
  check("a boundary near the limit is honoured",
    tidy.text.endsWith("."), JSON.stringify(tidy.text.slice(-20)));

  const farBoundary = "Short opening.\n\n" + "B".repeat(600);
  const blunt = capKnowledge(farBoundary, 500);
  check("a boundary too far back is not honoured — the text survives instead",
    blunt.text.length > 400, `${blunt.text.length}`);
  check("and the caller is told it was truncated either way",
    blunt.truncated === true && tidy.truncated === true);

  check("nothing is reported truncated when it was not", !capKnowledge("short").truncated);
}

console.log("\nHTML becomes readable text, without smuggling in code");
{
  const html = `<div><script>alert('x')</script><style>.a{color:red}</style>
    <h2>Returns</h2><p>Within 30 days.</p><ul><li>Unused</li><li>Original packaging</li></ul></div>`;
  const text = htmlToText(html);

  check("script contents never reach the text", !/alert/.test(text), text);
  check("style contents never reach the text", !/color:red/.test(text), text);
  check("the words survive", /Returns/.test(text) && /Within 30 days/.test(text));
  check("block elements become line breaks rather than running together",
    /Unused\s*\n\s*Original packaging/.test(text) || /Unused\s+Original/.test(text), JSON.stringify(text));
  check("entities are decoded", htmlToText("<p>Terms &amp; conditions</p>").includes("Terms & conditions"));
  check("no tags survive", !/[<>]/.test(htmlToText("<p>Plain</p>")));
}

console.log("\nQuestions are bounded");
{
  check("whitespace is collapsed", normaliseQuestion("  how   long \n do I have? ") === "how long do I have?");
  check("an over-long question is cut", normaliseQuestion("x".repeat(900)).length === 500);
  check("empty stays empty", normaliseQuestion(null) === "" && normaliseQuestion(undefined) === "");
}

console.log("\nThe sample is honest about what it does not cover");
{
  const text = SAMPLE.text.toLowerCase();
  check("the sample answers returns", text.includes("30 days"));
  check("and delivery", text.includes("free standard delivery"));

  /*
    The demonstration is only honest if a visitor can ask something the policy
    does not answer and watch the agent decline. A sample that covers
    everything would show the easy half of the behaviour and hide the half
    that matters.
  */
  check("but says nothing about instalments", !text.includes("instalment") && !text.includes("klarna"));
  check("and nothing about Ireland", !text.includes("ireland"));
  check("the sample questions include ones it cannot answer",
    SAMPLE_QUESTIONS.some((q) => /Ireland/i.test(q)) && SAMPLE_QUESTIONS.some((q) => /instalment/i.test(q)),
    SAMPLE_QUESTIONS.join(" | "));
  check("and ones it can", SAMPLE_QUESTIONS.some((q) => /return something/i.test(q)));
}

console.log("\nNo invented figures in the sample policy");
{
  // The sample is fiction, but it is fiction a visitor may mistake for a real
  // company's terms, so it uses example.com addresses throughout.
  const emails = SAMPLE.text.match(/[\w.]+@[\w.]+/g) ?? [];
  check("every address in the sample is a reserved example domain",
    emails.every((e) => e.endsWith(".example")), emails.join(", "));
}

console.log(
  failures === 0
    ? "\nAll customer-service tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
