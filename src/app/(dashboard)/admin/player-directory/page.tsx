import { redirect } from 'next/navigation';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import PlayerDirectoryClient from './client';

export const dynamic = 'force-dynamic';

export default async function PlayerDirectoryPage() {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    redirect('/');
  }
  return <PlayerDirectoryClient />;
}
