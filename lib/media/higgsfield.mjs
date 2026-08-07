/*
  Higgsfield Seedance 2.0, through the CLI.

  ── why the CLI and not an HTTP call ──

  The CLI holds the session, so there is no key to store, rotate or leak from
  a serverless function — and there is no serverless function here anyway.
  This runs from scripts/build-film.mjs, on a machine someone is sitting at,
  because a five-shot film takes minutes and costs money per run. That was
  already true of the previous engine; nothing about the Premium tier becomes
  self-serve by adding a second engine.

  ── what this engine does that the previous one could not ──

  Seedance pins BOTH ends of a clip: --start-image and --end-image. The
  previous engine could only pin the start, so each clip drifted freely toward whatever
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

/**
 * Uploads a local file and returns its media id.
 *
 * References are given to the generator as ids rather than paths so the same
 * photograph is uploaded once and reused across every keyframe and clip in a
 * film, instead of being re-sent a dozen times.
 */
export async function uploadMedia(path) {
  const { stdout, stderr } = await run("higgsfield", ["upload", "create", path, "--json"],
    { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  const id = `${stdout}${stderr}`.match(UUID)?.[0];
  if (!id) throw new Error(`Upload did not return an id for ${path}`);
  return id;
}

/** Email, plan and — the part that matters before a run — credits. */
export async function accountStatus() {
  const { stdout } = await run("higgsfield", ["account", "status"], { timeout: 20_000 });
  const text = stdout.trim();
  /* The fraction is not decoration: balances read "429.74 credits", and a
     pattern of digits and commas alone matches only the "74" on the end —
     a reading five times too small, in the direction that refuses a run
     there is easily enough credit for. */
  const credits = Number(text.match(/([\d,]+(?:\.\d+)?)\s*credits/i)?.[1]?.replace(/,/g, "") ?? NaN);
  return { text, credits: Number.isFinite(credits) ? credits : null };
}

/**
 * Builds the argument list for one clip.
 *
 * Separated from running it so the arguments can be asserted in a test
 * without a Higgsfield account, and so a dry run can print exactly what
 * would be spent before anything is.
 */
export function createArgs({ prompt, startImage, endImage, seconds = 5, resolution = "1080p", references = [] }) {
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

  /*
    The client's own photographs.

    Passed as --image=<id>, with the equals sign: the space-separated form
    is parsed as part of the parameter name and the CLI rejects the whole
    call with "Unknown params". Found by running it, not by reading help.

    Seedance allows nine image references in total and the two pins count
    toward that, so the room left is seven.
  */
  for (const id of references.slice(0, endImage ? 7 : 8)) args.push(`--image=${id}`);

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

/*
  Boundary keyframes, on the same engine as the clips.

  Generating the stills somewhere else was the last reason this pipeline
  needed a second account, and it was also a quality argument: a keyframe
  from a different model is a different world, and every clip that starts
  on it inherits that mismatch. One engine, one look.

  Soul 2.0 is the choice for cinematic stills. 16:9 always — the film is
  scrubbed full-bleed and a square frame would be cropped to nothing.
*/
export function imageArgs({ prompt, quality = "2k", references = [], soulId = null }) {
  if (!prompt) throw new Error("A keyframe needs a prompt.");
  const args = [
    "generate", "create", "text2image_soul_v2",
    "--prompt", prompt,
    "--aspect-ratio", "16:9",
    "--quality", quality,
  ];
  // Soul 2.0 takes one reference. A trained Soul id is stronger than a
  // single photograph and takes precedence when both are present.
  if (soulId) args.push(`--custom-reference-id=${soulId}`);
  else if (references[0]) args.push(`--image=${references[0]}`);
  args.push("--json");
  return args;
}

/**
 * Trains a Soul reference on the client's own photographs.
 *
 * Worth it when a film has to look like one real place: a single reference
 * steers one frame, a trained Soul steers every frame the same way. Needs
 * 5–20 images, which is also the honest minimum to ask a client for.
 */
export function soulTrainArgs({ name, images }) {
  if (!name) throw new Error("A Soul reference needs a name.");
  if (!Array.isArray(images) || images.length < 5) {
    throw new Error("Soul training needs at least 5 images (20 maximum).");
  }
  const args = ["soul-id", "create", "--name", name, "--soul-2"];
  for (const img of images.slice(0, 20)) args.push("--image", img);
  args.push("--json");
  return args;
}

const IMAGE_URL = /https:\/\/[^"\s]+\.(?:png|jpg|jpeg|webp)[^"\s]*/g;

export async function generateKeyframe(opts, { timeoutMinutes = 10, onStep = () => {} } = {}) {
  const args = imageArgs(opts);
  onStep({ step: "keyframe-create", model: "text2image_soul_v2" });

  const created = await run("higgsfield", args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const jobId = `${created.stdout}${created.stderr}`.match(UUID)?.[0];
  if (!jobId) throw new Error("Could not read a job id from the keyframe create response.");

  const waited = await run(
    "higgsfield",
    ["generate", "wait", jobId, "--timeout", `${timeoutMinutes}m`, "--interval", "3s", "--json"],
    { timeout: (timeoutMinutes + 2) * 60_000, maxBuffer: 8 * 1024 * 1024 },
  );

  const urls = `${waited.stdout}${waited.stderr}`.match(IMAGE_URL);
  if (!urls?.length) throw new Error("The keyframe job finished without an image. Unbilled on failure — retry.");

  onStep({ step: "keyframe-ready", jobId });
  return { url: urls[urls.length - 1], jobId };
}
