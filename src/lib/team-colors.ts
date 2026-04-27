// =====================================================================
// Team colour palette — v5
// =====================================================================
// Each LOMAF team has a permanent identity colour. The palette is spaced
// evenly around the colour wheel at uniform perceived lightness so any
// two teams visually contrast on a dark navy background.
//
// LOMAF portal green (#A3FF12) is reserved for global UI affordances —
// sidebar nav, primary CTAs, selection states. NEVER use it inside a
// trade context. Littl' bit LIPI's identity green (#7FD960) is softer
// and visually distinct.
// =====================================================================

export const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#FF6B6B', // Mansion Mambas — coral red
  3194005: '#FF9D52', // South Tel Aviv Dragons — burnt orange
  3194009: '#E6C547', // I believe in SEANO — mustard yellow
  3194003: '#7FD960', // Littl' bit LIPI — lime green (NOT portal green)
  3194006: '#4ECCA3', // Melech Mitchito — sage green
  3194010: '#3DC8E0', // Cripps Don't Lie — cyan
  3194008: '#5FA8FF', // Take Me Home Country Road — sky blue
  3194001: '#8B7CFF', // Doge Bombers — indigo
  3194004: '#C66FE0', // Gun M Down — violet
  3194007: '#FF6FB5', // Warnered613 — magenta pink
};

export const TEAM_SHORT_NAMES: Record<number, string> = {
  3194002: 'Mansion',
  3194005: 'Dragons',
  3194009: 'SEANO',
  3194003: 'LIPI',
  3194006: 'Melech',
  3194010: 'Cripps',
  3194008: 'Roads',
  3194001: 'Doge',
  3194004: 'Gun M',
  3194007: 'Warnered',
};

/** Default fallback when a team_id isn't in the palette (data error or future expansion). */
const FALLBACK_COLOR = '#6B7280';
/** Defensive fallbacks if two teams in a single trade share a colour (impossible by construction, but spec'd). */
export const FALLBACK_POSITIVE = '#FF8B3D'; // abstract orange
export const FALLBACK_NEGATIVE = '#3DA5FF'; // abstract blue

export function getTeamColor(teamId: number): string {
  return TEAM_COLOR_MAP[teamId] ?? FALLBACK_COLOR;
}

export function getTeamShortName(teamId: number, fallback = ''): string {
  return TEAM_SHORT_NAMES[teamId] ?? fallback;
}

/** Convert a team's hex colour into rgba with the given opacity (0..1). */
export function getTeamColorWithOpacity(teamId: number, opacity: number): string {
  return hexWithOpacity(getTeamColor(teamId), opacity);
}

/** Hex (#RRGGBB) → rgba(r, g, b, a). */
export function hexWithOpacity(hex: string, opacity: number): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return hex; // gracefully degrade on bad input
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Pick a readable text colour (white or dark navy) for text laid over the
 * given team's colour. Uses the YIQ luminance heuristic — fast and
 * indistinguishable from a proper APCA check at this resolution.
 */
export function getContrastingTextColor(teamId: number): string {
  const hex = getTeamColor(teamId).replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#0A0F1C' : '#FFFFFF';
}

// ──────────────────────────────────────────────────────────────────
// Coach-name lookup — v8 introduces coach-keyed probabilities so the
// price tag, verdict pill, and homepage cards all need fast first-name
// access.
// ──────────────────────────────────────────────────────────────────
const COACH_FIRST_NAME: Record<number, string> = {
  3194002: 'Tim',
  3194005: 'Jacob',
  3194009: 'Shir & Coby',
  3194003: 'Lipi',
  3194006: 'Gadi',
  3194010: 'Daniel',
  3194008: 'Alon',
  3194001: 'Ronen',
  3194004: 'Josh',
  3194007: 'Lior',
};
const COACH_FULL_NAME: Record<number, string> = {
  3194002: 'Tim Freed',
  3194005: 'Jacob Wytwornik',
  3194009: 'Shir & Coby',
  3194003: 'Lipi',
  3194006: 'Gadi Herskovitz',
  3194010: 'Daniel Penso',
  3194008: 'Alon Esterman',
  3194001: 'Ronen Slonim',
  3194004: 'Josh Sacks',
  3194007: 'Lior Davis',
};

export function getCoachByTeam(teamId: number, full = false): string {
  return full
    ? (COACH_FULL_NAME[teamId] ?? '')
    : (COACH_FIRST_NAME[teamId] ?? '');
}

/**
 * Per-trade two-colour pair. Returns the positive team's colour and the
 * negative team's colour, with a defensive fallback if both teams happen
 * to share a colour (data error / future expansion).
 */
export function getTradeColorPair(
  positiveTeamId: number | null | undefined,
  negativeTeamId: number | null | undefined
): { positive: string; negative: string } {
  const pos = positiveTeamId != null ? getTeamColor(positiveTeamId) : FALLBACK_POSITIVE;
  const neg = negativeTeamId != null ? getTeamColor(negativeTeamId) : FALLBACK_NEGATIVE;
  if (pos.toLowerCase() === neg.toLowerCase()) {
    if (typeof console !== 'undefined') {
      console.warn(
        `[team-colors] Two teams in the same trade resolved to the same hex (${pos}). Falling back to abstract orange/blue.`
      );
    }
    return { positive: FALLBACK_POSITIVE, negative: FALLBACK_NEGATIVE };
  }
  return { positive: pos, negative: neg };
}
