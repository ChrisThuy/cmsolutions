# CM Solutions — Portfolio

Live at **https://cmsolutions.tech**

A single-file, cinematic scrolling portfolio. No build step, no framework,
no external dependencies beyond two Google Fonts (with full system-font
fallbacks). Everything — the star canvas, the colour-shifting sky, the
scroll choreography, the SVG illustrations — lives in `index.html`.

## Showcase order

1. **Psychart** — psychart.app
2. **Agrimakis Estate** — agrimakis-deploy.vercel.app (The Golden Drop)
3. **Huddle** — gethuddle.tech
4. **Father's Voice UK** — fathersvoiceuk.com

## Contact details

Already filled in, but if they ever change:

1. **WhatsApp** — the number lives in the `wa.me/…` link
   (international format: country code, no `+`, no spaces).
2. **WeChat** — the ID lives in `data-wechat-id` and once as visible
   text (`ID: …`). Tapping the card copies the ID to the visitor's
   clipboard.

## Deploying

One command does it all — creates the GitHub repo, ships to Vercel
production, and attaches the domain:

```bash
./deploy.sh            # domain defaults to cmsolutions.tech
./deploy.sh other.com  # or pass a different domain
```

Needs the `gh` and `vercel` CLIs (the script prompts you to log in if
you aren't, and fetches the Vercel CLI via `npx` if it's missing).

Or do it by hand — it's one static file, so anything works:

- **Vercel** — import the repo, Framework: **Other**, no build command.
- **GitHub Pages / any host** — serve `index.html`.

After the first deploy, add `cmsolutions.tech` in the Vercel project
under **Settings → Domains** and set the DNS records it shows.

## Design notes

- The fixed `<canvas>` sky cross-fades its palette per section
  (gold → olive → signal blue → hearth amber) as you scroll.
- Full-screen "kinetic" statements between chapters scale and fade with
  scroll position — the video-like connective tissue between projects.
- `prefers-reduced-motion` is respected: animations collapse and content
  is fully readable with no JS-driven motion.
- `overflow-x: clip` (never `hidden`) so no scroll container is created.
- No pricing, no offers — deliberately just the work and two ways to talk.
