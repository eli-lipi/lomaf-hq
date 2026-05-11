import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import {
  advanceToRound,
  verifyRoundReady,
  getCurrentRound,
  ROUND_CURRENT_TAG,
} from '@/lib/round';

export const maxDuration = 300; // recalc + AI narratives can take a few minutes

interface Body {
  round: number;
  sendEmail?: boolean;
  force?: boolean;
}

/**
 * POST /api/round/advance — admin-only.
 *
 * The round-rhythm ceremony. Verifies the target round is ready, then:
 *   1. Inserts the round_advances ledger row.
 *   2. Recomputes every trade's probability + AI narrative for the new round.
 *   3. Auto-creates the PWRNKGs draft for the new round.
 *   4. Optionally sends the announcement email to all coaches.
 *
 * Body: { round: N, sendEmail: boolean, force?: boolean }.
 * `force` skips the verifyRoundReady gate (escape hatch — front-end button
 * never sets it, but we keep it for the API).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!Number.isFinite(body.round) || body.round < 1) {
    return NextResponse.json({ error: 'invalid round' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const current = await getCurrentRound(supabase);
  // v12.2.1 — re-advancing the current round is allowed and useful
  // (recompute trades, refresh narratives, optionally re-email). Only
  // block targets BELOW the current round.
  if (body.round < current) {
    return NextResponse.json(
      { error: `Round ${body.round} is behind the current round (${current}).` },
      { status: 400 }
    );
  }

  if (!body.force) {
    const verify = await verifyRoundReady(supabase, body.round);
    if (!verify.ready) {
      return NextResponse.json(
        { error: 'Round not ready', verify },
        { status: 409 }
      );
    }
  }

  try {
    const result = await advanceToRound(supabase, {
      round: body.round,
      sendEmail: body.sendEmail !== false,
      advancedBy: user!.id,
    });
    // v13.4 — drop the cached round-current lookup so RoundBadge and
    // any other surface reading the cached round see the new number
    // immediately instead of waiting up to 60s for revalidation. Next
    // 16's revalidateTag takes a CacheLifeConfig profile; { expire: 0 }
    // purges immediately.
    revalidateTag(ROUND_CURRENT_TAG, { expire: 0 });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[round/advance]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Advance failed' },
      { status: 500 }
    );
  }
}
