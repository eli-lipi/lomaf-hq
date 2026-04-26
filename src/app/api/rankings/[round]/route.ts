import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

export async function GET(request: Request, { params }: { params: Promise<{ round: string }> }) {
  const { round } = await params;
  const roundNumber = parseInt(round, 10);

  const { data: roundData } = await supabase
    .from('pwrnkgs_rounds')
    .select('*')
    .eq('round_number', roundNumber)
    .single();

  const { data: rankings } = await supabase
    .from('pwrnkgs_rankings')
    .select('*')
    .eq('round_number', roundNumber)
    .order('ranking', { ascending: true });

  return NextResponse.json({ round: roundData, rankings: rankings || [] });
}

export async function PUT(request: Request, { params }: { params: Promise<{ round: string }> }) {
  const { round } = await params;
  const roundNumber = parseInt(round, 10);
  const body = await request.json();

  try {
    // Update round metadata
    if (body.round) {
      const { error } = await supabase
        .from('pwrnkgs_rounds')
        .update({
          theme: body.round.theme,
          preview_text: body.round.preview_text,
          week_ahead_text: body.round.week_ahead_text,
        })
        .eq('round_number', roundNumber);

      if (error) throw error;
    }

    // Upsert rankings
    if (body.rankings && Array.isArray(body.rankings)) {
      const { error } = await supabase
        .from('pwrnkgs_rankings')
        .upsert(body.rankings, { onConflict: 'round_number,team_id' });

      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Save failed' },
      { status: 500 }
    );
  }
}
