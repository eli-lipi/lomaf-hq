import { NextResponse } from 'next/server';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { syncAflInjuries } from '@/lib/afl-injuries';

// Long timeout — fetch + parse + 130-row upsert + name resolution.
export const maxDuration = 120;

/**
 * POST /api/afl-injuries/sync — admin-only.
 * Pulls the AFL injury list, upserts the cache table, resolves player_ids.
 *
 * GET allowed too so the Vercel cron (which only does GETs) can hit it.
 * Cron auth happens via the Vercel-Cron header check.
 */
async function run(req: Request) {
  // Vercel cron requests carry an x-vercel-cron header. Allow them
  // without admin auth so a daily refresh can run unattended.
  const isCron = req.headers.get('x-vercel-cron') === '1';
  if (!isCron) {
    const user = await getCurrentUser();
    if (!isRealAdmin(user)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  try {
    const supabase = await createSupabaseServerClient();
    const result = await syncAflInjuries(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[afl-injuries/sync]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AFL injury sync failed' },
      { status: 500 }
    );
  }
}

export const POST = run;
export const GET = run;
