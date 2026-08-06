/*
  Tests the social content planner.

    node scripts/test-social.mjs

  Three things carry real risk here and get most of the attention.

  The SVG sanitiser, because a generated logo is executable. SVG can carry
  <script>, event handlers, <foreignObject> with arbitrary HTML, and external
  references. Rendering model output straight into the page would be an
  injection hole, so the sanitiser rebuilds from an allow-list and these tests
  try to get past it.

  The caption checker, because a 340-character X post reads perfectly well and
  is rejected by the API. Finding that out at posting time across a month of
  scheduled content is the failure worth preventing.

  And the date arithmetic, because a language model doing a month of dates is
  right almost every time, and a calendar somebody publishes from cannot be
  almost right.
*/

import {
  CADENCES, LIMITS_REVIEWED, PLATFORMS, buildSlots, cadenceById, checkPost,
  countHashtags, platformById, sanitiseSvg,
} from "../lib/social/brand.mjs";
import { tallyPlan, validatePlan } from "../lib/social/plan.mjs";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\nThe SVG sanitiser rebuilds rather than filters");
{
  const good = '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><path d="M2 2 L98 2" stroke="#000" stroke-width="2"/><text x="4" y="30" font-family="serif" font-size="22">SALT</text></svg>';
  const clean = sanitiseSvg(good);
  check("a legitimate wordmark survives intact",
    clean.svg.includes("<path") && clean.svg.includes("SALT") && clean.dropped.length === 0,
    JSON.stringify(clean.dropped));

  for (const [name, payload] of [
    ["a script element", '<svg viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4"/></svg>'],
    ["an event handler", '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" onload="alert(1)"/></svg>'],
    ["an onclick handler", '<svg viewBox="0 0 10 10"><rect width="10" height="10" onclick="alert(1)"/></svg>'],
    ["foreignObject", '<svg viewBox="0 0 10 10"><foreignObject><body onload="alert(1)"/></foreignObject></svg>'],
    ["an external image", '<svg viewBox="0 0 10 10"><image href="https://evil.example/x.png"/></svg>'],
    ["a use reference", '<svg viewBox="0 0 10 10"><use href="#x" xlink:href="data:..."/></svg>'],
    ["a javascript url in fill", '<svg viewBox="0 0 10 10"><rect fill="javascript:alert(1)" width="5" height="5"/></svg>'],
    ["a css url() escape", '<svg viewBox="0 0 10 10"><rect fill="url(#x);background:url(javascript:alert(1))" width="5" height="5"/></svg>'],
    ["a nested split tag", '<svg viewBox="0 0 10 10"><scr<script>ipt>alert(1)</script></svg>'],
    ["an animate handler", '<svg viewBox="0 0 10 10"><animate onbegin="alert(1)" attributeName="x"/></svg>'],
  ]) {
    const out = sanitiseSvg(payload).svg;
    const dangerous = /<script|onload=|onclick=|onbegin=|foreignobject|<image|<use|javascript:/i.test(out);
    check(`${name} does not survive`, !dangerous, out.slice(0, 90));
  }

  check("something that is not an SVG at all yields nothing",
    sanitiseSvg("<div>hello</div>").svg === "" && sanitiseSvg("").svg === "");

  // A truncated logo must not leave the page's own markup broken.
  const truncated = sanitiseSvg('<svg viewBox="0 0 10 10"><g><path d="M0 0');
  check("a truncated SVG is closed rather than left open",
    (truncated.svg.match(/<g>/g) ?? []).length === (truncated.svg.match(/<\/g>/g) ?? []).length,
    truncated.svg);

  // Accessibility attributes carry no script and no reference, and a logo that
  // announces itself to a screen reader is better than one that does not.
  const a11y = sanitiseSvg('<svg viewBox="0 0 1 1" role="img" aria-label="Acme"><circle cx="1" cy="1" r="1"/></svg>');
  check("aria attributes survive",
    a11y.svg.includes('role="img"') && a11y.svg.includes('aria-label="Acme"'), a11y.svg);

  check("dropped elements are reported, not silently swallowed",
    sanitiseSvg('<svg viewBox="0 0 1 1"><script>x</script></svg>').dropped.includes("script"));
}

console.log("\nCaptions are checked against the real platform limits");
{
  const ok = checkPost({ platform: "x", caption: "A short, complete thought.", hashtags: ["gin"] });
  check("a short X post passes", ok.ok, JSON.stringify(ok.problems));

  const tooLong = checkPost({ platform: "x", caption: "a".repeat(300), hashtags: [] });
  check("a 300-character X post is rejected", !tooLong.ok);
  check("and the message names the platform and the limit",
    tooLong.problems.some((p) => /X's 280/.test(p)), JSON.stringify(tooLong.problems));

  // Hashtags count against the same budget, because that is how the platforms
  // count them. A caption at exactly the limit plus tags is over it.
  const withTags = checkPost({ platform: "x", caption: "a".repeat(270), hashtags: ["one", "two"] });
  check("hashtags count against the caption budget", !withTags.ok,
    `${withTags.length} chars`);

  const tooMany = checkPost({
    platform: "tiktok", caption: "Short.", hashtags: ["a", "b", "c", "d", "e", "f"],
  });
  check("too many hashtags is rejected", !tooMany.ok,
    JSON.stringify(tooMany.problems));

  const spaced = checkPost({ platform: "instagram", caption: "Hi.", hashtags: ["two words"] });
  check("a hashtag containing a space is rejected", !spaced.ok);

  check("an empty caption is rejected", !checkPost({ platform: "x", caption: "  ", hashtags: [] }).ok);
  check("an unknown platform is rejected", !checkPost({ platform: "myspace", caption: "Hi" }).ok);

  const long = checkPost({ platform: "instagram", caption: "a".repeat(2000), hashtags: ["x"] });
  check("2000 characters is fine on Instagram", long.ok, JSON.stringify(long.problems));
}

console.log("\nHashtags are counted the way a platform counts them");
{
  check("plain hashtags count", countHashtags("Hello #one and #two") === 2);
  check("a hash mid-word is not a hashtag", countHashtags("C#Sharp") === 0, `${countHashtags("C#Sharp")}`);
  check("no hashtags is zero", countHashtags("Nothing here") === 0);
  check("null is handled", countHashtags(null) === 0);
}

console.log("\nDates are computed, never left to the model");
{
  const daily = buildSlots({ startDate: "2026-09-01", days: 30, cadenceId: "daily" });
  check("thirty days daily gives thirty slots", daily.length === 30, `${daily.length}`);
  check("the first slot is the start date", daily[0].date === "2026-09-01");
  check("dates strictly increase", daily.every((s, i) => i === 0 || s.date > daily[i - 1].date));
  check("it does not run past the window",
    daily.at(-1).date <= "2026-09-30", daily.at(-1).date);

  const weekdays = buildSlots({ startDate: "2026-09-05", days: 14, cadenceId: "weekdays" });
  check("weekday-only never lands on a weekend",
    weekdays.every((s) => s.weekday !== "Sat" && s.weekday !== "Sun"),
    weekdays.filter((s) => /Sat|Sun/.test(s.weekday)).map((s) => `${s.date} ${s.weekday}`).join(", "));
  check("5 September 2026 is a Saturday, so it is skipped",
    weekdays[0].date !== "2026-09-05", weekdays[0].date);

  const thrice = buildSlots({ startDate: "2026-09-01", days: 28, cadenceId: "three" });
  check("three a week over four weeks gives about twelve",
    thrice.length >= 11 && thrice.length <= 13, `${thrice.length}`);

  // Posting a month at the same time every day reads as automated.
  const times = new Set(daily.slice(0, 8).map((s) => s.time));
  check("times are spread rather than identical", times.size > 1, [...times].join(", "));

  check("a bad cadence yields nothing", buildSlots({ startDate: "2026-09-01", days: 30, cadenceId: "hourly" }).length === 0);
  check("a bad date yields nothing", buildSlots({ startDate: "not-a-date", days: 30, cadenceId: "daily" }).length === 0);
  check("an absurd window yields nothing", buildSlots({ startDate: "2026-09-01", days: 900, cadenceId: "daily" }).length === 0);
  check("zero days yields nothing", buildSlots({ startDate: "2026-09-01", days: 0, cadenceId: "daily" }).length === 0);
}

console.log("\nA month that would get muted is rejected");
{
  const post = (over = {}) => ({
    platform: "instagram", pillar: "Craft", hook: "h", caption: "c",
    hashtags: [], mediaBrief: "Founder at the bench, morning light.",
    mediaType: "image", intent: "educate", ...over,
  });

  const varied = { posts: [
    post(), post({ intent: "show-work", pillar: "Place" }), post({ intent: "story", pillar: "People" }),
    post({ intent: "offer" }), post({ intent: "point-of-view", pillar: "Place" }),
    post({ intent: "behind-scenes" }), post({ intent: "educate", pillar: "People" }), post({ intent: "story" }),
  ] };
  check("a varied month passes", validatePlan(varied).ok, JSON.stringify(validatePlan(varied).problems));

  const monotone = { posts: Array.from({ length: 10 }, () => post()) };
  const mono = validatePlan(monotone);
  check("ten identical-intent posts are rejected", !mono.ok);
  check("and so is a single pillar", mono.problems.some((p) => /one pillar/.test(p)),
    JSON.stringify(mono.problems));

  const salesy = { posts: [
    ...Array.from({ length: 5 }, () => post({ intent: "offer" })),
    post({ intent: "educate", pillar: "Place" }), post({ intent: "story", pillar: "People" }),
    post({ intent: "show-work", pillar: "Place" }),
  ] };
  const sales = validatePlan(salesy);
  check("a month that is mostly selling is rejected",
    !sales.ok && sales.problems.some((p) => /billboard/.test(p)), JSON.stringify(sales.problems));

  const noBrief = { posts: [post({ mediaBrief: "" }), post({ intent: "story", pillar: "P" }), post({ intent: "offer" })] };
  check("a post with no media brief is rejected", !validatePlan(noBrief).ok);

  check("an empty plan is rejected", !validatePlan({ posts: [] }).ok);

  const short = validatePlan(varied, 30);
  check("a plan far short of its slots is flagged",
    !short.ok && short.problems.some((p) => /for 30 slots/.test(p)), JSON.stringify(short.problems));
}

console.log("\nNothing about reach or engagement is ever produced");
{
  // The schema has no field for it, and the platform copy must not sneak it in.
  const text = JSON.stringify(PLATFORMS);
  const invented = /best time to post|\d+% more|engagement rate|reach of|guaranteed|grow your following by/i;
  check("no engagement claims in the platform data", !invented.test(text), text.match(invented)?.[0]);
}

console.log("\nPlatform data is complete and dated");
{
  check("every platform has a caption limit", PLATFORMS.every((p) => p.captionLimit > 0));
  check("every platform has a hashtag limit", PLATFORMS.every((p) => p.hashtagLimit > 0));
  check("every platform says what connecting it actually needs",
    PLATFORMS.every((p) => p.connect?.needs?.length > 40),
    PLATFORMS.filter((p) => !(p.connect?.needs?.length > 40)).map((p) => p.id).join(","));
  check("every platform says how long that takes",
    PLATFORMS.every((p) => p.connect?.effort?.length > 5));

  /* These numbers move — X changed its limit for paying accounts, TikTok
     raised captions from 150 to 2200. A stale limit produces captions that
     are rejected at posting time, so the review date is shown to the reader. */
  check("the limits carry a review date", /^\d{4}-\d{2}-\d{2}$/.test(LIMITS_REVIEWED));

  check("lookup works", platformById("x")?.captionLimit === 280 && platformById("nope") === null);
  check("every cadence has a weekly rate", CADENCES.every((c) => c.perWeek > 0));
  check("cadence lookup works", cadenceById("daily")?.perWeek === 7 && cadenceById("nope") === null);
}

console.log("\nThe tally reflects the plan");
{
  const posts = [
    { platform: "x", intent: "educate", mediaType: "image" },
    { platform: "x", intent: "offer", mediaType: "video" },
    { platform: "instagram", intent: "story", mediaType: "image" },
  ];
  const t = tallyPlan(posts);
  check("it counts the total", t.total === 3);
  check("it counts by platform", t.byPlatform.x === 2 && t.byPlatform.instagram === 1);
  check("it separates video from image", t.video === 1 && t.image === 2);
}

console.log(
  failures === 0 ? "\nAll social-planner tests passed.\n" : `\n${failures} test(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
