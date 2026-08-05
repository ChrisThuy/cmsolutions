/*
  Pre-flight check for the FuelEU Maritime and EU ETS calculator.

    npm run maritime:verify

  Same job as the methane verifier and the same limits: it confirms the
  citations still resolve, re-runs the calibration that stands in for the
  parts of Annex I that are published as images, and prints the questions a
  script cannot answer.

  This tool prints euros, so it carries a risk the methane tool does not. A
  stale obligation there produces a finding somebody argues with. A stale
  emission factor here produces a confident number in somebody's budget.
*/

import {
  ETS_PHASE_IN, FUELS, GWP, LAST_REVIEWED, PENALTY, REDUCTIONS,
  REFERENCE_INTENSITY, SOURCES, limitForYear,
} from "../lib/maritime/framework.mjs";
import { fuelIntensity } from "../lib/maritime/calculate.mjs";

const TIMEOUT_MS = 20_000;
const STALE_AFTER_DAYS = 60;

/* EUR-Lex answers automated requests with 202 and an empty body. That is a
   bot wall, not a broken link, and reporting it as broken would train the
   reader to ignore this script. */
const BOT_WALLED = /(^|\.)eur-lex\.europa\.eu$/;

const BOLD = "[1m", DIM = "[2m", RESET = "[0m";
const RED = "[31m", YELLOW = "[33m", GREEN = "[32m";

let problems = 0;
let manual = 0;

function utcMidnight(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
const daysBetween = (a, b) =>
  Math.round((utcMidnight(new Date(b)) - utcMidnight(new Date(a))) / 86_400_000);

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { status: res.status };
  } catch (cause) {
    return { status: null, error: cause.name === "AbortError" ? "timed out" : cause.message };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\n${BOLD}Maritime framework pre-flight${RESET}`);
console.log(`${DIM}framework last reviewed ${LAST_REVIEWED}${RESET}\n`);

// ── 1. Citations ──────────────────────────────────────────────────────────
console.log(`${BOLD}Citations${RESET}`);
for (const [key, src] of Object.entries(SOURCES)) {
  const host = new URL(src.url).hostname;
  const { status, error } = await checkUrl(src.url);
  if (BOT_WALLED.test(host)) {
    manual++;
    console.log(`  ${YELLOW}by hand${RESET}  ${key} ${DIM}— EUR-Lex blocks automated checks; open it${RESET}`);
    console.log(`           ${DIM}${src.url}${RESET}`);
  } else if (status && status >= 200 && status < 300) {
    console.log(`  ${GREEN}ok${RESET}       ${key} ${DIM}(${status})${RESET}`);
  } else {
    problems++;
    console.log(`  ${RED}FAILED${RESET}   ${key} — ${error ?? `HTTP ${status}`}`);
    console.log(`           ${DIM}${src.url}${RESET}`);
  }
}

// ── 2. The calibration that stands in for Annex I ─────────────────────────
console.log(`\n${BOLD}Calibration${RESET}`);
{
  const hfo = fuelIntensity(FUELS.find((f) => f.id === "hfo"));
  const drift = Math.abs(hfo - REFERENCE_INTENSITY);
  if (drift <= 1) {
    console.log(`  ${GREEN}ok${RESET}       HFO computes to ${hfo.toFixed(3)} against the regulation's ${REFERENCE_INTENSITY} reference`);
  } else {
    problems++;
    console.log(`  ${RED}DRIFT${RESET}    HFO computes to ${hfo.toFixed(3)}, ${drift.toFixed(2)} from the ${REFERENCE_INTENSITY} reference.`);
    console.log(`           A factor, the formula or a GWP has changed. Do not ship a euro`);
    console.log(`           figure until this is understood.`);
  }

  const gwpOk = GWP.co2 === 1 && GWP.ch4 === 25 && GWP.n2o === 298;
  if (gwpOk) console.log(`  ${GREEN}ok${RESET}       GWPs are the AR4 values RED II names (1 / 25 / 298)`);
  else { problems++; console.log(`  ${RED}FAILED${RESET}   GWPs are not the RED II values: ${JSON.stringify(GWP)}`); }
}

// ── 3. Where the calendar has got to ──────────────────────────────────────
console.log(`\n${BOLD}Where the calendar has got to${RESET}`);
{
  const today = new Date();
  const year = today.getUTCFullYear();
  const limit = limitForYear(year);
  console.log(`  ${DIM}${year} limit is ${limit === null ? "not yet in force" : limit.toFixed(4) + " gCO2eq/MJ"}${RESET}`);

  const next = REDUCTIONS.find((r) => r.from > year);
  if (next) {
    const days = daysBetween(today, new Date(Date.UTC(next.from, 0, 1)));
    console.log(`  ${DIM}next step ${next.from} at -${next.reduction} % — in ${days} days${RESET}`);
  }

  const etsNow = ETS_PHASE_IN.filter((p) => p.year <= year).pop();
  console.log(`  ${DIM}ETS surrender share for ${year}: ${etsNow ? etsNow.share : 0} %${RESET}`);

  // Which fuels have crossed from compliant to not since the last review.
  const overNow = FUELS.filter((f) => limit !== null && fuelIntensity(f) > limit);
  console.log(`  ${DIM}${overNow.length} of ${FUELS.length} default fuels are over the ${year} limit${RESET}`);
}

// ── 4. Freshness ──────────────────────────────────────────────────────────
console.log(`\n${BOLD}Freshness${RESET}`);
{
  const age = daysBetween(new Date(`${LAST_REVIEWED}T00:00:00Z`), new Date());
  if (age > STALE_AFTER_DAYS) {
    problems++;
    console.log(`  ${RED}STALE${RESET}    reviewed ${age} days ago and shown on every result`);
  } else {
    console.log(`  ${GREEN}ok${RESET}       reviewed ${age} days ago`);
  }
  console.log(`  ${DIM}penalty rate in force: EUR ${PENALTY.eurPerVlsfoTonne} per tonne VLSFO equivalent${RESET}`);
}

// ── 5. What a script cannot answer ────────────────────────────────────────
console.log(`\n${BOLD}Open questions — these need a person${RESET}`);
const QUESTIONS = [
  [
    "Has the Commission amended Annex II?",
    "Article 4(4) empowers delegated acts to change the well-to-wake factors, including adding new fuels. Every euro figure this tool prints rests on that table. A new delegated act is the single most likely way this becomes quietly wrong.",
  ],
  [
    "Where has the IMO Net-Zero Framework got to?",
    "It runs on its own timetable, not the EU's, and a shipowner planning past 2030 needs both. This tool covers only the EU regimes and says so — but if the IMO measures are in force, the answer it gives is no longer the whole answer.",
  ],
  [
    "Have the FuelEU implementing acts changed the scope or the reporting?",
    "Article 2(2) required implementing acts by 31 December 2025. Check whether they narrow or widen what is counted.",
  ],
  [
    "Is the ETS phase-in still 40/70/100, and has the scope been extended?",
    "Article 3gb is a fixed schedule and 100 % from 2026 — but the review clauses could bring in ships below 5 000 GT, which recital 30 explicitly leaves for later.",
  ],
  [
    "Do the biofuel pathways now have usable default values?",
    "The tool deliberately omits biofuels because Annex II points at certified RED II production pathways. If that changes, the omission stops being honest and starts being a gap.",
  ],
];
for (const [q, why] of QUESTIONS) {
  console.log(`\n  ${BOLD}·${RESET} ${q}`);
  console.log(`    ${DIM}${why}${RESET}`);
}

console.log(`\n${BOLD}After reviewing, set LAST_REVIEWED in lib/maritime/framework.mjs${RESET}`);
console.log(`${DIM}to today's date — it is shown on every result.${RESET}\n`);

if (problems) {
  console.error(`${RED}${problems} problem(s) need fixing.${RESET} ${manual} item(s) need checking by hand.\n`);
  process.exit(1);
}
console.log(`No broken citations. ${manual} item(s) need checking by hand.\n`);
