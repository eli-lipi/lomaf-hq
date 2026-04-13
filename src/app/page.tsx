import { redirect } from 'next/navigation';
import { getCurrentUser, isAdmin } from '@/lib/auth';

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  redirect(isAdmin(user) ? '/pwrnkgs' : '/pwrnkgs?tab=previous');
}
