'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import OverviewTab from './overview-tab';
import RoundRangeTab from './round-range-tab';
import LineRankingsTab from './line-rankings-tab';
import LuckFormTab from './luck-form-tab';
import DraftTab from './draft-tab';
import PlayersTab from './players-tab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'range', label: 'Round Range' },
  { id: 'lines', label: 'Line Rankings' },
  { id: 'luck', label: 'Luck & Form' },
  { id: 'draft', label: 'Draft vs Reality' },
  { id: 'players', label: 'Player Rankings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Data Analytics</h1>
      <p className="text-muted-foreground text-sm mb-6">League insights and team analysis</p>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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
      {activeTab === 'draft' && <DraftTab />}
      {activeTab === 'players' && <PlayersTab />}
    </div>
  );
}
