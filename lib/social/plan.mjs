import { z } from "zod";

/*
  The brand kit and content plan the model returns. Server-only.

  What the model is asked for and what it is not:

  It writes — voice, captions, hooks, hashtags, image briefs, the logo as SVG.
  It does not choose dates, does not count characters, and does not decide
  whether a caption fits. Those are in lib/social/brand.mjs, with tests,
  because a 340-character X post reads fine and is rejected by the API, and a
  month of dates worked out by a language model is right almost every time.

  There is also no field anywhere for reach, engagement, follower growth or
  best-time-to-post. Those would be invented, and a content plan that opens
  with a fabricated projection is one nobody should trust with the rest.
*/

export const PostSchema = z.object({
  /** Which platform this is written for. Captions differ per platform. */
  platform: z.enum(["instagram", "facebook", "x", "tiktok", "linkedin"]),

  /** The content pillar this belongs to — used to check the mix is varied. */
  pillar: z.string(),

  /** The first line, which is what decides whether anyone reads the rest. */
  hook: z.string(),

  /** The caption as it would be posted, without the hashtags. */
  caption: z.string(),

  /** Hashtags without the leading #, so the count can be checked cleanly. */
  hashtags: z.array(z.string()),

  /**
   * What the image or video should show, specific enough to shoot or to
   * generate. "Founder at the bench, morning light, shot from behind" — not
   * "engaging brand visual".
   */
  mediaBrief: z.string(),

  /** image | video — video costs credits and is flagged as such in the UI. */
  mediaType: z.enum(["image", "video"]),

  /** What this post is for. Keeps the month from being all the same thing. */
  intent: z.enum(["educate", "show-work", "behind-scenes", "point-of-view", "offer", "story"]),
});

export const BrandKitSchema = z.object({
  /** The brand in one sentence, as it would introduce itself. */
  positioning: z.string(),

  /** Three to five words that describe how it sounds. */
  voice: z.array(z.string()),

  /** What it never says or does. As useful as the voice. */
  avoid: z.array(z.string()),

  /** Who it is talking to, specifically. */
  audience: z.string(),

  /** The recurring themes the month is built from. Three to five. */
  pillars: z.array(z.object({ name: z.string(), description: z.string() })),

  palette: z.object({
    primary: z.string(),
    secondary: z.string(),
    ink: z.string(),
    paper: z.string(),
  }),

  /**
   * A logo as inline SVG. Vector on purpose: it stays crisp at any size, it
   * is editable, and it does not need an image-generation service. A wordmark
   * or a monogram — not an illustration, which SVG does badly.
   *
   * Sanitised before it is ever rendered; see sanitiseSvg.
   */
  logoSvg: z.string(),
  logoRationale: z.string(),
});

export const ContentPlanSchema = z.object({
  brand: BrandKitSchema,
  /** In the order they should be published. Dates are attached afterwards. */
  posts: z.array(PostSchema),
});

/**
 * Checks the shape of the month, which zod cannot.
 *
 * A plan can validate and still be a bad month: thirty posts that are all
 * offers, or all the same intent, is a feed people mute.
 */
export function validatePlan(plan, expectedCount) {
  const problems = [];
  const posts = plan?.posts ?? [];

  if (posts.length === 0) {
    return { ok: false, problems: ["produced no posts"] };
  }
  if (expectedCount && Math.abs(posts.length - expectedCount) > 2) {
    problems.push(`produced ${posts.length} posts for ${expectedCount} slots`);
  }

  const intents = new Set(posts.map((p) => p.intent));
  if (posts.length >= 8 && intents.size < 3) {
    problems.push("the whole month is two kinds of post — a feed like that gets muted");
  }

  const offers = posts.filter((p) => p.intent === "offer").length;
  if (posts.length >= 8 && offers / posts.length > 0.35) {
    problems.push(`${offers} of ${posts.length} posts are selling — that ratio reads as a billboard`);
  }

  const pillars = new Set(posts.map((p) => p.pillar));
  if (posts.length >= 8 && pillars.size < 2) {
    problems.push("every post comes from one pillar");
  }

  const withoutBrief = posts.filter((p) => !p.mediaBrief?.trim()).length;
  if (withoutBrief) problems.push(`${withoutBrief} post(s) have no media brief`);

  return { ok: problems.length === 0, problems };
}

/** Counts for the summary line. */
export function tallyPlan(posts) {
  const by = (key) => posts.reduce((acc, p) => {
    acc[p[key]] = (acc[p[key]] ?? 0) + 1;
    return acc;
  }, {});
  return {
    total: posts.length,
    byPlatform: by("platform"),
    byIntent: by("intent"),
    video: posts.filter((p) => p.mediaType === "video").length,
    image: posts.filter((p) => p.mediaType === "image").length,
  };
}
