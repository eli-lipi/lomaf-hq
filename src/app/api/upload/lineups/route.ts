import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function parseRoundFromId(roundId: string | number): number {
  const str = String(roundId);
  if (str.length === 6) {
    return parseInt(str.slice(4), 10);
  }
  return parseInt(str, 10);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data, target_round } = body as {
      data: Record<string, unknown>[];
      target_round?: number;
    };

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    // Group rows by round (each row has its own round_id, UNLESS the UI sent
    // an explicit target_round override — in which case all rows go to that).
    const rowsByRound = new Map<number, Record<string, unknown>[]>();
    const explicitRound =
      typeof target_round === 'number' && target_round > 0 ? target_round : null;

    if (explicitRound) {
      rowsByRound.set(explicitRound, data);
    } else {
      for (const row of data) {
        const roundId = (row['round_id'] || row['Round ID'] || row['roundId']) as
          | string
          | number
          | undefined;
        if (!roundId) continue;

        const roundNum = parseRoundFromId(roundId);
        if (!rowsByRound.has(roundNum)) {
          rowsByRound.set(roundNum, []);
        }
        rowsByRound.get(roundNum)!.push(row);
      }
    }

    if (rowsByRound.size === 0) {
      return NextResponse.json({ error: 'No round_id found in CSV data' }, { status: 400 });
    }

    const roundSummary: Record<number, number> = {};

    // Process each round
    for (const [roundNum, rows] of rowsByRound) {
      const playerRows = rows.map((row) => {
        const teamName = String(row['team_name'] || row['Team'] || row['team'] || '');
        const team = TEAMS.find(
          (t) => t.team_name.toLowerCase() === teamName.toLowerCase() || t.team_id === Number(row['team_id'])
        );

        const pos = String(row['pos'] || row['position'] || row['Position'] || 'BN').toUpperCase();
        const isEmg = row['is_emg'] === 1 || row['is_emg'] === '1' || row['is_emg'] === true || row['is_emg'] === 'true';
        const isScoring = row['is_scoring'] === 1 || row['is_scoring'] === '1' || row['is_scoring'] === true || row['is_scoring'] === 'true';
        const points = row['points'] !== undefined && row['points'] !== null && row['points'] !== '' ? Number(row['points']) : null;

        return {
          round_number: roundNum,
          team_id: team?.team_id || Number(row['team_id'] || 0),
          team_name: team?.team_name || teamName,
          player_id: Number(row['player_id'] || row['Player ID'] || 0),
          player_name: String(row['player_name'] || row['Player'] || row['player'] || ''),
          pos,
          is_emg: isEmg,
          is_scoring: isScoring,
          points,
        };
      });

      // Upsert in batches of 500
      for (let i = 0; i < playerRows.length; i += 500) {
        const batch = playerRows.slice(i, i + 500);
        const { error } = await supabase
          .from('player_rounds')
          .upsert(batch, { onConflict: 'round_number,team_id,player_id' });

        if (error) throw error;
      }

      roundSummary[roundNum] = playerRows.length;
    }

    // Log the upload
    const rounds = Array.from(rowsByRound.keys()).sort((a, b) => a - b);
    await supabase.from('csv_uploads').insert({
      round_number: rounds[rounds.length - 1], // latest round
      upload_type: 'lineups',
      raw_data: { rounds: roundSummary, total: data.length },
    });

    return NextResponse.json({
      success: true,
      count: data.length,
      rounds: roundSummary,
    });
  } catch (err) {
    console.error('Lineups upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
