import { z } from "zod";

/*
  Turning a page design into a shot list.

  This is the step that was missing, and its absence is why the first film had
  to be hand-written. The builder's spec describes a page — "gulls low over
  the ribs of a distant wreck" is prose meant to drive a CSS gradient. A
  generator needs a camera: a lens, a move, a light, and the same world in
  every shot or the cuts show.

  Feeding one straight into the other produces something. It does not produce
  a film.

  ── what this deliberately fixes, learned by spending credits ──

  · The world is stated in EVERY shot, because keyframes are generated
    independently. Chaining them was tried and it held the world by throwing
    away the shots — eight near-identical empty rooms and none of the film.

  · Faces are kept out of all but the last shot. Independent generations
    drift, and no prompt fixes that; a storyboard where a face appears once
    has nothing to be inconsistent with. Six different men in six chapters is
    what happens otherwise.

  · The concept name never reaches the image prompt. It was passed in as
    context and came back engraved on a razor.
*/

export const ShotSchema = z.object({
  name: z.string(),
  /** The shot instruction: subject, framing, lens, movement, light. */
  visual: z.string(),
  /** True only for the single shot allowed to show a face. */
  showsFace: z.boolean(),
});

export const ShotListSchema = z.object({
  /** The world, in one sentence, repeated into every shot by the code below. */
  world: z.string(),
  shots: z.array(ShotSchema),
});

export const SHOTLIST_SYSTEM = `You turn a website's design into a shot list for a
generated film. The film is scrubbed as the visitor scrolls, so it must read as
one continuous piece of photography, not a slideshow.

Six or seven shots. Each one is a real camera instruction: what fills the
frame, the lens, how the camera moves, where the light comes from.

THE RULES THAT MATTER, each learned from a film that failed on it:

1. FACES. Exactly one shot may show a face, and it must be the last. Every
   other shot sees people from behind, cropped to hands, jaw, shoulder or
   silhouette, or not at all. Each shot is generated independently and faces
   do not survive that — a film with six faces is a film with six different
   people in it. Set showsFace true on the final shot only.

2. THE WORLD. Write "world" as one sentence naming the room, the light source,
   the materials and the palette. It is appended to every shot, because a shot
   that does not restate the world comes back in a different place.

3. CRAFT OVER PEOPLE. Hands, tools, materials, textures, steam, cloth, the
   thing being made. This is what generated video does well and what a face is
   not. It is also how this kind of film is really shot.

4. MOVEMENT. Every shot needs one deliberate camera move — drifting in,
   rising, tracking along, settling. Never "dynamic" or "energetic": say what
   the camera does.

5. NO TEXT ANYWHERE. No signage, lettering, logos, labels or numbers in any
   shot. Text is the fastest way a generated image reads as fake, and asking
   for it invites it.

The shots must tell the same journey the website tells, in the same order, so
the film and the page are one thing.`;

/**
 * Builds the instruction sent to the studio.
 *
 * The page's own journey and chapters go in, because the film should be the
 * site's story rather than a second interpretation of the same business.
 */
export function shotlistRequest(spec) {
  const chapters = (spec.chapters ?? [])
    .map((c, i) => `${i + 1}. ${c.name} — ${c.visual}`)
    .join("\n");

  return [
    `The website is called "${spec.brandName}" — ${spec.tagline}.`,
    `Its journey, top to bottom: ${spec.journey}`,
    "",
    "Its chapters, as written for the page:",
    chapters,
    "",
    `Its palette: background ${spec.palette?.bg}, accent ${spec.palette?.accent}, second accent ${spec.palette?.accent2}.`,
    "",
    "Turn that into a shot list for the film.",
  ].join("\n");
}

/**
 * Folds the world into every shot and returns a spec the film pipeline takes.
 *
 * Done here rather than asked of the model: repeating a sentence seven times
 * is mechanical, and a model asked to do it will drift on the seventh.
 */
export function toFilmSpec(spec, shotlist) {
  return {
    conceptName: spec.conceptName,
    journey: spec.journey,
    chapters: shotlist.shots.map((shot) => ({
      name: shot.name,
      visual: `${shot.visual} ${shotlist.world} No text, no lettering, no signage, no logos, no watermark.`,
    })),
  };
}

/** How many shots show a face — one is correct, more is the drift problem. */
export const faceCount = (shotlist) => shotlist.shots.filter((s) => s.showsFace).length;
