import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Returns players for the trade logging player picker.
 *
 * Modes:
 *  1. `?team_id=N`           — roster mode: distinct players on that team's
 *                               roster from the most recent few rounds.
 *  2. `?all=true&team_id=N`  — league mode: ALL drafted players. Each result
 *                               includes `on_roster: boolean` so the UI can
 *                               flag waiver pickups / off-roster players.
 *
 * Both modes accept an optional `?q=...` text filter on player name.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = Number(searchParams.get('team_id'));
    const q = (searchParams.get('q') || '').toLowerCase().trim();
    const allMode = searchParams.get('all') === 'true';

    if (!teamId && !allMode) return NextResponse.json({ players: [] });

    // ------------------------------------------------------------------
    // League-wide search (all drafted players)
    // ------------------------------------------------------------------
    if (allMode) {
      // 1. Fetch all draft picks
      let draftQuery = supabase
        .from('draft_picks')
        .select('player_id, player_name, position')
        .order('player_name');

      // Apply name filter server-side if provided
      if (q) {
        draftQuery = draftQuery.ilike('player_name', `%${q}%`);
      }

      const { data: draftRows } = await draftQuery;
      if (!draftRows || draftRows.length === 0) {
        return NextResponse.json({ players: [] });
      }

      // 2. Determine which players are currently on the source team's roster
      //    (from the most recent rounds of player_rounds).
      const rosterPlayerIds = new Set<number>();
      if (teamId) {
        const { data: latest } = await supabase
          .from('player_rounds')
          .select('round_number')
          .order('round_number', { ascending: false })
          .limit(1);
        const latestRound = latest?.[0]?.round_number ?? 0;

        const { data: rosterRows } = await supabase
          .from('player_rounds')
          .select('player_id')
          .eq('team_id', teamId)
          .gte('round_number', Math.max(0, latestRound - 3));

        for (const r of rosterRows ?? []) {
          rosterPlayerIds.add(r.player_id);
        }
      }

      // 3. Deduplicate (a player can appear in multiple draft rounds if
      //    keeper-style, though unlikely) and build response.
      const seen = new Set<number>();
      const players: {
        player_id: number;
        player_name: string;
        pos: string | null;
        on_roster: boolean;
      }[] = [];

      for (const d of draftRows) {
        if (seen.has(d.player_id)) continue;
        seen.add(d.player_id);
        players.push({
          player_id: d.player_id,
          player_name: d.player_name,
          pos: d.position ?? null,
          on_roster: rosterPlayerIds.has(d.player_id),
        });
      }

      return NextResponse.json({ players });
    }

    // ------------------------------------------------------------------
    // Team roster search (original behavior)
    // ------------------------------------------------------------------
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
    const players: { player_id: number; player_name: string; pos: string | null; on_roster: boolean }[] = [];
    const playerIds: number[] = [];
    for (const r of rows ?? []) {
      if (seen.has(r.player_id)) continue;
      seen.add(r.player_id);
      if (q && !r.player_name.toLowerCase().includes(q)) continue;
      players.push({ player_id: r.player_id, player_name: r.player_name, pos: r.pos ?? null, on_roster: true });
      playerIds.push(r.player_id);
    }

    // Prefer the draft position over the round-specific position (which can be 'BN')
    if (playerIds.length > 0) {
      const { data: draftRows } = await supabase
        .from('draft_picks')
        .select('player_id, position')
        .in('player_id', playerIds);
      const draftPos = new Map<number, string>();
      for (const d of (draftRows ?? []) as { player_id: number; position: string | null }[]) {
        if (d.position) draftPos.set(d.player_id, d.position);
      }
      for (const p of players) {
        const dp = draftPos.get(p.player_id);
        if (dp) p.pos = dp;
      }
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
