import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { computeInjuryTrend, type SnapshotPoint, type InjuryTrend } from '@/lib/afl-injuries';
import { getCurrentRound } from '@/lib/round';
import { TEAMS } from '@/lib/constants';

export interface InjuryListPlayer {
  player_name: string;
  player_id: number | null;
  club_code: string;
  club_name: string;
  injury: string | null;
  estimated_return: string | null;
  return_max_weeks: number | null;
  source_updated_at: string | null;
  // Resolved LOMAF rosters — null when not on a LOMAF roster.
  lomaf_team_id: number | null;
  lomaf_team_name: string | null;
  lomaf_position: string | null;
  trend: InjuryTrend;
}

export interface InjuryListResponse {
  players: InjuryListPlayer[];
  cache: {
    afl_freshest: string | null;
    last_scraped: string | null;
    total: number;
    matched_to_lomaf: number;
  };
}

/**
 * GET /api/afl-injuries/list — open to any signed-in coach.
 * Bundles current-state injuries + trend computation + LOMAF roster
 * resolution so the /injuries page renders with one round trip.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from('afl_injuries')
    .select(
      'player_name, player_id, club_code, club_name, injury, estimated_return, return_max_weeks, source_updated_at, scraped_at'
    )
    .order('club_code', { ascending: true })
    .order('player_name', { ascending: true });

  const injuries = (rows ?? []) as Array<{
    player_name: string;
    player_id: number | null;
    club_code: string;
    club_name: string;
    injury: string | null;
    estimated_return: string | null;
    return_max_weeks: number | null;
    source_updated_at: string | null;
    scraped_at: string;
  }>;

  // v12.3.2 — Resolve LOMAF rosters from ONLY the most recent round.
  // Using historical player_rounds was matching players to whichever
  // coach last had them, even if they've been dropped or traded since.
  // The platform's current round is the explicit ledger value; fall back
  // to MAX(round_number) if not yet advanced.
  const matchedPlayerIds = injuries
    .map((r) => r.player_id)
    .filter((id): id is number => id != null);
  const rosterByPlayer = new Map<
    number,
    { team_id: number; team_name: string; position: string | null }
  >();
  if (matchedPlayerIds.length > 0) {
    let rosterRound = await getCurrentRound(supabase);
    if (rosterRound === 0) {
      const { data: maxRow } = await supabase
        .from('player_rounds')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      rosterRound = (maxRow as { round_number: number } | null)?.round_number ?? 0;
    }
    if (rosterRound > 0) {
      const { data: prRows } = await supabase
        .from('player_rounds')
        .select('player_id, team_id, team_name, pos')
        .in('player_id', matchedPlayerIds)
        .eq('round_number', rosterRound);
      for (const r of (prRows ?? []) as Array<{
        player_id: number;
        team_id: number;
        team_name: string;
        pos: string | null;
      }>) {
        // Some round-snapshots include the same player twice (DPP/EMG);
        // first one wins.
        if (rosterByPlayer.has(r.player_id)) continue;
        rosterByPlayer.set(r.player_id, {
          team_id: r.team_id,
          team_name: r.team_name,
          position: r.pos,
        });
      }
    }
  }

  // Pull all snapshots in one shot.
  const snapshotsByPlayer = new Map<number, SnapshotPoint[]>();
  // Also key by name+club for unmatched (player_id null) injuries.
  const snapshotsByNameClub = new Map<string, SnapshotPoint[]>();
  if (injuries.length > 0) {
    const { data: snapData } = await supabase
      .from('afl_injury_snapshots')
      .select(
        'player_name, player_id, club_code, source_updated_at, return_max_weeks, return_min_weeks, return_status, estimated_return'
      )
      .order('source_updated_at', { ascending: true });
    for (const s of (snapData ?? []) as Array<{
      player_name: string;
      player_id: number | null;
      club_code: string;
      source_updated_at: string;
      return_max_weeks: number | null;
      return_min_weeks: number | null;
      return_status: string | null;
      estimated_return: string | null;
    }>) {
      const point: SnapshotPoint = {
        source_updated_at: s.source_updated_at,
        return_max_weeks: s.return_max_weeks,
        return_min_weeks: s.return_min_weeks,
        return_status: s.return_status,
        estimated_return: s.estimated_return,
      };
      if (s.player_id != null) {
        if (!snapshotsByPlayer.has(s.player_id)) snapshotsByPlayer.set(s.player_id, []);
        snapshotsByPlayer.get(s.player_id)!.push(point);
      }
      const key = `${s.player_name}::${s.club_code}`;
      if (!snapshotsByNameClub.has(key)) snapshotsByNameClub.set(key, []);
      snapshotsByNameClub.get(key)!.push(point);
    }
  }

  const players: InjuryListPlayer[] = injuries.map((r) => {
    const points =
      (r.player_id != null && snapshotsByPlayer.get(r.player_id)) ||
      snapshotsByNameClub.get(`${r.player_name}::${r.club_code}`) ||
      [];
    const trend = computeInjuryTrend(points);
    const roster = r.player_id != null ? rosterByPlayer.get(r.player_id) : undefined;
    const lomafTeam = roster ? TEAMS.find((t) => t.team_id === roster.team_id) : null;
    return {
      player_name: r.player_name,
      player_id: r.player_id,
      club_code: r.club_code,
      club_name: r.club_name,
      injury: r.injury,
      estimated_return: r.estimated_return,
      return_max_weeks: r.return_max_weeks,
      source_updated_at: r.source_updated_at,
      lomaf_team_id: roster?.team_id ?? null,
      lomaf_team_name: lomafTeam?.team_name ?? roster?.team_name ?? null,
      lomaf_position: roster?.position ?? null,
      trend,
    };
  });

  // Cache freshness.
  const sourceDates = injuries.map((r) => r.source_updated_at).filter((d): d is string => !!d).sort();
  const lastScraped = injuries.length > 0
    ? injuries.map((r) => r.scraped_at).sort().slice(-1)[0]
    : null;

  const response: InjuryListResponse = {
    players,
    cache: {
      afl_freshest: sourceDates.length ? sourceDates[sourceDates.length - 1] : null,
      last_scraped: lastScraped,
      total: injuries.length,
      matched_to_lomaf: players.filter((p) => p.lomaf_team_id != null).length,
    },
  };

  return NextResponse.json(response);
}
