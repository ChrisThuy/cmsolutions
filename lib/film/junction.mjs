import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(execFile);

/*
  Frame work and the junction gate.

  ── what a junction is and why it is measured ──

  A scroll film is one unbroken shot. It is made of several generated clips,
  and each clip is generated FROM the last frame of the one before it. So the
  join between clip N and clip N+1 should be invisible — not because it is
  hidden, but because the two frames either side of it are the same picture.

  That is a measurable claim, so it gets measured. SSIM between the last frame
  of N and the first frame of N+1 should be near 1. When it is not, the model
  drifted off the frame it was given and the join will read as a cut.

  The alternative — eyeballing it, or dissolving over the seam — is how these
  end up looking like a slideshow with crossfades. A dissolve over a bad seam
  is not a fix, it is an admission.

  ── on the threshold ──

  0.90 is deliberately not 0.99. Generated video re-encodes, and the first
  frame of a clip is never byte-identical to the image it was seeded with even
  when the continuity is perfect — measured at 0.9945 on a real pair, and
  compression alone can cost a couple of points. A threshold set too high
  rejects good joins and trains whoever is running it to raise the threshold,
  which is worse than not measuring.
*/

export const JUNCTION_THRESHOLD = 0.9;

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}

/** Duration in seconds. Needed to know where "the last frame" is. */
export async function durationOf(video) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", video,
  ]);
  const seconds = Number(String(stdout).trim());
  if (!Number.isFinite(seconds)) throw new Error(`Could not read the duration of ${video}`);
  return seconds;
}

/**
 * Pulls the last frame out of a clip.
 *
 * This is the seed for the next clip, so it is the single most important
 * artefact in the whole chain. -sseof seeks from the end, which is far
 * cheaper than decoding the whole file to reach the last frame.
 */
export async function lastFrame(video, out) {
  await run("ffmpeg", ["-v", "error", "-sseof", "-0.2", "-i", video,
    "-frames:v", "1", "-q:v", "2", "-y", out]);
  const { size } = await stat(out);
  if (size < 1000) throw new Error(`The last frame of ${video} came out empty`);
  return out;
}

export async function firstFrame(video, out) {
  await run("ffmpeg", ["-v", "error", "-i", video,
    "-frames:v", "1", "-q:v", "2", "-y", out]);
  const { size } = await stat(out);
  if (size < 1000) throw new Error(`The first frame of ${video} came out empty`);
  return out;
}

/**
 * Structural similarity between two stills, 0 to 1.
 *
 * Both are scaled to a common size and greyscaled first: the two images come
 * from different pipelines — one is a generated still, one is a decoded video
 * frame — and can differ in dimensions and colour handling without differing
 * in content.
 */
export async function similarity(a, b) {
  const { stderr, stdout } = await run("ffmpeg", [
    "-v", "error", "-i", a, "-i", b,
    "-lavfi", "[0:v]scale=256:256,format=gray[x];[1:v]scale=256:256,format=gray[y];[x][y]ssim=stats_file=-",
    "-f", "null", "-",
  ]);
  const text = `${stdout ?? ""}${stderr ?? ""}`;
  const match = text.match(/All:([0-9.]+)/);
  if (!match) throw new Error(`SSIM produced no score for ${a} vs ${b}`);
  return Number(match[1]);
}

/**
 * Checks one seam.
 *
 * `seed` is the frame the next clip was generated from; `actual` is that
 * clip's real first frame. They should be the same picture.
 */
export async function gateJunction({ seed, actual, threshold = JUNCTION_THRESHOLD }) {
  const score = await similarity(seed, actual);
  return {
    score: Number(score.toFixed(4)),
    ok: score >= threshold,
    threshold,
    // Said plainly, because the number alone does not tell you what to do.
    verdict: score >= threshold
      ? "the join is invisible"
      : "the clip drifted off its seed frame — this seam will read as a cut",
  };
}

/**
 * Joins the clips into one continuous file.
 *
 * The first frame of each clip after the first is dropped. It is a duplicate
 * of the previous clip's last frame — that is the entire point of the chain —
 * and leaving both in produces a one-frame stutter at every seam, which is
 * exactly the artefact the technique exists to avoid.
 */
export async function assemble({ clips, out, workDir, fps = 24 }) {
  if (!clips.length) throw new Error("Nothing to assemble");
  await ensureDir(workDir);

  const trimmed = [];
  for (const [i, clip] of clips.entries()) {
    const target = join(workDir, `trim-${String(i).padStart(2, "0")}.mp4`);
    if (i === 0) {
      await run("ffmpeg", ["-v", "error", "-i", clip, "-an", "-c:v", "libx264",
        "-preset", "veryfast", "-crf", "20", "-r", String(fps), "-y", target]);
    } else {
      // Skip one frame at the head: it is the previous clip's last frame.
      await run("ffmpeg", ["-v", "error", "-i", clip,
        "-vf", `select='gte(n\\,1)',setpts=PTS-STARTPTS`, "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(fps), "-y", target]);
    }
    trimmed.push(target);
  }

  const listFile = join(workDir, "concat.txt");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(listFile, trimmed.map((f) => `file '${f}'`).join("\n"));

  await run("ffmpeg", ["-v", "error", "-f", "concat", "-safe", "0", "-i", listFile,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p", "-fps_mode", "vfr", "-y", out]);

  return out;
}

/**
 * Explodes the film into stills for scroll-scrubbing.
 *
 * Frames rather than a video element because seeking an MP4 on every scroll
 * tick is what makes these pages stutter — the decoder is not built for it.
 * A bounded number of stills, decoded once and held as ImageBitmaps, scrubs
 * at whatever rate the scroll produces.
 */
export async function explodeFrames({ video, dir, count = 240, width = 1280 }) {
  await rm(dir, { recursive: true, force: true });
  await ensureDir(dir);

  const seconds = await durationOf(video);
  const rate = count / seconds;

  await run("ffmpeg", ["-v", "error", "-i", video,
    "-vf", `fps=${rate.toFixed(4)},scale=${width}:-2`,
    "-q:v", "4", "-y", join(dir, "f-%04d.jpg")]);

  const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
  if (!files.length) throw new Error("Frame extraction produced nothing");
  return { files, count: files.length, seconds };
}
