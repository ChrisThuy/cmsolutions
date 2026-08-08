# The design system

This is the design system the website builder art-directs against. It is one
file, read at load time and sent to the model as part of the art-direction
prompt, so the document a person reads and the rules the model follows cannot
drift apart.

It governs **how** a site is designed, not **what** any particular site looks
like. There is no house palette and no house typeface here. A plumber in Leeds
and a coffee roaster in Chiang Mai should not come out looking like siblings —
they should come out looking like a plumber in Leeds and a coffee roaster in
Chiang Mai, each designed to the same standard.

The contrast table in section 1 and the motion list in section 3 are filled in
from code at load time, rather than typed here, so that a threshold changed in
`spec.mjs` changes this document and the prompt in the same commit. Do not
paste their contents in by hand.

---

## 1. Colour

Six roles. Every site fills all six, and every role has a job — a palette is
not six colours you like, it is six decisions about hierarchy.

| Role      | What it is                                                      |
|-----------|-----------------------------------------------------------------|
| `bg`      | The deepest background. The world the film happens in.          |
| `surface` | Raised panels and cards. Distinct from `bg` or cards disappear.  |
| `ink`     | Primary text. The thing most words are set in.                   |
| `dim`     | Secondary text. Used far more than people expect — see below.    |
| `accent`  | The brand colour. Kickers, buttons, the one thing that carries.  |
| `accent2` | A second, for gradients and depth. Never used for body text.     |

### Contrast is not negotiable

A spec that fails any of these is rejected before it renders, which costs the
visitor the entire wait for nothing. These are checked in code, at the sizes
the stylesheet actually paints:

{{CONTRAST_PAIRS}}

Three of those catch the same recurring mistake, so they are worth naming.

**`dim` is not decorative.** It sets chapter body copy, the lede and the
opening hours — a large share of everything a visitor reads. A `dim` chosen as
"a quieter version of `ink`" and then nudged until it looks tasteful is the
single most common failure. It needs the full 4.5:1.

**The button reads the other way round.** The primary button paints `bg` on
`accent`, so those two colours are tested twice: `accent` on `bg` for kickers,
and `bg` on `accent` for the button label. A pairing can pass one and fail the
other.

**`accent2` gets 3:1, not 4.5:1**, because it is never text — it exists for
gradients and depth. Using it for text is out of spec even where it happens to
pass.

### How to choose an accent

Pick the accent for the world first, then move it until it clears the ratio.
Do it in that order. Picking a value because it is beautiful and hoping it
passes is how a build fails.

The trap is an accent too close in luminance to the background — a soft gold
on cream, a dusty blue on slate. It looks considered while you are imagining
it and is unreadable on the actual page. Luminance distance is the thing being
tested, not hue difference: two colours can be miles apart on the wheel and
still fail.

---

## 2. Typography

Two faces: a display face with real character, and a clean body face.

**Never system defaults.** Not Inter, Roboto, Arial, Helvetica or a system
stack. Those are the visual signature of something generated rather than
designed, and a visitor recognises it without being able to name it.

Reach for expressive display faces available on Google Fonts — Fraunces,
Instrument Serif, Bodoni Moda, Syne, Unbounded, Playfair Display, DM Serif
Display, Cormorant, Space Grotesk and their like — and pair each with a body
face that gets out of the way.

**Two brands must never look like the same site.** If the display face you are
reaching for is the one you would reach for on any brief, that is the signal
to reach further. The pairing is a decision about the brand, not a default.

Where the site's own language needs it, the type must actually support that
script. A Thai or Arabic or Devanagari site set in a face with no coverage for
its own script is a broken site, however good the pairing looks in Latin.

---

## 3. Motion

The renderer implements a fixed vocabulary of scenes. The model composes with
these; it does not invent new ones, because a scene the renderer cannot build
is a scene that silently does not appear.

{{MOTIONS}}

**Vary them.** Four chapters on one motion is a slideshow, not a film. The
validator rejects a spec of four or more chapters using fewer than three
distinct motions.

**`counter` at most once**, and only where a real figure belongs. A counter
that counts to an invented number is worse than no counter.

---

## 4. Rhythm

Four to six chapters. Fewer than three is not a journey; more than seven and
nobody reaches the end.

Each chapter is one beat of a single continuous shot, not a slide. The
`journey` field states that shot in one sentence, top to bottom — a
transformation, not a theme. *"Moonlit field, into a single bloom, into a drop
of gold, pull back and you are inside the bottle"* is a journey. *"A modern
site showcasing our values"* is not.

Copy is read while the page is moving. Headlines are short because of physics,
not fashion.

---

## 5. What is banned

Generic AI aesthetics, which means specifically:

- Overused font families — Inter, Roboto, Arial, system stacks
- Cliched colour schemes, especially purple gradients on white or near-black
- Predictable layouts and component patterns that would fit any brief
- Cookie-cutter design with no context-specific character

Also banned, for reasons that are not aesthetic:

- **Invented facts.** No statistics, customer counts, awards or testimonials
  that the brief does not support. A counter figure must be something the
  brief supports or a plainly non-factual unit — kilometres of coastline,
  hours of daylight.
- **Placeholder copy.** No "Lorem", no "Your headline here", no bracketed
  slots. If the brief is thin, invent something specific and committed rather
  than something generic and safe.

---

## 6. The split this system depends on

The model supplies taste. Code supplies correctness.

The model decides the concept, the palette, the type pairing, the journey and
the copy, and returns them as data. It never writes HTML, CSS or JavaScript.
The renderer turns that data into a page, and the renderer gets the mechanics
right every time because it is code with tests — scroll pins created in the
right order, contrast verified, fonts loaded, both languages emitted.

That split is why this document can be about taste and still be enforceable.
Every rule here that can be checked mechanically is checked mechanically; the
rest is written down so it is at least argued about deliberately rather than
re-decided from scratch on every brief.
