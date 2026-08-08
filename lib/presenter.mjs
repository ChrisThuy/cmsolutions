import { timingSafeEqual } from "node:crypto";

/*
  A way past the rate limits, for the person demonstrating the tools.

  ── why this exists ──

  Every public endpoint here is rate limited per IP, and it has to be: a
  build costs real money at the model, and an open button that spends it is
  an open invoice. Five an hour is right for a stranger.

  It is wrong for the person showing the tools to somebody. Standing in front
  of a prospect and being told by your own product that you have had your five
  goes is worse than any abuse the limit prevents — it happened, and that is
  what this fixes.

  ── why a key, and not an IP allowlist ──

  Conference wifi, tethering, a hotel, a client's guest network. The presenter's
  address is exactly the thing that changes on the days this matters most. A
  key travels with the person instead.

  ── why the browser hides it after the first visit ──

  The header carries no data access — it only skips a counter — but a URL
  visible in a screen-shared address bar is a URL somebody can photograph.
  The kit stores the key locally on first visit and strips it from the URL, so
  the demo machine is armed once and the address bar stays clean afterwards.

  Set PRESENTER_KEY in the environment to arm it. Unset, every request is an
  ordinary rate-limited one, which is the correct default for a deployment
  that has not deliberately opted in.
*/

export const PRESENTER_HEADER = "x-presenter-key";

/** Constant time, so the endpoint cannot be used to guess the key a byte at a time. */
function sameSecret(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * True when this request carries the presenter key.
 *
 * Deliberately header-only. A query parameter would end up in access logs,
 * in `Referer` headers on any outbound link, and in the address bar — three
 * places a shared secret should never sit.
 */
export function isPresenter(req) {
  const expected = process.env.PRESENTER_KEY;
  if (!expected) return false;

  const got = req?.headers?.[PRESENTER_HEADER];
  return typeof got === "string" && got.length > 0 && sameSecret(got, expected);
}
