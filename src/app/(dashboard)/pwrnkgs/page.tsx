import { getCurrentUser, isAdmin } from '@/lib/auth';
import PwrnkgsContent from './pwrnkgs-content';

export default async function PwrnkgsPage() {
  const user = await getCurrentUser();
  const admin = isAdmin(user);
  return <PwrnkgsContent isAdmin={admin} />;
}
