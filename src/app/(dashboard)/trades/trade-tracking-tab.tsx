'use client';

import { ArrowLeftRight } from 'lucide-react';

export default function TradeTrackingTab() {
  return (
    <div className="bg-white border border-border rounded-lg p-8">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
          <ArrowLeftRight size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Trade Tracking</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track trades as they happen and see who won each one.
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            Coming soon — manual entry form for trades, plus winner evaluation logic.
          </p>
        </div>
      </div>
    </div>
  );
}
