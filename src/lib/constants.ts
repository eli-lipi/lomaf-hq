import type { LeagueTeam } from './types';

export const LEAGUE_NAME = 'LOMAF';
export const LEAGUE_FULL_NAME = 'Land of Milk and Fantasy';
export const SEASON = 2026;

export const TEAMS: LeagueTeam[] = [
  { team_name: 'Mansion Mambas', team_id: 3194002, coach: 'Tim Freed', coach_photo_key: 'tim' },
  { team_name: 'South Tel Aviv Dragons', team_id: 3194005, coach: 'Jacob Wytwornik', coach_photo_key: 'jacob' },
  { team_name: 'I believe in SEANO', team_id: 3194009, coach: 'Shir Maran & Coby Felbel', coach_photo_key: ['shir', 'coby'], is_co_coached: true },
  { team_name: "Littl' bit LIPI", team_id: 3194003, coach: 'Lipi', coach_photo_key: 'lipi' },
  { team_name: 'Melech Mitchito', team_id: 3194006, coach: 'Gadi Herskovitz', coach_photo_key: 'gadi' },
  { team_name: "Cripps Don't Lie", team_id: 3194010, coach: 'Daniel Penso', coach_photo_key: 'daniel' },
  { team_name: 'Take Me Home Country Road', team_id: 3194008, coach: 'Alon Esterman', coach_photo_key: 'alon' },
  { team_name: 'Doge Bombers', team_id: 3194001, coach: 'Ronen Slonim', coach_photo_key: 'ronen' },
  { team_name: 'Gun M Down', team_id: 3194004, coach: 'Josh Sacks', coach_photo_key: 'josh' },
  { team_name: 'Warnered613', team_id: 3194007, coach: 'Lior Davis', coach_photo_key: 'lior' },
];

export const POSITION_GROUPS = ['DEF', 'MID', 'FWD', 'RUC', 'UTL'] as const;

export const ROSTER_SIZE = 25;
export const SCORING_POSITIONS = { DEF: 5, MID: 7, RUC: 1, FWD: 4, UTL: 1 };
export const TOTAL_SCORING = 18;

export function getTeamById(teamId: number): LeagueTeam | undefined {
  return TEAMS.find((t) => t.team_id === teamId);
}

export function getTeamByName(name: string): LeagueTeam | undefined {
  return TEAMS.find((t) => t.team_name.toLowerCase() === name.toLowerCase());
}
