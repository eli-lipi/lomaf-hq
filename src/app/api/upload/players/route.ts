import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * POST /api/upload/players
 *
 * Ingests the season-wide AFL Fantasy players export (the canonical
 * roster: name, AFL club, position, owner, plus form / projection
 * stats). Used as the source of truth for player position when
 * round-specific lineup data doesn't tell us (e.g. a waiver pickup
 * who's never made the senior team's lineup).
 *
 * CSV columns expected (case-insensitive):
 *   name, team, position, owner, age, careerGames, seasons, adp,
 *   ownedPct, projAvg, avgPts, totalPts, L5, L3, L1, games, TOG%,
 *   kicks, handballs, marks, hitouts, tackles, goals, behinds.
 *
 * Upsert keyed on (player_name, afl_club). Resolves player_id from
 * player_rounds by exact name + matching club.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data } = body as { data: Record<string, unknown>[] };
    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    // Resolve player_id by joining on (player_name, club) against the
    // most recent player_rounds row per player.
    const { data: prRows } = await supabase
      .from('player_rounds')
      .select('player_id, player_name, club, round_number')
      .order('round_number', { ascending: false });
    const seen = new Set<number>();
    const idByNameClub = new Map<string, number>();
    for (const r of (prRows ?? []) as Array<{
      player_id: number;
      player_name: string;
      club: string | null;
      round_number: number;
    }>) {
      if (seen.has(r.player_id)) continue;
      seen.add(r.player_id);
      const key = `${r.player_name.toLowerCase()}::${(r.club ?? '').toUpperCase()}`;
      idByNameClub.set(key, r.player_id);
    }

    const num = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const int = (v: unknown): number | null => {
      const n = num(v);
      return n == null ? null : Math.round(n);
    };

    const rows = (data as Array<Record<string, unknown>>)
      .map((row) => {
        const playerName = String(row['name'] ?? row['Name'] ?? row['player_name'] ?? '').trim();
        const aflClub = String(row['team'] ?? row['Team'] ?? row['club'] ?? '').trim().toUpperCase();
        if (!playerName || !aflClub) return null;

        const ownerRaw = String(row['owner'] ?? row['Owner'] ?? '').trim();
        const owner = ownerRaw === '' ? null : ownerRaw;
        const position = String(row['position'] ?? row['Position'] ?? row['pos'] ?? '').trim() || null;
        const playerId = idByNameClub.get(`${playerName.toLowerCase()}::${aflClub}`) ?? null;

        return {
          player_id: playerId,
          player_name: playerName,
          afl_club: aflClub,
          position,
          owner_team_name: owner,
          age: int(row['age'] ?? row['Age']),
          career_games: int(row['careerGames'] ?? row['career_games']),
          seasons: int(row['seasons'] ?? row['Seasons']),
          adp: num(row['adp'] ?? row['ADP']),
          owned_pct: num(row['ownedPct'] ?? row['owned_pct']),
          proj_avg: num(row['projAvg'] ?? row['proj_avg']),
          avg_pts: num(row['avgPts'] ?? row['avg_pts']),
          total_pts: int(row['totalPts'] ?? row['total_pts']),
          last5_avg: num(row['L5'] ?? row['l5']),
          last3_avg: num(row['L3'] ?? row['l3']),
          last1: num(row['L1'] ?? row['l1']),
          games_played: int(row['games'] ?? row['Games']),
          tog_pct: num(row['TOG%'] ?? row['tog_pct']),
          kicks: num(row['kicks']),
          handballs: num(row['handballs']),
          marks: num(row['marks']),
          hitouts: num(row['hitouts']),
          tackles: num(row['tackles']),
          goals: num(row['goals']),
          behinds: num(row['behinds']),
          uploaded_at: new Date().toISOString(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid rows in CSV' }, { status: 400 });
    }

    // Batched upserts to keep payloads small.
    const BATCH = 200;
    let upserted = 0;
    let resolved = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase
        .from('players')
        .upsert(batch, { onConflict: 'player_name,afl_club' });
      if (error) {
        console.error('[upload/players] upsert error', error);
        return NextResponse.json({ error: error.message ?? 'players upsert failed' }, { status: 500 });
      }
      upserted += batch.length;
      resolved += batch.filter((r) => r.player_id != null).length;
    }

    // Log the upload — rest of the codebase reads csv_uploads for
    // bookkeeping.
    await supabase.from('csv_uploads').insert({
      round_number: 0, // season-wide, not round-specific
      upload_type: 'players',
    }).select();

    return NextResponse.json({
      success: true,
      total: rows.length,
      upserted,
      resolved,
      unresolved: rows.length - resolved,
    });
  } catch (err) {
    console.error('[upload/players]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
