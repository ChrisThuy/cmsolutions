/*
  Tests the generation adapter and the credits ledger.

    node scripts/test-media.mjs

  The ledger gets most of the attention because it is arithmetic about money.
  The rule it exists to enforce is that nobody is charged for a failure: the
  debit happens before generation, so a concurrent request cannot spend the
  same balance twice, and it is reversed the moment generation fails.

  The provider is tested for the decisions rather than the network — which
  failures are retried, which are not, and that a missing key refuses cleanly
  instead of throwing something unreadable. There is no FAL_KEY here and these
  tests never call fal.
*/

import {
  MODELS, MODELS_REVIEWED, ProviderError, buildVideoInput, generateImage,
  generateVideo, isRetryable, mediaAvailable, withRetry,
} from "../lib/media/provider.mjs";
import {
  PRICES, PRICES_REVIEWED, alreadyRefunded, balanceOf, canAfford, debitEntry,
  grantEntry, priceList, priceOf, quote, refundEntry,
} from "../lib/media/credits.mjs";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function throwsWith(fn, match) {
  try { await fn(); return false; } catch (e) { return match.test(e.message); }
}

console.log("\nPrices are explicit, and per-second work is rounded up");
{
  check("a draft image is priced", priceOf("image.draft") === 1);
  check("a final image costs more", priceOf("image.final") > priceOf("image.draft"));
  check("video scales with duration",
    priceOf("video.cheap", { seconds: 5 }) === 5 * PRICES["video.cheap"].creditsPerSecond);

  // A 5.5-second clip is charged as six seconds, never as five. Rounding
  // down would mean paying the provider for time nobody was billed for.
  check("a fractional second rounds up",
    priceOf("video.cheap", { seconds: 5.5 }) === Math.ceil(5.5 * 3),
    `${priceOf("video.cheap", { seconds: 5.5 })}`);

  check("chained cinematic costs more than cheap video",
    priceOf("video.chain", { seconds: 5 }) > priceOf("video.cheap", { seconds: 5 }));

  check("a per-second operation with no duration is an error",
    await throwsWith(() => priceOf("video.cheap"), /needs a duration/));
  check("a zero duration is an error",
    await throwsWith(() => priceOf("video.cheap", { seconds: 0 }), /needs a duration/));
  check("an unpriced operation is an error, not a free one",
    await throwsWith(() => priceOf("image.magic"), /No price/));

  check("every price has a label", priceList().every((p) => p.label));
  check("the price table is dated", /^\d{4}-\d{2}-\d{2}$/.test(PRICES_REVIEWED));
}

console.log("\nWhat is quoted is what is charged");
{
  const q = quote("video.chain", { seconds: 4 });
  check("a quote carries the same number as the price",
    q.credits === priceOf("video.chain", { seconds: 4 }), `${q.credits}`);
  check("a quote names the operation and its label", q.operation === "video.chain" && !!q.label);
  check("an unknown operation quotes null", quote("nope") === null);
}

console.log("\nAffordability is checked before anything is spent");
{
  const rich = canAfford(100, "video.cheap", { seconds: 5 });
  check("a sufficient balance can afford it", rich.ok && rich.short === 0);

  const poor = canAfford(4, "video.cheap", { seconds: 5 });
  check("an insufficient balance cannot", !poor.ok);
  check("and it says how far short", poor.short === poor.cost - 4, `${poor.short}`);

  check("exactly enough is enough", canAfford(15, "video.cheap", { seconds: 5 }).ok);
  check("one short is not", !canAfford(14, "video.cheap", { seconds: 5 }).ok);
  check("a nonsense balance is treated as zero", !canAfford("lots", "image.draft").ok);
  check("a negative balance cannot afford anything", !canAfford(-5, "image.draft").ok);
}

console.log("\nThe balance is the sum of its entries, never a stored number");
{
  const entries = [grantEntry({ credits: 50, reason: "Welcome" })];
  check("a grant raises the balance", balanceOf(entries) === 50);

  const debit = debitEntry({ operation: "video.cheap", seconds: 5, reference: "job-1" });
  entries.push(debit);
  check("a debit is negative", debit.credits < 0, `${debit.credits}`);
  check("and lowers the balance", balanceOf(entries) === 50 - 15, `${balanceOf(entries)}`);

  entries.push(refundEntry({ debit, reason: "the engine failed" }));
  check("a refund restores it exactly", balanceOf(entries) === 50, `${balanceOf(entries)}`);

  check("an empty ledger is zero", balanceOf([]) === 0 && balanceOf(undefined) === 0);
  check("a corrupt entry does not poison the sum",
    balanceOf([{ credits: "x" }, { credits: 5 }]) === 5);
}

console.log("\nNobody is charged for a failure, and nobody is refunded twice");
{
  const debit = debitEntry({ operation: "video.chain", seconds: 6, reference: "job-7" });
  const entries = [grantEntry({ credits: 200, reason: "Top-up" }), debit];
  const before = balanceOf(entries);

  entries.push(refundEntry({ debit, reason: "fal reported the job failed" }));
  check("the refund returns the whole debit",
    balanceOf(entries) === before + Math.abs(debit.credits));

  // A retry that refunds twice hands out free credits.
  check("a second refund is detected as already done",
    alreadyRefunded(entries, "job-7"));
  check("an unrelated job is not treated as refunded",
    !alreadyRefunded(entries, "job-8"));

  check("a refund needs the debit it reverses",
    await throwsWith(() => refundEntry({ debit: null, reason: "x" }), /needs the debit/));
  check("a refund cannot be built from a grant",
    await throwsWith(() => refundEntry({ debit: grantEntry({ credits: 5, reason: "x" }), reason: "y" }),
      /needs the debit/));

  check("a grant must be a positive whole number",
    await throwsWith(() => grantEntry({ credits: -5, reason: "x" }), /positive whole/) &&
    await throwsWith(() => grantEntry({ credits: 1.5, reason: "x" }), /positive whole/));
}

console.log("\nThe debit ties to its refund by reference");
{
  const a = debitEntry({ operation: "image.final", reference: "a" });
  const b = debitEntry({ operation: "image.final", reference: "b" });
  const entries = [grantEntry({ credits: 20, reason: "x" }), a, b, refundEntry({ debit: a, reason: "failed" })];
  check("only the failed job is refunded",
    balanceOf(entries) === 20 - 4 - 4 + 4, `${balanceOf(entries)}`);
  check("the other job stays charged", !alreadyRefunded(entries, "b"));
}

console.log("\nOnly transient failures are retried");
{
  check("a 500 is retried", isRetryable(500));
  check("a 503 is retried", isRetryable(503));
  check("a 429 is retried", isRetryable(429));
  check("a 408 timeout is retried", isRetryable(408));
  check("a network failure with no status is retried", isRetryable(null));

  // A 400 will fail identically forever; retrying it just burns time and,
  // worse, looks like a slow success to whoever is waiting.
  check("a 400 is not retried", !isRetryable(400));
  check("a 401 is not retried", !isRetryable(401));
  check("a 404 is not retried", !isRetryable(404));
  check("a 422 is not retried", !isRetryable(422));
}

console.log("\nRetry backs off, gives up, and does not retry what it should not");
{
  let calls = 0;
  const eventual = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new ProviderError("flaky", { retryable: true });
    return "ok";
  }, { baseMs: 1 });
  check("it succeeds once the transient failure clears", eventual === "ok" && calls === 3, `${calls}`);

  calls = 0;
  let threw = false;
  try {
    await withRetry(async () => { calls++; throw new ProviderError("bad request", { retryable: false }); },
      { baseMs: 1 });
  } catch { threw = true; }
  check("a non-retryable failure is attempted exactly once", threw && calls === 1, `${calls}`);

  calls = 0;
  threw = false;
  try {
    await withRetry(async () => { calls++; throw new ProviderError("always", { retryable: true }); },
      { attempts: 3, baseMs: 1 });
  } catch { threw = true; }
  check("it gives up after the attempt limit", threw && calls === 3, `${calls}`);

  // Without jitter a batch that fails on one rate limit retries in lockstep
  // and hits the same limit together.
  const waits = [];
  await withRetry(async (n) => { if (n < 3) throw new ProviderError("x", { retryable: true }); return 1; },
    { baseMs: 100, onRetry: (_n, _e, ms) => waits.push(ms) });
  check("backoff grows between attempts", waits.length === 2 && waits[1] > waits[0], JSON.stringify(waits));
}

console.log("\nEach model gets the input shape it actually declares");
{
  /*
    fal accepts unknown keys and drops them, so a wrong parameter name fails
    silently. The chain model takes start_image_url; it was being sent
    image_url, which meant a "chained" clip was generated from nothing and the
    continuity the cinematic tier depends on was absent with no error. Only a
    live call surfaced it, so it is pinned here.
  */
  const chain = buildVideoInput({
    chaining: true, prompt: "drift left", startImage: "https://x/a.jpg",
    endImage: "https://x/b.jpg", seconds: 5, resolution: "480p",
  });
  check("the chain model gets start_image_url", chain.start_image_url === "https://x/a.jpg");
  check("and end_image_url", chain.end_image_url === "https://x/b.jpg");
  check("and never image_url, which it would silently ignore",
    chain.image_url === undefined, JSON.stringify(chain));
  check("nor image_tail", chain.image_tail === undefined);

  const noEnd = buildVideoInput({ chaining: true, prompt: "p", startImage: "https://x/a.jpg", seconds: 5 });
  check("no end frame means the key is absent rather than null",
    !("end_image_url" in noEnd), JSON.stringify(noEnd));

  const cheap = buildVideoInput({
    chaining: false, prompt: "p", startImage: "https://x/a.jpg", seconds: 5, resolution: "480p",
  });
  check("the cheap model gets image_url", cheap.image_url === "https://x/a.jpg");
  check("and never start_image_url", cheap.start_image_url === undefined);
  check("resolution is sent, or it defaults to full price",
    cheap.resolution === "480p", JSON.stringify(cheap));

  // wan-25 has no generate_audio parameter; passing it did nothing except
  // look like cost control.
  check("no invented parameters are sent",
    !("generate_audio" in cheap) && !("generate_audio" in chain));

  check("duration is a string, as both schemas declare",
    typeof cheap.duration === "string" && typeof chain.duration === "string");
}

console.log("\nWith no engine configured, it refuses cleanly");
{
  check("availability reports false without a key", process.env.FAL_KEY ? true : !mediaAvailable());

  if (!process.env.FAL_KEY) {
    check("an image request refuses with a readable reason",
      await throwsWith(() => generateImage({ prompt: "a bottle" }), /No generation engine/));
    check("a video request refuses with a readable reason",
      await throwsWith(() => generateVideo({ prompt: "a bottle", startImage: "https://x/y.png" }),
        /No generation engine/));
  } else {
    console.log("  SKIP  refusal tests — FAL_KEY is set in this environment");
  }
}

console.log("\nBad input is refused before anything is spent");
{
  // These must fail on validation, not on a network call, so they cost nothing.
  process.env.FAL_KEY = process.env.FAL_KEY || "test-key-not-used";
  check("an image with no prompt is refused",
    await throwsWith(() => generateImage({ prompt: "  " }), /needs a prompt/));
  check("a clip with no prompt is refused",
    await throwsWith(() => generateVideo({ prompt: "", startImage: "https://x/y.png" }), /needs a prompt/));
  check("a clip with no start frame is refused",
    await throwsWith(() => generateVideo({ prompt: "a bottle" }), /needs a start frame/));
  if (process.env.FAL_KEY === "test-key-not-used") delete process.env.FAL_KEY;
}

console.log("\nThe model table is complete and dated");
{
  check("there is a model for every job",
    MODELS.imageDraft && MODELS.imageFinal && MODELS.videoCheap && MODELS.videoChain);
  check("the chain model is a first-frame/last-frame one",
    /o1|first-last|kling/.test(MODELS.videoChain), MODELS.videoChain);
  check("the table is dated, because model ids go stale into 404s",
    /^\d{4}-\d{2}-\d{2}$/.test(MODELS_REVIEWED));
}

console.log(
  failures === 0 ? "\nAll media and credits tests passed.\n" : `\n${failures} test(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
