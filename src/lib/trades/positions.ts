import type { NormalizedPosition } from './types';

// Rarity ordering: RUC (1 slot) > FWD (4) > DEF (5) > MID (7)
// Per user spec: UTL is a lineup slot, not a position — no UTL here.
const RARITY_ORDER: NormalizedPosition[] = ['RUC', 'FWD', 'DEF', 'MID'];

export const SCARCITY_MULTIPLIER: Record<NormalizedPosition, number> = {
  RUC: 1.25,
  FWD: 1.10,
  DEF: 1.05,
  MID: 1.00,
};

/**
 * Resolves a raw position string (possibly a DPP like "MID/FWD") to a single
 * normalized position. For DPPs, picks the rarer position.
 *
 * Examples:
 *   "DEF"      -> "DEF"
 *   "MID/FWD"  -> "FWD"
 *   "DEF/MID"  -> "DEF"
 *   "RUC/FWD"  -> "RUC"
 *   "def"      -> "DEF"
 *   null/""    -> null
 */
export function normalizePosition(raw: string | null | undefined): NormalizedPosition | null {
  if (!raw) return null;
  const parts = raw
    .toUpperCase()
    .split(/[\/,\s]+/)
    .map((p) => p.trim())
    .filter((p): p is NormalizedPosition => (RARITY_ORDER as readonly string[]).includes(p));
  if (parts.length === 0) return null;

  // Pick the rarer one (lowest index in RARITY_ORDER)
  let best = parts[0];
  let bestIdx = RARITY_ORDER.indexOf(best);
  for (const p of parts) {
    const idx = RARITY_ORDER.indexOf(p);
    if (idx < bestIdx) {
      best = p;
      bestIdx = idx;
    }
  }
  return best;
}

export function getScarcityMultiplier(pos: NormalizedPosition | null): number {
  if (!pos) return 1.0;
  return SCARCITY_MULTIPLIER[pos];
}

/** Lineup slots that are NOT real positions (position-agnostic bench/utility). */
const SLOT_ONLY = new Set(['UTL', 'BN', 'BENCH', 'EMG']);

/**
 * Strips UTL/BN from a position string for display purposes.
 *
 * Examples:
 *   "DEF"      -> "DEF"
 *   "BN"       -> null
 *   "UTL"      -> null
 *   "MID/FWD"  -> "MID/FWD"
 *   null       -> null
 */
export function cleanPositionDisplay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  if (SLOT_ONLY.has(trimmed)) return null;
  return raw.trim(); // preserve original casing
}
