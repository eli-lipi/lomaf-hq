import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const { data } = await request.json();

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    // Points Grid CSV is in WIDE format:
    // Columns: id, name, team (AFL club abbreviation: ADE, BRL, etc.), R0, R1, ... R28
    // Each row is one player, each R# column is their score for that round.

    // Detect round columns (R0, R1, R2, etc.)
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

    // Build a lookup of existing player_rounds keyed by (round_number, player_id).
    // Each player belongs to exactly one LOMAF team per round, so this key is unique.
    // Paginate to handle >1000 rows.
    const existingRows: { round_number: number; player_id: number; id: string }[] = [];
    let offset = 0;
    while (true) {
      const { data: batch } = await supabase
        .from('player_rounds')
        .select('round_number, player_id, id')
        .range(offset, offset + 999);
      if (!batch || batch.length === 0) break;
      existingRows.push(...batch);
      if (batch.length < 1000) break;
      offset += 1000;
    }

    const existingMap = new Map<string, string>();
    existingRows.forEach((r) => {
      existingMap.set(`${r.round_number}-${r.player_id}`, r.id);
    });

    // Build per-player club map (from column 3 of the CSV)
    const playerClubMap = new Map<number, string>();
    for (const row of data) {
      const playerId = Number(row['id'] || row['player_id'] || 0);
      if (!playerId) continue;
      const aflClubRaw = row['team'] || row['team_name'] || row['club'] || row['squad'] || '';
      const aflClub = String(aflClubRaw).trim();
      if (aflClub) playerClubMap.set(playerId, aflClub);
    }

    let pointsUpdatedCount = 0;
    let clubUpdatedCount = 0;

    // Process each round column → update points on matching player_rounds
    for (const { col, roundNum } of roundColumns) {
      for (const row of data) {
        const playerId = Number(row['id'] || row['player_id'] || 0);
        if (!playerId) continue;

        const val = row[col];
        if (val === undefined || val === null || val === '' || val === '-') continue;
        const points = Number(val);
        if (isNaN(points)) continue;

        const key = `${roundNum}-${playerId}`;
        const existingId = existingMap.get(key);
        if (!existingId) continue;

        const club = playerClubMap.get(playerId) || null;

        const { error } = await supabase
          .from('player_rounds')
          .update({ points, ...(club ? { club } : {}) })
          .eq('id', existingId);

        if (!error) {
          pointsUpdatedCount++;
          if (club) clubUpdatedCount++;
        }
      }
    }

    // Also back-fill club on ALL existing player_rounds for each player (across every round),
    // since club membership is stable regardless of round.
    for (const [playerId, club] of playerClubMap.entries()) {
      const { error } = await supabase
        .from('player_rounds')
        .update({ club })
        .eq('player_id', playerId)
        .is('club', null);
      if (!error) {
        // we don't count these for progress — just a best-effort backfill
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

    // Recalculate all trade probabilities for the newly-finalized rounds.
    // Fire-and-forget (caught) so a recalc failure never fails the upload.
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
      clubs_updated: clubUpdatedCount,
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
