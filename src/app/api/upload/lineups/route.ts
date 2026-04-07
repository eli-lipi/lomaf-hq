import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const { round_number, data } = await request.json();

    if (!round_number || !data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing round_number or data' }, { status: 400 });
    }

    // Map CSV rows to player_rounds format
    // Expected CSV columns vary — we normalize common patterns
    const rows = data.map((row: Record<string, unknown>) => {
      const teamName = String(row['team_name'] || row['Team'] || row['team'] || '');
      const team = TEAMS.find(
        (t) => t.team_name.toLowerCase() === teamName.toLowerCase() || t.team_id === Number(row['team_id'])
      );

      const pos = String(row['pos'] || row['position'] || row['Position'] || 'BN').toUpperCase();
      const isEmg = row['is_emg'] === 1 || row['is_emg'] === '1' || row['is_emg'] === true;
      const isScoring = row['is_scoring'] === 1 || row['is_scoring'] === '1' || row['is_scoring'] === true;
      const points = row['points'] !== undefined && row['points'] !== null && row['points'] !== '' ? Number(row['points']) : null;

      // Detect round from round_id column if present
      let playerRound = round_number;
      if (row['round_id']) {
        const rid = String(row['round_id']);
        if (rid.length === 6) {
          playerRound = parseInt(rid.slice(4), 10);
        }
      }

      return {
        round_number: playerRound,
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

    // Filter to only the specified round (CSV may be cumulative)
    const roundRows = rows.filter((r: { round_number: number }) => r.round_number === round_number);

    if (roundRows.length === 0) {
      return NextResponse.json({ error: `No data found for round ${round_number}` }, { status: 400 });
    }

    // Upsert into player_rounds
    const { error: upsertError } = await supabase
      .from('player_rounds')
      .upsert(roundRows, { onConflict: 'round_number,team_id,player_id' });

    if (upsertError) throw upsertError;

    // Log the upload
    await supabase.from('csv_uploads').insert({
      round_number,
      upload_type: 'lineups',
      raw_data: data,
    });

    return NextResponse.json({ success: true, count: roundRows.length });
  } catch (err) {
    console.error('Lineups upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
