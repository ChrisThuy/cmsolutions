#!/usr/bin/env node
/*
  Builds a scroll-film from a design spec.

    node scripts/build-film.mjs spec.json --out ./film
    node scripts/build-film.mjs spec.json --out ./film --tier chain --seconds 5
    node scripts/build-film.mjs spec.json --out ./film --quote-only

  ── why this is a command and not an endpoint ──

  A five-chapter chain is five generations of roughly ninety seconds each,
  plus assembly. That is well past any serverless function's ceiling and it
  costs real money per run, so it is a build step someone starts deliberately
  and watches — not something a stranger triggers by clicking a button.

  The website builder's cinematic tier points here. What it sells is a film
  built and reviewed, not a button that spends credits unattended.

  ── cost ──

  Nothing is generated until the total is printed and confirmed. --yes skips
  the prompt for scripted runs; --quote-only prints the bill and stops.
*/

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { buildFilm, quoteChain } from "../lib/film/pipeline.mjs";
import { mediaAvailable } from "../lib/media/provider.mjs";
import { accountStatus, higgsfieldAvailable } from "../lib/media/higgsfield.mjs";

const args = process.argv.slice(2);

function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? true);
}
const has = (name) => args.includes(`--${name}`);

if (!args.length || has("help")) {
  console.log(`
  Build a scroll-film from a design spec.

    node scripts/build-film.mjs <spec.json> --out <dir> [options]

    --out <dir>        where clips, frames and the film go   (required)
    --engine fal|higgsfield  which generator                 (default fal)
    --tier cheap|chain which video model                     (default cheap)
    --seconds <n>      length of each clip                   (default 5)
    --resolution <r>   480p | 720p | 1080p                   (default 480p)
    --frames <n>       stills extracted for scrubbing        (default 240)
    --quote-only       print the cost and stop
    --yes              do not ask before spending

  A spec is what /api/site-build returns — it needs chapters, each with a
  name and a visual. Draft the whole chain cheap before mastering anything.
`);
  process.exit(0);
}

const specPath = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
if (!specPath) {
  console.error("  Give me a spec file. See --help.");
  process.exit(1);
}

const outDir = flag("out");
if (!outDir && !has("quote-only")) {
  console.error("  --out is required (or use --quote-only).");
  process.exit(1);
}

let spec;
try {
  const raw = JSON.parse(await readFile(resolve(specPath), "utf8"));
  // Accept either a bare spec or the whole site-build response.
  spec = raw.spec ?? raw;
} catch (cause) {
  console.error(`  Could not read ${specPath}: ${cause.message}`);
  process.exit(1);
}

if (!spec?.chapters?.length) {
  console.error("  That spec has no chapters. It needs chapters[] with a name and a visual on each.");
  process.exit(1);
}

const seconds = Number(flag("seconds", 5));
const tier = flag("tier", "cheap");
const resolution = flag("resolution", "480p");
const frames = Number(flag("frames", 240));

const quote = quoteChain({ chapters: spec.chapters, seconds, tier });

console.log(`\n  ${spec.conceptName ?? "Untitled"}`);
console.log(`  ${spec.journey ?? ""}\n`);
console.log(`  ${quote.clips} chapters × ${seconds}s at ${tier} / ${resolution}`);
for (const [i, c] of spec.chapters.entries()) {
  console.log(`    ${i + 1}. ${c.name}`);
}
console.log(`\n  Keyframe        ${quote.keyframe} credits`);
console.log(`  ${quote.clips} clips        ${quote.perClip * quote.clips} credits  (${quote.perClip} each)`);
console.log(`  ─────────────────────────────`);
console.log(`  Total           ${quote.total} credits\n`);

if (has("quote-only")) process.exit(0);

/*
  A ceiling that --yes cannot walk through.

  --yes exists for scripted runs, and it turned a 121-credit job into
  something that started without anyone looking at the number. The prompt is
  skippable; the ceiling is not. Raise it deliberately with --max or
  FILM_MAX_CREDITS when a big run is genuinely intended.
*/
const ceiling = Number(flag("max", process.env.FILM_MAX_CREDITS ?? 60));
if (quote.total > ceiling) {
  console.error(`  This run costs ${quote.total} credits, over the ${ceiling}-credit ceiling.`);
  console.error(`  Nothing has been generated. Raise it deliberately:`);
  console.error(`    --max ${Math.ceil(quote.total / 10) * 10}    or    FILM_MAX_CREDITS=${Math.ceil(quote.total / 10) * 10}\n`);
  process.exit(1);
}

/*
  Which engine, and can it actually run.

  Checked before the confirmation prompt rather than after, because being
  asked "generate this?" by a tool that then discovers it has no credits is
  a worse experience than being told up front.
*/
const engine = flag("engine", process.env.FILM_ENGINE ?? "fal");

if (engine === "higgsfield") {
  if (!(await higgsfieldAvailable())) {
    console.error("  The higgsfield CLI is not logged in. Run: higgsfield auth login\n");
    process.exit(1);
  }
  const account = await accountStatus();
  console.log(`  engine: Higgsfield Seedance 2.0 — ${account.text}`);
  if (account.credits === 0) {
    console.error("\n  That account has no credits, so this run would fail at the first clip.");
    console.error("  Top up at higgsfield.ai, then run this again.\n");
    process.exit(1);
  }
  /* Both ends of every clip are pinned on this engine, which is the reason
     to use it — the junction is a frame both neighbours were handed, rather
     than a drift that gets measured afterwards and hoped about. */
  console.log("  seams: both ends pinned\n");
} else if (!mediaAvailable()) {
  console.error("  FAL_KEY is not set, so nothing can be generated.\n");
  process.exit(1);
}

if (!has("yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("  Generate this? [y/N] ");
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log("  Stopped. Nothing was generated.\n");
    process.exit(0);
  }
}

const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

try {
  const manifest = await buildFilm({
    spec, outDir: resolve(outDir), seconds, tier, resolution, frames,
    onStep(step) {
      switch (step.step) {
        case "keyframe":
          console.log(`  [${elapsed()}] opening keyframe…`); break;
        case "clip":
          console.log(`  [${elapsed()}] clip ${step.index + 1}/${step.of} — ${step.name}`); break;
        case "junction":
          console.log(`  [${elapsed()}]   seam ${step.index}: ${step.score} ${step.ok ? "ok" : "DRIFTED"}${step.retry ? " (after retry)" : ""}`);
          break;
        case "regenerate":
          console.log(`  [${elapsed()}]   regenerating — ${step.reason}`); break;
        case "assemble":
          console.log(`  [${elapsed()}] assembling ${step.clips} clips…`); break;
        case "frames":
          console.log(`  [${elapsed()}] extracting ${step.target} frames…`); break;
        default: break;
      }
    },
  });

  console.log(`\n  Done in ${elapsed()}.`);
  console.log(`  ${manifest.frames} frames over ${manifest.seconds.toFixed(1)}s`);
  if (manifest.junctions.length) {
    console.log(`  worst seam: ${manifest.worstJunction}`);
    const bad = manifest.junctions.filter((j) => !j.ok);
    if (bad.length) {
      console.log(`\n  ${bad.length} seam(s) still drifted after a retry:`);
      for (const j of bad) console.log(`    ${j.name} — ${j.score}`);
      console.log(`  Those joins will read as cuts. Rewrite those chapters' visuals and rebuild.`);
    }
  }
  console.log(`\n  ${resolve(outDir)}/film.mp4`);
  console.log(`  ${resolve(outDir)}/frames/\n`);
} catch (cause) {
  console.error(`\n  Failed after ${elapsed()}: ${cause.message}\n`);
  process.exit(1);
}
