/**
 * AFL Injury List — fetcher, parser, sync.
 *
 * Pulls the public injury list from afl.com.au/matches/injury-list and
 * caches it in `afl_injuries`. The page is server-rendered HTML with one
 * <table> per AFL club (PLAYER | INJURY | ESTIMATED RETURN), preceded by
 * a banner image whose URL contains the AFL club shortcode.
 *
 * Used by:
 *   - Trade Analysis prompt — gives the AI the official prognosis instead
 *     of guessing 'Likely injured' from DNP patterns.
 *   - Trade Justification prompt — same reasoning when the trade itself
 *     involves a flagged-injured player.
 *
 * Refresh cadence: synced inline by the round-advance ceremony, plus a
 * daily Vercel cron to catch the Tuesday-night AFL update.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any, any, any>;

const SOURCE_URL = 'https://www.afl.com.au/matches/injury-list';
// Mimic a real browser. The page itself is public + cacheable; we send
// one or two requests per day.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** AFL.com.au club shortcode → human-readable name. Confirmed against
 *  the live page (some clubs use `_FA_v2` banners). */
const CLUB_NAME_BY_CODE: Record<string, string> = {
  ADEL: 'Adelaide Crows',
  BRIS: 'Brisbane Lions',
  CARL: 'Carlton',
  COLL: 'Collingwood',
  ESS: 'Essendon',
  FREM: 'Fremantle',
  GCS: 'Gold Coast Suns',
  GEEL: 'Geelong Cats',
  GWS: 'GWS Giants',
  HAW: 'Hawthorn',
  MELB: 'Melbourne',
  NM: 'North Melbourne',
  PA: 'Port Adelaide',
  RICH: 'Richmond',
  STK: 'St Kilda',
  SYD: 'Sydney Swans',
  WB: 'Western Bulldogs',
  WCE: 'West Coast Eagles',
};

/**
 * Mapping from AFL.com.au shortcodes to AFL Fantasy club codes used in
 * `player_rounds.club`. AFL Fantasy generally uses 3 letters; AFL.com.au
 * uses 2-4. List multiple candidates per club so the matcher accepts any.
 */
const FANTASY_CLUB_BY_AFL_CODE: Record<string, string[]> = {
  ADEL: ['ADE', 'ADEL'],
  BRIS: ['BRL', 'BL', 'BRIS'],
  CARL: ['CAR', 'CARL'],
  COLL: ['COL', 'COLL'],
  ESS: ['ESS'],
  FREM: ['FRE', 'FREM'],
  GCS: ['GCS', 'GCFC'],
  GEEL: ['GEE', 'GEEL'],
  GWS: ['GWS'],
  HAW: ['HAW'],
  MELB: ['MEL', 'MELB'],
  NM: ['NTH', 'NM', 'KAN'],
  PA: ['PTA', 'PA', 'PORT'],
  RICH: ['RIC', 'RICH'],
  STK: ['STK'],
  SYD: ['SYD'],
  WB: ['WBD', 'WB'],
  WCE: ['WCE'],
};

export type InjuryReturnStatus =
  | 'weeks'
  | 'months'
  | 'specific_round'
  | 'concussion'
  | 'test'
  | 'managed'
  | 'indefinite'
  | 'season'
  | 'tbc'
  | 'unknown';

export interface ParsedInjury {
  player_name: string;
  club_code: string;
  club_name: string;
  injury: string;
  estimated_return: string;
  return_min_weeks: number | null;
  return_max_weeks: number | null;
  return_status: InjuryReturnStatus;
  source_updated_at: string | null; // YYYY-MM-DD
}

/**
 * Parse an "estimated return" string into a structured shape.
 * Stores everything in WEEKS for downstream consistency (months × ~4.3).
 *
 *   '1 week'              → {min:1, max:1, status:'weeks'}
 *   '2-3 weeks'           → {min:2, max:3, status:'weeks'}
 *   '12-14 weeks'         → {min:12, max:14, status:'weeks'}
 *   '3 months'            → {min:13, max:13, status:'months'}
 *   '6 months'            → {min:26, max:26, status:'months'}
 *   'Round 13'            → {min:null, max:null, status:'specific_round'}
 *   'Concussion protocols'→ {min:null, max:null, status:'concussion'}
 *   'Test'                → {min:null, max:null, status:'test'}
 *   'Managed'             → {min:null, max:null, status:'managed'}
 *   'Indefinite'          → {min:null, max:null, status:'indefinite'}
 *   'Season'              → {min:null, max:null, status:'season'}
 *   'TBC'                 → {min:null, max:null, status:'tbc'}
 */
export function parseEstimatedReturn(raw: string): {
  min: number | null;
  max: number | null;
  status: InjuryReturnStatus;
} {
  const text = raw.trim().toLowerCase();
  if (!text) return { min: null, max: null, status: 'unknown' };
  if (text.startsWith('test')) return { min: null, max: null, status: 'test' };
  if (text.startsWith('managed')) return { min: null, max: null, status: 'managed' };
  if (text.startsWith('indefinite')) return { min: null, max: null, status: 'indefinite' };
  if (text.includes('season')) return { min: null, max: null, status: 'season' };
  if (text.startsWith('tbc') || text.includes('to be confirmed')) {
    return { min: null, max: null, status: 'tbc' };
  }
  if (text.startsWith('concussion')) return { min: null, max: null, status: 'concussion' };
  if (text.startsWith('round')) return { min: null, max: null, status: 'specific_round' };

  // 'N month(s)' / 'N-M months' — convert to weeks (rounded down).
  const monthRange = text.match(/(\d+)\s*-\s*(\d+)\s*month/);
  if (monthRange) {
    return {
      min: Math.round(Number(monthRange[1]) * 4.3),
      max: Math.round(Number(monthRange[2]) * 4.3),
      status: 'months',
    };
  }
  const monthSingle = text.match(/(\d+)\s*month/);
  if (monthSingle) {
    const w = Math.round(Number(monthSingle[1]) * 4.3);
    return { min: w, max: w, status: 'months' };
  }

  // 'N-M weeks' or 'N week(s)'
  const range = text.match(/(\d+)\s*-\s*(\d+)\s*week/);
  if (range) return { min: Number(range[1]), max: Number(range[2]), status: 'weeks' };
  const single = text.match(/(\d+)\s*week/);
  if (single) {
    const n = Number(single[1]);
    return { min: n, max: n, status: 'weeks' };
  }
  return { min: null, max: null, status: 'unknown' };
}

/** Parse 'Updated: April 28, 2026' → '2026-04-28'. */
function parseUpdated(raw: string): string | null {
  // Strip HTML if present.
  const text = raw.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const m = text.match(/Updated:\s*([A-Za-z]+)\s+(\d+),\s+(\d{4})/);
  if (!m) return null;
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const month = months[m[1].toLowerCase()];
  if (month == null) return null;
  const d = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
  return d.toISOString().slice(0, 10);
}

/**
 * Parse the AFL.com.au injury-list HTML into a flat array of injuries.
 *
 * Strategy (the page is dead simple):
 *   1. Find every banner image whose src contains 'Editorial-GFX_Straps-Badge-Refresh_<CODE>_'.
 *   2. The next <table>...</table> below it is that club's injuries.
 *   3. Inside the table, the last row is 'Updated: <date>' (strip with colspan).
 *   4. Every other <tr> with 3 <td> cells is an injury row.
 */
export function parseInjuryListHtml(html: string): ParsedInjury[] {
  const result: ParsedInjury[] = [];

  // Find all club marker positions. Some clubs use `_FA_v2-1x`, others
  // `_FA-1x`. Each banner appears ~16 times (one per srcset variant);
  // we dedupe by keeping only the LAST index per club code, which is
  // the marker immediately preceding the club's injury <table>.
  const markerRe = /Editorial-GFX_Straps-Badge-Refresh_([A-Z]+)_FA(?:_v\d+)?-1x/g;
  const lastIndexByCode = new Map<string, number>();
  for (const m of html.matchAll(markerRe)) {
    lastIndexByCode.set(m[1], m.index ?? 0);
  }
  if (lastIndexByCode.size === 0) return result;
  const markers = Array.from(lastIndexByCode.entries())
    .map(([code, index]) => ({ code, index }))
    .sort((a, b) => a.index - b.index);

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? markers[i + 1].index : html.length;
    const region = html.slice(start, end);
    const code = markers[i].code;
    const clubName = CLUB_NAME_BY_CODE[code] || code;

    // First <table> in the region.
    const tableMatch = region.match(/<table[^>]*>([\s\S]*?)<\/table>/);
    if (!tableMatch) continue;
    const tableBody = tableMatch[1];

    // 'Updated: ...' lives inside a <td colspan="3">.
    let updatedAt: string | null = null;
    const updatedMatch = tableBody.match(/colspan="3"[^>]*>([\s\S]*?Updated:[\s\S]*?)<\/td>/);
    if (updatedMatch) updatedAt = parseUpdated(updatedMatch[1]);

    // Every other <tr> with three <td> cells is a player row.
    // Skip the colspan row by requiring exactly 3 distinct <td> blocks.
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    for (const rowMatch of tableBody.matchAll(rowRe)) {
      const row = rowMatch[1];
      if (/colspan=/i.test(row)) continue; // updated/footer row
      const cells: string[] = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      for (const cellMatch of row.matchAll(cellRe)) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
      }
      if (cells.length !== 3) continue;
      const [playerName, injury, estReturn] = cells;
      if (!playerName || /player/i.test(playerName)) continue; // header row

      const ret = parseEstimatedReturn(estReturn);
      result.push({
        player_name: playerName,
        club_code: code,
        club_name: clubName,
        injury,
        estimated_return: estReturn,
        return_min_weeks: ret.min,
        return_max_weeks: ret.max,
        return_status: ret.status,
        source_updated_at: updatedAt,
      });
    }
  }

  return result;
}

/** Fetch + parse the live page. */
export async function fetchAflInjuries(): Promise<ParsedInjury[]> {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    // Caching is fine — page rarely changes within an hour.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`AFL injury fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  return parseInjuryListHtml(html);
}

/** Strip diacritics, punctuation, lowercase — for fuzzy name compare. */
function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface PlayerLookupRow {
  player_id: number;
  player_name: string;
  club: string | null;
}

/**
 * Resolve AFL.com.au player_name + club_code to a LOMAF player_id.
 * Strategy:
 *   1. Exact normalised name + club-code-set match.
 *   2. Last-name + club-code-set match.
 *   3. Exact normalised name without club (fallback).
 *   4. null if none matched.
 */
function resolvePlayerId(
  playerName: string,
  clubCode: string,
  byName: Map<string, PlayerLookupRow[]>
): number | null {
  const norm = normaliseName(playerName);
  const fantasyCodes = FANTASY_CLUB_BY_AFL_CODE[clubCode] ?? [];

  const candidates = byName.get(norm) ?? [];
  // Exact name + matching club.
  for (const c of candidates) {
    if (c.club && fantasyCodes.includes(c.club)) return c.player_id;
  }

  // Last-name + matching club.
  const lastName = norm.split(' ').slice(-1)[0];
  if (lastName) {
    const lastNameCandidates: PlayerLookupRow[] = [];
    for (const [k, list] of byName.entries()) {
      if (k.split(' ').slice(-1)[0] === lastName) lastNameCandidates.push(...list);
    }
    for (const c of lastNameCandidates) {
      if (c.club && fantasyCodes.includes(c.club)) return c.player_id;
    }
    // If only one player league-wide has that last name, accept the match.
    const uniquePlayerIds = Array.from(new Set(lastNameCandidates.map((c) => c.player_id)));
    if (uniquePlayerIds.length === 1) return uniquePlayerIds[0];
  }

  // Exact name without club fallback (single match only).
  const uniqueByName = Array.from(new Set(candidates.map((c) => c.player_id)));
  if (uniqueByName.length === 1) return uniqueByName[0];

  return null;
}

export interface SyncResult {
  fetched: number;
  upserted: number;
  resolved: number;
  unresolved: number;
  source_freshest: string | null;
  source_oldest: string | null;
}

/**
 * Sync the live injury list into the afl_injuries table.
 * - Upserts each injury keyed on (player_name, club_code).
 * - Deletes any rows whose (player_name, club_code) no longer appears.
 * - Resolves player_id where possible by name+club join against
 *   player_rounds (latest round for each player).
 */
export async function syncAflInjuries(supabase: SB): Promise<SyncResult> {
  const injuries = await fetchAflInjuries();

  // Build player_id lookup from player_rounds. We use the most recent
  // (player_id, club) we have on file — handles trades / club changes.
  const { data: prRows } = await supabase
    .from('player_rounds')
    .select('player_id, player_name, club, round_number')
    .order('round_number', { ascending: false });
  const seen = new Set<number>();
  const byName = new Map<string, PlayerLookupRow[]>();
  for (const r of (prRows ?? []) as Array<{
    player_id: number;
    player_name: string;
    club: string | null;
    round_number: number;
  }>) {
    if (seen.has(r.player_id)) continue;
    seen.add(r.player_id);
    const key = normaliseName(r.player_name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push({ player_id: r.player_id, player_name: r.player_name, club: r.club });
  }

  const rowsToUpsert = injuries.map((inj) => {
    const playerId = resolvePlayerId(inj.player_name, inj.club_code, byName);
    return {
      player_name: inj.player_name,
      player_id: playerId,
      club_code: inj.club_code,
      club_name: inj.club_name,
      injury: inj.injury || null,
      estimated_return: inj.estimated_return || null,
      return_min_weeks: inj.return_min_weeks,
      return_max_weeks: inj.return_max_weeks,
      return_status: inj.return_status,
      source_updated_at: inj.source_updated_at,
      scraped_at: new Date().toISOString(),
    };
  });

  if (rowsToUpsert.length > 0) {
    const { error } = await supabase
      .from('afl_injuries')
      .upsert(rowsToUpsert, { onConflict: 'player_name,club_code' });
    if (error) throw error;
  }

  // Drop stale entries — anyone whose (name, club) is no longer on the
  // live list (player healed / dropped from list).
  const liveKey = new Set(rowsToUpsert.map((r) => `${r.player_name}::${r.club_code}`));
  const { data: existing } = await supabase
    .from('afl_injuries')
    .select('player_name, club_code');
  const stale: { player_name: string; club_code: string }[] = [];
  for (const e of (existing ?? []) as Array<{ player_name: string; club_code: string }>) {
    if (!liveKey.has(`${e.player_name}::${e.club_code}`)) stale.push(e);
  }
  for (const s of stale) {
    await supabase
      .from('afl_injuries')
      .delete()
      .eq('player_name', s.player_name)
      .eq('club_code', s.club_code);
  }

  const resolved = rowsToUpsert.filter((r) => r.player_id != null).length;
  const dates = rowsToUpsert
    .map((r) => r.source_updated_at)
    .filter((d): d is string => !!d)
    .sort();
  return {
    fetched: injuries.length,
    upserted: rowsToUpsert.length,
    resolved,
    unresolved: rowsToUpsert.length - resolved,
    source_freshest: dates.length ? dates[dates.length - 1] : null,
    source_oldest: dates.length ? dates[0] : null,
  };
}

/**
 * Format an injury row for inclusion in an AI prompt — short, human, and
 * unambiguous about what the source is so the model treats it as truth.
 */
export function formatInjuryForPrompt(inj: {
  injury: string | null;
  estimated_return: string | null;
  source_updated_at: string | null;
}): string {
  const parts: string[] = ['OFFICIAL INJURY'];
  if (inj.injury) parts.push(inj.injury);
  if (inj.estimated_return) parts.push(inj.estimated_return);
  let text = parts.join(', ');
  if (inj.source_updated_at) {
    const d = new Date(inj.source_updated_at + 'T00:00:00Z');
    const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    text += ` (as of ${month} ${d.getUTCDate()})`;
  }
  return text;
}
