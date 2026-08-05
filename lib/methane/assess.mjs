import { applicableObligations, LAST_REVIEWED, SOURCES } from "./framework.mjs";

/*
  Turns a profile into a dated gap report.

  Two decisions shape everything here.

  There is no score. A percentage would be the easiest thing to put on a slide
  and the least honest: it implies a precision this does not have, it invites
  gaming, and "we are 78% compliant" is a sentence that has never helped
  anybody prepare for an audit. What replaces it is a count and an order —
  what is open, and what falls due first.

  "Unknown" is a finding, not a blank. An operator who cannot say whether they
  have independently verified site-level measurement has learned something
  useful about their own organisation, and it is the most common honest answer
  in this space. Treating it as a gap would overstate; treating it as fine
  would be worse.
*/

/** Whole days from today to a date, negative once it has passed. */
export function daysUntil(dateString, today = new Date()) {
  const target = new Date(`${dateString}T00:00:00Z`);
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  return Math.round((target - start) / 86_400_000);
}

/** "in 3 months", "in 18 days", "passed" — how far off a deadline reads. */
export function describeHorizon(days) {
  if (days < 0) return "already passed";
  if (days === 0) return "today";
  if (days < 45) return `in ${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30);
  if (months < 24) return `in about ${months} months`;
  return `in about ${Math.round(days / 365)} years`;
}

/*
  Urgency is deliberately a function of both the gap and the clock.

  An open obligation two years out is not the same problem as an open one this
  quarter, and a report that treats them alike sends people to work on the
  wrong thing. The measurement obligations are the ones with the longest lead
  time, so "two years away" is not the reassurance it sounds like — which is
  said in the report rather than encoded as a bigger number.
*/
function urgency(status, days) {
  if (status === "ready") return 0;
  if (days < 0) return 100;
  if (days <= 120) return 90;
  if (days <= 400) return 70;
  return 40;
}

/**
 * Assesses a profile.
 *
 * Pure — no I/O, no clock of its own unless one is supplied. That is what lets
 * the tests pin behaviour to fixed dates instead of drifting with the calendar.
 */
export function assess(profile, today = new Date()) {
  const obligations = applicableObligations(profile);

  const findings = obligations.map((o) => {
    const status = o.assess(profile);
    const days = daysUntil(o.date, today);
    return {
      id: o.id,
      title: o.title,
      regime: o.regime,
      detail: o.detail,
      date: o.date,
      dateNote: o.dateNote,
      horizon: describeHorizon(days),
      daysRemaining: days,
      status,
      action: status === "ready" ? null : o.ifGap,
      source: SOURCES[o.source],
      urgency: urgency(status, days),
    };
  });

  // Worst and soonest first. Ties break on the earlier date, because between
  // two equally open items the one that falls due sooner is the one to start.
  findings.sort((a, b) => b.urgency - a.urgency || a.date.localeCompare(b.date));

  const counts = {
    total: findings.length,
    ready: findings.filter((f) => f.status === "ready").length,
    gap: findings.filter((f) => f.status === "gap").length,
    unknown: findings.filter((f) => f.status === "unknown").length,
  };

  const open = findings.filter((f) => f.status !== "ready");
  const next = open.find((f) => f.daysRemaining >= 0) ?? open[0] ?? null;

  return {
    assessedAt: today.toISOString(),
    frameworkReviewed: LAST_REVIEWED,
    inScope: obligations.length > 0,
    counts,
    findings,
    nextDeadline: next
      ? { title: next.title, date: next.date, horizon: next.horizon, regime: next.regime }
      : null,
    headline: headlineFor(profile, counts, next),
  };
}

/*
  One sentence a director can repeat in a meeting.

  Written to be true rather than alarming. An operator with everything in hand
  should be told so plainly — a tool that finds a problem no matter what the
  answers are is a sales instrument, and the room can tell.
*/
function headlineFor(profile, counts, next) {
  if (!counts.total) {
    return "On the answers given, none of the methane regimes covered here apply to your operations. That is worth re-checking if you sell into the EU at any point in the chain, because exposure follows the molecule rather than the company.";
  }

  if (counts.gap === 0 && counts.unknown === 0) {
    return `On the answers given, all ${counts.total} obligations in scope look to be in hand. Worth re-testing against the detail of your asset class, and worth revisiting whenever the rules move.`;
  }

  const openCount = counts.gap + counts.unknown;
  const unknownNote = counts.unknown
    ? ` ${counts.unknown} of them you were not able to answer, which is itself a finding — an obligation nobody in the business can speak to is not one you can evidence to a verifier.`
    : "";

  const deadlineNote = next
    ? ` The first to fall due is "${next.title}" (${next.regime}), ${next.horizon}.`
    : "";

  return `${openCount} of ${counts.total} obligations in scope are open.${unknownNote}${deadlineNote}`;
}
