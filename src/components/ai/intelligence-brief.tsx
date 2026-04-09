'use client';

import { useState, useEffect } from 'react';
import { Brain, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IntelligenceBriefData {
  storylines: string[];
  trade_implications: string[];
  ranking_suggestions: { ranking: number; team: string; justification: string }[];
  team_ammunition: Record<string, string[]>;
}

export default function IntelligenceBrief({ roundNumber }: { roundNumber: number }) {
  const [brief, setBrief] = useState<IntelligenceBriefData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // Load cached brief on mount
  useEffect(() => {
    async function loadCached() {
      try {
        const res = await fetch(`/api/ai/intelligence-brief?round=${roundNumber}`);
        const data = await res.json();
        if (data.data) setBrief(data.data);
      } catch { /* ignore */ }
    }
    if (roundNumber) loadCached();
  }, [roundNumber]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/intelligence-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundNumber }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate brief');
      }
      const data = await res.json();
      setBrief(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleTeam = (team: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  };

  if (!brief && !loading) {
    return (
      <div className="bg-card rounded-lg border border-border shadow-sm p-5">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">AI Intelligence Brief</label>
        </div>
        <div className="text-center py-6">
          <Brain size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            Generate an AI-powered analysis of this round&apos;s data — storylines, trade angles, ranking suggestions, and writeup ammunition.
          </p>
          <button
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Brain size={16} /> Generate Intelligence Brief
          </button>
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
      </div>
    );
  }

  if (loading && !brief) {
    return (
      <div className="bg-card rounded-lg border border-border shadow-sm p-5">
        <div className="flex items-center gap-3 justify-center py-8">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Generating intelligence brief... This takes ~15 seconds.</span>
        </div>
      </div>
    );
  }

  if (!brief) return null;

  return (
    <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-5">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">AI Intelligence Brief</label>
        <button
          onClick={generate}
          disabled={loading}
          className={cn(
            'flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors',
            loading && 'opacity-50'
          )}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Regenerating...' : 'Regenerate'}
        </button>
      </div>

      {/* Storylines */}
      <div>
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          🔥 Biggest Storylines
        </h4>
        <ol className="space-y-2">
          {brief.storylines.map((s, i) => (
            <li key={i} className="text-sm leading-relaxed flex gap-2">
              <span className="text-muted-foreground font-mono shrink-0 w-5 text-right">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Trade Implications */}
      {brief.trade_implications?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            💰 Trade Implications
          </h4>
          <ul className="space-y-1.5">
            {brief.trade_implications.map((t, i) => (
              <li key={i} className="text-sm leading-relaxed flex gap-2">
                <span className="text-muted-foreground shrink-0">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ranking Suggestions */}
      {brief.ranking_suggestions?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            📊 Suggested Rankings
          </h4>
          <div className="space-y-1">
            {brief.ranking_suggestions
              .sort((a, b) => a.ranking - b.ranking)
              .map((r, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="font-bold text-primary w-5 text-right shrink-0">{r.ranking}.</span>
                  <span className="font-medium shrink-0">{r.team}</span>
                  <span className="text-muted-foreground">— {r.justification}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Team Ammunition */}
      {brief.team_ammunition && Object.keys(brief.team_ammunition).length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            🎯 Writeup Ammunition
          </h4>
          <div className="space-y-1">
            {Object.entries(brief.team_ammunition).map(([team, bullets]) => (
              <div key={team} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleTeam(team)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
                >
                  {expandedTeams.has(team) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {team}
                </button>
                {expandedTeams.has(team) && (
                  <div className="px-3 pb-2 space-y-1">
                    {(bullets as string[]).map((b, i) => (
                      <p key={i} className="text-sm text-muted-foreground pl-5 flex gap-2">
                        <span className="shrink-0">•</span>
                        <span>{b}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
