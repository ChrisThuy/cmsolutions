/*
  Pre-flight check for the methane readiness tool.

    npm run methane:verify

  Run this before showing the tool to anyone who knows the subject — and
  certainly before a conference. It exists because the last manual review
  found the tool asserting a database launch date from a trade newsletter
  while Article 30(1) of the regulation gave a different date that had already
  passed. That was invisible to the test suite, because the tests check that
  every claim HAS a source, not that the source still says what we think.

  What this script can do: confirm each citation still resolves, find dates
  that have quietly gone into the past, and say how stale the review is.

  What it cannot do is read the law for you. Several of the open questions
  below are questions of fact about the world in the next few weeks, and a
  script that pretended to answer them would be worse than one that prints
  them out and makes a person look. So it prints them out.
*/

import { OBLIGATIONS, SOURCES, LAST_REVIEWED } from "../lib/methane/framework.mjs";

const TIMEOUT_MS = 20_000;
const STALE_AFTER_DAYS = 60;

/*
  EUR-Lex, the Federal Register and congress.gov all sit behind bot walls that
  answer automated requests with 202 or 403 and an empty body. That is not a
  broken link and must not be reported as one — the failure mode to avoid is a
  checker that cries wolf until someone stops reading it. These get flagged
  for a human to open instead.
*/
const BOT_WALLED = /(^|\.)(eur-lex\.europa\.eu|federalregister\.gov|congress\.gov)$/;

const BOLD = "[1m", DIM = "[2m", RESET = "[0m";
const RED = "[31m", YELLOW = "[33m", GREEN = "[32m";

let problems = 0;
let manual = 0;

/* Both ends normalised to UTC midnight. Comparing a date-only constant with a
   `new Date()` that carries a time of day reported the framework as reviewed
   "1 days ago" on the day it was reviewed. */
function utcMidnight(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysBetween(a, b) {
  return Math.round((utcMidnight(new Date(b)) - utcMidnight(new Date(a))) / 86_400_000);
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // HEAD first; several of these hosts answer HEAD with 405, so fall back.
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { status: res.status, finalUrl: res.url };
  } catch (cause) {
    return { status: null, error: cause.name === "AbortError" ? "timed out" : cause.message };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\n${BOLD}Methane framework pre-flight${RESET}`);
console.log(`${DIM}framework last reviewed ${LAST_REVIEWED}${RESET}\n`);

// ── 1. Citations still resolve ────────────────────────────────────────────
console.log(`${BOLD}Citations${RESET}`);
for (const [key, src] of Object.entries(SOURCES)) {
  const host = new URL(src.url).hostname;
  const { status, finalUrl, error } = await checkUrl(src.url);

  if (status && status >= 200 && status < 300 && !BOT_WALLED.test(host)) {
    console.log(`  ${GREEN}ok${RESET}       ${key} ${DIM}(${status})${RESET}`);
  } else if (BOT_WALLED.test(host)) {
    manual++;
    console.log(`  ${YELLOW}by hand${RESET}  ${key} ${DIM}— ${host} blocks automated checks; open it in a browser${RESET}`);
    console.log(`           ${DIM}${src.url}${RESET}`);
  } else if (status === null) {
    problems++;
    console.log(`  ${RED}FAILED${RESET}   ${key} — ${error}`);
  } else if (status >= 400) {
    problems++;
    console.log(`  ${RED}FAILED${RESET}   ${key} — HTTP ${status}`);
    console.log(`           ${DIM}${src.url}${RESET}`);
  } else {
    manual++;
    console.log(`  ${YELLOW}check${RESET}    ${key} — HTTP ${status} → ${finalUrl}`);
  }
}

// ── 2. Dates that have gone past ──────────────────────────────────────────
console.log(`\n${BOLD}Dates${RESET}`);
const today = new Date();
const passed = OBLIGATIONS.filter((o) => new Date(`${o.date}T00:00:00Z`) < today);
const soon = OBLIGATIONS.filter((o) => {
  const d = daysBetween(today, new Date(`${o.date}T00:00:00Z`));
  return d >= 0 && d <= 120;
});

if (!passed.length) {
  console.log(`  ${GREEN}ok${RESET}       no obligation date has passed`);
} else {
  for (const o of passed) {
    manual++;
    const ago = -daysBetween(today, new Date(`${o.date}T00:00:00Z`));
    console.log(`  ${YELLOW}passed${RESET}   ${o.id} — ${o.date}, ${ago} days ago`);
    console.log(`           ${DIM}Still the right date to show? If the deadline moved or was met,${RESET}`);
    console.log(`           ${DIM}the finding needs rewording, not just re-dating.${RESET}`);
  }
}
for (const o of soon) {
  console.log(`  ${DIM}soon     ${o.id} — ${o.date}, in ${daysBetween(today, new Date(`${o.date}T00:00:00Z`))} days${RESET}`);
}

// ── 3. Staleness ──────────────────────────────────────────────────────────
console.log(`\n${BOLD}Freshness${RESET}`);
const age = daysBetween(new Date(`${LAST_REVIEWED}T00:00:00Z`), today);
if (age > STALE_AFTER_DAYS) {
  problems++;
  console.log(`  ${RED}STALE${RESET}    reviewed ${age} days ago — the page shows this date, and a`);
  console.log(`           reader who checks it will discount everything else.`);
} else {
  console.log(`  ${GREEN}ok${RESET}       reviewed ${age} days ago`);
}

// ── 4. What a script cannot answer ────────────────────────────────────────
console.log(`\n${BOLD}Open questions — these need a person${RESET}`);
const QUESTIONS = [
  [
    "Has EPA finalised the GHGRP rescission?",
    "Proposed 16 Sept 2025 (90 FR / docket EPA-HQ-OAR-2025-0186): remove gas distribution from Subpart W, suspend the rest until 2034. If it is final, the us-ghgrp finding changes materially. The 30 Oct 2026 deadline for CY2025 stood as of the last review, per 91 FR 9712.",
  ],
  [
    "Is the EU Methane Transparency Database live?",
    "Article 30(1) required it by 5 Feb 2026 and it was not live. Launch has been reported for September 2026. If it has launched, eu-database stops being a 'get ready' item and becomes a 'you are visible now' item.",
  ],
  [
    "Have the Article 27–29 importer rules been amended?",
    "The 2027 and 2030 import dates are the spine of the commercial findings. Check for amending regulations or delegated acts since the last review.",
  ],
  [
    "Has an OGMP 2.0 reporting cycle changed the Level 4/5 expectations?",
    "UNEP updates the framework independently of the EU timetable.",
  ],
];
for (const [q, why] of QUESTIONS) {
  console.log(`\n  ${BOLD}·${RESET} ${q}`);
  console.log(`    ${DIM}${why}${RESET}`);
}

console.log(`\n${BOLD}After reviewing, set LAST_REVIEWED in lib/methane/framework.mjs${RESET}`);
console.log(`${DIM}to today's date — it is shown on every report and in every email.${RESET}\n`);

if (problems) {
  console.error(`${RED}${problems} problem(s) need fixing.${RESET} ${manual} item(s) need checking by hand.\n`);
  process.exit(1);
}
console.log(`No broken citations. ${manual} item(s) need checking by hand.\n`);
