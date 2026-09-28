/*
  Renders every share card.

    npm run og

  Headless Chrome rather than an SVG toolchain, for two reasons: the cards use
  the same web fonts and CSS the site uses, so they stay in step with the brand
  without a second set of assets; and no converter on this machine handles the
  blurs and web fonts correctly.

  ── why the cards are generated from a table rather than hand-written ──

  Ten of twelve pages were falling back to the site-wide card, which says "AI
  Architect and Product Builder". That is true, and it tells someone sent a
  link to the invoice extractor absolutely nothing. But hand-writing a card
  per page meant hand-maintaining a stylesheet per page, and the two that
  existed had already drifted apart.

  So there is one layout and a table of claims. Adding a card is a row.

  The claims are the pages' own headlines, not marketing written for the card.
  If a claim would not survive being read next to the tool it links to, it
  does not belong on the card either.

  The PNGs are build output. Edit the table and re-run — a hand-edited PNG is
  a change nobody can reproduce.
*/

import { execFile } from "node:child_process";
import { access, stat, writeFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* Facebook, LinkedIn and WhatsApp all accept 1.91:1. 2400x1260 matches the
   original site card, so the whole set stays consistent. */
const WIDTH = 2400;
const HEIGHT = 1260;

/*
  dots: the small strip under the sub-line. Each entry is [position%, colour].
  It exists so a card is recognisable at thumbnail size, where no word is
  legible — the shape reads before the type does. Colours are the palette's
  status colours, used to mean the same thing they mean in the tool.
*/
const CARDS = [
  {
    output: "og-methane.png",
    section: "Methane Readiness",
    claim: 'From 2030, a cargo that cannot evidence its methane intensity <em>cannot be sold into Europe</em>.',
    sub: 'Find out where you stand in four minutes — a dated gap check against <b>Regulation (EU) 2024/1787</b> and <b>OGMP 2.0</b>, cited to primary law.',
    url: "cmsolutions.tech/methane-readiness",
    note: "Nothing you enter leaves your browser.",
    dots: [[6, "gap"], [20, "unsure"], [34, "gap"], [61, "ready"], [92, "gap"]],
  },
  {
    output: "og-fueleu.png",
    section: "FuelEU Maritime",
    claim: 'LNG in a medium-speed Otto engine clears the 2025 limit by 0.13 — and <em>misses 2030 by 3.51</em>.',
    sub: "Your fuel mix, the regulation's own formula, the penalty in euros — <b>FuelEU Maritime</b> and <b>EU ETS</b>, cited to the Official Journal.",
    url: "cmsolutions.tech/fueleu-calculator",
    note: "Nothing you enter leaves your browser.",
    dots: [[12, "ready"], [26, "ready"], [44, "unsure"], [52, "gap"], [71, "gap"], [88, "gap"]],
  },
  {
    output: "og-extract.png",
    section: "Document Data Extraction",
    claim: 'Stop retyping numbers off a PDF. And <em>never trust one that was guessed</em>.',
    sub: 'Invoices, receipts, contracts and CVs into data. Every value quotes the text it came from, and a field that is not there comes back <b>empty rather than invented</b>.',
    url: "cmsolutions.tech/ai-document-data-extraction",
    note: "The file is read and discarded. Never stored, never logged.",
    dots: [[8, "ready"], [19, "ready"], [30, "ready"], [44, "unsure"], [58, "ready"], [74, "gap"], [88, "ready"]],
  },
  {
    output: "og-support.png",
    section: "Customer Service Agent",
    claim: 'Most support bots fail by <em>confidently inventing your policy</em>.',
    sub: 'A bot that makes up a returns window sounds exactly like one that read it. This one <b>quotes the passage</b> — or says it does not know and drafts the handover.',
    url: "cmsolutions.tech/ai-customer-service-software",
    note: "Your policy text is answered from, then discarded.",
    dots: [[10, "ready"], [24, "ready"], [38, "ready"], [55, "unsure"], [78, "gap"]],
  },
  {
    output: "og-workflow.png",
    section: "Workflow Planner",
    claim: 'The useful answer is usually <em>which steps not to automate</em>.',
    sub: 'Describe what you do by hand. Get the steps, what breaks, and the hours — <b>worked out in code from your figures</b>, not by a model. No figures, no estimate.',
    url: "cmsolutions.tech/ai-workflow-automation",
    note: "Your description is planned from, then discarded.",
    dots: [[9, "ready"], [22, "ready"], [36, "accent"], [50, "accent"], [66, "unsure"], [86, "ready"]],
  },
  {
    output: "og-audit.png",
    section: "Free Website Check",
    claim: 'Every finding says what is wrong, on which pages, and <em>exactly how to fix it</em>.',
    sub: 'Crawls your site and reports titles, metadata, structured data and accessibility. <b>No invented traffic figures</b> and no lost-revenue estimates.',
    url: "cmsolutions.tech/free-website-audit-tool",
    note: "Free, no signup, nothing stored.",
    dots: [[7, "gap"], [21, "gap"], [33, "unsure"], [48, "ready"], [63, "unsure"], [81, "ready"]],
  },
  {
    output: "og-schema.png",
    section: "Schema Markup Generator",
    claim: 'Valid JSON-LD for your business. <em>No invented ratings</em>.',
    sub: 'Built entirely in your browser. It will not fabricate review counts or star ratings, because <b>marking up reviews you do not have risks a penalty</b>.',
    url: "cmsolutions.tech/schema-generator",
    note: "Runs in your browser. Nothing is sent anywhere.",
    dots: [[11, "ready"], [27, "ready"], [43, "ready"], [59, "ready"], [76, "unsure"]],
  },
  {
    output: "og-proposal.png",
    section: "CM Proposal AI",
    claim: 'A questionnaire in. A scoped, costed, <em>branded proposal</em> out.',
    sub: 'Requirements to deliverables, pricing table, timeline, assumptions and a branded PDF. The most complete of these — <b>a product, not a demonstration</b>.',
    url: "cmsolutions.tech/ai-proposal-generator",
    note: "Try the live demo — no card, no commitment.",
    dots: [[10, "accent"], [25, "accent"], [40, "ready"], [56, "ready"], [72, "ready"], [88, "ready"]],
  },
  {
    output: "og-petro.png",
    section: "Petro Agent OS",
    claim: '135 agents mapped onto the oil and gas value chain. <em>Each one is a job somebody does today</em>.',
    sub: 'Drilling, production, subsurface, reliability, HSE, regulatory, emissions and commercial — every agent states <b>what it replaces and the KPI it moves</b>.',
    url: "cmsolutions.tech/oil-gas",
    note: "Nine functions, 41 job trees, one knowledge base.",
    dots: [[7, "ready"], [18, "accent"], [29, "ready"], [41, "unsure"], [54, "ready"], [67, "accent"], [79, "ready"], [91, "unsure"]],
  },
  {
    output: "og-agentmap.png",
    section: "Agent OS",
    claim: 'What a company looks like when <em>137 of its jobs are agents</em>.',
    sub: 'The whole estate on one map — seven departments, 33 job trees, and a build ladder so it is <b>a sequence rather than a wish list</b>.',
    url: "cmsolutions.tech/agent-map",
    note: "An architecture, not a product pitch.",
    dots: [[9, "accent"], [21, "ready"], [34, "accent"], [47, "ready"], [60, "unsure"], [73, "ready"], [88, "accent"]],
  },
  {
    output: "og-sitebuilder.png",
    section: "Website Builder",
    claim: 'Describe a brand. Get <em>one continuous film</em> that scrolls.',
    sub: 'Concept, palette, type pairing and copy, art-directed for that brand — delivered as <b>one self-contained file you own</b>. No account, no builder to learn.',
    url: "cmsolutions.tech/ai-website-builder",
    note: "Your brief is designed from, then discarded.",
    dots: [[8, "accent"], [23, "ready"], [37, "accent"], [52, "unsure"], [68, "accent"], [85, "ready"]],
  },
  {
    output: "og-social.png",
    section: "Social Content Planner",
    claim: 'A month of posts, and <em>not one over the limit</em>.',
    sub: 'A brand kit, a vector logo, and a dated calendar written separately per platform. Every caption <b>measured in code</b> against the real limit before you schedule it.',
    url: "cmsolutions.tech/ai-social-media-content-planner",
    note: "Your brief is written from, then discarded.",
    dots: [[9, "ready"], [21, "ready"], [33, "accent"], [46, "ready"], [58, "unsure"], [71, "ready"], [86, "accent"]],
  },
  {
    output: "og-tools.png",
    section: "AI Tools",
    claim: 'Working software you can use right now. <em>No signup, nothing stored</em>.',
    sub: 'Document extraction, a support agent, a workflow planner, a site check and a schema generator — each built so it <b>tells you what it does not know</b>.',
    url: "cmsolutions.tech/ai-tools",
    note: "Free to try. Built and shipped by one person.",
    dots: [[8, "ready"], [22, "accent"], [36, "ready"], [50, "unsure"], [64, "ready"], [80, "accent"], [93, "ready"]],
  },
];

/*
  The CM Solutions set. Rendered with the Dala template below — Inter, pure
  black, violet and amber — because these pages carry the rebrand while the
  tool pages above still wear the old look. Same table-not-hand-written rule.
*/
const MAVRIDIS_CARDS = [
  {
    output: "og.png",
    section: "Business Diagnostics for UK SMEs",
    claim: 'The evidence is already <em>public</em>.',
    sub: 'Companies House, planning applications, rateable values, Land Registry and ONS catchment data — diagnostics for UK SMEs with <b>every finding cited to its source</b>.',
    url: "cmsolutions.tech",
    note: "Founding rates held for the first ten clients.",
    dots: [[8, "violet"], [24, "violet"], [40, "amber"], [58, "violet"], [76, "white"], [92, "violet"]],
  },
  {
    output: "og-diagnostic.png",
    section: "Free Diagnostic Scorecard",
    claim: 'How much of your business is <em>guesswork</em>?',
    sub: 'Twelve questions, about five minutes, no sign-up. A score, four areas, and your three weakest named — with <b>the public register that settles each one</b>.',
    url: "cmsolutions.tech/diagnostic",
    note: "Nothing stored, nothing sent anywhere.",
    dots: [[10, "violet"], [28, "amber"], [46, "violet"], [64, "white"], [82, "violet"]],
  },
  {
    output: "og-health-check.png",
    section: "Business Health Check",
    claim: 'Your accounts, read the way a <em>lender</em> reads them.',
    sub: 'Five years of your filings and three competitors&#8217;, read with the same method, every finding cited. <b>£450 at the founding rate</b>, delivered in five working days.',
    url: "cmsolutions.tech/business-health-check",
    note: "Not an audit — your accountant stays your accountant.",
    dots: [[8, "violet"], [26, "violet"], [44, "amber"], [66, "violet"], [88, "white"]],
  },
  {
    output: "og-location.png",
    section: "Location & Market Intelligence",
    claim: 'Know the site <em>before</em> you sign for it.',
    sub: 'A drive-time catchment with its census profile, twenty-four months of planning applications, and your rates position against the units either side. <b>£1,200–£2,500, fixed before work starts</b>.',
    url: "cmsolutions.tech/location-intelligence",
    note: "It reads the record — it does not price the building.",
    dots: [[12, "amber"], [30, "violet"], [48, "violet"], [66, "white"], [84, "violet"]],
  },
  {
    output: "og-deep.png",
    section: "Deep Diagnostic",
    claim: 'The full picture, before the <em>big</em> decision.',
    sub: 'A sale, an acquisition, a refinance or a turnaround — every register, every site, one document, <b>written so a lender can check every line</b>. £4,000–£7,500, scoped in writing first.',
    url: "cmsolutions.tech/deep-diagnostic",
    note: "Complements your solicitor and accountant. Replaces neither.",
    dots: [[6, "violet"], [22, "violet"], [38, "amber"], [54, "violet"], [70, "violet"], [88, "white"]],
  },
  {
    output: "og-retainer.png",
    section: "Intelligence Retainer",
    claim: 'The registers move. You hear about it <em>first</em>.',
    sub: 'A monthly watch on your filings and your competitors&#8217;, planning inside your catchment, rates and title changes — <b>one short written note a month</b>. £400–£900, cancel any month.',
    url: "cmsolutions.tech/intelligence-retainer",
    note: "Urgent items flagged the day they are found.",
    dots: [[14, "violet"], [32, "white"], [50, "violet"], [68, "amber"], [86, "violet"]],
  },
  {
    output: "og-sample.png",
    section: "Sample Report",
    claim: 'A claim, a source, a date — <em>every line</em>.',
    sub: 'A worked example of the £450 Business Health Check, for a fictitious company. <b>The figures are invented; the method is the product.</b> Read it before you spend anything.',
    url: "cmsolutions.tech/sample-report",
    note: "Every real finding is cited to the filing it came from.",
    dots: [[10, "violet"], [30, "violet"], [50, "amber"], [70, "violet"], [90, "white"]],
  },
];

const MAVRIDIS_PALETTE = {
  violet: "#8052ff",
  amber: "#ffb829",
  white: "#bdbdbd",
};

function mavridisHtml(card) {
  const dots = card.dots
    .map(([left, tone]) => `<i style="left:${left}%;background:${MAVRIDIS_PALETTE[tone]}"></i>`)
    .join("\n    ");

  return `<!doctype html>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;400;600&display=swap" rel="stylesheet" />
<style>
  :root {
    --ink: #ffffff; --ink-dim: #9a9a9a; --ink-faint: #bdbdbd; --void: #000000;
    --violet: #8052ff; --amber: #ffb829;
    --sans: "Inter", -apple-system, sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    background: var(--void); color: var(--ink); font-family: var(--sans);
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 168px; position: relative; overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  body::before, body::after { content: ""; position: absolute; border-radius: 50%; filter: blur(220px); }
  body::before { width: 1500px; height: 1000px; top: -540px; left: -400px; background: rgba(128,82,255,0.13); }
  body::after  { width: 1400px; height: 950px; bottom: -560px; right: -420px; background: rgba(255,184,41,0.05); }
  .inner { position: relative; z-index: 1; }
  .eyebrow {
    font-size: 30px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase;
    color: var(--violet); margin-bottom: 58px;
  }
  .eyebrow span { color: var(--ink-dim); }
  h1 {
    font-weight: 400;
    font-size: 118px; line-height: 1.1; letter-spacing: -0.04em; max-width: 1900px;
  }
  h1 em { font-style: normal; color: var(--amber); }
  .sub { margin-top: 56px; font-size: 40px; font-weight: 200; line-height: 1.5; color: var(--ink-dim); max-width: 1760px; }
  .sub b { color: var(--ink); font-weight: 400; }
  .track { margin-top: 80px; width: 1580px; height: 10px; border-radius: 5px; background: rgba(255,255,255,0.10); position: relative; }
  .track i { position: absolute; top: -9px; width: 28px; height: 28px; border-radius: 50%; border: 5px solid var(--void); }
  .track .t { left: 0; width: 10px; height: 28px; border-radius: 3px; border: 0; background: var(--ink); }
  .foot {
    position: absolute; left: 168px; right: 168px; bottom: 92px;
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 32px; color: var(--ink-dim);
  }
  .foot .url { color: var(--violet); font-weight: 600; letter-spacing: 0.02em; }
</style>

<div class="inner">
  <p class="eyebrow">CM Solutions <span>— ${card.section}</span></p>
  <h1>${card.claim}</h1>
  <p class="sub">${card.sub}</p>
  <div class="track">
    <i class="t"></i>
    ${dots}
  </div>
</div>

<div class="foot">
  <span>${card.note}</span>
  <span class="url">${card.url}</span>
</div>
`;
}

const PALETTE = {
  gap: "#d98b6a",
  unsure: "#d4af6a",
  ready: "#a8b878",
  accent: "#7ab8d4",
};

function cardHtml(card) {
  const dots = card.dots
    .map(([left, tone]) => `<i style="left:${left}%;background:${PALETTE[tone]}"></i>`)
    .join("\n    ");

  return `<!doctype html>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet" />
<style>
  :root {
    --ink: #e8e6df; --ink-dim: #a09d93; --ink-faint: #6b6960; --void: #07080c;
    --unsure: #d4af6a; --gold: #c9a227;
    --serif: "Fraunces", Georgia, serif;
    --sans: "Inter", -apple-system, sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    background: var(--void); color: var(--ink); font-family: var(--sans);
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 168px; position: relative; overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  body::before, body::after { content: ""; position: absolute; border-radius: 50%; filter: blur(200px); }
  body::before { width: 1500px; height: 1000px; top: -520px; left: -380px; background: rgba(201,162,39,0.10); }
  body::after  { width: 1500px; height: 1000px; bottom: -560px; right: -420px; background: rgba(122,184,212,0.07); }
  .inner { position: relative; z-index: 1; }
  .eyebrow {
    font-size: 30px; font-weight: 500; letter-spacing: 0.34em; text-transform: uppercase;
    color: var(--gold); margin-bottom: 54px;
  }
  .eyebrow span { color: var(--ink-faint); }
  h1 {
    font-family: var(--serif); font-weight: 300;
    font-size: 116px; line-height: 1.13; letter-spacing: -0.015em; max-width: 1900px;
  }
  h1 em { font-style: normal; color: var(--unsure); }
  .sub { margin-top: 54px; font-size: 40px; font-weight: 300; line-height: 1.5; color: var(--ink-dim); max-width: 1700px; }
  .sub b { color: var(--ink); font-weight: 400; }
  .track { margin-top: 78px; width: 1580px; height: 10px; border-radius: 5px; background: rgba(232,230,223,0.14); position: relative; }
  .track i { position: absolute; top: -9px; width: 28px; height: 28px; border-radius: 50%; border: 5px solid var(--void); }
  .track .t { left: 0; width: 10px; height: 28px; border-radius: 3px; border: 0; background: var(--ink); }
  .foot {
    position: absolute; left: 168px; right: 168px; bottom: 92px;
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 32px; color: var(--ink-faint);
  }
  .foot .url { color: var(--gold); font-weight: 500; letter-spacing: 0.02em; }
</style>

<div class="inner">
  <p class="eyebrow">CM Solutions <span>— ${card.section}</span></p>
  <h1>${card.claim}</h1>
  <p class="sub">${card.sub}</p>
  <div class="track">
    <i class="t"></i>
    ${dots}
  </div>
</div>

<div class="foot">
  <span>${card.note}</span>
  <span class="url">${card.url}</span>
</div>
`;
}

async function render(card) {
  const source = resolve(root, `.og-${card.output.replace(/\.png$/, "")}.tmp.html`);
  const to = resolve(root, card.output);
  await writeFile(source, (card.brand === "mavridis" ? mavridisHtml : cardHtml)(card));

  try {
    await run(CHROME, [
      "--headless", "--disable-gpu", "--hide-scrollbars",
      `--screenshot=${to}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      "--default-background-color=00000000",
      // Fonts come from Google Fonts, so this render needs the network.
      // Without it Chrome falls back to Georgia and the card ships off-brand.
      "--virtual-time-budget=4000",
      `file://${source}`,
    ]);

    const { size } = await stat(to);
    if (size < 20_000) {
      throw new Error(`${card.output} came out at ${size} bytes — the page probably rendered blank.`);
    }
    console.log(`  ${card.output.padEnd(20)} ${WIDTH}x${HEIGHT}  ${(size / 1024).toFixed(0)} KB`);
  } finally {
    await unlink(source).catch(() => {});
  }
}

try {
  await access(CHROME);
} catch {
  console.error(`Chrome not found at ${CHROME}. Install it or point CHROME at another build.`);
  process.exit(1);
}

/* --only mavridis / --only legacy renders one set; default renders both. */
const only = (process.argv.find((x) => x.startsWith("--only")) ?? "").split("=")[1]
  ?? process.argv[process.argv.indexOf("--only") + 1];
MAVRIDIS_CARDS.forEach((c) => { c.brand = "mavridis"; });
const ALL = [
  ...(only === "mavridis" ? [] : CARDS),
  ...(only === "legacy" ? [] : MAVRIDIS_CARDS),
];
for (const card of ALL) await render(card);

console.log(`\n${ALL.length} cards rendered. Look at them before deploying — a share card is\nthe first thing a stranger sees and the last thing anyone reviews.\n`);
