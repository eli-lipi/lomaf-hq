'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import OverviewTab from './overview-tab';
import RoundRangeTab from './round-range-tab';
import LineRankingsTab from './line-rankings-tab';
import LuckFormTab from './luck-form-tab';
import DraftTab from './draft-tab';
import PlayersTab from './players-tab';
import ConcentrationTab from './concentration-tab';
import StabilityTab from './stability-tab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'range', label: 'Round Range' },
  { id: 'lines', label: 'Line Rankings' },
  { id: 'luck', label: 'Luck & Form' },
  { id: 'draft', label: 'Draft vs Reality' },
  { id: 'players', label: 'Player Rankings' },
  { id: 'concentration', label: 'AFL Concentration' },
  { id: 'stability', label: 'Team Stability' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AnalyticsContent({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading...</div>}>
      <AnalyticsContentInner isAdmin={isAdmin} />
    </Suspense>
  );
}

function AnalyticsContentInner({ isAdmin }: { isAdmin: boolean }) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TabId>(
    (TABS.find((t) => t.id === tabParam)?.id) ?? 'overview'
  );

  useEffect(() => {
    if (tabParam && TABS.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
    }
  }, [tabParam]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Data Analytics</h1>
      <p className="text-muted-foreground text-sm mb-6">League insights and team analysis</p>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              window.history.replaceState(null, '', `/analytics?tab=${tab.id}`);
            }}
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

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'range' && <RoundRangeTab />}
      {activeTab === 'lines' && <LineRankingsTab />}
      {activeTab === 'luck' && <LuckFormTab />}
      {activeTab === 'draft' && <DraftTab isAdmin={isAdmin} />}
      {activeTab === 'players' && <PlayersTab />}
      {activeTab === 'concentration' && <ConcentrationTab />}
      {activeTab === 'stability' && <StabilityTab />}
    </div>
  );
}
