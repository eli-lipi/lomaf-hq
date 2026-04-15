import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { data } = await request.json();

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    // Points Grid CSV is in WIDE format:
    // Columns: id, name, team (AFL club: ADE, BRL, ...), R0, R1, ... R28
    // Each row is one player, each R# column is their score for that round.

    const sampleRow = data[0];
    const roundColumns: { col: string; roundNum: number }[] = [];
    for (const key of Object.keys(sampleRow)) {
      const match = key.match(/^R(\d+)$/);
      if (match) {
        roundColumns.push({ col: key, roundNum: parseInt(match[1], 10) });
      }
    }

    if (roundColumns.length === 0) {
      return NextResponse.json({ error: 'No round columns (R0, R1, ...) found in data' }, { status: 400 });
    }

    // Fetch ALL existing player_rounds (with the fields we need to echo back in upsert).
    // Keyed by (round_number, player_id). Paginate to get all.
    interface ExistingRow {
      id: string;
      round_number: number;
      player_id: number;
      team_id: number;
      player_name: string;
    }
    const existingRows: ExistingRow[] = [];
    let offset = 0;
    while (true) {
      const { data: batch, error } = await supabase
        .from('player_rounds')
        .select('id, round_number, player_id, team_id, player_name')
        .range(offset, offset + 999);
      if (error) throw error;
      if (!batch || batch.length === 0) break;
      existingRows.push(...batch);
      if (batch.length < 1000) break;
      offset += 1000;
    }

    const existingMap = new Map<string, ExistingRow>();
    existingRows.forEach((r) => {
      existingMap.set(`${r.round_number}-${r.player_id}`, r);
    });

    // Build player_id → AFL club map (from column 3 of CSV)
    const playerClubMap = new Map<number, string>();
    for (const row of data) {
      const playerId = Number(row['id'] || row['player_id'] || 0);
      if (!playerId) continue;
      const aflClubRaw = row['team'] || row['team_name'] || row['club'] || row['squad'] || '';
      const aflClub = String(aflClubRaw).trim();
      if (aflClub) playerClubMap.set(playerId, aflClub);
    }

    // Build the set of upsert rows (one per existing player_rounds row that has a score this grid)
    interface UpsertRow {
      id: string;
      round_number: number;
      player_id: number;
      team_id: number;
      player_name: string;
      points: number;
      club: string | null;
    }
    const upsertRows: UpsertRow[] = [];

    for (const { col, roundNum } of roundColumns) {
      for (const row of data) {
        const playerId = Number(row['id'] || row['player_id'] || 0);
        if (!playerId) continue;

        const val = row[col];
        if (val === undefined || val === null || val === '' || val === '-') continue;
        const points = Number(val);
        if (isNaN(points)) continue;

        const existing = existingMap.get(`${roundNum}-${playerId}`);
        if (!existing) continue;

        upsertRows.push({
          id: existing.id,
          round_number: existing.round_number,
          player_id: existing.player_id,
          team_id: existing.team_id,
          player_name: existing.player_name,
          points,
          club: playerClubMap.get(playerId) || null,
        });
      }
    }

    // Batch upsert in chunks of 500
    let pointsUpdatedCount = 0;
    const CHUNK = 500;
    for (let i = 0; i < upsertRows.length; i += CHUNK) {
      const chunk = upsertRows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('player_rounds')
        .upsert(chunk, { onConflict: 'id' });
      if (error) {
        console.error('[points-grid] Chunk upsert failed:', error);
        throw error;
      }
      pointsUpdatedCount += chunk.length;
    }

    // ─── Backfill club across every round for each player (batch). ───────────
    // Even rows that had no score entry in this grid get their club populated.
    // Do this via batch upsert: build one row per existing player_round whose
    // player has a club but club is still null. We already have existingRows in memory.
    const clubBackfillRows: UpsertRow[] = [];
    // Track which (round,player) keys already got a points update so we don't stomp them
    const alreadyUpdated = new Set(upsertRows.map(r => r.id));

    for (const er of existingRows) {
      if (alreadyUpdated.has(er.id)) continue;
      const club = playerClubMap.get(er.player_id);
      if (!club) continue;
      clubBackfillRows.push({
        id: er.id,
        round_number: er.round_number,
        player_id: er.player_id,
        team_id: er.team_id,
        player_name: er.player_name,
        // points: don't overwrite — set to existing value? We don't have it.
        // Safer: skip the backfill if we'd need to preserve an unknown points value.
        // Instead, use a lightweight update() below for club-only changes.
        points: 0, // placeholder, never used
        club,
      });
    }

    // For the backfill, do club-only UPDATE in parallel chunks (not upsert, to avoid stomping points).
    let clubBackfilledCount = 0;
    if (clubBackfillRows.length > 0) {
      const PARALLEL = 20;
      for (let i = 0; i < clubBackfillRows.length; i += PARALLEL) {
        const batch = clubBackfillRows.slice(i, i + PARALLEL);
        await Promise.all(
          batch.map(async (r) => {
            const { error } = await supabase
              .from('player_rounds')
              .update({ club: r.club })
              .eq('id', r.id);
            if (!error) clubBackfilledCount++;
          })
        );
      }
    }

    // Log upload
    const maxRound = Math.max(...roundColumns.map((r) => r.roundNum));
    await supabase.from('csv_uploads').insert({
      round_number: maxRound,
      upload_type: 'points_grid',
      raw_data: {
        players: data.length,
        round_columns: roundColumns.map((r) => r.col),
        clubs_found: playerClubMap.size,
      },
    });

    // Recalculate trade probabilities (fire-and-forget)
    try {
      const { recalculateAllTradesForRound } = await import('@/lib/trades/recalculate');
      for (const { roundNum } of roundColumns) {
        await recalculateAllTradesForRound(supabase, roundNum).catch((e) =>
          console.error('[points-grid] Trade recalc failed for R' + roundNum, e)
        );
      }
    } catch (e) {
      console.error('[points-grid] Could not load trade recalc module', e);
    }

    return NextResponse.json({
      success: true,
      count: pointsUpdatedCount,
      club_backfilled: clubBackfilledCount,
      players_with_club: playerClubMap.size,
      rounds_in_grid: roundColumns.map((r) => r.roundNum),
    });
  } catch (err) {
    console.error('Points grid upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
