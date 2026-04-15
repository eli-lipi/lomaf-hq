import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  recalculateTradeAcrossPostTradeRounds,
  recalculateTradeForRound,
} from '@/lib/trades/recalculate';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { round?: number; force?: boolean };
    const force = body.force === true;

    // If a specific round is provided, just recalc that one round (legacy behavior).
    // Otherwise, recalc the entire post-trade span — this is what the UI button does.
    if (body.round !== undefined && body.round !== null) {
      await recalculateTradeForRound(supabase, id, body.round, force);
      return NextResponse.json({ success: true, rounds: [body.round] });
    }

    const { rounds } = await recalculateTradeAcrossPostTradeRounds(supabase, id, { force });
    return NextResponse.json({ success: true, rounds });
  } catch (err) {
    console.error('[trades/[id]/recalculate]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Recalc failed' },
      { status: 500 }
    );
  }
}
