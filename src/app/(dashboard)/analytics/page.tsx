import { getCurrentUser, isAdmin } from '@/lib/auth';
import AnalyticsContent from './analytics-content';

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  const admin = isAdmin(user);
  return <AnalyticsContent isAdmin={admin} />;
}
