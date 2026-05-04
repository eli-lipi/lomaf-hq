// =====================================================================
// AFL clubs — colors, names, and ordering
// =====================================================================
// Single source of truth for the 18 AFL clubs that LOMAF coaches draft
// from. Used by analytics views (concentration heatmap), the Byes page,
// and anywhere else we need to render a club name or color.
//
// Codes are the 3-letter AFL.com.au shorthand and match what's stored
// in the `player_rounds.club` column.
// =====================================================================

export interface AflClub {
  name: string;
  primary: string;
  text: string;
}

export const AFL_CLUBS: Record<string, AflClub> = {
  ADE: { name: 'Adelaide Crows',    primary: '#002B5C', text: '#E21937' },
  BRL: { name: 'Brisbane Lions',    primary: '#A30046', text: '#FFCD00' },
  CAR: { name: 'Carlton',           primary: '#031A29', text: '#FFFFFF' },
  COL: { name: 'Collingwood',       primary: '#000000', text: '#FFFFFF' },
  ESS: { name: 'Essendon',          primary: '#CC2031', text: '#000000' },
  FRE: { name: 'Fremantle',         primary: '#2A0D54', text: '#FFFFFF' },
  GEE: { name: 'Geelong Cats',      primary: '#002B5C', text: '#FFFFFF' },
  GCS: { name: 'Gold Coast Suns',   primary: '#D71920', text: '#F8C20A' },
  GWS: { name: 'GWS Giants',        primary: '#F47B20', text: '#000000' },
  HAW: { name: 'Hawthorn',          primary: '#4D2004', text: '#FFC423' },
  MEL: { name: 'Melbourne',         primary: '#0F1131', text: '#CC2031' },
  NTH: { name: 'North Melbourne',   primary: '#013B9F', text: '#FFFFFF' },
  PTA: { name: 'Port Adelaide',     primary: '#01B2A9', text: '#000000' },
  RIC: { name: 'Richmond',          primary: '#000000', text: '#FFD200' },
  STK: { name: 'St Kilda',          primary: '#000000', text: '#ED1B2F' },
  SYD: { name: 'Sydney Swans',      primary: '#ED171F', text: '#FFFFFF' },
  WCE: { name: 'West Coast Eagles', primary: '#003087', text: '#F2A900' },
  WBD: { name: 'Western Bulldogs',  primary: '#014896', text: '#CC2031' },
};

export const ALL_CLUB_CODES = Object.keys(AFL_CLUBS).sort((a, b) =>
  AFL_CLUBS[a].name.localeCompare(AFL_CLUBS[b].name)
);
