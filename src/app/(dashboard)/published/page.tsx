'use client';

import { useState, useEffect } from 'react';
import { Archive, ChevronRight, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn, ordinal, movementLabel, movementColor } from '@/lib/utils';
import type { PwrnkgsRound, PwrnkgsRanking } from '@/lib/types';

export default function PublishedPage() {
  const [rounds, setRounds] = useState<PwrnkgsRound[]>([]);
  const [selectedRound, setSelectedRound] = useState<PwrnkgsRound | null>(null);
  const [rankings, setRankings] = useState<PwrnkgsRanking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('pwrnkgs_rounds')
        .select('*')
        .eq('status', 'published')
        .order('round_number', { ascending: false });

      if (data && data.length > 0) {
        setRounds(data as PwrnkgsRound[]);
        selectRound(data[0] as PwrnkgsRound);
      }
      setLoading(false);
    }
    load();
  }, []);

  const selectRound = async (round: PwrnkgsRound) => {
    setSelectedRound(round);
    const { data } = await supabase
      .from('pwrnkgs_rankings')
      .select('*')
      .eq('round_number', round.round_number)
      .order('ranking', { ascending: true });

    setRankings((data as PwrnkgsRanking[]) || []);
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  if (rounds.length === 0) {
    return (
      <div className="text-center py-12">
        <Archive size={48} className="mx-auto mb-4 text-muted-foreground/30" />
        <p className="text-muted-foreground">No published PWRNKGs yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Published PWRNKGs</h1>
      <p className="text-muted-foreground text-sm mb-6">Browse past power rankings</p>

      {/* Round selector */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {rounds.map((r) => (
          <button
            key={r.round_number}
            onClick={() => selectRound(r)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
              selectedRound?.round_number === r.round_number
                ? 'bg-primary text-primary-foreground'
                : 'bg-card border border-border text-muted-foreground hover:text-foreground'
            )}
          >
            R{r.round_number}
            {r.theme && <span className="ml-1 opacity-70">— {r.theme}</span>}
          </button>
        ))}
      </div>

      {selectedRound && (
        <div>
          {/* Round info */}
          <div className="bg-card border border-border rounded-lg p-5 mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xl font-bold">Round {selectedRound.round_number} PWRNKGs</span>
              {selectedRound.theme && (
                <span className="text-sm text-primary">&quot;{selectedRound.theme}&quot;</span>
              )}
            </div>
            {selectedRound.preview_text && (
              <p className="text-sm text-muted-foreground whitespace-pre-line mt-3 max-w-3xl">
                {selectedRound.preview_text}
              </p>
            )}
          </div>

          {/* Rankings */}
          <div className="space-y-3">
            {rankings.map((r) => {
              const movement = movementLabel(r.ranking, r.previous_ranking);
              const moveColor = movementColor(r.ranking, r.previous_ranking);

              return (
                <div key={r.team_id} className="bg-card border border-border rounded-lg p-4 flex gap-4">
                  <div className="w-12 shrink-0 flex items-start justify-center pt-1">
                    <span className="text-3xl font-bold text-primary">{r.ranking}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-semibold">{r.team_name}</span>
                      <span className={cn('text-sm font-medium', moveColor)}>{movement}</span>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">{r.writeup}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Week Ahead */}
          {selectedRound.week_ahead_text && (
            <div className="bg-card border border-border rounded-lg p-5 mt-6">
              <h3 className="text-sm font-semibold text-primary mb-2">Week Ahead</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {selectedRound.week_ahead_text}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
