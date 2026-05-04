'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { TEAMS } from '@/lib/constants';
import { AFL_CLUBS } from '@/lib/afl-clubs';
import {
  AFL_CLUB_BYES,
  BYE_ROUNDS,
  getByeRule,
  getImpactGrade,
  type ByeRound,
} from '@/lib/afl-club-byes';
import { LOMAF_BYE_FIXTURE } from '@/lib/lomaf-bye-fixture';
import type { CoachRoundImpact, UnavailablePlayer } from './types';

interface RosterRow {
  team_id: number;
  player_id: number;
  player_name: string;
  club: string;
}

interface MatchupDbRow {
  round_number: number;
  team_id: number;
  opp_id: number | null;
}

/** Per-player injury status across the bye window. Set membership = predicted out. */
type InjuryByRound = Record<ByeRound, Set<number>>;

/** team_id → opp_id, per round. Built from matchup_rounds with a static fallback. */
type OpponentByRound = Record<ByeRound, Map<number, number>>;

/** Loaded data + computed impact maps for every bye round × LOMAF team. */
export interface ByeData {
  loading: boolean;
  hasRosters: boolean;
  /** Latest round_number found in player_rounds (so the UI can label "rosters as of R…"). */
  latestRound: number;
  /** ISO timestamp of the most recent AFL injury scrape, if available. */
  injuryFreshness: string | null;
  /**
   * Computed coach impact per bye round. `impactByRound[round]` is a CoachRoundImpact[]
   * sorted worst → best (ladder order). Always contains 10 entries (one per LOMAF team).
   */
  impactByRound: Record<ByeRound, CoachRoundImpact[]>;
  /**
   * Per-round map from team_id → opp_id. Sourced from matchup_rounds when
   * uploaded, otherwise from the static LOMAF_BYE_FIXTURE table.
   */
  opponentByRound: OpponentByRound;
}

const EMPTY_IMPACT: Record<ByeRound, CoachRoundImpact[]> = {
  12: [], 13: [], 14: [], 15: [], 16: [],
};

/**
 * Fetches current rosters from `player_rounds` (latest round) and AFL
 * injury predictions from `/api/afl-injuries/list`, then computes which
 * of each LOMAF coach's players are unavailable in each bye round.
 *
 * "Unavailable" = the player's AFL club byes that round, OR the AFL
 * injury feed predicts the player is out that round (or both — deduped
 * on player_id, so each player counts once).
 */
export function useByeData(): ByeData {
  const [rosters, setRosters] = useState<RosterRow[]>([]);
  const [injuriesByRound, setInjuriesByRound] = useState<InjuryByRound>({
    12: new Set(), 13: new Set(), 14: new Set(), 15: new Set(), 16: new Set(),
  });
  const [latestRound, setLatestRound] = useState(0);
  const [injuryFreshness, setInjuryFreshness] = useState<string | null>(null);
  const [matchups, setMatchups] = useState<MatchupDbRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // ── Rosters ────────────────────────────────────────────────────
        const { data: roundCheck } = await supabase
          .from('player_rounds')
          .select('round_number')
          .order('round_number', { ascending: false })
          .limit(1);
        const maxRound = roundCheck?.[0]?.round_number ?? 0;
        if (!cancelled) setLatestRound(maxRound);

        const allRows: RosterRow[] = [];
        if (maxRound > 0) {
          let offset = 0;
          while (true) {
            const { data: batch } = await supabase
              .from('player_rounds')
              .select('team_id, player_id, player_name, club')
              .eq('round_number', maxRound)
              .range(offset, offset + 999);
            if (!batch || batch.length === 0) break;
            for (const row of batch) {
              if (row.club && AFL_CLUBS[row.club]) {
                allRows.push({
                  team_id: row.team_id,
                  player_id: row.player_id,
                  player_name: row.player_name,
                  club: row.club,
                });
              }
            }
            if (batch.length < 1000) break;
            offset += 1000;
          }
        }
        if (!cancelled) setRosters(allRows);

        // ── Matchups (LOMAF fixture for the bye rounds) ────────────────
        try {
          const { data: rows } = await supabase
            .from('matchup_rounds')
            .select('round_number, team_id, opp_id')
            .in('round_number', BYE_ROUNDS as unknown as number[]);
          if (!cancelled && rows) {
            setMatchups(
              rows.filter((r) =>
                (BYE_ROUNDS as readonly number[]).includes(r.round_number),
              ) as MatchupDbRow[],
            );
          }
        } catch (err) {
          console.warn('Failed to load matchup_rounds for byes:', err);
        }

        // ── Injuries ───────────────────────────────────────────────────
        // Reuse the same endpoint the Injuries page uses. Each player has
        // a `rounds[]` timeline with `predicted_injured` per round.
        try {
          const res = await fetch('/api/afl-injuries/list', { cache: 'no-store' });
          if (res.ok) {
            const json = await res.json() as {
              players: Array<{ player_id: number | null; rounds: Array<{ round: number; predicted_injured: boolean }> }>;
              cache?: { afl_freshest?: string | null };
            };
            const next: InjuryByRound = {
              12: new Set(), 13: new Set(), 14: new Set(), 15: new Set(), 16: new Set(),
            };
            for (const p of json.players ?? []) {
              if (p.player_id == null) continue;
              for (const cell of p.rounds ?? []) {
                if (cell.predicted_injured && (BYE_ROUNDS as readonly number[]).includes(cell.round)) {
                  next[cell.round as ByeRound].add(p.player_id);
                }
              }
            }
            if (!cancelled) {
              setInjuriesByRound(next);
              setInjuryFreshness(json.cache?.afl_freshest ?? null);
            }
          }
        } catch (err) {
          // Injury feed is optional — without it, impact = byes only.
          console.warn('Failed to load AFL injury list for bye impact:', err);
        }
      } catch (err) {
        console.error('Failed to load bye data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const rosterByTeam = useMemo(() => {
    const m = new Map<number, RosterRow[]>();
    for (const row of rosters) {
      if (!m.has(row.team_id)) m.set(row.team_id, []);
      m.get(row.team_id)!.push(row);
    }
    return m;
  }, [rosters]);

  const impactByRound = useMemo<Record<ByeRound, CoachRoundImpact[]>>(() => {
    if (rosters.length === 0) return EMPTY_IMPACT;

    const out: Record<ByeRound, CoachRoundImpact[]> = {
      12: [], 13: [], 14: [], 15: [], 16: [],
    };

    for (const round of BYE_ROUNDS) {
      const byeClubs = new Set(AFL_CLUB_BYES[round]);
      const injured = injuriesByRound[round];
      const rule = getByeRule(round);

      const perTeam: CoachRoundImpact[] = TEAMS.map((team) => {
        const roster = rosterByTeam.get(team.team_id) ?? [];
        const unavailable: UnavailablePlayer[] = [];
        for (const p of roster) {
          const isByed = byeClubs.has(p.club);
          const isInjured = injured.has(p.player_id);
          if (isByed || isInjured) {
            unavailable.push({
              player_id: p.player_id,
              player_name: p.player_name,
              club: p.club,
              byed: isByed,
              injured: isInjured,
            });
          }
        }
        return {
          team,
          rosterSize: roster.length,
          unavailable,
          grade: getImpactGrade(unavailable.length, roster.length, rule),
        };
      });

      // Worst impact at the top. Tiebreak by raw count, then by team name
      // so the order is stable across renders.
      perTeam.sort((a, b) => {
        const ga = gradeOrdinal(a.grade);
        const gb = gradeOrdinal(b.grade);
        if (ga !== gb) return ga - gb;
        if (a.unavailable.length !== b.unavailable.length) return b.unavailable.length - a.unavailable.length;
        return a.team.team_name.localeCompare(b.team.team_name);
      });
      out[round] = perTeam;
    }

    return out;
  }, [rosters, rosterByTeam, injuriesByRound]);

  // Build the per-round opponent map. Prefer DB matchup_rounds when any
  // rows exist for that round; otherwise fall back to the static fixture.
  const opponentByRound = useMemo<OpponentByRound>(() => {
    const out: OpponentByRound = {
      12: new Map(), 13: new Map(), 14: new Map(), 15: new Map(), 16: new Map(),
    };
    const dbByRound: Record<ByeRound, MatchupDbRow[]> = {
      12: [], 13: [], 14: [], 15: [], 16: [],
    };
    for (const m of matchups) {
      if ((BYE_ROUNDS as readonly number[]).includes(m.round_number)) {
        dbByRound[m.round_number as ByeRound].push(m);
      }
    }
    for (const round of BYE_ROUNDS) {
      const dbRows = dbByRound[round];
      if (dbRows.length > 0) {
        for (const m of dbRows) {
          if (m.opp_id != null) out[round].set(m.team_id, m.opp_id);
        }
      } else {
        for (const [a, b] of LOMAF_BYE_FIXTURE[round]) {
          out[round].set(a, b);
          out[round].set(b, a);
        }
      }
    }
    return out;
  }, [matchups]);

  return {
    loading,
    hasRosters: rosters.length > 0,
    latestRound,
    injuryFreshness,
    impactByRound,
    opponentByRound,
  };
}

function gradeOrdinal(grade: CoachRoundImpact['grade']): number {
  switch (grade) {
    case 'cannot-field': return 0;
    case 'serious':      return 1;
    case 'medium':       return 2;
    case 'low':          return 3;
    case 'none':         return 4;
  }
}
