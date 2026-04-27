import { redirect } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import ActivityHeartbeat from '@/components/ActivityHeartbeat';
import { getCurrentUser } from '@/lib/auth';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="flex h-full">
      <Sidebar user={user} />
      <main className="flex-1 min-h-screen lg:pt-0 pt-14 overflow-auto bg-background">
        {/* v10 — bumped from max-w-7xl (1280px) to 1440px so the data-rich
            Trades page (chart, side-by-side tables) has room to breathe.
            Prose-heavy sections constrain themselves internally where needed. */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </div>
      </main>
      <ActivityHeartbeat />
    </div>
  );
}
