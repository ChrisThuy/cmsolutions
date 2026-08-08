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
/**
 * The shot instruction for one frame.
 *
 * `index` null means the hero, and the hero is deliberately not chapter one.
 * Given the same subject it returns near enough the same picture, and the
 * hero sitting directly above chapter one made that repetition the first
 * thing anybody saw. The hero is the whole journey in a single frame; each
 * chapter is its own beat.
 */
export function heroPrompt(spec, index = null) {
  const subject = index === null
    ? spec.journey
    : (spec.chapters?.[index]?.visual || spec.journey);
  return [
    subject,
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
export async function generateHero(spec, { signal, timeoutMs = 90_000, log = console, index = null } = {}) {
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
/*
  How many frames, and why the default is "all of them".

  It was three — the renderer's minimum for showing chapter imagery at all —
  and the renderer then cycled those three across five or six chapters. Two
  beats of the film shared a picture with two others, which reads as a
  template rather than a shot list, and the whole point of a scroll-film is
  that each beat is its own place.

  So: one frame per chapter, plus one for the hero. At Gemini 3 Pro's ~24s
  they still all run at once, so this costs cost and not time — about $0.14 a
  frame, so roughly $0.84 for a six-frame site against $0.42 before.

  SCENE_COUNT still pins it lower for a cheaper build. Below three the
  renderer drops chapter imagery entirely and only the hero keeps a picture,
  which is the honest fallback rather than a half-illustrated page.
*/
export const sceneCount = (chapters = 5) => {
  const perBeat = Math.min(chapters + 1, MAX_SCENES);
  const raw = process.env.SCENE_COUNT;
  if (raw == null || raw === "") return perBeat;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_SCENES, n)) : perBeat;
};

/* Chapters are capped at seven by validateSpec, so eight frames is the
   ceiling: seven beats and a hero. */
const MAX_SCENES = 8;

export async function generateScenes(spec, { signal, timeoutMs = 170_000, log = console } = {}) {
  if (!imageGenAvailable()) return [];

  const chapters = spec.chapters?.length ?? 0;
  const want = sceneCount(chapters);
  const started = Date.now();

  /*
    Frame 0 is the hero (index null → the journey); frame k is chapter k-1.
    That mapping has to match render.mjs, where photos[0] is the hero and
    photoFor(i) reads photos[i + 1]. Change one and you shift every scene
    onto the wrong beat, silently.
  */
  const jobs = Array.from({ length: want }, (_, k) =>
    generateHero(spec, { signal, timeoutMs, log, index: k === 0 ? null : k - 1 }));

  /* allSettled, not all: one refused or slow frame must not lose the others,
     and a build with five of six is still a film. */
  const results = await Promise.allSettled(jobs);
  const images = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean);

  log.info?.(
    `[imagegen] ${images.length}/${want} frames in ${((Date.now() - started) / 1000).toFixed(1)}s` +
    ` — $${images.reduce((sum, im) => sum + (im.cost ?? 0), 0).toFixed(3)}`,
  );
  return images;
}
