import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ARCHIVED (2026-07) — the Byes feature covered the R12–R16 bye block, which
// is over for the 2026 season. The nav entry is removed and the route now
// redirects to Analytics. The byes-*.tsx components are kept in-repo (not
// deleted) so the feature can be revived for a future season if needed.
export default async function ByesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  redirect('/analytics?tab=overview');
}
