import { NextResponse } from 'next/server';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';

/**
 * GET /api/afl-injuries/status — admin-only.
 * Returns aggregate freshness stats so the Round Control UI can show
 * 'last refreshed Xh ago, AFL says updated Apr 28' etc.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();

  const { data, count } = await supabase
    .from('afl_injuries')
    .select('player_id, source_updated_at, scraped_at', { count: 'exact' })
    .order('scraped_at', { ascending: false });

  const rows = (data ?? []) as Array<{
    player_id: number | null;
    source_updated_at: string | null;
    scraped_at: string;
  }>;
  const total = count ?? rows.length;
  const resolved = rows.filter((r) => r.player_id != null).length;
  const lastScraped = rows.length > 0 ? rows[0].scraped_at : null;
  const sourceDates = rows
    .map((r) => r.source_updated_at)
    .filter((d): d is string => !!d)
    .sort();
  const sourceFreshest = sourceDates.length ? sourceDates[sourceDates.length - 1] : null;
  const sourceOldest = sourceDates.length ? sourceDates[0] : null;

  return NextResponse.json({
    total,
    resolved,
    unresolved: total - resolved,
    lastScraped,
    sourceFreshest,
    sourceOldest,
  });
}
