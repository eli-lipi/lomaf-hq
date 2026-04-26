/**
 * Trades — display & math helpers for the ±100 advantage scale.
 *
 * Single source of truth: snap once at the data layer, render snapped values
 * everywhere. The UI never re-snaps — it just trusts these helpers.
 */

/** Snap a percentage value to the nearest 5. Works for negative numbers too. */
export function snap5(pct: number): number {
  return Math.round(pct / 5) * 5;
}

// ──────────────────────────────────────────────────────────────────
// v5 — Per-team colour palette (10 permanent team identities)
// ──────────────────────────────────────────────────────────────────
// LOMAF portal green is reserved for global UI affordances. Inside any
// trade context, every team-anchored element pulls from the team-colors
// module — never abstract green/cyan.

import { getTeamColor as _getTeamColor, FALLBACK_POSITIVE, FALLBACK_NEGATIVE } from '@/lib/team-colors';

/** Backwards-compat exports — used by non-trade UI surfaces (homepage filter
 *  pills, etc.) that explicitly want the LOMAF portal palette, NOT a team. */
export const COLOR_POSITIVE = '#A3FF12';   // portal green — sidebar / global selection
export const COLOR_NEGATIVE = '#22D3EE';   // legacy cyan — kept for back-compat callers

/**
 * Pick the per-trade colour for a given team. v5 returns the team's permanent
 * identity colour from the team-colors module (NOT an abstract green/cyan).
 *
 * The `positiveTeamId` arg is kept for API compatibility with v3/v4 callers
 * but is now unused — colour is anchored to the team itself, not the role.
 */
export function colorForTeam(
  teamId: number,
  positiveTeamId: number | null | undefined
): string {
  void positiveTeamId; // accepted for back-compat; team identity is now stable
  return _getTeamColor(teamId);
}

/** Re-export so call sites can grab fallbacks without a second import. */
export { FALLBACK_POSITIVE, FALLBACK_NEGATIVE };

// ──────────────────────────────────────────────────────────────────
// Surname display + collision handling
// ──────────────────────────────────────────────────────────────────

/** Return the last token of a player name (typically the surname). */
export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : fullName;
}

/** Return the first character of the player's first name (or '' if single-name). */
export function firstInitialOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[0].charAt(0).toUpperCase() : '';
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Build a per-trade map of player_id → display label, applying first-initial
 * disambiguation when surnames are too similar (Humphries / Humphrey).
 */
export function buildDisplayLabels(
  players: { player_id: number; player_name: string }[]
): Map<number, string> {
  const surnames = players.map((p) => ({ pid: p.player_id, full: p.player_name, last: surnameOf(p.player_name) }));
  // Detect collisions — Levenshtein ≤ 2 between any two surnames
  let collide = false;
  for (let i = 0; i < surnames.length; i++) {
    for (let j = i + 1; j < surnames.length; j++) {
      const a = surnames[i].last.toLowerCase();
      const b = surnames[j].last.toLowerCase();
      if (a === b) { collide = true; break; }
      if (levenshtein(a, b) <= 2) { collide = true; break; }
    }
    if (collide) break;
  }
  const out = new Map<number, string>();
  if (!collide) {
    for (const s of surnames) out.set(s.pid, s.last);
    return out;
  }
  // Apply initials. If the first-initial+surname is still ambiguous, use full first name.
  const initialed = surnames.map((s) => ({
    ...s,
    label: `${firstInitialOf(s.full)}. ${s.last}`,
  }));
  // If two players share both initial and surname, fall back to full first name
  const seen = new Map<string, number>();
  for (const i of initialed) {
    seen.set(i.label.toLowerCase(), (seen.get(i.label.toLowerCase()) ?? 0) + 1);
  }
  for (const s of surnames) {
    const initialLabel = `${firstInitialOf(s.full)}. ${s.last}`;
    if ((seen.get(initialLabel.toLowerCase()) ?? 0) > 1) {
      const firstName = s.full.trim().split(/\s+/)[0];
      out.set(s.pid, `${firstName} ${s.last}`);
    } else {
      out.set(s.pid, initialLabel);
    }
  }
  return out;
}

/**
 * Convert a 0..100 probability for team A into the signed ±100 advantage
 * relative to a chosen "positive" team. 50 → 0; 75 → +50 if A is positive,
 * −50 if B is positive.
 */
export function toAdvantage(
  probA: number,
  positiveTeamId: number | null,
  teamAId: number,
  teamBId: number
): number {
  // Edge to A on a ±100 scale: 50 → 0, 100 → +100, 0 → −100.
  const aEdge = (probA - 50) * 2;
  if (positiveTeamId === teamBId) return -aEdge;
  // Default to A as positive when polarity isn't set.
  void teamAId;
  return aEdge;
}

/** Verdict thresholds for the v2 ±100 scale. */
export type VerdictLevel = 'flip' | 'slight' | 'edge' | 'big' | 'robbery';
export interface Verdict {
  level: VerdictLevel;
  text: string;
  isFlip: boolean;
}

export function verdictFor(advantage: number, positiveTeamName: string, negativeTeamName: string): Verdict {
  const abs = Math.abs(advantage);
  const winner = advantage >= 0 ? positiveTeamName : negativeTeamName;
  if (abs <= 10) return { level: 'flip', text: 'Coin flip', isFlip: true };
  if (abs <= 30) return { level: 'slight', text: `Slight edge — ${winner}`, isFlip: false };
  if (abs <= 55) return { level: 'edge', text: `Edge — ${winner}`, isFlip: false };
  if (abs <= 80) return { level: 'big', text: `Big edge — ${winner}`, isFlip: false };
  return { level: 'robbery', text: `Robbery — ${winner}`, isFlip: false };
}

/** Per-player verdict (resolution criteria) thresholds. */
export type PlayerVerdict =
  | 'crushing'
  | 'outperforming'
  | 'tracking'
  | 'slight-under'
  | 'broken'
  | 'avail-drag'
  | 'pending';

export interface PlayerVerdictResult {
  level: PlayerVerdict;
  text: string;
}

export function playerVerdictFor(
  avgSinceTrade: number | null,
  expectedAvg: number | null,
  expectedGames: number | null,
  actualGames: number
): PlayerVerdictResult {
  // Availability drag check first — it overrides perf when severe
  if (
    expectedGames != null &&
    expectedGames >= 1 &&
    actualGames / expectedGames < 0.5 &&
    actualGames < expectedGames
  ) {
    return {
      level: 'avail-drag',
      text: `Availability drag — missed ${Math.round(expectedGames - actualGames)} of ${Math.round(expectedGames)} expected games`,
    };
  }
  if (avgSinceTrade == null || expectedAvg == null) {
    return { level: 'pending', text: 'Pending — no post-trade data yet' };
  }
  const delta = avgSinceTrade - expectedAvg;
  if (delta > 10) return { level: 'crushing', text: 'Crushing the bet' };
  if (delta >= 5) return { level: 'outperforming', text: 'Outperforming' };
  if (delta >= -5) return { level: 'tracking', text: 'Tracking expectation' };
  if (delta >= -10) return { level: 'slight-under', text: 'Slight underperformance' };
  return { level: 'broken', text: 'Bet broken' };
}
