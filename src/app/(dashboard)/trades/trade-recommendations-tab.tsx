'use client';

import { Sparkles } from 'lucide-react';

export default function TradeRecommendationsTab() {
  return (
    <div className="bg-white border border-border rounded-lg p-8">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
          <Sparkles size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Trade Recommendations</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-suggested trades for each team based on roster analysis.
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            Coming soon — recommendation engine using roster surplus/deficit across lines.
          </p>
        </div>
      </div>
    </div>
  );
}
