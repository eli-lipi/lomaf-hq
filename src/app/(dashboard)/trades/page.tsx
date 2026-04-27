import { getCurrentUser, isAdmin } from '@/lib/auth';
import TradesPageClient from './trades-page-client';

export default async function TradesPage() {
  const user = await getCurrentUser();
  const admin = isAdmin(user);
  return <TradesPageClient isAdmin={admin} />;
}
