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
const FAL_SYNC = "https://fal.run";

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
 * Synchronous call. Used for images.
 *
 * An image comes back in well under a second, so queueing it and polling adds
 * latency and two more failure points for nothing.
 */
async function falSync(model, input, { key }) {
  return falRequest(`${FAL_SYNC}/${model}`, {
    method: "POST", headers: falHeaders(key), body: JSON.stringify(input),
  }, 120_000);
}

/**
 * Queued call. Used for video, which takes minutes and cannot hold a socket.
 *
 * The poll and result URLs are taken from the submit response rather than
 * built here. That is not defensiveness, it is a bug fix: fal's polling path
 * drops the model's sub-path — a job submitted to "fal-ai/flux/schnell" is
 * polled at ".../fal-ai/flux/requests/{id}", not ".../fal-ai/flux/schnell/
 * requests/{id}". Constructing it by hand returned 405 on every poll. The
 * server says where to look; take it at its word.
 */
async function falQueued(model, input, { key, pollMs = 2500, maxWaitMs = 240_000, log }) {
  const submitted = await falRequest(`${FAL_QUEUE}/${model}`, {
    method: "POST", headers: falHeaders(key), body: JSON.stringify(input),
  }, 30_000);

  const id = submitted?.request_id;
  const statusUrl = submitted?.status_url;
  const resultUrl = submitted?.response_url;
  if (!id || !statusUrl || !resultUrl) {
    throw new ProviderError("fal accepted the job but did not say where to collect it", { retryable: true });
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const status = await falRequest(statusUrl, { headers: falHeaders(key) }, 20_000);

    if (status?.status === "COMPLETED") {
      return await falRequest(resultUrl, { headers: falHeaders(key) }, 30_000);
    }
    if (status?.status === "FAILED") {
      // Server-side failure with no reason is the documented few-percent case.
      throw new ProviderError("fal reported the job failed", { retryable: true });
    }
    log?.(status?.status ?? "IN_QUEUE");
  }
  throw new ProviderError(`fal did not finish within ${Math.round(maxWaitMs / 1000)}s`, { retryable: false });
}

/**
 * The input body for a video model.
 *
 * Extracted so the shape is testable without calling fal, because getting it
 * wrong is silent: fal accepts unknown keys and drops them. The chain model
 * takes start_image_url and end_image_url; sending image_url to it produced a
 * clip generated from nothing, with the continuity the whole technique
 * depends on quietly absent and no error anywhere.
 */
export function buildVideoInput({ chaining, prompt, startImage, endImage, seconds, resolution }) {
  if (chaining) {
    return {
      prompt,
      start_image_url: startImage,
      ...(endImage ? { end_image_url: endImage } : {}),
      duration: String(seconds),
    };
  }
  return {
    prompt,
    image_url: startImage,
    duration: String(seconds),
    /* Draft cheap, master once. Left unset this returned 1440x1440 — full
       price to validate a storyboard that may be thrown away. */
    resolution,
  };
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
    () => falSync(model, { prompt, image_size: size, num_images: 1 }, { key }),
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
  prompt, startImage, endImage = null, seconds = 5, tier = "cheap",
  resolution = "480p", log,
} = {}) {
  const key = keyOrNull();
  if (!key) throw new ProviderError("No generation engine is configured.", { retryable: false });
  if (!prompt?.trim()) throw new ProviderError("A clip needs a prompt.", { retryable: false });
  if (!startImage) throw new ProviderError("A clip needs a start frame to chain from.", { retryable: false });

  const chaining = tier === "chain" || Boolean(endImage);
  const model = chaining ? MODELS.videoChain : MODELS.videoCheap;

  /*
    Each fal model has its own input schema. Assuming one shape across them
    was a real bug and a quiet one: the chain model takes start_image_url and
    end_image_url, and the code was sending image_url and image_tail. fal
    accepts unknown keys and drops them, so the frames would simply have been
    ignored — a "chained" clip generated from nothing, with the continuity the
    whole cinematic technique depends on silently absent.

    Nothing here is sent unless the model's schema actually declares it. Same
    reason generate_audio is gone: wan-25 has no such parameter, so passing it
    did nothing except look like cost control.
  */
  const input = buildVideoInput({ chaining, prompt, startImage, endImage, seconds, resolution });

  const out = await withRetry(
    () => falQueued(model, input, { key, maxWaitMs: 420_000, log }),
    { onRetry: (n, e, ms) => log?.(`video retry ${n} in ${ms}ms — ${e.message}`) },
  );

  const url = out?.video?.url ?? out?.videos?.[0]?.url ?? null;
  if (!url) throw new ProviderError("fal completed but returned no video", { retryable: true });
  return { url, model, seconds, tier };
}
