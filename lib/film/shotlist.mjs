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
  /*
    What the people in THIS shot are wearing, as one present-tense state.

    Per shot rather than once for the film, because clothing legitimately
    changes — a man arrives in a jacket and ends up under a cape — and the
    two ways of expressing that in a single sentence both fail. Describing
    only the chair state puts a cutting cape on him out in the street.
    Describing the sequence ("on the street… once seated…") gives the image
    model two states to draw and it draws both, side by side, as a diptych.
  */
  wardrobe: z.string(),
  /** True only for the single shot allowed to show a face. */
  showsFace: z.boolean(),
});

export const ShotListSchema = z.object({
  /** The world, in one sentence, repeated into every shot by the code below. */
  world: z.string(),
  /*
    Who is in the film. Separate from `world` because it must never be dropped:
    left unsaid, the model casts whoever it likes, and the first barber film
    came back with a Black customer in one shot and a white European in
    another for a shop in Taipei. A client's film shows a client's customers.
  */
  casting: z.string(),
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

6. CASTING. Write "casting" naming the people in the film — who they are and
   where they are from — matching the shop's actual customers. Say it plainly,
   e.g. "Taiwanese men in their thirties, East Asian features, black hair".
   Unstated, the model casts at random: a Taipei barbershop came back with a
   Black customer in one shot and a white European in the next. This is a
   client's shop, and the people in it are the client's customers.

7. WARDROBE, PER SHOT. Every shot states what the people in it are wearing,
   as one present-tense state — "a charcoal cutting cape fastened at the neck
   over a white shirt; the barber in a dark apron". Repeat it in each shot in
   the same words, changing it only where the story genuinely changes it: a
   cape mentioned once vanishes in the next shot, and a jacket that is never
   mentioned again is still on him under the cape.

   Never write a shot's wardrobe as a sequence. "On the street he wears a
   jacket; once seated he is in a cape" gives the image model two states for
   one frame and it draws both, side by side, as a split-screen comparison.
   One shot, one state, always.

8. THE PROCEDURE MUST BE REAL. Name the tool AND what it is doing, and make
   sure a barber would actually do that at that moment. Generated video fills
   any gap you leave with nonsense: a shot that said only "hot towel" came
   back with clippers running over the towel on the man's face. A hot towel
   sits on the face and nothing else touches it. Clippers cut hair. A razor
   shaves lathered skin, never hair under a towel. If a step involves waiting,
   say the hands are still.

The shots must tell the same journey the website tells, in the same order, so
the film and the page are one thing.`;

/**
 * Builds the instruction sent to the studio.
 *
 * The page's own journey and chapters go in, because the film should be the
 * site's story rather than a second interpretation of the same business.
 */
export function shotlistRequest(spec, { place = null, customers = null, arc = null } = {}) {
  const chapters = (spec.chapters ?? [])
    .map((c, i) => `${i + 1}. ${c.name} — ${c.visual}`)
    .join("\n");

  /*
    Where the business is and who walks in. Passed separately because it is
    not in the page design anywhere — a spec describes a website, and nothing
    in it says the shop is in Taipei and its customers are Taiwanese. Without
    this the casting rule has nothing to work from.
  */
  const who = [
    place ? `The shop is in ${place}.` : null,
    customers ? `Its customers are ${customers}.` : null,
    place || customers
      ? "Everyone who appears in the film is one of these customers or the barber who serves them."
      : null,
  ].filter(Boolean);

  return [
    `The website is called "${spec.brandName}" — ${spec.tagline}.`,
    `Its journey, top to bottom: ${spec.journey}`,
    ...(who.length ? ["", ...who] : []),
    "",
    "Its chapters, as written for the page:",
    chapters,
    "",
    `Its palette: background ${spec.palette?.bg}, accent ${spec.palette?.accent}, second accent ${spec.palette?.accent2}.`,
    ...(arc ? ["", "THE ARC THIS FILM MUST TELL:", arc] : []),
    "",
    "Turn that into a shot list for the film.",
  ].join("\n");
}

/*
  The before-and-after arc, written so it cannot break the one-face rule.

  A transformation film wants to open on the problem and close on the result,
  and the obvious way to shoot the problem is a face — which is exactly the
  thing that must appear once, at the end, or the man changes identity partway
  through. The way out is that overgrown hair and an unkempt beard are visible
  from behind, in profile, cropped at the jaw, or in a mirror over a shoulder.
  You can see the before perfectly well without seeing who he is, and then the
  face at the end lands as a reveal rather than a continuity problem.
*/
export const TRANSFORMATION_ARC = `This is a before-and-after film. It opens on a
man who needs a haircut, moves through the work, and ends on the same man
finished.

  · The opening shots establish the problem: hair grown well past its shape,
    a beard weeks past neat. Show it from behind, in profile, cropped at the
    jaw, or reflected in the mirror over his shoulder — never his face.
  · The middle is the work itself, and it is the bulk of the film. Hair being
    cut, not tools lying on a towel: the comb lifting a section and the
    scissors closing on it, clippers shaping the neckline, the beard being
    taken down, lather, the razor. Say what each tool is doing.
  · The last shot is the reveal, and the only face in the film: the same man,
    cut and groomed, seen properly for the first time.

The hair must visibly change between the opening and the end. That contrast
is the entire point of the film — a middle full of beautiful tools that never
touch anyone's hair does not sell a haircut.`;

/**
 * Folds the world into every shot and returns a spec the film pipeline takes.
 *
 * Done here rather than asked of the model: repeating a sentence seven times
 * is mechanical, and a model asked to do it will drift on the seventh.
 */
export function toFilmSpec(spec, shotlist) {
  /*
    Casting and wardrobe ride along with the world into every single shot.

    All three describe things that must not change between shots, and every
    shot is generated with no knowledge of the others. The first film proved
    each one separately: the room changed when the world was not restated, the
    customer changed race when casting was not stated at all, and the cape
    disappeared when the wardrobe was mentioned only once.
  */
  const tidy = (s) => String(s ?? "").trim().replace(/\.?$/, ".");
  const constant = [shotlist.world, shotlist.casting].filter(Boolean).map(tidy).join(" ");

  return {
    conceptName: spec.conceptName,
    journey: spec.journey,
    chapters: shotlist.shots.map((shot) => ({
      name: shot.name,
      /* World and casting are the same in every shot; wardrobe is this
         shot's own, so a jacket in the street and a cape in the chair are
         two states of one film rather than two halves of one frame. */
      visual: `${shot.visual} ${constant} ${tidy(shot.wardrobe)} ` +
              `No text, no lettering, no signage, no logos, no watermark.`,
    })),
  };
}

/** How many shots show a face — one is correct, more is the drift problem. */
export const faceCount = (shotlist) => shotlist.shots.filter((s) => s.showsFace).length;

/*
  Who a site is written for, from the language it is written in.

  A shop's site is in the language its customers read, so the language tag is
  the one piece of casting information every spec already carries. It is a
  coarse signal and deliberately so: it says "the people in this film are the
  people who walk into this shop" rather than describing anyone precisely,
  and the studio writes the actual casting line from it.

  Left to itself the image model casts at random, which for a Taipei
  barbershop produced a Black customer in one shot and a white European in
  the next. A rough right answer beats an unprompted wrong one.
*/
const AUDIENCE = {
  "zh-hant": "Taiwanese, of East Asian appearance",
  "zh-hans": "Chinese, of East Asian appearance",
  zh: "Chinese-speaking, of East Asian appearance",
  ja: "Japanese, of East Asian appearance",
  ko: "Korean, of East Asian appearance",
  th: "Thai, of Southeast Asian appearance",
  vi: "Vietnamese, of Southeast Asian appearance",
  el: "Greek, of Southern European appearance",
  ar: "Arabic-speaking, of Middle Eastern appearance",
  he: "Israeli, of Middle Eastern appearance",
  hi: "Indian, of South Asian appearance",
  tr: "Turkish",
  ru: "Russian",
  pt: "Portuguese-speaking",
  es: "Spanish-speaking",
  it: "Italian",
  fr: "French",
  de: "German",
  pl: "Polish",
  nl: "Dutch",
  ja_JP: "Japanese, of East Asian appearance",
};

/**
 * A casting hint from the spec's primary language, or null for English.
 *
 * Null rather than a guess when the language is English: English is spoken
 * everywhere and tells you nothing about who the customers are, so the studio
 * is better off inferring from the business itself than from a bad hint.
 */
export function audienceFromSpec(spec) {
  const tag = String(spec?.language?.primary ?? "").toLowerCase().replace("_", "-");
  if (!tag || tag === "en" || tag.startsWith("en-")) return null;
  return AUDIENCE[tag] ?? AUDIENCE[tag.split("-")[0]] ?? null;
}
