import { createClient } from '@supabase/supabase-js';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { loadTradesList } from '@/lib/trades/load-list';
import TradesPageClient from './trades-page-client';

// Anon-keyed client is fine here — RLS gates all the trade tables to
// signed-in users and the middleware already enforces auth.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default async function TradesPage() {
  // v13.4 — load the trades list during SSR so the page renders with
  // data baked into the HTML instead of an empty shell + spinner. The
  // client component still owns the eventual refresh path (after
  // create/edit/delete) — it just gets a hot initial state.
  const [user, listResult] = await Promise.all([
    getCurrentUser(),
    loadTradesList(supabase).catch((err) => {
      console.error('[trades/page] initial list failed', err);
      return { trades: [] };
    }),
  ]);
  const admin = isAdmin(user);
  return <TradesPageClient isAdmin={admin} initialTrades={listResult.trades} />;
}
