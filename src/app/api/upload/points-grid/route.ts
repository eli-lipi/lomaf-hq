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

    // Fetch ALL existing player_rounds. We include `club` and `points` so we
    // can skip no-op updates (huge speedup when re-uploading the same grid).
    interface ExistingRow {
      id: string;
      round_number: number;
      player_id: number;
      team_id: number;
      player_name: string;
      club: string | null;
      points: number | null;
    }
    const existingRows: ExistingRow[] = [];
    let offset = 0;
    while (true) {
      const { data: batch, error } = await supabase
        .from('player_rounds')
        .select('id, round_number, player_id, team_id, player_name, club, points')
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

    // Build the set of update rows (one per existing player_rounds row that has a score this grid)
    interface UpdateRow {
      id: string;
      points: number;
      club: string | null;
    }
    const updateRows: UpdateRow[] = [];

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

        const club = playerClubMap.get(playerId) || null;
        // Skip if both points and club already match existing (no-op).
        const pointsMatch = existing.points === points;
        const clubMatch = club == null || existing.club === club;
        if (pointsMatch && clubMatch) continue;

        updateRows.push({
          id: existing.id,
          points,
          club,
        });
      }
    }

    // Parallel UPDATE calls in batches (we only ever update existing rows — never insert).
    // This avoids upsert's NOT NULL column requirements.
    let pointsUpdatedCount = 0;
    const updateErrors: string[] = [];
    const PARALLEL = 50;
    for (let i = 0; i < updateRows.length; i += PARALLEL) {
      const batch = updateRows.slice(i, i + PARALLEL);
      await Promise.all(
        batch.map(async (r) => {
          const patch: { points: number; club?: string } = { points: r.points };
          if (r.club) patch.club = r.club;
          const { error } = await supabase
            .from('player_rounds')
            .update(patch)
            .eq('id', r.id);
          if (error) {
            updateErrors.push(error.message);
          } else {
            pointsUpdatedCount++;
          }
        })
      );
    }
    if (updateErrors.length > 0) {
      console.error('[points-grid] Update errors (first 5):', updateErrors.slice(0, 5));
      throw new Error(`${updateErrors.length} update(s) failed. First: ${updateErrors[0]}`);
    }

    // ─── Backfill club across every round for each player (rows w/ no score this grid) ──
    // Skip rows where the existing club already matches (no-op).
    const alreadyUpdated = new Set(updateRows.map((r) => r.id));
    const clubBackfillRows: { id: string; club: string }[] = [];
    for (const er of existingRows) {
      if (alreadyUpdated.has(er.id)) continue;
      const club = playerClubMap.get(er.player_id);
      if (!club) continue;
      if (er.club === club) continue; // already correct, skip
      clubBackfillRows.push({ id: er.id, club });
    }

    let clubBackfilledCount = 0;
    if (clubBackfillRows.length > 0) {
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

    // Recalculate trade probabilities ONLY for the latest round we have data for.
    // Running this for every round column (0..28) was causing 10+ minute timeouts;
    // the only snapshot the UI cares about is the current round.
    try {
      const { recalculateAllTradesForRound } = await import('@/lib/trades/recalculate');
      await recalculateAllTradesForRound(supabase, maxRound).catch((e) =>
        console.error('[points-grid] Trade recalc failed for R' + maxRound, e)
      );
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
    let message = 'Upload failed';
    if (err instanceof Error) message = err.message;
    else if (err && typeof err === 'object') {
      const e = err as { message?: string; details?: string; hint?: string };
      message = e.message || e.details || e.hint || JSON.stringify(err);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
