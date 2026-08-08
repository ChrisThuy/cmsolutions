/*
  One generated hero image, for a site that has no photographs of its own.

  ── when this runs, and when it must not ──

  Only when the client gave us nothing to work with. If they pointed at their
  own website and it yielded pictures, those win every time: their actual
  room, their actual light, their actual work. A generated approximation of a
  barbershop is never better than a photograph of the barbershop.

  So this is the fallback, not the default — and it produces exactly one
  image, behind the hero, because that is the screen that decides whether
  anyone scrolls. Six generated scenes cost eight times as much and start to
  look like what they are.

  ── which model, and the tradeoff that was made deliberately ──

  This ran on Gemini 2.5 Flash Image, chosen on a measurement: on the same
  prompt through the same account it returned in 8.2s for $0.039, against
  57.1s for $0.043 on OpenAI's gpt-5-image-mini. Seven times faster for the
  same money.

  It now runs on GPT Image 2 (openai/gpt-5.4-image-2), because the hero is
  the screen that decides whether anyone scrolls and picture quality was
  judged worth the wait. That is a real trade, not a free upgrade: expect
  roughly a minute rather than eight seconds, and a higher per-image price.

  Two consequences are handled below rather than left to be discovered:

    - The timeout was 45s, which is under the measured OpenAI latency. Left
      alone, every generation would have been killed just before returning.
      It is now caller-supplied and defaults high enough to be useful.
    - The generator is env-overridable. If a build starts running close to
      its ceiling, or the price stops being worth it, set IMAGE_MODEL back
      to google/gemini-2.5-flash-image without a code change or a deploy.
*/

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** OpenAI's current best image generator. Override with IMAGE_MODEL. */
export const DEFAULT_IMAGE_MODEL = "openai/gpt-5.4-image-2";
const MODEL = () => process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

export const imageGenAvailable = () => Boolean(process.env.OPENROUTER_API_KEY);

/**
 * Turns the design into a shot instruction.
 *
 * Built from the spec rather than the visitor's brief, so the image belongs
 * to the world the studio just designed — its palette, its opening beat —
 * instead of being a second, unrelated interpretation of the same business.
 */
export function heroPrompt(spec) {
  const opening = spec.chapters?.[0];
  return [
    opening?.visual || spec.journey,
    `The mood of "${spec.conceptName}".`,
    `Colour palette around ${spec.palette.bg}, ${spec.palette.accent} and ${spec.palette.accent2}.`,
    "Cinematic still, wide 16:9, shallow depth of field, natural light.",
    // Text in a generated image is the single most common way one of these
    // reads as fake, and a hero with garbled lettering is worse than none.
    "No text, no lettering, no signage, no logos, no watermark, no people looking at camera.",
  ].filter(Boolean).join(" ");
}

/**
 * Generates the hero image and returns it as base64.
 *
 * Returns null rather than throwing on any failure. A site that renders
 * without its generated hero is a good site with a gradient; a build that
 * fails because an image model was busy is nothing at all.
 */
export async function generateHero(spec, { signal, timeoutMs = 90_000, log = console } = {}) {
  if (!imageGenAvailable()) return null;

  const deadline = AbortSignal.timeout(timeoutMs);
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://cmsolutions.tech",
        "X-Title": "CM Solutions website builder",
      },
      body: JSON.stringify({
        model: MODEL(),
        messages: [{ role: "user", content: heroPrompt(spec) }],
        modalities: ["image", "text"],
      }),
      signal: stop,
    });

    if (!response.ok) {
      log.warn?.(`[imagegen] ${response.status} — building without a generated hero`);
      return null;
    }

    const payload = await response.json();
    const url = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (typeof url !== "string" || !url.startsWith("data:")) {
      log.warn?.("[imagegen] no image in the response");
      return null;
    }

    const [head, data] = url.split(",", 2);
    const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/png";
    if (!data) return null;

    return { data, mime, cost: payload.usage?.cost ?? null, model: MODEL() };
  } catch (cause) {
    log.warn?.(`[imagegen] failed: ${cause?.message} — building without a generated hero`);
    return null;
  }
}
