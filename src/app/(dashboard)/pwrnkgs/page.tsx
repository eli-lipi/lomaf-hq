'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import SlideLayoutTab from './slide-layout-tab';
import RankingsTab from './rankings-tab';
import PreviewPublishTab from './preview-publish-tab';
import PreviousWeeksTab from './previous-weeks-tab';

const TOP_TABS = [
  { id: 'this-week', label: 'This Week' },
  { id: 'previous', label: 'Previous Weeks' },
] as const;

const SUB_TABS = [
  { id: 'layout', label: 'Slide Layout' },
  { id: 'rankings', label: 'Rankings Editor' },
  { id: 'preview', label: 'Preview & Publish' },
] as const;

type TopTab = (typeof TOP_TABS)[number]['id'];
type SubTab = (typeof SUB_TABS)[number]['id'];

export default function PwrnkgsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading...</div>}>
      <PwrnkgsPageInner />
    </Suspense>
  );
}

function PwrnkgsPageInner() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const subParam = searchParams.get('sub');

  const [topTab, setTopTab] = useState<TopTab>(tabParam === 'previous' ? 'previous' : 'this-week');
  const [subTab, setSubTab] = useState<SubTab>(
    subParam === 'rankings' ? 'rankings' : subParam === 'preview' ? 'preview' : 'layout'
  );

  // Sync with URL params on change
  useEffect(() => {
    if (tabParam === 'previous') setTopTab('previous');
    else if (tabParam === 'this-week') setTopTab('this-week');
  }, [tabParam]);

  useEffect(() => {
    if (subParam === 'rankings') setSubTab('rankings');
    else if (subParam === 'preview') setSubTab('preview');
    else if (subParam === 'layout') setSubTab('layout');
  }, [subParam]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">PWRNKGs</h1>
        <p className="text-muted-foreground text-sm mt-1">Power Rankings — the weekly verdict</p>
      </div>

      {/* Top-level tabs: This Week / Previous Weeks */}
      <div className="flex gap-1 border-b border-border mb-0">
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

      {/* This Week content with sub-tabs */}
      {topTab === 'this-week' && (
        <>
          {/* Sub-tab navigation */}
          <div className="flex gap-1 bg-muted/50 rounded-lg p-1 mt-4 mb-6">
            {SUB_TABS.map((tab, i) => (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors',
                  subTab === tab.id
                    ? 'bg-white text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold',
                  subTab === tab.id ? 'bg-primary text-primary-foreground' : 'bg-border text-muted-foreground'
                )}>
                  {i + 1}
                </span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sub-tab content */}
          {subTab === 'layout' && <SlideLayoutTab />}
          {subTab === 'rankings' && <RankingsTab />}
          {subTab === 'preview' && <PreviewPublishTab />}
        </>
      )}

      {/* Previous Weeks content */}
      {topTab === 'previous' && <PreviousWeeksTab />}
    </div>
  );
}
