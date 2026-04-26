import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cleanPositionDisplay } from '@/lib/trades/positions';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

/**
 * Returns players for the trade logging player picker.
 *
 * Modes:
 *  1. `?team_id=N`           — roster mode: distinct players on that team's
 *                               roster from the most recent few rounds.
 *  2. `?all=true&team_id=N`  — league mode: ALL players ever seen in the
 *                               league (drafted + waiver pickups). Each result
 *                               includes `on_roster: boolean` so the UI can
 *                               flag off-roster players.
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
    // League-wide search (all players: drafted + waiver pickups)
    // ------------------------------------------------------------------
    if (allMode) {
      if (!q || q.length < 2) return NextResponse.json({ players: [] });

      // 1. Search draft_picks for drafted players
      const { data: draftRows } = await supabase
        .from('draft_picks')
        .select('player_id, player_name, position')
        .ilike('player_name', `%${q}%`)
        .order('player_name');

      // 2. Search player_rounds for ALL players who've ever appeared
      //    (catches waiver pickups not in draft_picks)
      const { data: roundRows } = await supabase
        .from('player_rounds')
        .select('player_id, player_name, pos')
        .ilike('player_name', `%${q}%`);

      // 3. Determine which players are on the source team's recent roster
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

      // 4. Merge both sources — draft_picks position takes priority
      const draftPos = new Map<number, string>();
      const seen = new Set<number>();
      const players: {
        player_id: number;
        player_name: string;
        pos: string | null;
        on_roster: boolean;
      }[] = [];

      // Index draft positions
      for (const d of draftRows ?? []) {
        if (d.position) draftPos.set(d.player_id, d.position);
      }

      // Add drafted players first
      for (const d of draftRows ?? []) {
        if (seen.has(d.player_id)) continue;
        seen.add(d.player_id);
        players.push({
          player_id: d.player_id,
          player_name: d.player_name,
          pos: d.position ?? null,
          on_roster: rosterPlayerIds.has(d.player_id),
        });
      }

      // Add any player_rounds players not already covered (waiver pickups)
      for (const r of roundRows ?? []) {
        if (seen.has(r.player_id)) continue;
        seen.add(r.player_id);
        players.push({
          player_id: r.player_id,
          player_name: r.player_name,
          // Draft pos > cleaned round pos (strip BN/UTL)
          pos: draftPos.get(r.player_id) ?? cleanPositionDisplay(r.pos) ?? null,
          on_roster: rosterPlayerIds.has(r.player_id),
        });
      }

      players.sort((a, b) => a.player_name.localeCompare(b.player_name));
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

    // Strip any remaining UTL/BN — these are lineup slots, not positions
    for (const p of players) {
      p.pos = cleanPositionDisplay(p.pos);
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
