import { NextResponse } from 'next/server';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { sendRoundLiveEmail } from '@/lib/email';

/**
 * POST /api/round/[round]/resend-email — admin-only.
 *
 * Manually re-sends the "Round N is live" announcement. Used from the
 * History table on /round-control when an earlier advance failed to
 * email or you just want to nudge people again.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ round: string }> }) {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { round: roundStr } = await ctx.params;
  const round = Number(roundStr);
  if (!Number.isFinite(round) || round < 1) {
    return NextResponse.json({ error: 'invalid round' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  try {
    await sendRoundLiveEmail(supabase, round);
    await supabase
      .from('round_advances')
      .update({ emails_sent: true, email_sent_at: new Date().toISOString() })
      .eq('round_number', round);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[round/resend-email]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Email send failed' },
      { status: 500 }
    );
  }
}
