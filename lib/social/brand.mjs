/*
  Social content planning — platforms, scheduling, and the SVG sanitiser.

  Browser-safe: no imports at all. The page renders logos and the calendar from
  this, the endpoint validates against it, and neither gets a bare specifier.

  ── what lives here rather than in the model ──

  Character limits, hashtag caps, and every date in the calendar. A model
  writing a caption will cheerfully hand you 340 characters for X, and it
  reads perfectly well right up until it is rejected by the API. A model doing
  date arithmetic across a month gets most of them right. Neither is a thing
  to find out in production, so both are code with tests.

  The model writes. This counts.
*/

/*
  Platform limits.

  These move — X changed its limit for paying accounts, TikTok raised captions
  from 150 to 2,200, Instagram's hashtag cap has been argued about for years.
  So they carry a review date and the verifier prints them for re-checking,
  the same way the methane and maritime frameworks do. A number in here that
  is quietly two years stale produces captions that get rejected on posting,
  which is the worst place to discover it.
*/
export const LIMITS_REVIEWED = "2026-08-06";

export const PLATFORMS = [
  {
    id: "instagram",
    name: "Instagram",
    captionLimit: 2200,
    hashtagLimit: 30,
    /** What the caption should feel like on this platform. Guides the model. */
    voice: "Warm and specific. The first line has to earn the tap on 'more'.",
    media: "square or 4:5 image, or a reel",
    /** Why it cannot post yet. Shown verbatim on the page — no vagueness. */
    connect: {
      needs: "A Meta app with instagram_content_publish, passed through App Review, plus business verification. Only works for an Instagram Business or Creator account linked to a Facebook Page.",
      effort: "Weeks. Meta reviews each permission by hand.",
    },
  },
  {
    id: "facebook",
    name: "Facebook",
    captionLimit: 63206,
    hashtagLimit: 10,
    voice: "Plainer and longer than Instagram. Full sentences, less performance.",
    media: "landscape image or video",
    connect: {
      needs: "The same Meta app, with pages_manage_posts and pages_read_engagement, reviewed against a Page you administer.",
      effort: "Weeks, alongside the Instagram review.",
    },
  },
  {
    id: "x",
    name: "X",
    /* The free tier's limit. Paid tiers allow far more, but a plan that only
       works if the reader is paying for X is not a plan. */
    captionLimit: 280,
    hashtagLimit: 3,
    voice: "One idea, said once. No preamble, no thread unless the idea needs one.",
    media: "image optional; text carries it",
    connect: {
      needs: "An X developer account with write access, which is a paid API tier.",
      effort: "Immediate once paid for — this is a billing decision, not a review.",
    },
  },
  {
    id: "tiktok",
    name: "TikTok",
    captionLimit: 2200,
    hashtagLimit: 5,
    voice: "Spoken, not written. The caption is a hook for something being watched.",
    media: "vertical video, 9:16",
    connect: {
      needs: "A TikTok for Developers app with the Content Posting API, and an audit before Direct Post is allowed. Unaudited apps can only push private drafts.",
      effort: "Weeks, and the audit needs a working demo.",
    },
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    captionLimit: 3000,
    hashtagLimit: 5,
    voice: "Direct and useful. A point of view, not an announcement.",
    media: "landscape image or document carousel",
    connect: {
      needs: "A LinkedIn app with w_member_social, and Community Management API access for Page posting.",
      effort: "Days to weeks depending on the access tier.",
    },
  },
];

export function platformById(id) {
  return PLATFORMS.find((p) => p.id === id) ?? null;
}

export const CADENCES = [
  { id: "daily", label: "Every day", perWeek: 7 },
  { id: "weekdays", label: "Weekdays only", perWeek: 5 },
  { id: "four", label: "Four times a week", perWeek: 4 },
  { id: "three", label: "Three times a week", perWeek: 3 },
  { id: "two", label: "Twice a week", perWeek: 2 },
];

export function cadenceById(id) {
  return CADENCES.find((c) => c.id === id) ?? null;
}

/*
  Posting slots, computed here rather than by the model.

  Dates are exactly the kind of arithmetic a language model does almost
  correctly — the wrong Tuesday, a month with 31 days treated as 30, a
  weekday rule applied to four days out of five. Almost correct is not a
  calendar somebody can publish from.

  Times are spread rather than identical so a month of posts does not all
  land at 09:00, which reads as automated to anyone watching.
*/
const SLOT_TIMES = ["08:30", "12:15", "17:45", "19:30"];

export function buildSlots({ startDate, days, cadenceId }) {
  const cadence = cadenceById(cadenceId);
  const total = Number(days);
  if (!cadence || !Number.isInteger(total) || total < 1 || total > 90) return [];

  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];

  const slots = [];
  const wantWeekdaysOnly = cadence.id === "weekdays";
  // Spread the week's posts evenly rather than clustering them.
  const gap = cadence.id === "daily" ? 1 : 7 / cadence.perWeek;

  let cursor = 0;
  let n = 0;
  while (cursor < total) {
    const day = new Date(start.getTime() + Math.floor(cursor) * 86_400_000);
    const dow = day.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;

    if (!(wantWeekdaysOnly && isWeekend)) {
      slots.push({
        date: day.toISOString().slice(0, 10),
        time: SLOT_TIMES[n % SLOT_TIMES.length],
        weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow],
      });
      n++;
      cursor += gap;
    } else {
      cursor += 1; // skip the weekend day without consuming a slot
    }
  }
  return slots;
}

/* ── caption checking ──────────────────────────────────────────────────── */

export function countHashtags(text) {
  return (String(text ?? "").match(/(^|\s)#[\wÀ-ɏ]+/g) ?? []).length;
}

/**
 * Checks one post against its platform's real limits.
 *
 * A caption that is 340 characters reads perfectly well and is rejected by
 * X's API. Finding that out at posting time, across a month of scheduled
 * content, is the failure this prevents.
 */
export function checkPost(post) {
  const platform = platformById(post?.platform);
  if (!platform) return { ok: false, problems: [`unknown platform "${post?.platform}"`] };

  const problems = [];
  const caption = String(post.caption ?? "");
  const tags = Array.isArray(post.hashtags) ? post.hashtags : [];

  // Hashtags are counted against the same budget as the caption, because
  // that is how the platforms count them.
  const full = tags.length ? `${caption}\n\n${tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}` : caption;

  if (!caption.trim()) problems.push("has no caption");
  if (full.length > platform.captionLimit) {
    problems.push(`is ${full.length} characters with hashtags, over ${platform.name}'s ${platform.captionLimit}`);
  }
  if (tags.length > platform.hashtagLimit) {
    problems.push(`has ${tags.length} hashtags, over ${platform.name}'s practical limit of ${platform.hashtagLimit}`);
  }
  for (const tag of tags) {
    if (/\s/.test(tag)) problems.push(`hashtag "${tag}" contains a space`);
  }

  return { ok: problems.length === 0, problems, length: full.length, limit: platform.captionLimit };
}

/* ── SVG sanitising ────────────────────────────────────────────────────── */

/*
  A generated logo is SVG, and SVG is executable. It can carry <script>, event
  handlers, <foreignObject> with arbitrary HTML, and external references
  through <use> or <image>. Rendering model output straight into the page
  would be an injection hole with a bow on it.

  So it is rebuilt from an allow-list rather than filtered. Anything not
  explicitly permitted does not survive — which is the only direction of
  defence that stays safe when a new SVG feature is invented.
*/
const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
  "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "title", "desc",
]);

const ALLOWED_ATTRS = new Set([
  "viewbox", "xmlns", "width", "height", "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "stroke-opacity", "opacity", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
  "r", "rx", "ry", "points", "transform", "font-family", "font-size", "font-weight",
  "letter-spacing", "text-anchor", "dominant-baseline", "offset", "stop-color",
  "stop-opacity", "gradientunits", "gradienttransform", "id", "class",
  /*
    Accessibility attributes are allowed through. They carry no script and no
    reference, and a logo that announces itself to a screen reader is better
    than one that does not — the first run of this dropped role and aria-label
    from a perfectly good wordmark.
  */
  "role", "aria-label", "aria-labelledby", "aria-hidden",
]);

/**
 * Rebuilds an SVG from allowed parts only.
 *
 * Deliberately a parser rather than a regex strip: a regex that removes
 * "<script" is defeated by "<scr<script>ipt", and this has to be right rather
 * than nearly right.
 */
export function sanitiseSvg(input) {
  const raw = String(input ?? "");
  const out = [];
  const dropped = new Set();

  // Tokenise into tags and text.
  const re = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^<>]*?)?)\/?>|([^<]+)/g;
  let m;
  const openStack = [];
  let skipDepth = 0;

  while ((m = re.exec(raw))) {
    const [full, tagName, attrString, text] = m;

    if (text !== undefined) {
      if (skipDepth === 0) out.push(text.replace(/[<>]/g, ""));
      continue;
    }

    const name = tagName.toLowerCase();
    const isClose = full.startsWith("</");
    const selfClosing = full.endsWith("/>");

    if (!ALLOWED_TAGS.has(name)) {
      dropped.add(name);
      if (isClose) { if (skipDepth > 0) skipDepth--; }
      else if (!selfClosing) skipDepth++;
      continue;
    }
    if (skipDepth > 0) continue;

    if (isClose) {
      const expected = openStack.pop();
      if (expected === name) out.push(`</${name}>`);
      continue;
    }

    const attrs = [];
    const attrRe = /([a-zA-Z][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attrRe.exec(attrString ?? ""))) {
      const key = a[1].toLowerCase();
      const value = a[3] ?? a[4] ?? "";
      // No event handlers, no namespaced hrefs, no url() escapes into a
      // stylesheet, no javascript: anywhere.
      if (key.startsWith("on")) { dropped.add(key); continue; }
      if (!ALLOWED_ATTRS.has(key)) { dropped.add(key); continue; }
      if (/javascript:|url\s*\(|expression\s*\(|&#/i.test(value)) { dropped.add(key); continue; }
      attrs.push(`${key}="${value.replace(/[<>"]/g, "")}"`);
    }

    if (selfClosing) {
      out.push(`<${name}${attrs.length ? " " + attrs.join(" ") : ""}/>`);
    } else {
      openStack.push(name);
      out.push(`<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`);
    }
  }

  // Close anything left open, so a truncated logo cannot break the page.
  while (openStack.length) out.push(`</${openStack.pop()}>`);

  const svg = out.join("").trim();
  return {
    svg: /^<svg[\s>]/i.test(svg) ? svg : "",
    dropped: [...dropped],
  };
}
