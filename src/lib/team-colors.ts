// Consistent team colors + short display names used across the portal.
// Colors chosen to be maximally distinct from each other for use in charts
// and heatmaps where 10+ series need to be visually separable.

export const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#3B82F6', // Mansion Mambas - blue
  3194005: '#EF4444', // South Tel Aviv Dragons - red
  3194009: '#22C55E', // SEANO - green
  3194003: '#F59E0B', // LIPI - amber
  3194006: '#A855F7', // Melech Mitchito - purple
  3194010: '#06B6D4', // Cripps Don't Lie - cyan
  3194008: '#F97316', // TMHCR - orange
  3194001: '#F43F5E', // Doge Bombers - rose
  3194004: '#6366F1', // Gun M Down - indigo
  3194007: '#14B8A6', // Warnered613 - teal
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

export function getTeamColor(teamId: number): string {
  return TEAM_COLOR_MAP[teamId] || '#6B7280';
}

export function getTeamShortName(teamId: number, fallback = ''): string {
  return TEAM_SHORT_NAMES[teamId] || fallback;
}
