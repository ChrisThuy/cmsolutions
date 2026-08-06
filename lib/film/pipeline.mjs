import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
import { generateImage, generateVideo } from "../media/provider.mjs";
import { priceOf } from "../media/credits.mjs";
import {
  assemble, ensureDir, explodeFrames, firstFrame, gateJunction, lastFrame,
} from "./junction.mjs";
import { renderFilmPage } from "./page.mjs";

/*
  The chain: a storyboard in, one continuous film out.

  ── the shape of it ──

    keyframe ──▶ clip 1 ──▶ last frame ──▶ clip 2 ──▶ last frame ──▶ clip 3
                    │                         │                        │
                  gate                      gate                     gate

  Every clip after the first is generated FROM the previous clip's last frame,
  and every seam is measured rather than trusted. That is what makes it one
  shot instead of three clips with dissolves over the joins.

  ── cost discipline ──

  Generation is the only expensive thing here and it is spent before anyone
  has seen the result, so:

    · the whole chain is drafted at the cheap tier and the cheap resolution
      first, so a storyboard that does not work costs pennies to find out;
    · the total is quoted before a single call is made, never after;
    · a failed junction is regenerated once, not silently accepted, and not
      retried forever.

  Mastering at full resolution is a separate pass over prompts that have
  already been approved.
*/

/** What a chain will cost before any of it is spent. */
export function quoteChain({ chapters, seconds = 5, tier = "cheap" }) {
  const clips = chapters.length;
  const perClip = priceOf(tier === "chain" ? "video.chain" : "video.cheap", { seconds });
  const keyframe = priceOf("image.draft");
  return {
    clips,
    seconds,
    tier,
    perClip,
    keyframe,
    total: keyframe + perClip * clips,
  };
}

/**
 * Turns a chapter into a shot instruction.
 *
 * The camera direction is explicit and continuous — "continue the same
 * unbroken take" — because the model is being handed the previous frame and
 * asked to carry on, not to start something new. Prompts that describe a
 * scene rather than a continuation are what produce a cut.
 */
export function shotPrompt(chapter, index) {
  const opening = index === 0
    ? "Open on"
    : "Continue the same unbroken take, moving on from exactly this frame:";
  return [
    opening,
    chapter.visual,
    "Slow, deliberate camera movement. Cinematic, no cuts, no titles, no text on screen.",
  ].join(" ");
}

/**
 * Builds the whole film.
 *
 * onStep is called with plain progress so a CLI can narrate it; nothing here
 * prints, because a library that writes to stdout cannot be used twice.
 */
export async function buildFilm({
  spec,
  outDir,
  seconds = 5,
  tier = "cheap",
  resolution = "480p",
  frames = 240,
  onStep = () => {},
}) {
  const chapters = spec.chapters ?? [];
  if (!chapters.length) throw new Error("The spec has no chapters to film");

  const clipsDir = await ensureDir(join(outDir, "clips"));
  const workDir = await ensureDir(join(outDir, "work"));

  const quote = quoteChain({ chapters, seconds, tier });
  onStep({ step: "quote", ...quote });

  /* ── the opening keyframe ─────────────────────────────────────────────
     Everything downstream inherits this frame's world — its palette, its
     light, its lens. It is worth generating at the better tier even in a
     draft chain, because a weak opening frame poisons every clip after it. */
  onStep({ step: "keyframe", of: chapters.length });
  const opening = await generateImage({
    prompt: `${chapters[0].visual}. Cinematic still, ${spec.conceptName ?? ""}. No text, no titles, no watermark.`,
    tier: "draft",
    size: "landscape_16_9",
  });

  const junctions = [];
  const clipFiles = [];
  let seedUrl = opening.url;
  let seedFile = null;

  for (const [i, chapter] of chapters.entries()) {
    onStep({ step: "clip", index: i, of: chapters.length, name: chapter.name });

    let clip = await generateVideo({
      prompt: shotPrompt(chapter, i),
      startImage: seedUrl,
      seconds,
      tier,
      resolution,
    });

    let localClip = join(clipsDir, `clip-${String(i).padStart(2, "0")}.mp4`);
    await download(clip.url, localClip);

    /* ── the gate ───────────────────────────────────────────────────────
       Compare the frame this clip was seeded with against the frame it
       actually starts on. They should be the same picture. */
    if (seedFile) {
      const actual = join(workDir, `first-${i}.jpg`);
      await firstFrame(localClip, actual);
      let gate = await gateJunction({ seed: seedFile, actual });
      onStep({ step: "junction", index: i, ...gate });

      if (!gate.ok) {
        /* One regeneration, not a loop. If a second attempt from the same
           seed also drifts, the problem is the prompt or the seed, and
           spending more credits on it will not fix either. */
        onStep({ step: "regenerate", index: i, reason: gate.verdict });
        clip = await generateVideo({
          prompt: `${shotPrompt(chapter, i)} The first frame must match the supplied image exactly.`,
          startImage: seedUrl, seconds, tier, resolution,
        });
        localClip = join(clipsDir, `clip-${String(i).padStart(2, "0")}b.mp4`);
        await download(clip.url, localClip);
        await firstFrame(localClip, actual);
        gate = await gateJunction({ seed: seedFile, actual });
        onStep({ step: "junction", index: i, retry: true, ...gate });
      }
      junctions.push({ index: i, name: chapter.name, ...gate });
    }

    clipFiles.push(localClip);

    // This clip's last frame seeds the next one. Uploaded nowhere — fal takes
    // a URL, so the frame has to be reachable; see the note in the CLI.
    seedFile = join(workDir, `last-${i}.jpg`);
    await lastFrame(localClip, seedFile);
    seedUrl = await frameAsDataUri(seedFile, workDir, i);
  }

  onStep({ step: "assemble", clips: clipFiles.length });
  const film = join(outDir, "film.mp4");
  await assemble({ clips: clipFiles, out: film, workDir });

  onStep({ step: "frames", target: frames });
  const exploded = await explodeFrames({ video: film, dir: join(outDir, "frames"), count: frames });

  const manifest = {
    concept: spec.conceptName,
    chapters: chapters.map((c) => ({ name: c.name, visual: c.visual })),
    clips: clipFiles.length,
    seconds: exploded.seconds,
    frames: exploded.count,
    junctions,
    worstJunction: junctions.length ? Math.min(...junctions.map((j) => j.score)) : null,
    quote,
  };
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // The frames are only useful attached to something that scrubs them.
  await writeFile(join(outDir, "index.html"), renderFilmPage({ manifest, spec }));

  onStep({ step: "done", ...manifest });
  return manifest;
}

async function download(url, to) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(to, buffer);
  return to;
}

/*
  A seed frame has to reach fal somehow. The obvious route is uploading it and
  passing a URL, which means depending on a storage API and adding a failure
  mode between every pair of clips.

  It turns out not to be necessary: a base64 data URI passed as the start
  frame is accepted AND used. Verified rather than assumed — a clip seeded
  this way was measured at 0.994 SSIM against its seed, which is the same
  number a hosted URL gives. The whole upload path is gone.

  The frame is downscaled first. Full-size it was 1.2 MB, which is a 1.6 MB
  request body per clip for no gain; at 1280 wide it is 68 KB and the model
  sees the same picture.
*/
async function frameAsDataUri(file, workDir, index) {
  const scaled = join(workDir, `seed-${index}.jpg`);
  await run("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=1280:-2",
    "-q:v", "4", "-y", scaled]);
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(scaled);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
