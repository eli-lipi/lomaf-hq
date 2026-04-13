'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import TradeTrackingTab from './trade-tracking-tab';
import TradeRecommendationsTab from './trade-recommendations-tab';

const TOP_TABS = [
  { id: 'tracking', label: 'Trade Tracking' },
  { id: 'recommendations', label: 'Trade Recommendations' },
] as const;

type TopTab = (typeof TOP_TABS)[number]['id'];

export default function TradesPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading...</div>}>
      <TradesPageInner />
    </Suspense>
  );
}

function TradesPageInner() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [topTab, setTopTab] = useState<TopTab>(
    tabParam === 'recommendations' ? 'recommendations' : 'tracking'
  );

  useEffect(() => {
    if (tabParam === 'recommendations') setTopTab('recommendations');
    else if (tabParam === 'tracking') setTopTab('tracking');
  }, [tabParam]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Trades</h1>
        <p className="text-muted-foreground text-sm mt-1">Trade tracking & recommendations</p>
      </div>

      {/* Top-level tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        {TOP_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTopTab(tab.id)}
            className={cn(
              'px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              topTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {topTab === 'tracking' && <TradeTrackingTab />}
      {topTab === 'recommendations' && <TradeRecommendationsTab />}
    </div>
  );
}
