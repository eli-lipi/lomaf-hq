import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AFL_CLUBS } from '@/lib/afl-clubs';

/**
 * GET /api/byes/data — server-side, parallelized fetch of the two
 * heavy data sources the /byes page needs: current rosters and
 * season-to-date averages.
 *
 * Previously the browser ran these as paginated waterfalls directly
 * against Supabase (one-by-one, each adding ~80ms of public-internet
 * latency). Doing it server-side from the same Vercel region as
 * Supabase collapses the round-trip count and parallelises the two
 * datasets that don't depend on each other.
 *
 * The injury feed stays on its own endpoint (/api/afl-injuries/list)
 * because it's already a single-call helper used by the /injuries
 * page; the browser fires both fetches in parallel from useByeData.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface RosterRow {
  team_id: number;
  player_id: number;
  player_name: string;
  club: string;
}

interface AvgRow {
  player_id: number;
  avg_pts: number;
}

export interface ByesDataResponse {
  latestRound: number;
  rosters: RosterRow[];
  averages: AvgRow[];
}

async function fetchAllRostersForRound(maxRound: number): Promise<RosterRow[]> {
  if (maxRound <= 0) return [];
  const all: RosterRow[] = [];
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: batch, error } = await supabase
      .from('player_rounds')
      .select('team_id, player_id, player_name, club')
      .eq('round_number', maxRound)
      .range(offset, offset + 999);
    if (error) throw error;
    if (!batch || batch.length === 0) break;
    for (const row of batch) {
      // Filter to known AFL clubs server-side so the browser doesn't
      // ship rows it would discard anyway.
      if (row.club && AFL_CLUBS[row.club]) {
        all.push({
          team_id: row.team_id,
          player_id: row.player_id,
          player_name: row.player_name,
          club: row.club,
        });
      }
    }
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function fetchAllAverages(): Promise<AvgRow[]> {
  const out: AvgRow[] = [];
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: batch, error } = await supabase
      .from('players')
      .select('player_id, avg_pts')
      .range(offset, offset + 999);
    if (error) throw error;
    if (!batch || batch.length === 0) break;
    for (const r of batch as Array<{ player_id: number | null; avg_pts: number | string | null }>) {
      if (r.player_id != null && r.avg_pts != null) {
        const n = Number(r.avg_pts);
        if (Number.isFinite(n) && n > 0) {
          out.push({ player_id: r.player_id, avg_pts: n });
        }
      }
    }
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return out;
}

export async function GET() {
  try {
    // 1. Get the latest round with player_rounds data — needed before we
    //    know which round's rosters to query. Run in parallel with the
    //    averages query (which doesn't depend on it).
    const [latestRoundRes, averages] = await Promise.all([
      supabase
        .from('player_rounds')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1),
      fetchAllAverages(),
    ]);
    const latestRound =
      (latestRoundRes.data as { round_number: number }[] | null)?.[0]?.round_number ?? 0;

    // 2. Pull rosters for the latest round.
    const rosters = await fetchAllRostersForRound(latestRound);

    const payload: ByesDataResponse = { latestRound, rosters, averages };
    return NextResponse.json(payload, {
      // 30s edge cache. Bye impact tables don't change minute-to-minute;
      // a coach refreshing the page during planning won't notice this.
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  } catch (err) {
    console.error('[byes/data]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load bye data' },
      { status: 500 }
    );
  }
}
