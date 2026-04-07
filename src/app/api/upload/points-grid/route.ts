import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';

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
    // Columns: id, name, team, R0, R1, R2, R3, R4, ... R28
    // Each row is one player, each R# column is their score for that round

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

    // Build a lookup of existing player_rounds for fast matching
    // Get all unique rounds that have data
    const { data: existingRounds } = await supabase
      .from('player_rounds')
      .select('round_number, player_id, team_id, id')
      .order('round_number');

    const existingMap = new Map<string, string>();
    existingRounds?.forEach((r) => {
      existingMap.set(`${r.round_number}-${r.player_id}-${r.team_id}`, r.id);
    });

    let updatedCount = 0;

    // Process in batches per round
    for (const { col, roundNum } of roundColumns) {
      const updates: { id: string; points: number }[] = [];

      for (const row of data) {
        const playerId = Number(row['id'] || row['player_id'] || 0);
        const teamName = String(row['team'] || row['team_name'] || '');

        if (!playerId) continue;

        const val = row[col];
        if (val === undefined || val === null || val === '' || val === '-') continue;
        const points = Number(val);
        if (isNaN(points)) continue;

        // Find team
        const team = TEAMS.find(
          (t) => t.team_name.toLowerCase() === teamName.toLowerCase()
        );
        const teamId = team?.team_id || 0;

        // Look up existing record
        const key = `${roundNum}-${playerId}-${teamId}`;
        const existingId = existingMap.get(key);
        if (existingId) {
          updates.push({ id: existingId, points });
        }
      }

      // Batch update by ID
      for (const { id, points } of updates) {
        const { error } = await supabase
          .from('player_rounds')
          .update({ points })
          .eq('id', id);

        if (!error) updatedCount++;
      }
    }

    // Log upload
    const maxRound = Math.max(...roundColumns.map((r) => r.roundNum));
    await supabase.from('csv_uploads').insert({
      round_number: maxRound,
      upload_type: 'points_grid',
      raw_data: { players: data.length, round_columns: roundColumns.map((r) => r.col) },
    });

    return NextResponse.json({
      success: true,
      count: updatedCount,
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
