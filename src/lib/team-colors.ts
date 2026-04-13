// Consistent team colors used across all charts in the portal.
// Lifted from analytics/overview-tab.tsx for reuse.

export const TEAM_COLOR_MAP: Record<number, string> = {
  3194002: '#1A56DB', // Mansion Mambas - blue
  3194005: '#DC2626', // South Tel Aviv Dragons - red
  3194009: '#16A34A', // SEANO - green
  3194003: '#F59E0B', // LIPI - amber
  3194006: '#9333EA', // Melech Mitchito - purple
  3194010: '#0891B2', // Cripps Don't Lie - cyan
  3194008: '#EA580C', // TMHCR - orange
  3194001: '#DB2777', // Doge Bombers - pink
  3194004: '#4F46E5', // Gun M Down - indigo
  3194007: '#059669', // Warnered613 - emerald
};

export function getTeamColor(teamId: number): string {
  return TEAM_COLOR_MAP[teamId] || '#6B7280';
}
