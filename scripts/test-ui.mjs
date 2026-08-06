/*
  Checks the shared UI kit, and that every inline script on the site parses.

    node scripts/test-ui.mjs

  ── why the syntax check is here ──

  These pages carry their logic in one inline <script>. A syntax error
  anywhere in it does not break a feature, it breaks the whole page — every
  handler on it stops existing, silently, with nothing visible until someone
  clicks the button that no longer works. Editing eight of those files by
  script, as the progress bar work did, is exactly how that gets introduced.

  Parsing every block is cheap and catches it before it ships. The check has
  to skip application/ld+json, which is JSON and does not parse as JS — the
  first version of this reported all fourteen pages broken for that reason.
*/

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { UI_PAGES } from "./build-ui.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const files = (await readdir(root)).filter((f) => f.endsWith(".html")).sort();
const html = new Map();
for (const f of files) html.set(f, await readFile(join(root, f), "utf8"));

/* ── every inline script parses ───────────────────────────────────── */

const work = await mkdtemp(join(tmpdir(), "cm-syntax-"));
try {
  for (const [file, source] of html) {
    const blocks = [...source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    const problems = [];

    for (const [i, m] of blocks.entries()) {
      const attrs = m[1], body = m[2];
      if (/\bsrc=/.test(attrs)) continue;
      const type = attrs.match(/type\s*=\s*"([^"]+)"/)?.[1];
      // ld+json is data, not code — parsing it as JS reports every page broken
      if (type && !/javascript|module/.test(type)) continue;
      if (!body.trim()) continue;

      const path = join(work, `${file}-${i}.mjs`);
      await writeFile(path, body);
      try {
        await run("node", ["--check", path]);
      } catch (cause) {
        const line = String(cause.stderr).split("\n").find((l) => l.includes("Error")) ?? "parse error";
        problems.push(`block ${i}: ${line.trim()}`);
      }
    }
    check(`${file}: inline scripts parse`, problems.length === 0, problems.join("; "));
  }

  /* JSON-LD is data and must be valid JSON — same silent-failure argument. */
  for (const [file, source] of html) {
    const blocks = [...source.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
    let bad = null;
    for (const m of blocks) {
      try { JSON.parse(m[1]); } catch (cause) { bad = cause.message; break; }
    }
    if (blocks.length) check(`${file}: JSON-LD is valid JSON`, bad === null, bad ?? "");
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

/* ── the kit is present where it should be, and only there ────────── */

for (const file of UI_PAGES) {
  const source = html.get(file);
  check(`${file}: kit styles`, source.includes(".prog-fill"));
  check(`${file}: kit script`, source.includes("window.CMProgress"));
  check(`${file}: a mount point`, /id="prog"/.test(source));
  check(`${file}: progress is started`, source.includes("CMProgress.attach"));
  // A bar that can reach 100% without a real response is the failure mode
  // this whole design exists to avoid.
  check(`${file}: completes only on a real response`, source.includes("prog.done("));
  check(`${file}: has a failure path`, source.includes("prog.fail("));
}

const kitted = new Set(UI_PAGES);
for (const [file, source] of html) {
  if (kitted.has(file)) continue;
  check(`${file}: no orphan progress markup`, !source.includes("CMProgress.attach"),
    "a page using the kit must be listed in UI_PAGES");
}

/* ── the pages match the generator ────────────────────────────────── */

const drift = await run("node", [join(root, "scripts/build-ui.mjs"), "--check"])
  .then(() => null).catch((e) => e);
check("no page has drifted from the kit", drift === null, drift ? "run: node scripts/build-ui.mjs" : "");

console.log(`\n  ${failures === 0 ? "All UI checks passed." : `${failures} failure(s).`}\n`);
process.exit(failures === 0 ? 0 : 1);
