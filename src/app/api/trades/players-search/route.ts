import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Returns players on a given team's roster (distinct player_id/name/pos) based
 * on the latest player_rounds data for that team_id. Used by the manual trade
 * entry form to pick players.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = Number(searchParams.get('team_id'));
    const q = (searchParams.get('q') || '').toLowerCase().trim();
    if (!teamId) return NextResponse.json({ players: [] });

    // Get most recent round number
    const { data: latest } = await supabase
      .from('player_rounds')
      .select('round_number')
      .order('round_number', { ascending: false })
      .limit(1);
    const latestRound = latest?.[0]?.round_number ?? 0;

    // Get distinct players from the most recent few rounds for this team
    const { data: rows } = await supabase
      .from('player_rounds')
      .select('player_id, player_name, pos, round_number')
      .eq('team_id', teamId)
      .gte('round_number', Math.max(0, latestRound - 3))
      .order('round_number', { ascending: false });

    const seen = new Set<number>();
    const players: { player_id: number; player_name: string; pos: string | null }[] = [];
    for (const r of rows ?? []) {
      if (seen.has(r.player_id)) continue;
      seen.add(r.player_id);
      if (q && !r.player_name.toLowerCase().includes(q)) continue;
      players.push({ player_id: r.player_id, player_name: r.player_name, pos: r.pos ?? null });
    }

    players.sort((a, b) => a.player_name.localeCompare(b.player_name));
    return NextResponse.json({ players });
  } catch (err) {
    console.error('[trades/players-search]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search failed' },
      { status: 500 }
    );
  }
}
