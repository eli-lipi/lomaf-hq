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

  // 'N-M weeks' or 'N week(s)' — also accept 'match'/'matches' and
  // 'game'/'games' (AFL uses these for suspensions; one match == one
  // week for our purposes since LOMAF rounds map 1:1 with AFL rounds).
  const range = text.match(/(\d+)\s*-\s*(\d+)\s*(?:week|match|game)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]), status: 'weeks' };
  const single = text.match(/(\d+)\s*(?:week|match|game)/);
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
 *   1. Find every banner image whose src identifies a club. Two patterns:
 *      - Standard: 'Editorial-GFX_Straps-Badge-Refresh_<CODE>_FA*-1x'
 *      - Indigenous banners (introduced 2026 for cultural rounds): the file
 *        stem is the club's Indigenous name (e.g. kuwarna_2026.jpg for ADEL).
 *        Six clubs use these and have no standard banner on the page at all,
 *        so they must be matched explicitly or their tables are silently
 *        dropped from the result.
 *   2. The next <table>...</table> below the marker is that club's injuries.
 *   3. Inside the table, the last row is 'Updated: <date>' (strip with colspan).
 *   4. Every other <tr> with 3 <td> cells is an injury row.
 */
// AFL.com.au has been rotating in Indigenous-language banner images for
// certain clubs (e.g. for Sir Doug Nicholls Round). When a club gets one,
// its standard 'Editorial-GFX_Straps-Badge-Refresh_<CODE>_FA*-1x' banner
// disappears from the page — so the parser needs to also recognise these.
// Keys are the lowercase file stem as it appears in the photo-resources URL.
const INDIGENOUS_BANNER_STEM_TO_CODE: Record<string, string> = {
  'kuwarna': 'ADEL',
  'walyalup': 'FREM',
  'narrm': 'MELB',
  'yartapuulti': 'PA',
  'euro-yroke': 'STK',
  'waalitj-marawar': 'WCE',
};

export function parseInjuryListHtml(html: string): ParsedInjury[] {
  const result: ParsedInjury[] = [];

  // Find all club marker positions. Some clubs use `_FA_v2-1x`, others
  // `_FA-1x`. Each banner appears ~16 times (one per srcset variant);
  // we dedupe by keeping only the LAST index per club code, which is
  // the marker immediately preceding the club's injury <table>.
  const lastIndexByCode = new Map<string, number>();

  const standardRe = /Editorial-GFX_Straps-Badge-Refresh_([A-Z]+)_FA(?:_v\d+)?-1x/g;
  for (const m of html.matchAll(standardRe)) {
    lastIndexByCode.set(m[1], m.index ?? 0);
  }

  // Indigenous-named banners. Pattern: '<stem>_<year>.jpg' inside the
  // photo-resources URL. Track the LAST occurrence per stem just like
  // the standard banners.
  for (const [stem, code] of Object.entries(INDIGENOUS_BANNER_STEM_TO_CODE)) {
    const re = new RegExp(`/${stem}_\\d{4}\\.jpg`, 'g');
    let lastIdx: number | null = null;
    for (const m of html.matchAll(re)) {
      lastIdx = m.index ?? 0;
    }
    if (lastIdx !== null) lastIndexByCode.set(code, lastIdx);
  }

  if (lastIndexByCode.size === 0) return result;

  // Sanity check: the AFL has 18 clubs. If we detect fewer, AFL has likely
  // swapped in a new banner pattern (Indigenous-language or otherwise) for
  // the missing club(s). Log which ones are missing so the gap is visible
  // in Vercel logs without needing the slide bug to resurface first.
  if (lastIndexByCode.size < 18) {
    const all = Object.keys(CLUB_NAME_BY_CODE);
    const missing = all.filter(c => !lastIndexByCode.has(c));
    console.warn(`[afl-injuries] Detected only ${lastIndexByCode.size}/18 club section markers. Missing: ${missing.join(', ')}. AFL may have introduced a new banner pattern.`);
  }

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
 *
 * v12.3.3 — STRICT club-matching. The earlier 'unique last name in
 * LOMAF' fallback was matching e.g. Josh Kelly (GWS, injured) to
 * Tim Kelly's player_id (WCE) because Kelly was unique in LOMAF.
 * Same with Avery Thomas vs Harvey Thomas. AFL club is now required
 * for any match. Two players with the same last name on the same
 * AFL club is a documented edge case the user is happy to live with.
 */
function resolvePlayerId(
  playerName: string,
  clubCode: string,
  byName: Map<string, PlayerLookupRow[]>
): number | null {
  const norm = normaliseName(playerName);
  const fantasyCodes = FANTASY_CLUB_BY_AFL_CODE[clubCode] ?? [];
  if (fantasyCodes.length === 0) return null;

  const candidates = byName.get(norm) ?? [];
  // Exact name + matching club.
  for (const c of candidates) {
    if (c.club && fantasyCodes.includes(c.club)) return c.player_id;
  }

  // Last-name + matching club. If two players on the same AFL club share
  // a last name, first hit wins — acceptable error per user.
  const lastName = norm.split(' ').slice(-1)[0];
  if (lastName) {
    for (const [k, list] of byName.entries()) {
      if (k.split(' ').slice(-1)[0] !== lastName) continue;
      for (const c of list) {
        if (c.club && fantasyCodes.includes(c.club)) return c.player_id;
      }
    }
  }

  // No club-matching candidate — refuse to guess across clubs.
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

    // v12.3.1 — append a snapshot per (player, club, source_updated_at)
    // for trend tracking. Uniqueness on the conflict target means
    // re-running a sync without an AFL update is a no-op.
    const snapshotRows = rowsToUpsert
      .filter((r) => r.source_updated_at != null)
      .map((r) => ({
        player_name: r.player_name,
        player_id: r.player_id,
        club_code: r.club_code,
        injury: r.injury,
        estimated_return: r.estimated_return,
        return_min_weeks: r.return_min_weeks,
        return_max_weeks: r.return_max_weeks,
        return_status: r.return_status,
        source_updated_at: r.source_updated_at,
        scraped_at: r.scraped_at,
      }));
    if (snapshotRows.length > 0) {
      const { error: snapErr } = await supabase
        .from('afl_injury_snapshots')
        .upsert(snapshotRows, {
          onConflict: 'player_name,club_code,source_updated_at',
          ignoreDuplicates: true,
        });
      if (snapErr) {
        // Non-fatal — snapshots are bonus, the live cache still works.
        console.warn('[afl-injuries] snapshot upsert failed:', snapErr.message);
      }
    }
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

// =============================================================
// v12.3.1 — Trend detection from snapshot history
// =============================================================

export type InjuryTrendStatus =
  | 'new'           // <2 snapshots — too early to call
  | 'on_track'      // ETA decreasing roughly in line with weeks elapsed
  | 'stalled'       // ETA hasn't moved (or has worsened) against weeks elapsed
  | 'accelerating'  // ETA dropping faster than weeks elapsed
  | 'worsened'      // status moved to 'season' / 'indefinite' from 'weeks'
  | 'cleared';      // no longer on the list (computed externally)

export interface InjuryTrend {
  status: InjuryTrendStatus;
  weeksOnList: number;
  initialMaxWeeks: number | null;
  currentMaxWeeks: number | null;
  slippageWeeks: number | null; // current - expected; positive = stalled
  initialStatus: string | null;
  currentStatus: string | null;
  snapshots: SnapshotPoint[];
  /** Short human label for chips/tooltips. */
  summary: string;
}

export interface SnapshotPoint {
  source_updated_at: string; // YYYY-MM-DD
  return_max_weeks: number | null;
  return_min_weeks: number | null;
  return_status: string | null;
  estimated_return: string | null;
}

const CATEGORICAL_WORSE = new Set(['season', 'indefinite']);

/**
 * Compute a trend from a player's chronologically-ordered snapshots.
 * Pure function — give it the snapshot list, get back the verdict.
 */
export function computeInjuryTrend(rawSnapshots: SnapshotPoint[]): InjuryTrend {
  const snapshots = [...rawSnapshots].sort((a, b) =>
    a.source_updated_at < b.source_updated_at ? -1 : 1
  );
  if (snapshots.length === 0) {
    return {
      status: 'new',
      weeksOnList: 0,
      initialMaxWeeks: null,
      currentMaxWeeks: null,
      slippageWeeks: null,
      initialStatus: null,
      currentStatus: null,
      snapshots: [],
      summary: 'New listing',
    };
  }
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const weeksOnList = Math.max(
    0,
    Math.round(
      (Date.parse(last.source_updated_at + 'T00:00:00Z') -
        Date.parse(first.source_updated_at + 'T00:00:00Z')) /
        (7 * 86_400_000)
    )
  );

  if (snapshots.length === 1) {
    return {
      status: 'new',
      weeksOnList: 0,
      initialMaxWeeks: first.return_max_weeks,
      currentMaxWeeks: first.return_max_weeks,
      slippageWeeks: null,
      initialStatus: first.return_status,
      currentStatus: last.return_status,
      snapshots,
      summary: 'Newly listed',
    };
  }

  const initialMax = first.return_max_weeks;
  const currentMax = last.return_max_weeks;

  // Categorical worsening trumps numeric math.
  if (
    last.return_status &&
    CATEGORICAL_WORSE.has(last.return_status) &&
    first.return_status &&
    !CATEGORICAL_WORSE.has(first.return_status)
  ) {
    return {
      status: 'worsened',
      weeksOnList,
      initialMaxWeeks: initialMax,
      currentMaxWeeks: currentMax,
      slippageWeeks: null,
      initialStatus: first.return_status,
      currentStatus: last.return_status,
      snapshots,
      summary: `Worsened: ${first.estimated_return ?? '?'} → ${last.estimated_return ?? '?'}`,
    };
  }

  if (initialMax == null || currentMax == null) {
    // Can't do numeric trend math (e.g. always 'Test' or 'Indefinite').
    const sameStatus = first.return_status === last.return_status;
    return {
      status: sameStatus ? 'stalled' : 'on_track',
      weeksOnList,
      initialMaxWeeks: initialMax,
      currentMaxWeeks: currentMax,
      slippageWeeks: null,
      initialStatus: first.return_status,
      currentStatus: last.return_status,
      snapshots,
      summary: sameStatus
        ? `Same status ${weeksOnList}w later`
        : `${first.estimated_return ?? '?'} → ${last.estimated_return ?? '?'}`,
    };
  }

  // Expected current ETA = initial - weeks elapsed (clamped at 0).
  const expectedNowMax = Math.max(0, initialMax - weeksOnList);
  const slippage = currentMax - expectedNowMax;

  let status: InjuryTrendStatus = 'on_track';
  if (slippage >= 2) status = 'stalled';
  else if (slippage <= -2) status = 'accelerating';

  let summary: string;
  if (status === 'stalled') {
    summary = `Stalled +${slippage}w · ${weeksOnList}w on list, still ${currentMax}w out`;
  } else if (status === 'accelerating') {
    summary = `Accelerating ${slippage}w · ${currentMax}w out vs ${expectedNowMax}w expected`;
  } else {
    summary = `On track · ${weeksOnList}w on list, ${currentMax}w to go`;
  }

  return {
    status,
    weeksOnList,
    initialMaxWeeks: initialMax,
    currentMaxWeeks: currentMax,
    slippageWeeks: slippage,
    initialStatus: first.return_status,
    currentStatus: last.return_status,
    snapshots,
    summary,
  };
}

/**
 * Format the trend for inclusion in an AI prompt. Adds a single line on
 * top of the OFFICIAL INJURY entry when the trend is informative
 * (stalled / accelerating / worsened — no signal for on_track or new).
 */
export function formatTrendForPrompt(trend: InjuryTrend): string | null {
  if (trend.status === 'on_track' || trend.status === 'new') return null;
  if (trend.status === 'stalled') {
    return `TIMELINE STALLED — listed ${trend.weeksOnList} weeks ago at ${
      trend.initialMaxWeeks ?? '?'
    }w, current ETA still ${trend.currentMaxWeeks ?? '?'}w. Slippage +${trend.slippageWeeks}w.`;
  }
  if (trend.status === 'accelerating') {
    return `TIMELINE ACCELERATING — listed ${trend.weeksOnList} weeks ago at ${
      trend.initialMaxWeeks ?? '?'
    }w, current ETA only ${trend.currentMaxWeeks ?? '?'}w. Healing ahead of schedule.`;
  }
  if (trend.status === 'worsened') {
    return `TIMELINE WORSENED — initially ${trend.initialStatus ?? '?'}, now ${trend.currentStatus ?? '?'}.`;
  }
  return null;
}

/**
 * Re-resolve player_ids for a list of (player_name, club_code) pairs
 * using the current strict matcher. Used by the /injuries query layer
 * to self-heal stale player_id assignments — the matcher logic
 * tightens over time, but afl_injuries rows only get re-resolved at
 * sync. This way the displayed result always reflects the live matcher.
 */
export async function resolveInjuryPlayerIds(
  supabase: SB,
  pairs: Array<{ player_name: string; club_code: string }>
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (pairs.length === 0) return out;

  // Build the same byName lookup the sync uses.
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

  for (const p of pairs) {
    out.set(`${p.player_name}::${p.club_code}`, resolvePlayerId(p.player_name, p.club_code, byName));
  }
  return out;
}

/**
 * Pull all snapshots for a set of player_ids in one query. Caller
 * groups by player_id and runs computeInjuryTrend.
 */
export async function fetchSnapshotsForPlayers(
  supabase: SB,
  playerIds: number[]
): Promise<Map<number, SnapshotPoint[]>> {
  const out = new Map<number, SnapshotPoint[]>();
  if (playerIds.length === 0) return out;
  const { data } = await supabase
    .from('afl_injury_snapshots')
    .select('player_id, source_updated_at, return_max_weeks, return_min_weeks, return_status, estimated_return')
    .in('player_id', playerIds)
    .order('source_updated_at', { ascending: true });
  for (const r of (data ?? []) as Array<
    SnapshotPoint & { player_id: number | null }
  >) {
    if (r.player_id == null) continue;
    if (!out.has(r.player_id)) out.set(r.player_id, []);
    out.get(r.player_id)!.push({
      source_updated_at: r.source_updated_at,
      return_max_weeks: r.return_max_weeks,
      return_min_weeks: r.return_min_weeks,
      return_status: r.return_status,
      estimated_return: r.estimated_return,
    });
  }
  return out;
}

// =============================================================
// v13 — Injury snapshot at trade time + drift detection
// =============================================================

export interface InjurySnapshot {
  injury: string | null;
  estimated_return: string | null;
  return_min_weeks: number | null;
  return_max_weeks: number | null;
  return_status: string;
  source_updated_at: string | null;
  trend_status: string | null;
  trend_summary: string | null;
}

/**
 * Build InjurySnapshot objects for a set of player IDs by querying
 * afl_injuries + afl_injury_snapshots. Only players currently on the
 * injury list get a snapshot; others are absent from the returned map
 * (their injury_at_trade will be null, meaning "healthy at trade time").
 */
export async function buildInjurySnapshotsForPlayers(
  supabase: SB,
  playerIds: number[]
): Promise<Map<number, InjurySnapshot>> {
  const out = new Map<number, InjurySnapshot>();
  if (playerIds.length === 0) return out;

  const { data: injuries } = await supabase
    .from('afl_injuries')
    .select('player_id, injury, estimated_return, return_min_weeks, return_max_weeks, return_status, source_updated_at')
    .in('player_id', playerIds);

  if (!injuries || injuries.length === 0) return out;

  const injuredIds = (injuries as Array<{ player_id: number }>)
    .map((r) => r.player_id)
    .filter((id): id is number => id != null);

  const snapshotMap = await fetchSnapshotsForPlayers(supabase, injuredIds);

  for (const inj of injuries as Array<{
    player_id: number;
    injury: string | null;
    estimated_return: string | null;
    return_min_weeks: number | null;
    return_max_weeks: number | null;
    return_status: string;
    source_updated_at: string | null;
  }>) {
    if (inj.player_id == null) continue;

    const snaps = snapshotMap.get(inj.player_id) ?? [];
    const trend = computeInjuryTrend(snaps);

    out.set(inj.player_id, {
      injury: inj.injury,
      estimated_return: inj.estimated_return,
      return_min_weeks: inj.return_min_weeks,
      return_max_weeks: inj.return_max_weeks,
      return_status: inj.return_status,
      source_updated_at: inj.source_updated_at,
      trend_status: trend.status,
      trend_summary: trend.summary,
    });
  }

  return out;
}

// =============================================================
// v13 — Drift detection (trade-time snapshot vs current state)
// =============================================================

export type DriftStatus =
  | 'cleared'
  | 'on_track'
  | 'stalled'
  | 'worsened'
  | 'new_injury'
  | 'healthy_throughout';

export interface InjuryDrift {
  status: DriftStatus;
  summary: string;
  injuryAtTrade: InjurySnapshot | null;
  injuryCurrent: InjurySnapshot | null;
}

/**
 * Compare the injury state at trade execution to the current injury
 * state and produce a drift verdict.
 *
 * @param atTrade   - injury_at_trade JSONB from trade_players (null = healthy)
 * @param current   - current afl_injuries row (null = not on list / healthy)
 */
export function computeInjuryDrift(
  atTrade: InjurySnapshot | null | undefined,
  current: InjurySnapshot | null | undefined
): InjuryDrift {
  const at = atTrade ?? null;
  const cur = current ?? null;

  if (!at && !cur) {
    return {
      status: 'healthy_throughout',
      summary: 'Healthy at trade time and now',
      injuryAtTrade: null,
      injuryCurrent: null,
    };
  }

  if (!at && cur) {
    return {
      status: 'new_injury',
      summary: `New injury since trade: ${cur.injury ?? 'unknown'}, ETA ${cur.estimated_return ?? 'TBC'}`,
      injuryAtTrade: null,
      injuryCurrent: cur,
    };
  }

  if (at && !cur) {
    return {
      status: 'cleared',
      summary: `Cleared — was ${at.injury ?? 'injured'} (${at.estimated_return ?? '?'}) at trade time`,
      injuryAtTrade: at,
      injuryCurrent: null,
    };
  }

  // Both at and cur are non-null — compare timelines
  const atMax = at!.return_max_weeks;
  const curMax = cur!.return_max_weeks;

  // Categorical worsening: went from weeks/months → season/indefinite
  if (
    cur!.return_status &&
    CATEGORICAL_WORSE.has(cur!.return_status) &&
    at!.return_status &&
    !CATEGORICAL_WORSE.has(at!.return_status)
  ) {
    return {
      status: 'worsened',
      summary: `Worsened: ${at!.estimated_return ?? '?'} → ${cur!.estimated_return ?? '?'}`,
      injuryAtTrade: at,
      injuryCurrent: cur,
    };
  }

  // If we have numeric ETAs, compute slippage
  if (atMax != null && curMax != null) {
    // Estimate weeks elapsed since trade-time snapshot
    const atDate = at!.source_updated_at;
    const curDate = cur!.source_updated_at;
    let weeksElapsed = 0;
    if (atDate && curDate) {
      weeksElapsed = Math.max(
        0,
        Math.round(
          (Date.parse(curDate + 'T00:00:00Z') - Date.parse(atDate + 'T00:00:00Z')) /
            (7 * 86_400_000)
        )
      );
    }

    const expectedNow = Math.max(0, atMax - weeksElapsed);
    const slippage = curMax - expectedNow;

    if (slippage >= 2) {
      return {
        status: 'stalled',
        summary: `Stalled +${slippage}w — was ${atMax}w at trade, now ${curMax}w (${weeksElapsed}w later)`,
        injuryAtTrade: at,
        injuryCurrent: cur,
      };
    }
  }

  return {
    status: 'on_track',
    summary: `Recovery on track — ${at!.injury ?? 'injury'} progressing as expected`,
    injuryAtTrade: at,
    injuryCurrent: cur,
  };
}
