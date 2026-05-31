'use client';

import { useEffect, useMemo, useState } from 'react';
import { TEAMS } from '@/lib/constants';
import {
  AFL_CLUB_BYES,
  BYE_ROUNDS,
  IMPACT_META,
  getByeRule,
  getImpactGrade,
  type ByeRound,
} from '@/lib/afl-club-byes';
import { LOMAF_BYE_FIXTURE } from '@/lib/lomaf-bye-fixture';
import type { CoachRoundImpact, UnavailablePlayer, ByeRoundRetro } from './types';

interface RosterRow {
  team_id: number;
  player_id: number;
  player_name: string;
  club: string;
}

/** Per-player injury status across the bye window. Set membership = predicted out. */
type InjuryByRound = Record<ByeRound, Set<number>>;

/** team_id → opp_id, per round. Sourced from the canonical static fixture. */
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
   * Per-round map from team_id → opp_id. Sourced from the canonical
   * LOMAF_BYE_FIXTURE table — DB matchups are not consulted for the bye
   * window because the fixture is finalized for the season.
   */
  opponentByRound: OpponentByRound;
  /**
   * Played bye rounds (R12–R16 already scored), each with per-coach
   * available/total/best-N stats. Empty until a bye round is uploaded.
   * Indexable by round via `retroByRound`.
   */
  byeRetro: ByeRoundRetro[];
  /** team_id → retrospective stats, per played bye round. */
  retroByRound: Partial<Record<ByeRound, Map<number, ByeRoundRetro['teams'][number]>>>;
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
  const [avgByPlayerId, setAvgByPlayerId] = useState<Map<number, number>>(new Map());
  const [byeRetro, setByeRetro] = useState<ByeRoundRetro[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // v13.2 — kick off both data sources in parallel from the
        // browser. Previously these were sequential paginated loops
        // run directly against Supabase from the browser (3-4 round
        // trips, each with public-internet latency). Now:
        //  - /api/byes/data: server-side parallel rosters + avgs
        //  - /api/afl-injuries/list: existing single-call endpoint
        const [byesRes, injRes] = await Promise.all([
          fetch('/api/byes/data', { cache: 'no-store' }).catch((e) => {
            console.warn('byes/data fetch failed', e);
            return null;
          }),
          fetch('/api/afl-injuries/list', { cache: 'no-store' }).catch((e) => {
            console.warn('afl-injuries/list fetch failed', e);
            return null;
          }),
        ]);

        // ── Rosters + avgs ─────────────────────────────────────────────
        if (byesRes && byesRes.ok) {
          const json = (await byesRes.json()) as {
            latestRound: number;
            rosters: RosterRow[];
            averages: Array<{ player_id: number; avg_pts: number }>;
            byeRetro?: ByeRoundRetro[];
          };
          if (!cancelled) {
            setLatestRound(json.latestRound ?? 0);
            setRosters(json.rosters ?? []);
            const map = new Map<number, number>();
            for (const r of json.averages ?? []) map.set(r.player_id, r.avg_pts);
            setAvgByPlayerId(map);
            setByeRetro(json.byeRetro ?? []);
          }
        }

        // ── Injuries ───────────────────────────────────────────────────
        // Each player has a `rounds[]` timeline with `predicted_injured`
        // per round; the bye page only cares about the BYE_ROUNDS slice.
        if (injRes && injRes.ok) {
          const json = (await injRes.json()) as {
            players: Array<{
              player_id: number | null;
              rounds: Array<{ round: number; predicted_injured: boolean }>;
            }>;
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
        let pointsLost = 0;
        for (const p of roster) {
          const isByed = byeClubs.has(p.club);
          const isInjured = injured.has(p.player_id);
          if (isByed || isInjured) {
            const avg = avgByPlayerId.get(p.player_id) ?? null;
            if (avg != null) pointsLost += avg;
            unavailable.push({
              player_id: p.player_id,
              player_name: p.player_name,
              club: p.club,
              byed: isByed,
              injured: isInjured,
              avg,
            });
          }
        }
        // Sort unavailable players by avg desc — stars surface first in
        // any expanded list across the tabs.
        unavailable.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
        const roundedPoints = Math.round(pointsLost);
        return {
          team,
          rosterSize: roster.length,
          unavailable,
          pointsLost: roundedPoints,
          // Combined grade — driven by whichever threshold (count or
          // points) lands you in the higher tier.
          grade: getImpactGrade(unavailable.length, roster.length, rule, roundedPoints),
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
  }, [rosters, rosterByTeam, injuriesByRound, avgByPlayerId]);

  // Build the per-round opponent map straight from the static fixture.
  // The bye-window fixture is finalized for the 2026 season (see
  // lomaf-bye-fixture.ts), so we deliberately ignore matchup_rounds here
  // — that table can drift via stale CSV uploads and we don't want it
  // to override the canonical schedule.
  const opponentByRound = useMemo<OpponentByRound>(() => {
    const out: OpponentByRound = {
      12: new Map(), 13: new Map(), 14: new Map(), 15: new Map(), 16: new Map(),
    };
    for (const round of BYE_ROUNDS) {
      for (const [a, b] of LOMAF_BYE_FIXTURE[round]) {
        out[round].set(a, b);
        out[round].set(b, a);
      }
    }
    return out;
  }, []);

  // Index the retrospective by round → team_id for O(1) lookup in cards.
  const retroByRound = useMemo<
    Partial<Record<ByeRound, Map<number, ByeRoundRetro['teams'][number]>>>
  >(() => {
    const out: Partial<Record<ByeRound, Map<number, ByeRoundRetro['teams'][number]>>> = {};
    for (const r of byeRetro) {
      const m = new Map<number, ByeRoundRetro['teams'][number]>();
      for (const t of r.teams) m.set(t.team_id, t);
      out[r.round as ByeRound] = m;
    }
    return out;
  }, [byeRetro]);

  return {
    loading,
    hasRosters: rosters.length > 0,
    latestRound,
    injuryFreshness,
    impactByRound,
    opponentByRound,
    byeRetro,
    retroByRound,
  };
}

function gradeOrdinal(grade: CoachRoundImpact['grade']): number {
  return IMPACT_META[grade].ordinal;
}
