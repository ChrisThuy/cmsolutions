/*
  Renders the share cards from their HTML sources.

    node scripts/make-og.mjs

  Headless Chrome rather than an SVG toolchain, for two reasons: the cards use
  the same web fonts and CSS the site uses, so they stay in step with the brand
  without a second set of assets; and there is no converter installed on this
  machine that handles the blurs and web fonts correctly.

  The PNGs are build output. Edit the .html source and re-run — a hand-edited
  PNG is a change nobody can reproduce.
*/

import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* Facebook, LinkedIn and WhatsApp all accept 1.91:1; 2400x1260 is what the
   existing site card uses, so the pair stay consistent. */
const CARDS = [
  { source: "scripts/og-methane.html", output: "og-methane.png", width: 2400, height: 1260 },
];

async function render({ source, output, width, height }) {
  const from = resolve(root, source);
  const to = resolve(root, output);
  await access(from);

  await run(CHROME, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    // Fonts come from Google Fonts, so this render needs the network. Without
    // it Chrome silently falls back to Georgia and the card ships off-brand.
    `--screenshot=${to}`,
    `--window-size=${width},${height}`,
    "--default-background-color=00000000",
    // Give the webfont time to land. Chrome screenshots as soon as load
    // fires, which on a cold font cache is before Fraunces has swapped in.
    "--virtual-time-budget=4000",
    `file://${from}`,
  ]);

  const { size } = await stat(to);
  if (size < 20_000) {
    throw new Error(`${output} came out at ${size} bytes — the page probably rendered blank.`);
  }
  console.log(`  ${output}  ${width}x${height}  ${(size / 1024).toFixed(0)} KB`);
}

try {
  await access(CHROME);
} catch {
  console.error(`Chrome not found at ${CHROME}. Install it or point CHROME at another build.`);
  process.exit(1);
}

for (const card of CARDS) await render(card);
console.log("\nCards rendered. Check them before deploying — a share card is the\nfirst thing a stranger sees and the last thing anyone reviews.\n");
