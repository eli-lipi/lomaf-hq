import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { computeInjuryTrend, resolveInjuryPlayerIds, type SnapshotPoint, type InjuryTrend } from '@/lib/afl-injuries';
import { getCurrentRound } from '@/lib/round';
import { cleanPositionDisplay } from '@/lib/trades/positions';
import { TEAMS } from '@/lib/constants';

export interface InjuryRoundCell {
  round: number;
  points: number | null;
  // ETA listed by AFL during this round, if any. Maps the snapshot to
  // the LOMAF round that was current/upcoming when AFL published.
  eta: string | null;
  injury: string | null;
  // True when the round is in the future and the latest AFL listing
  // says the player is still out. Drives the striped 'predicted-injured'
  // tile in the picker.
  predicted_injured: boolean;
}

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
  // Cleaned to DEF / MID / FWD / RUC (or DPP combo). BN / UTL are
  // lineup slots, not positions, so they're stripped.
  lomaf_position: string | null;
  trend: InjuryTrend;
  /** Per-round timeline. Length = max(currentRound + 1, latest snapshot round). */
  rounds: InjuryRoundCell[];
  /** AFL Fantasy projected season average. Used to sort waiver targets
   *  and quantify 'projAvg lost' per coach. Null if the players CSV
   *  hasn't been uploaded or this player isn't in it. */
  proj_avg: number | null;
}

export interface InjuryListResponse {
  players: InjuryListPlayer[];
  cache: {
    afl_freshest: string | null;
    last_scraped: string | null;
    total: number;
    matched_to_lomaf: number;
    /** Platform's current round so the picker can colour past-but-no-data
     *  rounds as DNP rather than mistaking them for future rounds. */
    current_round: number;
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

  const injuriesRaw = (rows ?? []) as Array<{
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

  // v12.3.4 — Re-resolve player_ids at query time using the live matcher
  // so the display self-heals after matcher tightenings. Without this,
  // afl_injuries rows still carry the player_id assigned by whatever
  // matcher version was running when they were synced. Drift back into
  // the DB so snapshots & other readers converge.
  const fresh = await resolveInjuryPlayerIds(
    supabase,
    injuriesRaw.map((r) => ({ player_name: r.player_name, club_code: r.club_code }))
  );
  const corrections: Array<{ player_name: string; club_code: string; player_id: number | null }> = [];
  const injuries = injuriesRaw.map((r) => {
    const freshId = fresh.get(`${r.player_name}::${r.club_code}`) ?? null;
    if (freshId !== r.player_id) {
      corrections.push({ player_name: r.player_name, club_code: r.club_code, player_id: freshId });
    }
    return { ...r, player_id: freshId };
  });
  // Persist corrections in the background — non-blocking. UPDATE one row
  // per drifted record; afl_injury_snapshots player_id is also corrected
  // so the trend computer reads accurate history.
  if (corrections.length > 0) {
    Promise.all(
      corrections.map((c) =>
        supabase
          .from('afl_injuries')
          .update({ player_id: c.player_id })
          .eq('player_name', c.player_name)
          .eq('club_code', c.club_code)
      )
    ).catch((e) => console.error('[afl-injuries/list] correction write failed', e));
    Promise.all(
      corrections.map((c) =>
        supabase
          .from('afl_injury_snapshots')
          .update({ player_id: c.player_id })
          .eq('player_name', c.player_name)
          .eq('club_code', c.club_code)
      )
    ).catch((e) => console.error('[afl-injuries/list] snapshot correction write failed', e));
  }

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
  // v12.4 — canonical position + proj_avg from the season-wide players
  // table. Position fallback for waiver pickups who've never made a
  // senior lineup; proj_avg powers the 'lost projAvg' per-coach summary
  // and waiver-target sorting. Keyed by (name, AFL club) since the
  // players CSV doesn't carry player_id.
  const allInjuredKeys = injuries.map((r) => ({ name: r.player_name, club: r.club_code }));
  const positionByNameClub = new Map<string, string>();
  const projAvgByNameClub = new Map<string, number>();
  if (allInjuredKeys.length > 0) {
    const names = Array.from(new Set(allInjuredKeys.map((k) => k.name)));
    const { data: pl } = await supabase
      .from('players')
      .select('player_name, afl_club, position, player_id, proj_avg')
      .in('player_name', names);
    for (const p of (pl ?? []) as Array<{
      player_name: string;
      afl_club: string;
      position: string | null;
      player_id: number | null;
      proj_avg: number | null;
    }>) {
      const key = `${p.player_name.toLowerCase()}::${p.afl_club.toUpperCase()}`;
      if (p.position) positionByNameClub.set(key, p.position);
      if (p.proj_avg != null) projAvgByNameClub.set(key, p.proj_avg);
    }
  }
  // AFL.com.au club code → AFL Fantasy club code(s) — we already have
  // a mapping baked into the matcher; mirror the resolution path here
  // for the position lookup.
  const FANTASY_CLUB_BY_AFL_CODE: Record<string, string[]> = {
    ADEL: ['ADE', 'ADEL'], BRIS: ['BRL', 'BL', 'BRIS'], CARL: ['CAR', 'CARL'],
    COLL: ['COL', 'COLL'], ESS: ['ESS'], FREM: ['FRE', 'FREM'],
    GCS: ['GCS', 'GCFC'], GEEL: ['GEE', 'GEEL'], GWS: ['GWS'],
    HAW: ['HAW'], MELB: ['MEL', 'MELB'], NM: ['NTH', 'NM', 'KAN'],
    PA: ['PTA', 'PA', 'PORT'], RICH: ['RIC', 'RICH'], STK: ['STK'],
    SYD: ['SYD'], WB: ['WBD', 'WB'], WCE: ['WCE'],
  };
  const positionFromPlayers = (name: string, aflCode: string): string | null => {
    const fantasyCodes = FANTASY_CLUB_BY_AFL_CODE[aflCode] ?? [];
    for (const fc of fantasyCodes) {
      const hit = positionByNameClub.get(`${name.toLowerCase()}::${fc.toUpperCase()}`);
      if (hit) return hit;
    }
    return null;
  };
  const projAvgFromPlayers = (name: string, aflCode: string): number | null => {
    const fantasyCodes = FANTASY_CLUB_BY_AFL_CODE[aflCode] ?? [];
    for (const fc of fantasyCodes) {
      const hit = projAvgByNameClub.get(`${name.toLowerCase()}::${fc.toUpperCase()}`);
      if (hit != null) return hit;
    }
    return null;
  };

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

  // v12.3.3 — round-advance dates and per-round play data so the UI
  // can render the round-tile picker.
  let currentRound = await getCurrentRound(supabase);
  if (currentRound === 0) {
    const { data: maxRow } = await supabase
      .from('player_rounds')
      .select('round_number')
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    currentRound = (maxRow as { round_number: number } | null)?.round_number ?? 0;
  }
  const { data: advanceRows } = await supabase
    .from('round_advances')
    .select('round_number, advanced_at')
    .order('round_number', { ascending: true });
  const advances = (advanceRows ?? []) as Array<{ round_number: number; advanced_at: string }>;

  // Per-player round-by-round score data for ALL listed players, not just
  // matched ones — so the AFL Club view can show a journeyman's
  // played/DNP record even if they're off LOMAF rosters.
  const allInjuredIds = injuries.map((r) => r.player_id).filter((id): id is number => id != null);
  const playerRoundsByPlayer = new Map<number, Map<number, number | null>>();
  if (allInjuredIds.length > 0) {
    const { data: prAll } = await supabase
      .from('player_rounds')
      .select('player_id, round_number, points')
      .in('player_id', allInjuredIds)
      .gte('round_number', 1);
    for (const r of (prAll ?? []) as Array<{
      player_id: number;
      round_number: number;
      points: number | null;
    }>) {
      if (!playerRoundsByPlayer.has(r.player_id)) playerRoundsByPlayer.set(r.player_id, new Map());
      playerRoundsByPlayer.get(r.player_id)!.set(r.round_number, r.points);
    }
  }

  // Map a snapshot's source_updated_at → the LOMAF round it applies to.
  // AFL updates Tuesday night; the listing applies to the round about to
  // start. So: snapshot maps to the FIRST round whose advanced_at is
  // AFTER the snapshot date. If nothing's been advanced yet after the
  // snapshot, the listing applies to the next-not-yet-advanced round.
  const snapshotToRound = (sourceDate: string | null): number | null => {
    if (!sourceDate) return null;
    const t = Date.parse(sourceDate + 'T00:00:00Z');
    if (Number.isNaN(t)) return null;
    for (const a of advances) {
      if (Date.parse(a.advanced_at) > t) return a.round_number;
    }
    return currentRound + 1;
  };

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

    // Build the per-round timeline. Always extend to SEASON_END_ROUND
    // so the picker includes empty future rounds the user can scan
    // for predicted-injured stripes.
    const playerRounds = (r.player_id != null && playerRoundsByPlayer.get(r.player_id)) || new Map<number, number | null>();
    const etaByRound = new Map<number, string>();
    const injuryByRound = new Map<number, string>();
    for (const s of points) {
      const rd = snapshotToRound(s.source_updated_at);
      if (rd != null && s.estimated_return) etaByRound.set(rd, s.estimated_return);
    }
    const latestSnap = points.length > 0 ? points[points.length - 1] : null;
    const latestSnapshotRound = latestSnap
      ? snapshotToRound(latestSnap.source_updated_at)
      : null;
    if (latestSnapshotRound != null && r.injury) injuryByRound.set(latestSnapshotRound, r.injury);

    // Predicted-out window: from the latest snapshot's mapped round
    // through (round + return_max_weeks - 1). Worst-case bound so we
    // don't promise an early return.
    //
    // For non-numeric ETAs ('Test', 'Concussion protocols', 'TBC',
    // 'Indefinite', 'Season') return_max_weeks is null but the listing
    // itself implies the player isn't fit. Treat them as out for at
    // least the live week — we can't extend further without a
    // duration. 'Season' and 'Indefinite' get extended to season-end.
    const predictedOut = new Set<number>();
    if (latestSnap && latestSnapshotRound != null) {
      if (latestSnap.return_max_weeks != null && latestSnap.return_max_weeks > 0) {
        const start = latestSnapshotRound;
        const end = start + latestSnap.return_max_weeks - 1;
        for (let rd = start; rd <= end; rd++) predictedOut.add(rd);
      } else if (latestSnap.estimated_return && latestSnap.estimated_return.trim() !== '') {
        predictedOut.add(latestSnapshotRound);
        const status = (latestSnap.return_status ?? '').toLowerCase();
        if (status === 'season' || status === 'indefinite') {
          for (let rd = latestSnapshotRound + 1; rd <= 24; rd++) {
            predictedOut.add(rd);
          }
        }
      }
    }

    const SEASON_END_ROUND = 24;
    const maxRound = Math.max(SEASON_END_ROUND, currentRound + 1, ...Array.from(etaByRound.keys()), 1);
    const rounds: InjuryRoundCell[] = [];
    for (let rd = 1; rd <= maxRound; rd++) {
      const cellPoints = playerRounds.has(rd) ? playerRounds.get(rd)! : null;
      rounds.push({
        round: rd,
        points: cellPoints,
        eta: etaByRound.get(rd) ?? null,
        injury: injuryByRound.get(rd) ?? null,
        predicted_injured: rd > currentRound && predictedOut.has(rd),
      });
    }

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
      // BN / UTL are lineup slots, not positions — strip them so the
      // display only shows DEF / MID / FWD / RUC (or DPP combos). When
      // the round-specific lineup slot is missing or non-positional,
      // fall back to the canonical players table.
      lomaf_position:
        cleanPositionDisplay(roster?.position ?? null) ??
        positionFromPlayers(r.player_name, r.club_code),
      trend,
      rounds,
      proj_avg: projAvgFromPlayers(r.player_name, r.club_code),
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
      current_round: currentRound,
    },
  };

  return NextResponse.json(response);
}
