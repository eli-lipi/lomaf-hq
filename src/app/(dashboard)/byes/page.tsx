import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ByesClient from './byes-client';

export const dynamic = 'force-dynamic';

export default async function ByesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Phase 1 admin-only gate removed — Byes is open to all coaches.
  return <ByesClient userTeamId={user.team_id ?? null} />;
}
