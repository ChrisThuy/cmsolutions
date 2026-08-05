/*
  Runs every test suite and reports all of them.

    npm test

  This exists because `npm test` used to be a chain of `&&` naming three
  suites, while seven sat in this directory. The SSRF guard's tests were among
  the four that never ran — a security control with tests nobody executed is
  worse than one without tests, because it looks covered.

  Two decisions. Suites are discovered from disk rather than listed, so
  writing a new test file is enough to have it run; a list is a thing that
  goes stale silently. And a failing suite does not stop the others: `&&`
  hides every failure after the first, which is exactly when you most want to
  see the whole picture.
*/

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const BOLD = "[1m", DIM = "[2m", RESET = "[0m";
const RED = "[31m", GREEN = "[32m";

function run(file) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(here, file)], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => done({ file, code, output }));
  });
}

const files = (await readdir(here))
  .filter((f) => f.startsWith("test-") && f.endsWith(".mjs") && f !== "test-all.mjs")
  .sort();

// The generated agent indexes are checked here too — a data file edited
// without regenerating leaves the served HTML claiming the old agent count.
const extra = [{ file: "build-agent-index.mjs", args: ["--check"] }];

console.log(`\n${BOLD}Running ${files.length + extra.length} suites${RESET}\n`);

const results = [];
for (const file of files) results.push(await run(file));

for (const { file, args } of extra) {
  results.push(
    await new Promise((done) => {
      const child = spawn(process.execPath, [resolve(here, file), ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("close", (code) => done({ file, code, output }));
    }),
  );
}

const failed = results.filter((r) => r.code !== 0);

for (const r of results) {
  const name = r.file.replace(/^test-|\.mjs$/g, "").padEnd(20);
  if (r.code === 0) {
    const passes = (r.output.match(/ {2}PASS /g) ?? []).length;
    console.log(`  ${GREEN}pass${RESET}  ${name} ${DIM}${passes} check${passes === 1 ? "" : "s"}${RESET}`);
  } else {
    console.log(`  ${RED}FAIL${RESET}  ${name}`);
  }
}

// Only the failures get their output printed. A wall of passing checks is how
// a failure goes unread.
for (const r of failed) {
  console.log(`\n${BOLD}${RED}── ${r.file} ──${RESET}`);
  for (const line of r.output.split("\n")) {
    if (/FAIL|Error|error:/.test(line)) console.log(line);
  }
}

const total = results.reduce((n, r) => n + (r.output.match(/ {2}PASS /g) ?? []).length, 0);

if (failed.length) {
  console.error(`\n${RED}${failed.length} of ${results.length} suites failed.${RESET}\n`);
  process.exit(1);
}
console.log(`\n${GREEN}All ${results.length} suites passed${RESET} ${DIM}(${total} checks)${RESET}\n`);
