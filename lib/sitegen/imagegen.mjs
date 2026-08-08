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

  ── which model, and why this one ──

  Four were measured on the same prompt through the same account, and — this
  is the part that decided it — the output of each was looked at rather than
  compared on a spreadsheet:

    google/gemini-3-pro-image      23.6s   $0.140   native 16:9
    google/gemini-2.5-flash-image  14.0s   $0.039   letterboxed
    openai/gpt-5-image             55.2s   $0.197   near-black, no subject
    openai/gpt-5.4-image-2        140.3s   $0.227   excellent, but square

  Gemini 3 Pro wins on every axis that matters here. Its pictures stand with
  GPT Image 2's — a baker's hands in flour, proving baskets, lantern light,
  steam in the beam — it is six times faster, and it costs a third less.

  The deciding detail is aspect. The prompt asks for wide 16:9 because these
  are full-bleed backgrounds behind text. Gemini 3 Pro honours it; GPT Image 2
  ignored it and returned a square, which the renderer then has to crop. And
  Flash, the cheapest, bakes black letterbox bars into a square canvas — which
  is not a cheaper picture, it is a broken one.

  Speed is not a luxury on this endpoint. At 23.6s a build finishes in about
  ninety seconds instead of three and a half minutes, which is the difference
  between demonstrating this in front of someone and apologising to them.

  IMAGE_MODEL overrides it without a deploy.
*/

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Measured best for full-bleed scene backgrounds. Override with IMAGE_MODEL. */
export const DEFAULT_IMAGE_MODEL = "google/gemini-3-pro-image";
const MODEL = () => process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

export const imageGenAvailable = () => Boolean(process.env.OPENROUTER_API_KEY);

/**
 * Turns the design into a shot instruction.
 *
 * Built from the spec rather than the visitor's brief, so the image belongs
 * to the world the studio just designed — its palette, its opening beat —
 * instead of being a second, unrelated interpretation of the same business.
 */
export function heroPrompt(spec, index = 0) {
  const opening = spec.chapters?.[index];
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
export async function generateHero(spec, { signal, timeoutMs = 90_000, log = console, index = 0 } = {}) {
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
        messages: [{ role: "user", content: heroPrompt(spec, index) }],
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

/*
  The scenes behind the chapters.

  The renderer has always been able to put a photograph behind a chapter, and
  has always refused to with fewer than three — below that there is not enough
  material for it to look deliberate rather than accidental:

    const sceneable = photos.length >= 3 ? photos : [];

  We were generating exactly one. So `sceneable` was always empty, every
  chapter fell through to a CSS gradient, and the "one unbroken cinematic
  shot" was a photograph followed by five panels of coloured haze. The hero
  looked expensive and nothing after it did.

  So: generate several, one per chapter, and generate them ALL AT ONCE. They
  are independent HTTP calls, so the wall clock is the slowest single image
  rather than the sum — the same trick that let the hero run alongside the
  translation. Sequential would be count x 140s and could never fit.

  Cost is the honest constraint, not time: each image is about $0.23 on GPT
  Image 2, so this multiplies the cost of a build. SCENE_COUNT sets how many,
  defaulting to the renderer's own threshold of three — enough to switch
  chapter imagery on, cycled by the renderer across however many chapters
  there are. Raise it for one image per chapter; set it to 1 for hero-only.
*/
export const sceneCount = () => {
  const n = Number.parseInt(process.env.SCENE_COUNT ?? "3", 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : 3;
};

export async function generateScenes(spec, { signal, timeoutMs = 170_000, log = console } = {}) {
  if (!imageGenAvailable()) return [];

  const want = Math.min(sceneCount(), spec.chapters?.length || 1);
  const started = Date.now();

  /* allSettled, not all: one refused or slow scene must not lose the others,
     and a build with four of five scenes is still a film. */
  const results = await Promise.allSettled(
    Array.from({ length: want }, (_, i) =>
      generateHero(spec, { signal, timeoutMs, log, index: i })),
  );

  const images = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean);

  log.info?.(
    `[imagegen] ${images.length}/${want} scenes in ${((Date.now() - started) / 1000).toFixed(1)}s` +
    ` — $${images.reduce((sum, im) => sum + (im.cost ?? 0), 0).toFixed(3)}`,
  );
  return images;
}
