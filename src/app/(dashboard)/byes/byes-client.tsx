'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import OverviewTab from './overview-tab';
import FixtureTab from './fixture-tab';
import MyTeamTab from './my-team-tab';
import { useByeData } from './use-bye-data';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'fixture', label: 'Fixture' },
  { id: 'my-team', label: 'My Team' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ByesClient({ userTeamId }: { userTeamId: number | null }) {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading…</div>}>
      <ByesClientInner userTeamId={userTeamId} />
    </Suspense>
  );
}

function ByesClientInner({ userTeamId }: { userTeamId: number | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId =
    (TABS.find((t) => t.id === tabParam)?.id) ?? 'overview';

  const switchTab = (tab: TabId) => {
    router.replace(`/byes?tab=${tab}`, { scroll: false });
  };

  // Single shared fetch — every tab consumes the same data.
  const data = useByeData();

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Byes</h1>
        <p className="text-muted-foreground text-sm mt-1">
          AFL bye fixture for the 2026 season (R12–R16). When 2 AFL clubs bye we play normally;
          when 4 bye we play <span className="font-semibold text-foreground">best 16</span> — top
          16 scores from each coach&apos;s full list, no positions or bench. Players predicted
          injured by AFL.com.au also count as unavailable.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab data={data} />}
      {activeTab === 'fixture' && <FixtureTab data={data} />}
      {activeTab === 'my-team' && <MyTeamTab data={data} defaultTeamId={userTeamId} />}
    </div>
  );
}
