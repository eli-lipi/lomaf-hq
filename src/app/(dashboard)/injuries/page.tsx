import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import InjuriesClient from './injuries-client';

export const dynamic = 'force-dynamic';

export default async function InjuriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return <InjuriesClient userTeamId={user.team_id ?? null} />;
}
