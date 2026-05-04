import { NextResponse } from 'next/server';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';

/**
 * GET /api/round/history — admin-only. Returns all round_advances rows
 * (most recent first) joined with the advancing user's display_name.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from('round_advances')
    .select('*')
    .order('round_number', { ascending: false });

  const advances = (rows ?? []) as Array<{
    round_number: number;
    advanced_at: string;
    advanced_by: string | null;
    emails_sent: boolean;
    email_sent_at: string | null;
  }>;

  // Resolve admin names in one pass.
  const userIds = Array.from(new Set(advances.map((r) => r.advanced_by).filter((id): id is string => !!id)));
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, display_name').in('id', userIds);
    for (const u of (users ?? []) as { id: string; display_name: string | null }[]) {
      if (u.display_name) nameById.set(u.id, u.display_name);
    }
  }

  return NextResponse.json({
    history: advances.map((r) => ({
      round_number: r.round_number,
      advanced_at: r.advanced_at,
      advanced_by_name: r.advanced_by ? nameById.get(r.advanced_by) ?? 'System' : 'System (backfill)',
      emails_sent: r.emails_sent,
      email_sent_at: r.email_sent_at,
    })),
  });
}
