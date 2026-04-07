'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import UploadTab from './upload-tab';
import RankingsTab from './rankings-tab';
import GenerateTab from './generate-tab';

const TABS = [
  { id: 'upload', label: 'Upload Data' },
  { id: 'rankings', label: 'Rankings Editor' },
  { id: 'generate', label: 'Generate Images' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ThisWeekPage() {
  const [activeTab, setActiveTab] = useState<TabId>('upload');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">This Week</h1>
      <p className="text-muted-foreground text-sm mb-6">Create and publish this week&apos;s PWRNKGs</p>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
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
      {activeTab === 'upload' && <UploadTab />}
      {activeTab === 'rankings' && <RankingsTab />}
      {activeTab === 'generate' && <GenerateTab />}
    </div>
  );
}
