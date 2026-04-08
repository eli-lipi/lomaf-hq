'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { formatScore, ordinal } from '@/lib/utils';
import type { TeamSnapshot } from '@/lib/types';
import { fetchResolvedScores } from '@/lib/scores';
import { cn } from '@/lib/utils';

const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', 3194005: '#DC2626', 3194009: '#16A34A', 3194003: '#F59E0B',
  3194006: '#9333EA', 3194010: '#0891B2', 3194008: '#EA580C', 3194001: '#DB2777',
  3194004: '#4F46E5', 3194007: '#059669',
};

interface LuckRow {
  team_name: string; team_id: number;
  wins: number; losses: number; ties: number;
  expectedWins: number; luckScore: number;
  perRound: { round: number; luck: number }[];
}

interface FormRow {
  team_name: string; team_id: number;
  perRound: { round: number; pts: number }[];
  formPts: number; formRank: number; actualRank: number; delta: number;
}

export default function LuckFormTab() {
  const [luckData, setLuckData] = useState<LuckRow[]>([]);
  const [formData, setFormData] = useState<FormRow[]>([]);
  const [luckRounds, setLuckRounds] = useState<number[]>([]);
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [noResultData, setNoResultData] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const { teamRoundScores, validRounds } = await fetchResolvedScores();

      const { data: snapshots } = await supabase
        .from('team_snapshots')
        .select('*')
        .order('round_number', { ascending: true });

      if (!snapshots || snapshots.length === 0 || validRounds.length === 0) {
        setLoading(false);
        return;
      }

      // Build snapshot lookup
      const snapshotsByRound: Record<number, Record<number, TeamSnapshot>> = {};
      snapshots.forEach((s: TeamSnapshot) => {
        if (!snapshotsByRound[s.round_number]) snapshotsByRound[s.round_number] = {};
        snapshotsByRound[s.round_number][s.team_id] = s;
      });
      const snapshotRounds = [...new Set(snapshots.map((s: TeamSnapshot) => s.round_number))].sort((a, b) => a - b);

      // === Per-round W/L from matchup_rounds (for per-round breakdown) ===
      const perRoundResult: Record<string, number> = {};
      const { data: matchups } = await supabase
        .from('matchup_rounds')
        .select('round_number, team_id, win, loss, tie');
      if (matchups && matchups.length > 0) {
        matchups.forEach((m: { round_number: number; team_id: number; win: boolean; loss: boolean; tie: boolean }) => {
          perRoundResult[`${m.round_number}-${m.team_id}`] = m.win ? 1 : m.tie ? 0.5 : 0;
        });
      }
      const hasMatchupData = validRounds.some(round =>
        TEAMS.every(t => perRoundResult[`${round}-${t.team_id}`] !== undefined)
      );
      const roundsWithMatchups = validRounds.filter(round =>
        TEAMS.every(t => perRoundResult[`${round}-${t.team_id}`] !== undefined)
      );

      setLuckRounds(validRounds);

      // === Compute Luck-O-Meter ===
      // Expected wins: per round, count teams outscored → expected win rate
      // Actual wins: from cumulative W/L in latest snapshot
      // Luck = actual wins - expected wins (zero-sum across all teams)

      const maxSnapRound = Math.max(...snapshotRounds);

      const luckRows: LuckRow[] = TEAMS.map(team => {
        // Compute expected wins from per-round score rankings
        let totalExpected = 0;
        const perRoundLuck: { round: number; luck: number }[] = [];

        validRounds.forEach(round => {
          const myScore = teamRoundScores[`${round}-${team.team_id}`] || 0;

          // Count how many of the other 9 teams this team outscored
          let teamsOutscored = 0;
          TEAMS.forEach(other => {
            if (other.team_id === team.team_id) return;
            const otherScore = teamRoundScores[`${round}-${other.team_id}`] || 0;
            if (myScore > otherScore) teamsOutscored += 1;
            else if (myScore === otherScore) teamsOutscored += 0.5;
          });

          const expectedWinRate = teamsOutscored / 9;
          totalExpected += expectedWinRate;

          // Per-round luck (only if matchup data available for this round)
          if (perRoundResult[`${round}-${team.team_id}`] !== undefined) {
            const actualResult = perRoundResult[`${round}-${team.team_id}`];
            const roundLuck = actualResult - expectedWinRate;
            perRoundLuck.push({ round, luck: Math.round(roundLuck * 100) / 100 });
          }
        });

        // Actual wins from cumulative snapshot: wins count as 1, ties as 0.5
        const snap = snapshotsByRound[maxSnapRound]?.[team.team_id];
        const wins = snap?.wins || 0;
        const losses = snap?.losses || 0;
        const ties = snap?.ties || 0;
        const actualWins = wins + 0.5 * ties;

        // LUCK = ACTUAL WINS minus EXPECTED WINS
        const luckScore = Math.round((actualWins - totalExpected) * 100) / 100;

        return {
          team_name: team.team_name, team_id: team.team_id,
          wins, losses, ties,
          expectedWins: Math.round(totalExpected * 10) / 10,
          luckScore,
          perRound: perRoundLuck,
        };
      });

      // SANITY CHECK: sum of all luck scores must be ~0 (zero-sum)
      const totalLuckSum = luckRows.reduce((sum, r) => sum + r.luckScore, 0);
      if (Math.abs(totalLuckSum) > 0.2) {
        console.warn(`Luck-O-Meter: total luck = ${totalLuckSum.toFixed(2)} (expected ~0). May be off if validRounds doesn't cover all played rounds.`);
      }

      // Sort: luckiest first (descending)
      luckRows.sort((a, b) => b.luckScore - a.luckScore);
      setLuckData(luckRows);
      setNoResultData(!hasMatchupData);

      // === Form Ladder ===
      computeFormLadder(validRounds, teamRoundScores, snapshotsByRound, snapshotRounds);
    } catch (err) {
      console.error('Failed to load luck/form data:', err);
    } finally {
      setLoading(false);
    }
  };

  const computeFormLadder = (
    validRounds: number[],
    teamRoundScores: Record<string, number>,
    snapshotsByRound: Record<number, Record<number, TeamSnapshot>>,
    snapshotRounds: number[],
  ) => {
    const formRows: FormRow[] = TEAMS.map(team => ({
      team_name: team.team_name, team_id: team.team_id,
      perRound: [] as { round: number; pts: number }[],
      formPts: 0, formRank: 0, actualRank: 0, delta: 0,
    }));

    validRounds.forEach(round => {
      const roundScores = TEAMS.map(t => ({
        team_id: t.team_id,
        score: teamRoundScores[`${round}-${t.team_id}`] || 0,
      })).sort((a, b) => b.score - a.score);

      // Assign points handling ties (average method)
      let i = 0;
      while (i < roundScores.length) {
        let j = i;
        while (j < roundScores.length && roundScores[j].score === roundScores[i].score) j++;
        const avgPts = (i + j - 1) / 2;
        const ptsPerTied = 10 - avgPts;
        for (let k = i; k < j; k++) {
          const fr = formRows.find(f => f.team_id === roundScores[k].team_id);
          if (fr) {
            const pts = Math.round(ptsPerTied * 10) / 10;
            fr.perRound.push({ round, pts });
            fr.formPts += pts;
          }
        }
        i = j;
      }
    });

    formRows.forEach(f => { f.formPts = Math.round(f.formPts * 10) / 10; });
    formRows.sort((a, b) => b.formPts - a.formPts);
    formRows.forEach((f, idx) => { f.formRank = idx + 1; });

    // Get actual ranks from snapshots
    if (snapshotRounds.length > 0) {
      const maxSnapRound = Math.max(...snapshotRounds);
      formRows.forEach(f => {
        const snap = snapshotsByRound[maxSnapRound]?.[f.team_id];
        f.actualRank = snap?.league_rank || 0;
        f.delta = f.actualRank - f.formRank;
      });
    }
    setFormData(formRows);
  };

  const generateInsights = (luck: LuckRow[], form: FormRow[]) => {
    const ins: string[] = [];

    if (luck.length > 0) {
      const luckiest = luck[0];
      const unluckiest = luck[luck.length - 1];
      if (unluckiest.luckScore <= -0.5) {
        ins.push(`${unluckiest.team_name} is ${unluckiest.wins}-${unluckiest.losses}${unluckiest.ties ? `-${unluckiest.ties}` : ''} but would have won ${unluckiest.expectedWins} games against a random schedule — luck score: ${unluckiest.luckScore.toFixed(2)}.`);
      }
      if (luckiest.luckScore >= 0.5) {
        ins.push(`${luckiest.team_name}'s ${luckiest.wins}-${luckiest.losses}${luckiest.ties ? `-${luckiest.ties}` : ''} record flatters them — expected wins: ${luckiest.expectedWins}. Luck score: +${luckiest.luckScore.toFixed(2)}.`);
      }
    }

    if (form.length > 0) {
      const mostUndervalued = [...form].sort((a, b) => b.delta - a.delta)[0];
      const mostOvervalued = [...form].sort((a, b) => a.delta - b.delta)[0];
      if (mostUndervalued.delta >= 2) {
        ins.push(`${mostUndervalued.team_name} would be ${ordinal(mostUndervalued.formRank)} on the form ladder but sit ${ordinal(mostUndervalued.actualRank)} on the actual ladder — the most undervalued by W/L record.`);
      }
      if (mostOvervalued.delta <= -2) {
        ins.push(`${mostOvervalued.team_name} sit ${ordinal(mostOvervalued.actualRank)} but would be ${ordinal(mostOvervalued.formRank)} on form — their record has been kind to them.`);
      }
      const formFirst = form[0];
      if (formFirst) {
        ins.push(`${formFirst.team_name} top the form ladder with ${formFirst.formPts} points — they've been the most consistent scorer regardless of matchup.`);
      }
    }

    setInsights(ins.slice(0, 6));
  };

  // Re-generate insights when both luckData and formData are ready
  useEffect(() => {
    if (luckData.length > 0 || formData.length > 0) {
      generateInsights(luckData, formData);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [luckData, formData]);

  if (loading) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Loading luck & form data...</p></div>;

  if (luckData.length === 0 && formData.length === 0) {
    return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Upload round data to see luck and form analysis.</p></div>;
  }

  return (
    <div className="space-y-6">
      {/* Luck-O-Meter */}
      {luckData.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Luck-O-Meter</h3>
            <p className="text-xs text-muted-foreground mt-1">Compares actual W/L record to expected wins based on weekly score ranking. Positive = lucky, Negative = unlucky. Zero-sum: total luck across all teams = 0.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2.5 font-medium text-muted-foreground w-10">#</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Team</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">W</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">L</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">T</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Expected W</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Luck Score</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {luckData.map((team, i) => {
                  const verdict = team.luckScore <= -1.5 ? 'Cursed \u{1F480}'
                    : team.luckScore <= -0.5 ? 'Unlucky'
                    : team.luckScore >= 1.5 ? 'Blessed \u{1F340}'
                    : team.luckScore >= 0.5 ? 'Lucky'
                    : 'Fair';
                  return (
                    <tr key={team.team_id} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TEAM_COLOR_MAP[team.team_id] }} />
                          <span className="font-medium">{team.team_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold text-green-600">{team.wins}</td>
                      <td className="px-3 py-2.5 text-center font-semibold text-red-600">{team.losses}</td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground">{team.ties}</td>
                      <td className="px-3 py-2.5 text-right">{team.expectedWins.toFixed(1)}</td>
                      <td className={cn('px-3 py-2.5 text-right font-bold',
                        team.luckScore > 0.3 ? 'text-green-600' : team.luckScore < -0.3 ? 'text-red-600' : 'text-muted-foreground'
                      )}>
                        {team.luckScore > 0 ? '+' : ''}{team.luckScore.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs font-medium">{verdict}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Per-Round Luck Heatmap (requires matchup data) */}
          {!noResultData && luckData[0]?.perRound.length > 0 && (
            <div className="border-t border-border p-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Per-Round Luck Breakdown</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Team</th>
                      {luckRounds.map(r => (
                        <th key={r} className="px-2 py-1.5 text-center font-medium text-muted-foreground min-w-[52px]">R{r}</th>
                      ))}
                      <th className="px-2 py-1.5 text-center font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {luckData.map((team, i) => (
                      <tr key={team.team_id} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                        <td className="px-2 py-1.5 font-medium">{team.team_name}</td>
                        {team.perRound.map(pr => {
                          const bg = pr.luck > 0.3 ? 'bg-green-100 text-green-700'
                            : pr.luck < -0.3 ? 'bg-red-100 text-red-700'
                            : 'text-muted-foreground';
                          return (
                            <td key={pr.round} className={cn('px-2 py-1.5 text-center font-mono', bg)}>
                              {pr.luck > 0 ? '+' : ''}{pr.luck.toFixed(2)}
                            </td>
                          );
                        })}
                        <td className={cn('px-2 py-1.5 text-center font-bold',
                          team.luckScore > 0.3 ? 'text-green-600' : team.luckScore < -0.3 ? 'text-red-600' : 'text-muted-foreground'
                        )}>
                          {team.luckScore > 0 ? '+' : ''}{team.luckScore.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Note when per-round breakdown unavailable */}
          {noResultData && (
            <div className="border-t border-border p-3">
              <p className="text-xs text-muted-foreground">Upload the matchups CSV to see per-round luck breakdown.</p>
            </div>
          )}
        </div>
      )}

      {/* Form Ladder */}
      {formData.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Form Ladder — Score-Based Rankings</h3>
            <p className="text-xs text-muted-foreground mt-1">Points awarded by weekly score rank (1st = 10pts, 10th = 1pt). Removes schedule luck.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2.5 font-medium text-muted-foreground w-10">Form #</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Team</th>
                  {(formData[0]?.perRound || []).map(pr => (
                    <th key={pr.round} className="px-2 py-2.5 font-medium text-muted-foreground text-center min-w-[44px]">R{pr.round}</th>
                  ))}
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Form Pts</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">Actual #</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">{'\u0394'}</th>
                </tr>
              </thead>
              <tbody>
                {formData.map((team, i) => (
                  <tr key={team.team_id} className={i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}>
                    <td className="px-3 py-2.5">
                      <span className={cn('inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold border',
                        team.formRank <= 3 ? 'bg-green-100 text-green-700 border-green-200'
                        : team.formRank >= 8 ? 'bg-red-100 text-red-700 border-red-200'
                        : 'bg-gray-100 text-gray-600 border-gray-200'
                      )}>
                        {team.formRank}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: TEAM_COLOR_MAP[team.team_id] }} />
                        <span className="font-medium">{team.team_name}</span>
                      </div>
                    </td>
                    {team.perRound.map(pr => {
                      const pts = pr.pts;
                      const cellColor = pts >= 8 ? 'bg-green-50 text-green-700 font-semibold'
                        : pts <= 3 ? 'bg-red-50 text-red-700'
                        : 'text-muted-foreground';
                      return (
                        <td key={pr.round} className={cn('px-2 py-2.5 text-center text-xs', cellColor)}>
                          {Number.isInteger(pts) ? pts : pts.toFixed(1)}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-right font-bold">{Number.isInteger(team.formPts) ? team.formPts : team.formPts.toFixed(1)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-bold">
                        {team.actualRank}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {team.delta > 0 ? (
                        <span className="text-xs font-semibold text-green-600">{'\u2191'}{team.delta}</span>
                      ) : team.delta < 0 ? (
                        <span className="text-xs font-semibold text-red-600">{'\u2193'}{Math.abs(team.delta)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-sm p-5">
          <h3 className="font-semibold mb-3">Luck & Form Insights</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((insight, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-lg bg-muted/30">
                <span className="text-primary font-bold text-sm mt-0.5 shrink-0">{i + 1}.</span>
                <p className="text-sm text-foreground leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
