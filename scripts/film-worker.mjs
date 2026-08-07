#!/usr/bin/env node
/*
  The film worker.

  Runs on the Hetzner box, where nothing is killed after five minutes. Claims
  a queued job, builds the film, writes progress back, uploads the result.

    node scripts/film-worker.mjs           run until stopped
    node scripts/film-worker.mjs --once    claim at most one job and exit

  ── why this exists at all ──

  A seven-shot film is about thirty-five minutes of generation and a Vercel
  function is killed at three hundred seconds. The button therefore cannot do
  the work; it can only ask for it. This is the thing that does it.

  ── what it needs ──

    · the higgsfield CLI, logged in (its credentials file is portable)
    · ffmpeg and ffprobe, for frames and the junction gate
    · AUDIT_SUPABASE_URL, AUDIT_SUPABASE_ANON_KEY, AUDIT_SERVICE_SECRET

  The service secret is what separates this from a visitor: claiming a job,
  reporting progress and finishing one all require it, and none of those are
  granted to anon. A worker that could be impersonated could mark films
  finished that were never made.
*/

import { readFile } from "node:fs/promises";
import { buildFilm } from "../lib/film/pipeline.mjs";

const ONCE = process.argv.includes("--once");
const IDLE_MS = 15_000;

const url = process.env.AUDIT_SUPABASE_URL;
const anonKey = process.env.AUDIT_SUPABASE_ANON_KEY;
const secret = process.env.AUDIT_SERVICE_SECRET;

if (!url || !anonKey || !secret) {
  console.error("Set AUDIT_SUPABASE_URL, AUDIT_SUPABASE_ANON_KEY and AUDIT_SERVICE_SECRET.");
  process.exit(1);
}

async function rpc(name, body) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function runJob(job) {
  say(`claimed ${job.id} — ${job.slug} at ${job.resolution}`);
  const outDir = `/var/lib/cmfilm/${job.id}`;
  const total = (job.film_spec.chapters?.length ?? 0) * 2 + 2;
  let step = 0;

  const report = async (text) => {
    step += 1;
    try { await rpc("film_job_progress", { p_secret: secret, p_id: job.id, p_progress: text, p_step: step, p_of: total }); }
    catch (cause) { say(`  progress write failed: ${cause.message}`); }
  };

  try {
    const manifest = await buildFilm({
      spec: job.film_spec,
      outDir,
      seconds: 5,
      resolution: job.resolution,
      frames: 240,
      onStep(s) {
        if (s.step === "keyframe") report(`Framing shot ${s.index + 1} of ${s.of}`);
        else if (s.step === "clip") report(`Filming “${s.name}” — ${s.index + 1} of ${s.of}`);
        else if (s.step === "assemble") report("Cutting the film together");
        else if (s.step === "frames") report("Preparing it to scrub");
      },
    });

    /*
      The film is stored where the demo route can serve it, in the same
      table as the generated images. A 480p thirty-five-second film is a
      few megabytes of base64 — larger than an image and well inside what
      the column allows.
    */
    const bytes = await readFile(`${outDir}/film.mp4`);
    const id = await rpc("store_site_image", { p_data: bytes.toString("base64"), p_mime: "video/mp4" });
    const filmUrl = `${process.env.SITE_ORIGIN ?? "https://cmsolutions.tech"}/api/demo?img=${id}`;

    await rpc("finish_film_job", { p_secret: secret, p_id: job.id, p_film_url: filmUrl, p_error: null });
    say(`done ${job.id} — ${manifest.frames} frames, worst seam ${manifest.worstJunction}`);
  } catch (cause) {
    say(`failed ${job.id}: ${cause.message}`);
    // The visitor is told something plain; the detail stays in the log.
    await rpc("finish_film_job", {
      p_secret: secret, p_id: job.id, p_film_url: null,
      p_error: "The film could not be completed. Nothing further was charged.",
    }).catch(() => {});
  }
}

say(`worker up${ONCE ? " (one job)" : ""}`);
for (;;) {
  let job = null;
  try {
    const rows = await rpc("claim_film_job", { p_secret: secret });
    job = Array.isArray(rows) ? rows[0] : rows;
  } catch (cause) {
    say(`claim failed: ${cause.message}`);
  }

  if (job) await runJob(job);
  else if (ONCE) break;

  if (ONCE && job) break;
  await new Promise((r) => setTimeout(r, job ? 1000 : IDLE_MS));
}
say("worker stopping");
