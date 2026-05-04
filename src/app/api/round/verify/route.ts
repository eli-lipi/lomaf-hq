import { NextResponse } from 'next/server';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { verifyRoundReady, getNextRound } from '@/lib/round';

/**
 * GET /api/round/verify?round=N — admin-only.
 * Returns the readiness checklist for round N. Used by /round-control to
 * power the verification panel + enable/disable the Advance button.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const url = new URL(req.url);
  const roundParam = url.searchParams.get('round');
  const round = roundParam ? Number(roundParam) : await getNextRound(supabase);
  if (!Number.isFinite(round) || round < 1) {
    return NextResponse.json({ error: 'invalid round' }, { status: 400 });
  }
  const result = await verifyRoundReady(supabase, round);
  return NextResponse.json(result);
}
