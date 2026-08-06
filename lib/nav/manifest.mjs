/*
  The site map, in one place.

  Fourteen pages are fourteen separate HTML files with no shared layout, so
  every one of them used to carry its own hand-written header. They drifted:
  the front page had no navigation at all, and the tool pages linked to the
  tools index but never to each other — landing on one tool was a dead end.

  This is the single source of truth. scripts/build-nav.mjs renders it into
  every page and scripts/test-nav.mjs checks the result, so adding a tool is
  one entry here rather than fourteen edits that are one page from being wrong.

  `file` is what the page is called on disk; `href` is what a visitor sees.
  They differ because vercel.json sets cleanUrls, and the test asserts every
  href resolves to a file that actually exists — a nav that links to a 404 is
  worse than no nav.
*/

export const SITE = "CM Solutions";

/** Everything with a URL. Order is the order it appears in the panel. */
export const PAGES = [
  { file: "index.html", href: "/", label: "Home", group: null },

  {
    file: "ai-tools.html",
    href: "/ai-tools",
    label: "All tools",
    group: "tools",
    blurb: "Every tool in one place",
    lead: true,
  },
  {
    file: "ai-proposal-generator.html",
    href: "/ai-proposal-generator",
    label: "Proposal generator",
    group: "tools",
    blurb: "Scoped proposals from a brief",
  },
  {
    file: "free-website-audit-tool.html",
    href: "/free-website-audit-tool",
    label: "Website check",
    group: "tools",
    blurb: "SEO and accessibility, measured",
  },
  {
    file: "schema-generator.html",
    href: "/schema-generator",
    label: "Schema generator",
    group: "tools",
    blurb: "Valid JSON-LD, no invention",
  },
  {
    file: "ai-document-data-extraction.html",
    href: "/ai-document-data-extraction",
    label: "Document extraction",
    group: "tools",
    blurb: "Invoices and forms into fields",
  },
  {
    file: "ai-customer-service-software.html",
    href: "/ai-customer-service-software",
    label: "Support agent",
    group: "tools",
    blurb: "Answers only from your policy",
  },
  {
    file: "ai-workflow-automation.html",
    href: "/ai-workflow-automation",
    label: "Workflow planner",
    group: "tools",
    blurb: "What to automate, and what not to",
  },
  {
    file: "ai-website-builder.html",
    href: "/ai-website-builder",
    label: "Website builder",
    group: "tools",
    blurb: "A scroll-film site from a prompt",
  },
  {
    file: "ai-social-media-content-planner.html",
    href: "/ai-social-media-content-planner",
    label: "Social planner",
    group: "tools",
    blurb: "Posts, captions and a schedule",
  },

  {
    file: "oil-gas.html",
    href: "/oil-gas",
    label: "Oil & gas",
    group: "industry",
    blurb: "Agents for upstream and trading",
  },
  {
    file: "methane-readiness.html",
    href: "/methane-readiness",
    label: "Methane readiness",
    group: "industry",
    blurb: "EU 2024/1787, cargo and contracts",
  },
  {
    file: "fueleu-calculator.html",
    href: "/fueleu-calculator",
    label: "FuelEU calculator",
    group: "industry",
    blurb: "Compliance balance and penalties",
  },
  {
    file: "agent-map.html",
    href: "/agent-map",
    label: "Agent OS map",
    group: "industry",
    blurb: "137 agents, wired together",
  },
];

/** Panel headings. A group with no pages is simply not rendered. */
export const GROUPS = [
  { key: "tools", title: "Tools", note: "Free, no sign-up" },
  { key: "industry", title: "Industry", note: "Built for a sector" },
];

/*
  The bar itself stays deliberately short.

  A top bar that lists fourteen destinations is a sitemap someone has to read
  on every page. Three items and a panel is navigable at a glance, and the
  panel is where the breadth lives.
*/
export const BAR = [
  { href: "/#services", label: "What I build", desktopOnly: true },
  { href: "/#contact", label: "Contact", cta: true },
];

export const pagesIn = (group) => PAGES.filter((p) => p.group === group);

/** The page a given file *is*, so it can mark itself current. */
export const pageOf = (file) => PAGES.find((p) => p.file === file) ?? null;
