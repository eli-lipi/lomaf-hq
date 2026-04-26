import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

export async function POST(request: Request) {
  try {
    const { data } = await request.json();

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    const rows = data.map((row: Record<string, unknown>) => {
      const teamName = String(row['team_name'] || row['Team'] || row['team'] || '');
      const team = TEAMS.find(
        (t) => t.team_name.toLowerCase() === teamName.toLowerCase() || t.team_id === Number(row['team_id'])
      );

      return {
        round: Number(row['round'] || row['Round'] || row['draft_round'] || 0),
        round_pick: Number(row['round_pick'] || row['Round Pick'] || row['pick'] || 0),
        overall_pick: Number(row['overall_pick'] || row['Overall Pick'] || row['overall'] || 0),
        team_name: team?.team_name || teamName,
        team_id: team?.team_id || Number(row['team_id'] || 0),
        player_name: String(row['player_name'] || row['Player'] || row['player'] || ''),
        player_id: Number(row['player_id'] || row['Player ID'] || 0),
        drafted_at: row['drafted_at'] ? String(row['drafted_at']) : null,
        draft_method: row['draft_method'] ? String(row['draft_method']) : null,
        position: row['position'] ? String(row['position']) : null,
      };
    });

    const { error } = await supabase.from('draft_picks').insert(rows);
    if (error) throw error;

    // Log upload
    await supabase.from('csv_uploads').insert({
      round_number: 0,
      upload_type: 'draft',
      raw_data: data,
    });

    return NextResponse.json({ success: true, count: rows.length });
  } catch (err) {
    console.error('Draft upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
