import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recalculateTradeForRound } from '@/lib/trades/recalculate';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { round?: number; force?: boolean };

    let round: number;
    if (body.round === undefined || body.round === null) {
      // Fallback: latest round with snapshots
      const { data: latest } = await supabase
        .from('team_snapshots')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1);
      round = latest?.[0]?.round_number ?? 0;
    } else {
      round = body.round;
    }

    await recalculateTradeForRound(supabase, id, round, body.force === true);
    return NextResponse.json({ success: true, round });
  } catch (err) {
    console.error('[trades/[id]/recalculate]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Recalc failed' },
      { status: 500 }
    );
  }
}
