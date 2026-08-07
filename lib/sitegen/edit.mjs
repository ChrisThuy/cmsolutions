import { z } from "zod";

/*
  Editing the design by asking for it.

  Forty form fields is an accurate way to expose a spec and a poor way to
  meet one. Most people know what they want in sentences — "warmer", "the
  headline is too long", "put the workshop chapter first" — and translating
  that into which of forty boxes to touch is work the tool should do.

  ── why operations and not a rewritten spec ──

  The obvious approach is to hand the model the spec and take a new one back.
  It costs about 3.4 cents an edit, because the whole design comes back every
  time, and it lets a model that was asked to shorten one headline quietly
  return five chapters where there were six.

  Operations are a tenth of the price and cannot lose anything. The model
  names what changes; the code changes exactly that and nothing else. It also
  means the tool can say what it did — "accent colour, and chapter 3's
  headline" — which is the difference between a change someone trusts and a
  page that is mysteriously different.
*/

export const EditOpsSchema = z.object({
  /* One short sentence, in the visitor's own terms, for the transcript. */
  summary: z.string(),
  ops: z.array(z.union([
    z.object({
      op: z.literal("set"),
      /** Dotted path into the spec: "palette.accent", "chapters.2.headline". */
      path: z.string(),
      value: z.string(),
    }),
    z.object({
      op: z.literal("move"),
      /** Chapter reordering, which no amount of set operations expresses well. */
      from: z.number().int(),
      to: z.number().int(),
    }),
  ])),
  /* Said out loud when the request cannot be honoured — a layout the renderer
     cannot build, a seventh chapter, a motion that does not exist. Refusing
     with a reason beats silently doing something adjacent. */
  refused: z.string().nullable(),
});

/* Only these branches may be written. A path outside them is rejected rather
   than applied: the model has no business setting `language.primary` because
   somebody asked for a shorter headline, and an edit endpoint that can write
   anywhere is one prompt injection away from being a problem. */
const WRITABLE = [
  /^brandName$/, /^tagline$/, /^conceptName$/, /^journey$/, /^footerNote$/,
  /^palette\.(bg|surface|ink|dim|accent|accent2)$/,
  /^type\.(display|body)$/,
  /^chapters\.\d+\.(name|kicker|headline|body|visual|motion|counterLabel)$/,
  /^sections\.\d+\.(title|body)$/,
  /^sections\.\d+\.items\.\d+\.(heading|text)$/,
  /^cta\.(heading|body|label)$/,
  /^alt\.(tagline|conceptName|footerNote)$/,
  /^alt\.chapters\.\d+\.(name|kicker|headline|body|counterLabel)$/,
  /^alt\.sections\.\d+\.(title|body)$/,
  /^alt\.sections\.\d+\.items\.\d+\.(heading|text)$/,
  /^alt\.cta\.(heading|body|label)$/,
];

export const isWritable = (path) => WRITABLE.some((re) => re.test(path));

/**
 * Applies operations to a copy of the spec.
 *
 * Never mutates the original, so a set of operations that turns out to break
 * validation can be discarded whole rather than half-applied — a spec left
 * halfway through an edit is worse than one that never changed.
 */
export function applyOps(spec, ops) {
  const next = JSON.parse(JSON.stringify(spec));
  const applied = [];
  const rejected = [];

  for (const op of ops) {
    if (op.op === "move") {
      const { from, to } = op;
      if (!Array.isArray(next.chapters) || from < 0 || to < 0
          || from >= next.chapters.length || to >= next.chapters.length) {
        rejected.push(`move ${from}→${to} is out of range`);
        continue;
      }
      const [moved] = next.chapters.splice(from, 1);
      next.chapters.splice(to, 0, moved);
      // The translation travels with its chapter, or chapter three ends up
      // narrated by chapter one.
      if (Array.isArray(next.alt?.chapters)) {
        const [movedAlt] = next.alt.chapters.splice(from, 1);
        next.alt.chapters.splice(to, 0, movedAlt);
      }
      applied.push(`moved chapter ${from + 1} to position ${to + 1}`);
      continue;
    }

    if (!isWritable(op.path)) {
      rejected.push(`${op.path} is not editable`);
      continue;
    }

    const parts = op.path.split(".");
    let node = next;
    let ok = true;
    for (const key of parts.slice(0, -1)) {
      node = node?.[key];
      if (node === undefined || node === null) { ok = false; break; }
    }
    if (!ok) { rejected.push(`${op.path} does not exist on this design`); continue; }

    const leaf = parts[parts.length - 1];
    if (!(leaf in node)) { rejected.push(`${op.path} does not exist on this design`); continue; }

    node[leaf] = op.value;
    applied.push(op.path);
  }

  return { spec: next, applied, rejected };
}

/**
 * A compact description of the design, for the model to edit against.
 *
 * Sending the whole spec would double the input cost and most of it is not
 * addressable anyway. This is every writable path and its current value,
 * which is exactly what an editor needs and nothing else.
 */
export function describeForEditing(spec) {
  const lines = [];
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) v.forEach((item, i) => {
        if (item && typeof item === "object") walk(item, `${path}.${i}`);
      });
      else if (v && typeof v === "object") walk(v, path);
      else if (isWritable(path)) lines.push(`${path}: ${String(v).slice(0, 160)}`);
    }
  };
  walk(spec, "");
  return lines.join("\n");
}

export const EDIT_SYSTEM = `You edit a website design that already exists. Someone
describes a change in their own words; you return the operations that make it.

Return ONLY operations for what they asked to change. Do not tidy, improve or
adjust anything else — a person who asked for a shorter headline and got a new
colour scheme has been ignored, however good the colours are.

Paths are dotted, e.g. palette.accent, chapters.2.headline, cta.label. Indexes
are zero-based. To reorder chapters use a move operation, not a set.

If the site is bilingual, an edit to wording usually needs BOTH languages —
change chapters.2.headline and alt.chapters.2.headline together, or the two
versions drift apart. Write real copy in each language, not a translation of
your own English.

Colours must be six-digit hex. The design is checked for contrast after your
edit and will be rejected if body text, secondary text or the accent falls
below 4.5:1 against its background, so move a colour far enough to clear it.

Motion must be one of: pin-zoom, char-reveal, horizontal, clip-reveal,
layer-parallax, counter.

If what they want cannot be done — a layout the renderer does not build, more
than seven chapters, an eighth motion — set "refused" to one plain sentence
saying so, and return no operations. Refusing clearly is better than doing
something adjacent and calling it done.`;
