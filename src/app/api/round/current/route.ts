import { NextResponse } from 'next/server';
import { getCurrentRoundRow } from '@/lib/round';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getCurrentUser } from '@/lib/auth';

/**
 * GET /api/round/current — open to any signed-in user. Powers the
 * top-bar Round badge that's visible to everyone.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = await createSupabaseServerClient();
  const row = await getCurrentRoundRow(supabase);
  if (!row) {
    return NextResponse.json({ round: 0, advancedAt: null, emailsSent: false });
  }
  return NextResponse.json({
    round: row.round_number,
    advancedAt: row.advanced_at,
    advancedBy: row.advanced_by,
    emailsSent: row.emails_sent,
    emailSentAt: row.email_sent_at,
  });
}
