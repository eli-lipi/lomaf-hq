/**
 * Centralised position handling for LOMAF HQ.
 *
 * Background: prior to v14 every feature (Position Depth, Byes, Injuries,
 * Trades…) had its own ad-hoc logic for parsing AFL position strings and
 * resolving DPP players to a single canonical position. That dispersion
 * caused real bugs — Chad Warner missing his FWD eligibility, Jeremy
 * Howe defaulting to MID, etc. — because each feature handled missing
 * data slightly differently.
 *
 * This module is now the single source of truth. Every consumer should:
 *   1. Read the raw `position` string from the `players` table (which
 *      is refreshed weekly from the Keeper Players CSV).
 *   2. Apply `classifyPosition()` to get the canonical Position type.
 *   3. Apply `normalizePosition()` if they need a clean 'DEF/MID/FWD'
 *      display string.
 *
 * Don't write new position-parsing logic anywhere else. If you need a
 * variant (e.g. group by line for an analytics view), extend this
 * module so the rules stay co-located.
 */

export type Position = 'FWD' | 'DEF' | 'RUC' | 'MID';

/**
 * Hierarchy order — the position a DPP player resolves to. Higher in
 * the list wins. FWD > DEF > RUC > MID matches AFL Fantasy convention
 * (DPPs land in their scarcer slot for lineup purposes).
 */
export const POSITION_HIERARCHY: Position[] = ['FWD', 'DEF', 'RUC', 'MID'];

/**
 * Canonical DPP display order — used when joining multiple
 * eligibilities into a single string so we always write "MID/FWD",
 * never "FWD/MID".
 */
export const POSITION_DISPLAY_ORDER: Position[] = ['DEF', 'MID', 'RUC', 'FWD'];

export const POSITION_LABEL: Record<Position, string> = {
  FWD: 'Forward',
  DEF: 'Defender',
  RUC: 'Ruck',
  MID: 'Midfielder',
};

export const POSITION_LABEL_PLURAL: Record<Position, string> = {
  FWD: 'Forwards',
  DEF: 'Defenders',
  RUC: 'Rucks',
  MID: 'Midfielders',
};

/**
 * Accent colours used across all position-aware visualisations.
 * Defined here so a single tweak rolls through every chart.
 */
export const POSITION_COLOR: Record<Position, string> = {
  FWD: '#DC2626',
  DEF: '#1A56DB',
  RUC: '#7C3AED',
  MID: '#059669',
};

/**
 * Parse a raw position string (possibly a DPP like "MID/FWD", or a
 * variant like "Forward", "Back", "Ruck") into a Set of canonical
 * positions. Robust to whitespace, slashes, commas, and pipes.
 *
 * Examples:
 *   "MID/FWD"  → {MID, FWD}
 *   "Back/Mid" → {DEF, MID}
 *   "Ruck"     → {RUC}
 *   ""         → {} (empty set — caller decides the default)
 */
export function parsePositionSet(raw: string | null | undefined): Set<Position> {
  const found = new Set<Position>();
  if (!raw) return found;
  for (const part of raw.toUpperCase().split(/[\s/,|]+/)) {
    const t = part.trim();
    if (!t) continue;
    if (t.startsWith('FWD') || t.startsWith('FOR')) found.add('FWD');
    else if (t.startsWith('DEF') || t.startsWith('BAC')) found.add('DEF');
    else if (t.startsWith('RUC') || t.startsWith('RUK')) found.add('RUC');
    else if (t.startsWith('MID')) found.add('MID');
  }
  return found;
}

/**
 * Apply the LOMAF positional hierarchy to a raw eligibility string,
 * resolving DPPs to a single canonical position. Defaults to MID when
 * the input contains no recognised position — this matches the
 * fallback the Position Depth view used before centralisation and
 * keeps behaviour stable for unmatched players.
 */
export function classifyPosition(raw: string | null | undefined): Position {
  const set = parsePositionSet(raw);
  for (const p of POSITION_HIERARCHY) {
    if (set.has(p)) return p;
  }
  return 'MID';
}

/**
 * Normalise an eligibility string into the canonical 'DEF/MID/FWD'
 * order. Returns null when no recognised position is found, so callers
 * can distinguish "no data" from "MID only".
 *
 *   "MID/FWD"   → "MID/FWD"
 *   "fwd, mid"  → "MID/FWD"
 *   "Back"      → "DEF"
 *   "" / null   → null
 */
export function normalizePosition(raw: string | null | undefined): string | null {
  const set = parsePositionSet(raw);
  if (set.size === 0) return null;
  return POSITION_DISPLAY_ORDER.filter((p) => set.has(p)).join('/');
}

/**
 * True when the parsed eligibility lists more than one position — i.e.
 * the player is a DPP. Useful for showing a "MID/FWD" tag in lists.
 */
export function isDppPosition(raw: string | null | undefined): boolean {
  return parsePositionSet(raw).size > 1;
}
