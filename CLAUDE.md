# LOMAF HQ

## Project
- AFL Fantasy draft league portal for managing weekly power rankings (PWRNKGs)
- 10-coach league called LOMAF (Land of Milk and Fantasy)
- Single admin (Lipi) uploads CSVs, writes rankings, generates carousel images

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
- NEVER force push to any branch
- Use `@supabase/supabase-js` for all DB operations — no Prisma, no raw SQL from the app
- All carousel images are 1080x1080 rendered via `ImageResponse` from `next/og`
- CSV parsing happens client-side with PapaParse, then JSON is POSTed to API routes
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
