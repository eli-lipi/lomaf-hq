import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';

// Called once a minute from the dashboard while the tab is visible.
// Increments the (user_id, today) row in user_activity by 1 minute.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const { error } = await supabase.rpc('increment_user_activity', {
    p_user_id: user.id,
    p_date: today,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
