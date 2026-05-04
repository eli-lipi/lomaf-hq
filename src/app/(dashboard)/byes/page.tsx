import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ByesClient from './byes-client';

export const dynamic = 'force-dynamic';

export default async function ByesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // Admin-only for phase 1 — drop this gate once the user approves opening
  // Byes to all coaches.
  if (user.role !== 'admin') redirect('/');
  return <ByesClient />;
}
