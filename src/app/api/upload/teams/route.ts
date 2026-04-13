import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data, target_round } = body as {
      data: Record<string, unknown>[];
      target_round?: number;
    };

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    // Target round comes from the UI picker. Fall back to latest player_rounds
    // for backward compatibility, but prefer the explicit picker value so the
    // teams CSV lands on the round the user actually intends.
    let targetRound: number | undefined;
    if (typeof target_round === 'number' && target_round > 0) {
      targetRound = target_round;
    } else {
      const { data: latestRound } = await supabase
        .from('player_rounds')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1);
      targetRound = latestRound?.[0]?.round_number;
    }

    if (!targetRound) {
      return NextResponse.json(
        { error: 'Pick a target round (or upload lineups first) so we know which round to assign standings to' },
        { status: 400 }
      );
    }

    // Parse teams CSV
    const snapshots = data.map((row: Record<string, unknown>) => {
      const teamName = String(row['team_name'] || row['Team'] || row['team'] || '');
      const team = TEAMS.find(
        (t) => t.team_name.toLowerCase() === teamName.toLowerCase() || t.team_id === Number(row['team_id'])
      );

      return {
        round_number: targetRound,
        team_id: team?.team_id || Number(row['team_id'] || 0),
        team_name: team?.team_name || teamName,
        wins: Number(row['wins'] || row['Wins'] || row['W'] || 0),
        losses: Number(row['losses'] || row['Losses'] || row['L'] || 0),
        ties: Number(row['ties'] || row['Ties'] || row['T'] || 0),
        pts_for: Number(row['pts_for'] || row['Pts For'] || row['PF'] || row['pts for'] || 0),
        pts_against: Number(row['pts_against'] || row['Pts Against'] || row['PA'] || row['pts against'] || 0),
        pct: Number(row['pct'] || row['Pct'] || row['PCT'] || 0),
        league_rank: Number(row['league_rank'] || row['Rank'] || row['rank'] || 0),
      };
    });

    // Upsert team snapshots for latest round
    const { error: snapError } = await supabase
      .from('team_snapshots')
      .upsert(snapshots, { onConflict: 'round_number,team_id' });
    if (snapError) throw snapError;

    // Get ALL player_rounds and compute everything in memory
    const { data: allPlayers } = await supabase
      .from('player_rounds')
      .select('round_number, team_id, pos, points, is_scoring');

    if (!allPlayers) {
      return NextResponse.json({ success: true, count: snapshots.length, target_round: targetRound });
    }

    // Get unique rounds
    const uniqueRounds = [...new Set(allPlayers.map((p) => p.round_number))].sort((a, b) => a - b);

    // Compute line totals per team per round (all in memory)
    const lineTotals = new Map<string, Record<string, number>>(); // key: "round-teamId"

    for (const p of allPlayers) {
      if (!p.is_scoring) continue;
      const key = `${p.round_number}-${p.team_id}`;
      if (!lineTotals.has(key)) {
        lineTotals.set(key, { DEF: 0, MID: 0, FWD: 0, RUC: 0, UTL: 0 });
      }
      const totals = lineTotals.get(key)!;
      const pos = p.pos.toUpperCase();
      if (pos in totals) {
        totals[pos] += Number(p.points || 0);
      }
    }

    // Build all team_snapshots rows with line totals and rankings
    const allSnapshotRows: Record<string, unknown>[] = [];

    for (const roundNum of uniqueRounds) {
      const roundTeams = TEAMS.map((t) => {
        const key = `${roundNum}-${t.team_id}`;
        const totals = lineTotals.get(key) || { DEF: 0, MID: 0, FWD: 0, RUC: 0, UTL: 0 };
        return {
          round_number: roundNum,
          team_id: t.team_id,
          team_name: t.team_name,
          def_total: totals.DEF,
          mid_total: totals.MID,
          fwd_total: totals.FWD,
          ruc_total: totals.RUC,
          utl_total: totals.UTL,
        };
      });

      // Compute per-round rankings for all 5 lines
      const positions = ['def', 'mid', 'fwd', 'ruc', 'utl'] as const;
      for (const pos of positions) {
        const sorted = [...roundTeams].sort(
          (a, b) => (b[`${pos}_total`] as number) - (a[`${pos}_total`] as number)
        );
        sorted.forEach((team, i) => {
          (team as Record<string, unknown>)[`${pos}_rank`] = i + 1;
        });
      }

      allSnapshotRows.push(...roundTeams);
    }

    // Compute season rankings (average across all rounds up to each round)
    for (const roundNum of uniqueRounds) {
      const roundsUpTo = uniqueRounds.filter((r) => r <= roundNum);
      const seasonPositions = ['def', 'mid', 'fwd', 'ruc', 'utl'] as const;

      for (const pos of seasonPositions) {
        // Compute average per team across rounds up to this one
        const teamAvgs = TEAMS.map((t) => {
          const vals = roundsUpTo
            .map((r) => {
              const snap = allSnapshotRows.find(
                (s) => s.round_number === r && s.team_id === t.team_id
              );
              return snap ? (snap[`${pos}_total`] as number) : 0;
            });
          const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          return { team_id: t.team_id, avg };
        });

        teamAvgs.sort((a, b) => b.avg - a.avg);
        teamAvgs.forEach((ta, i) => {
          const snap = allSnapshotRows.find(
            (s) => s.round_number === roundNum && s.team_id === ta.team_id
          );
          if (snap) {
            (snap as Record<string, unknown>)[`${pos}_season_rank`] = i + 1;
          }
        });
      }
    }

    // Single batch upsert for all snapshots
    for (let i = 0; i < allSnapshotRows.length; i += 500) {
      const batch = allSnapshotRows.slice(i, i + 500);
      const { error } = await supabase
        .from('team_snapshots')
        .upsert(batch, { onConflict: 'round_number,team_id' });
      if (error) throw error;
    }

    // Log upload
    await supabase.from('csv_uploads').insert({
      round_number: targetRound,
      upload_type: 'teams',
      raw_data: data,
    });

    return NextResponse.json({
      success: true,
      count: snapshots.length,
      target_round: targetRound,
      rounds_computed: uniqueRounds,
    });
  } catch (err) {
    console.error('Teams upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
