# Free Tools Hub — Starter

A small, public, responsive tool hub built for Cloudflare Pages + Workers, with a Worker API endpoint ready for future server-side tools.

## What's included
- Responsive Chinese-language landing page
- JSON formatter/validator tool (runs entirely in the browser)
- Text character/word counter (runs entirely in the browser)
- `/api/health` Worker endpoint
- Cloudflare Pages Functions-compatible API route
- No paid APIs, database, or secrets required for the starter

## Local preview
Use any static server, or install Wrangler and run:

```bash
npm install
npm run dev
```

Then open the local URL Wrangler prints.

## Deploy to Cloudflare Pages
1. Create a GitHub repository and upload/push this project.
2. In Cloudflare Dashboard, go to **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Authorize GitHub and select this repository.
4. For this static starter, set:
   - Framework preset: **None**
   - Build command: leave empty
   - Build output directory: `public`
5. Click **Save and Deploy**. Cloudflare will publish a `*.pages.dev` URL.
6. Future pushes to the production branch trigger a new deployment.

## API endpoint
The file `functions/api/health.js` exposes `GET /api/health`.

For future backend/AI tools, add routes under `functions/api/`. Store API keys in Cloudflare dashboard **Settings → Variables and Secrets**; never put secrets in browser JavaScript or GitHub.

## Free-tier notes
Cloudflare's free plan limits and product terms can change. Check the current official plan pages before launching a high-traffic or commercial service. Pages and Workers have separate quotas/limits; AI model usage, storage, databases, and third-party APIs may have their own charges or limits.

## Suggested next steps
- Add tool pages under `public/tools/`
- Add backend endpoints under `functions/api/`
- Add rate limiting and input validation before exposing costly or sensitive API-backed tools
- Add a privacy notice before collecting or processing personal data
