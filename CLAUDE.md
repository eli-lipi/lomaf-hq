# LOMAF HQ

## Project
- AFL Fantasy draft league portal for managing weekly power rankings (PWRNKGs)
- 10-coach league called LOMAF (Land of Milk and Fantasy)
- Single admin (Lipi) uploads CSVs, writes rankings, generates carousel images

## Hosting — read before touching anything Vercel-related
- **Production URL:** https://lomaf-hq.vercel.app
- **Vercel team:** `lipi-8398's projects` (Eli's personal Hobby account) — **NOT** `multiplymiis-projects` (MultiplyMii Pro). The MM team is for company projects only; lomaf-hq has been wrongly re-created there multiple times and pollutes paid usage.
- **GitHub repo:** `eli-lipi/lomaf-hq` (personal account, NOT `multiplymii-git` or `multiplymii`)
- **Deploys happen via GitHub auto-deploy on push to `main`.** The Vercel CLI is not part of the workflow.
- **Env var dashboard (Hobby team):** https://vercel.com/lipi-8398s-projects/lomaf-hq/settings/environment-variables

## Tech Stack
- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase direct client (`@supabase/supabase-js`) — NOT Prisma
- Image generation: `next/og` (Satori) for 1080x1080 carousel PNGs
- Charts: Recharts
- Drag-and-drop: @dnd-kit

## Design
- Light theme inspired by AFL.com.au: `#F0F2F5` background, white cards, `#1A56DB` blue accent
- Dark navy sidebar: `#0E1629`
- Sporty, clean, professional aesthetic
- Fixed sidebar navigation

## Rules
- **NEVER run `vercel` CLI commands in this directory** — no `vercel link`, `vercel deploy`, `vercel env add`, `vercel env pull`, etc. Every prior incident of lomaf-hq re-appearing on the MultiplyMii Pro team has been traced to a Claude Code session running the Vercel CLI here. Deploys go through GitHub auto-deploy; env vars are managed in the Vercel dashboard by Eli.
- **If env vars need to change**, tell Eli — don't try to edit them yourself, don't pipe `.env.local` into anything, don't link projects.
- **Never visit a `vercel.com/multiplymiis-projects/lomaf-hq/...` URL or suggest it to the user.** That team's lomaf-hq is wrong by definition; landing on it tempts re-import. The only correct team is `lipi-8398s-projects`.
- NEVER force push to any branch
- Use `@supabase/supabase-js` for all DB operations — no Prisma, no raw SQL from the app
- All carousel images are 1080x1080 rendered via `ImageResponse` from `next/og`
- CSV parsing happens client-side with PapaParse, then JSON is POSTed to API routes
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` (server-side only, for AI features)
