/*
  Image and video generation, behind one interface.

  ── why an adapter and not a direct integration ──

  Model quality in this space leapfrogs every few months. The expensive
  mistake is threading one vendor's request shape through the codebase, so
  everything above this file speaks in generateImage/generateVideo and the
  vendor lives in one place. Swapping provider should be a config change and a
  new case in this file, not a refactor.

  fal is the implementation because the business sells credits, and you cannot
  price a credit against unpredictable cost. fal bills per image and per
  video-second; per-GPU-second billing varies with queue conditions and warm-up
  and cannot be turned into a fixed unit price safely.

  ── on failures ──

  Generation jobs fail server-side at a few percent with no stated reason.
  Retries here are deliberate about which failures are worth retrying: a 5xx
  or a timeout is transient, a 4xx is a bad request that will fail identically
  forever and retrying it just burns time. Nothing is charged for a failure —
  see lib/media/credits.mjs; the debit is reversed by the caller on error.
*/

const FAL_QUEUE = "https://queue.fal.run";

/*
  Model ids, per job.

  Named by what they are for rather than by vendor, so the caller never has to
  know which model is behind "cheap video". Reviewed on a date for the same
  reason the methane and maritime limits are: these move, and a stale model id
  becomes a 404 at generation time.
*/
export const MODELS_REVIEWED = "2026-08-06";

export const MODELS = {
  imageDraft: "fal-ai/flux/schnell",
  imageFinal: "fal-ai/flux-pro/v1.1",
  videoCheap: "fal-ai/wan-25/image-to-video",
  /*
    The scroll-film chain needs a model that accepts BOTH a start frame and an
    end frame, because each clip begins on the previous clip's last frame.
    Without that the joins are cuts, and a dissolve over a cut is exactly what
    the whole technique exists to avoid.
  */
  videoChain: "fal-ai/kling-video/o1/standard/image-to-video",
};

export class ProviderError extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
    this.status = status;
  }
}

/** Which failures are worth trying again. */
export function isRetryable(status) {
  // 408 timeout, 409 conflict, 425 too early, 429 rate limited, and anything 5xx.
  return status === null || status === 408 || status === 409 || status === 425 ||
         status === 429 || (status >= 500 && status < 600);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries with exponential backoff and jitter.
 *
 * Jitter matters: without it, a batch of posts that all fail on the same rate
 * limit retries in lockstep and hits the same limit again together.
 */
export async function withRetry(fn, { attempts = 3, baseMs = 800, onRetry } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (cause) {
      last = cause;
      const retryable = cause instanceof ProviderError ? cause.retryable : true;
      if (!retryable || attempt === attempts) break;
      const wait = baseMs * 2 ** (attempt - 1) * (0.7 + Math.random() * 0.6);
      onRetry?.(attempt, cause, Math.round(wait));
      await sleep(wait);
    }
  }
  throw last;
}

/* ── fal ───────────────────────────────────────────────────────────────── */

function falHeaders(key) {
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

async function falRequest(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderError(
        `fal returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        { retryable: isRetryable(res.status), status: res.status },
      );
    }
    return await res.json();
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    const aborted = cause?.name === "AbortError";
    throw new ProviderError(aborted ? "fal timed out" : `fal request failed: ${cause?.message}`,
      { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Submits to fal's queue and waits for the result.
 *
 * The queue API is submit / poll / fetch rather than one blocking call,
 * because video takes minutes and no sane request holds a socket open for it.
 */
async function falRun(model, input, { key, pollMs = 2500, maxWaitMs = 240_000, log }) {
  const submitted = await falRequest(`${FAL_QUEUE}/${model}`, {
    method: "POST", headers: falHeaders(key), body: JSON.stringify(input),
  }, 30_000);

  const id = submitted?.request_id;
  if (!id) throw new ProviderError("fal accepted the job but returned no request_id", { retryable: true });

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const status = await falRequest(
      `${FAL_QUEUE}/${model}/requests/${id}/status`,
      { headers: falHeaders(key) }, 20_000);

    if (status?.status === "COMPLETED") {
      return await falRequest(`${FAL_QUEUE}/${model}/requests/${id}`,
        { headers: falHeaders(key) }, 30_000);
    }
    if (status?.status === "FAILED") {
      // Server-side failure with no reason is the documented few-percent case.
      throw new ProviderError("fal reported the job failed", { retryable: true });
    }
    log?.(status?.status ?? "IN_QUEUE");
  }
  throw new ProviderError(`fal did not finish within ${Math.round(maxWaitMs / 1000)}s`, { retryable: false });
}

/* ── the interface everything above this file uses ─────────────────────── */

function keyOrNull() {
  return process.env.FAL_KEY || null;
}

/** Whether generation is available at all. Callers refuse cleanly when not. */
export function mediaAvailable() {
  return Boolean(keyOrNull());
}

/**
 * One image.
 *
 * @param {object} o
 *   prompt   what to draw
 *   tier     "draft" | "final"
 *   size     a fal image_size preset
 */
export async function generateImage({ prompt, tier = "draft", size = "square_hd", log } = {}) {
  const key = keyOrNull();
  if (!key) throw new ProviderError("No generation engine is configured.", { retryable: false });
  if (!prompt?.trim()) throw new ProviderError("An image needs a prompt.", { retryable: false });

  const model = tier === "final" ? MODELS.imageFinal : MODELS.imageDraft;
  const out = await withRetry(
    () => falRun(model, { prompt, image_size: size, num_images: 1 }, { key, log }),
    { onRetry: (n, e, ms) => log?.(`image retry ${n} in ${ms}ms — ${e.message}`) },
  );

  const url = out?.images?.[0]?.url ?? out?.image?.url ?? null;
  if (!url) throw new ProviderError("fal completed but returned no image", { retryable: true });
  return { url, model, tier };
}

/**
 * One video clip.
 *
 * startImage is what makes a chain possible: each clip begins on the previous
 * clip's last frame, so the joins are not cuts. endImage pins the other end
 * when the chain needs to arrive somewhere exact.
 */
export async function generateVideo({
  prompt, startImage, endImage = null, seconds = 5, tier = "cheap", log,
} = {}) {
  const key = keyOrNull();
  if (!key) throw new ProviderError("No generation engine is configured.", { retryable: false });
  if (!prompt?.trim()) throw new ProviderError("A clip needs a prompt.", { retryable: false });
  if (!startImage) throw new ProviderError("A clip needs a start frame to chain from.", { retryable: false });

  const chaining = tier === "chain" || Boolean(endImage);
  const model = chaining ? MODELS.videoChain : MODELS.videoCheap;

  const input = {
    prompt,
    image_url: startImage,
    duration: String(seconds),
    // Audio roughly triples the bill and none of these clips use it.
    generate_audio: false,
  };
  if (endImage) input.image_tail = endImage;

  const out = await withRetry(
    () => falRun(model, input, { key, maxWaitMs: 420_000, log }),
    { onRetry: (n, e, ms) => log?.(`video retry ${n} in ${ms}ms — ${e.message}`) },
  );

  const url = out?.video?.url ?? out?.videos?.[0]?.url ?? null;
  if (!url) throw new ProviderError("fal completed but returned no video", { retryable: true });
  return { url, model, seconds, tier };
}
