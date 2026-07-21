#!/usr/bin/env bash
# CM Solutions — one-shot publish: GitHub repo + Vercel production deploy.
# Usage:  ./deploy.sh            (deploy only)
#         ./deploy.sh yourdomain.com   (deploy + attach domain)
set -euo pipefail

REPO="cmsolutions"
GH_USER="ChrisThuy"
DOMAIN="${1:-cmsolutions.tech}"

echo "▸ CM Solutions — one-shot publish"

# Must be run from inside the project folder.
if [ ! -f index.html ]; then
  echo "✗ Run this from inside the cmsolutions folder (index.html not found here)." >&2
  exit 1
fi

# 1) Local git.
if [ ! -d .git ]; then
  git init -q
  git add .
  git commit -qm "CM Solutions portfolio"
  git branch -M main
fi

# 2) Create + push the GitHub repo (needs the gh CLI, logged in: `gh auth login`).
if command -v gh >/dev/null 2>&1; then
  if gh repo view "$GH_USER/$REPO" >/dev/null 2>&1; then
    git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$GH_USER/$REPO.git"
    git push -u origin main
  else
    gh repo create "$GH_USER/$REPO" --public --source=. --remote=origin --push
  fi
  echo "✓ GitHub → https://github.com/$GH_USER/$REPO"
else
  echo "! gh CLI not found. Create the repo manually at https://github.com/new (name: $REPO, Public), then:"
  echo "    git remote add origin https://github.com/$GH_USER/$REPO.git && git push -u origin main"
fi

# 3) Deploy to Vercel production (npx fetches the CLI if it isn't installed).
if command -v vercel >/dev/null 2>&1; then VC="vercel"; else VC="npx --yes vercel"; fi
echo "▸ Deploying to Vercel — accept the login/link prompts if they appear…"
$VC deploy --prod --yes

# 4) Attach the domain if one was passed.
if [ -n "$DOMAIN" ]; then
  echo "▸ Adding domain $DOMAIN to Vercel…"
  $VC domains add "$DOMAIN" || true
  echo "→ Finish in the Vercel dashboard: Project → Settings → Domains → add the DNS records it shows for $DOMAIN."
else
  echo "→ To attach a domain later: $VC domains add <yourdomain>  (then set DNS as Vercel instructs)."
fi

echo "✓ Done."
