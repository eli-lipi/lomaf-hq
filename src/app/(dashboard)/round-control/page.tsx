import { redirect } from 'next/navigation';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { getCurrentRoundRow, getNextRound } from '@/lib/round';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import RoundControlClient from './round-control-client';

export const dynamic = 'force-dynamic';

export default async function RoundControlPage() {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    redirect('/');
  }

  const supabase = await createSupabaseServerClient();
  const currentRow = await getCurrentRoundRow(supabase);
  const currentRound = currentRow?.round_number ?? 0;
  const nextRound = await getNextRound(supabase);

  return (
    <RoundControlClient
      initialCurrentRound={currentRound}
      initialAdvancedAt={currentRow?.advanced_at ?? null}
      initialEmailsSent={currentRow?.emails_sent ?? false}
      initialNextRound={nextRound}
    />
  );
}
