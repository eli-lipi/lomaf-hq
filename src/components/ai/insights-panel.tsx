'use client';

import { useState, useEffect } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InsightsPanelProps {
  roundNumber: number;
  sectionKey: string;
  sectionName: string;
  sectionData: unknown;
}

export default function InsightsPanel({ roundNumber, sectionKey, sectionName, sectionData }: InsightsPanelProps) {
  const [insights, setInsights] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Try to load cached insights on mount
  useEffect(() => {
    async function loadCached() {
      try {
        const res = await fetch(`/api/ai/chart-insights?round=${roundNumber}&section=${sectionKey}`);
        const data = await res.json();
        if (data.insights) {
          setInsights(data.insights);
        }
      } catch { /* ignore */ }
    }
    if (roundNumber) loadCached();
  }, [roundNumber, sectionKey]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/chart-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundNumber, sectionKey, sectionName, sectionData }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate insights');
      }
      const data = await res.json();
      setInsights(data.insights);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  if (!insights && !loading && !error) {
    return (
      <div className="mt-4">
        <button
          onClick={generate}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors font-medium"
        >
          <Sparkles size={14} /> Generate Insights
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 bg-muted/30 border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Sparkles size={12} className="text-amber-500" />
          Insights
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className={cn(
            'flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors',
            loading && 'opacity-50 cursor-not-allowed'
          )}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Generating...' : 'Regenerate'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-500 mb-2">{error}</p>
      )}

      {insights && (
        <ul className="space-y-1.5">
          {insights.map((insight, i) => (
            <li key={i} className="text-sm text-foreground leading-relaxed flex gap-2">
              <span className="text-muted-foreground shrink-0">•</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      )}

      {loading && !insights && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Analyzing data...
        </div>
      )}
    </div>
  );
}
