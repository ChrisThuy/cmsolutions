/*
  Higgsfield Seedance 2.0, through the CLI.

  ── why the CLI and not an HTTP call ──

  The CLI holds the session, so there is no key to store, rotate or leak from
  a serverless function — and there is no serverless function here anyway.
  This runs from scripts/build-film.mjs, on a machine someone is sitting at,
  because a five-shot film takes minutes and costs money per run. That was
  already true of the fal path; nothing about the Premium tier becomes
  self-serve by adding a second engine.

  ── what this engine does that fal did not ──

  Seedance pins BOTH ends of a clip: --start-image and --end-image. The fal
  path could only pin the start, so each clip drifted freely toward whatever
  it wanted its last frame to be, and the next clip inherited that drift. The
  worst seam measured 0.911 SSIM, which reads as a soft cut rather than a
  continuous move.

  Pinning both ends changes the shape of the chain. Instead of

      keyframe -> clip -> its last frame -> clip -> ...

  it becomes

      keyframe A, keyframe B, keyframe C ...   (all generated first)
      clip 1 travels A->B, clip 2 travels B->C

  so every junction is a frame that both neighbouring clips were explicitly
  given. The seam is not measured and hoped for; it is constructed.

  ── on parsing CLI output ──

  Job ids are read out of the create response and never guessed from a job
  list. Two builds running at once would otherwise attach to each other's
  jobs, and the failure is silent: you download somebody else's clip and it
  looks fine. The skill's own chain-step.sh makes the same point.
*/

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const MP4 = /https:\/\/[^"\s]+\.mp4[^"\s]*/g;

/** Seedance's own rule: fast tops out at 720p. */
export const modeFor = (resolution) => (resolution === "1080p" || resolution === "4k" ? "std" : "fast");

export async function higgsfieldAvailable() {
  try {
    const { stdout } = await run("higgsfield", ["auth", "token"], { timeout: 15_000 });
    return UUID.test(stdout) || /^oat_/.test(stdout.trim());
  } catch {
    return false;
  }
}

/** Email, plan and — the part that matters before a run — credits. */
export async function accountStatus() {
  const { stdout } = await run("higgsfield", ["account", "status"], { timeout: 20_000 });
  const text = stdout.trim();
  const credits = Number(text.match(/([\d,]+)\s*credits/i)?.[1]?.replace(/,/g, "") ?? NaN);
  return { text, credits: Number.isFinite(credits) ? credits : null };
}

/**
 * Builds the argument list for one clip.
 *
 * Separated from running it so the arguments can be asserted in a test
 * without a Higgsfield account, and so a dry run can print exactly what
 * would be spent before anything is.
 */
export function createArgs({ prompt, startImage, endImage, seconds = 5, resolution = "1080p" }) {
  if (!prompt) throw new Error("A shot needs a prompt.");
  if (!startImage) throw new Error("A chained shot needs a start image.");

  const args = [
    "generate", "create", "seedance_2_0",
    "--prompt", prompt,
    "--start-image", startImage,
  ];
  // The whole reason for this engine. Omitted only for a final shot that is
  // deliberately allowed to travel somewhere new.
  if (endImage) args.push("--end-image", endImage);

  args.push(
    "--duration", String(seconds),
    "--resolution", resolution,
    "--mode", modeFor(resolution),
    // A scroll-film is scrubbed by the reader; it has no timeline of its own
    // and audio would never play. Generating it wastes the render.
    "--generate-audio", "false",
    "--json",
  );
  return args;
}

/**
 * Generates one clip and returns its mp4 URL.
 *
 * `onStep` reports progress rather than printing, so the CLI owns the
 * narration and this stays usable from a test.
 */
export async function generateClip(opts, { timeoutMinutes = 15, onStep = () => {} } = {}) {
  const args = createArgs(opts);
  onStep({ step: "create", model: "seedance_2_0", resolution: opts.resolution });

  const created = await run("higgsfield", args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const jobId = `${created.stdout}${created.stderr}`.match(UUID)?.[0];
  if (!jobId) {
    throw new Error(
      "Could not read a job id from the create response. Not guessing from the job " +
      "list — that can attach to an unrelated job and download the wrong clip.",
    );
  }
  onStep({ step: "queued", jobId });

  const waited = await run(
    "higgsfield",
    ["generate", "wait", jobId, "--timeout", `${timeoutMinutes}m`, "--interval", "5s", "--json"],
    { timeout: (timeoutMinutes + 2) * 60_000, maxBuffer: 8 * 1024 * 1024 },
  );

  const urls = `${waited.stdout}${waited.stderr}`.match(MP4);
  if (!urls?.length) {
    // Worth saying: Higgsfield does not bill a server-side failure, so the
    // correct response is to retry rather than to treat it as money lost.
    throw new Error("The job finished without an mp4. Server-side failures are unbilled — retry.");
  }

  onStep({ step: "ready", jobId });
  return { url: urls[urls.length - 1], jobId };
}
