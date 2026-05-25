import { NextResponse } from 'next/server';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';

/**
 * GET /api/round/recompute-list?round=N — admin-only.
 *
 * Returns the list of trade IDs that need recomputing for round N (every
 * trade executed at or before N). The client uses this to chunk per-trade
 * recompute calls so no single request blows through Vercel Hobby's 60s
 * function ceiling.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const round = Number(url.searchParams.get('round'));
  if (!Number.isFinite(round) || round < 1) {
    return NextResponse.json({ error: 'invalid round' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('trades')
    .select('id')
    .lte('round_executed', round)
    .order('round_executed', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tradeIds: (data ?? []).map((t) => t.id as string) });
}
