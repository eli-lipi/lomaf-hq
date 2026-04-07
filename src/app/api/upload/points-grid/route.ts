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

    // Points grid CSV: update player_rounds with score data
    let updatedCount = 0;

    for (const row of data) {
      const playerName = String(row['player_name'] || row['Player'] || row['player'] || '');
      const teamName = String(row['team_name'] || row['Team'] || row['team'] || '');
      const points = row['points'] !== undefined && row['points'] !== null && row['points'] !== '' ? Number(row['points']) : null;
      const playerId = Number(row['player_id'] || row['Player ID'] || 0);

      if (!playerName && !playerId) continue;

      const team = TEAMS.find(
        (t) => t.team_name.toLowerCase() === teamName.toLowerCase() || t.team_id === Number(row['team_id'])
      );

      // Update existing player_rounds row with the score
      const query = supabase
        .from('player_rounds')
        .update({ points })
        .eq('round_number', round_number);

      if (playerId) {
        query.eq('player_id', playerId);
      } else {
        query.eq('player_name', playerName);
      }

      if (team) {
        query.eq('team_id', team.team_id);
      }

      const { error } = await query;
      if (!error) updatedCount++;
    }

    // Log upload
    await supabase.from('csv_uploads').insert({
      round_number,
      upload_type: 'points_grid',
      raw_data: data,
    });

    return NextResponse.json({ success: true, count: updatedCount });
  } catch (err) {
    console.error('Points grid upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
