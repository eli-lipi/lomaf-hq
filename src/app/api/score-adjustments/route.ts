import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

// GET all score adjustments
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('score_adjustments')
      .select('*')
      .order('round_number', { ascending: true })
      .order('team_name', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load' },
      { status: 500 }
    );
  }
}

// POST: create or update a score adjustment (manual override or update existing)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { round_number, team_id, team_name, correct_score, lineup_score, assigned_line, note, status, source } = body;

    if (!round_number || !team_id) {
      return NextResponse.json({ error: 'round_number and team_id required' }, { status: 400 });
    }

    const adjustment = Number(correct_score) - Number(lineup_score);

    const { data, error } = await supabase
      .from('score_adjustments')
      .upsert({
        round_number,
        team_id,
        team_name: team_name || '',
        correct_score: Number(correct_score),
        lineup_score: Number(lineup_score),
        adjustment,
        source: source || 'manual',
        assigned_line: assigned_line || null,
        note: note || null,
        status: status || 'unconfirmed',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'round_number,team_id' });

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save' },
      { status: 500 }
    );
  }
}

// DELETE a score adjustment
export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { error } = await supabase.from('score_adjustments').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete' },
      { status: 500 }
    );
  }
}
