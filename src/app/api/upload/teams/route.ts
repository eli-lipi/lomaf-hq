import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TEAMS, POSITION_GROUPS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const { round_number, data } = await request.json();

    if (!round_number || !data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Missing round_number or data' }, { status: 400 });
    }

    // Parse teams CSV and create team_snapshots
    const snapshots = data.map((row: Record<string, unknown>) => {
      const teamName = String(row['team_name'] || row['Team'] || row['team'] || '');
      const team = TEAMS.find(
        (t) => t.team_name.toLowerCase() === teamName.toLowerCase() || t.team_id === Number(row['team_id'])
      );

      return {
        round_number,
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

    // Upsert team snapshots
    const { error: snapError } = await supabase
      .from('team_snapshots')
      .upsert(snapshots, { onConflict: 'round_number,team_id' });

    if (snapError) throw snapError;

    // Compute line totals from player_rounds
    await computeLineScores(round_number);

    // Compute line rankings
    await computeLineRankings(round_number);

    // Log upload
    await supabase.from('csv_uploads').insert({
      round_number,
      upload_type: 'teams',
      raw_data: data,
    });

    return NextResponse.json({ success: true, count: snapshots.length });
  } catch (err) {
    console.error('Teams upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}

async function computeLineScores(roundNumber: number) {
  // Get all scoring players for this round
  const { data: players } = await supabase
    .from('player_rounds')
    .select('team_id, pos, points')
    .eq('round_number', roundNumber)
    .eq('is_scoring', true);

  if (!players) return;

  // Group by team and position
  const teamTotals = new Map<number, Record<string, number>>();

  for (const p of players) {
    if (!teamTotals.has(p.team_id)) {
      teamTotals.set(p.team_id, { DEF: 0, MID: 0, FWD: 0, RUC: 0, UTL: 0 });
    }
    const totals = teamTotals.get(p.team_id)!;
    const pos = p.pos.toUpperCase();
    if (pos in totals) {
      totals[pos] += Number(p.points || 0);
    }
  }

  // Update team_snapshots with line totals
  for (const [teamId, totals] of teamTotals) {
    await supabase
      .from('team_snapshots')
      .update({
        def_total: totals.DEF,
        mid_total: totals.MID,
        fwd_total: totals.FWD,
        ruc_total: totals.RUC,
        utl_total: totals.UTL,
      })
      .eq('round_number', roundNumber)
      .eq('team_id', teamId);
  }
}

async function computeLineRankings(roundNumber: number) {
  const { data: snapshots } = await supabase
    .from('team_snapshots')
    .select('*')
    .eq('round_number', roundNumber);

  if (!snapshots || snapshots.length === 0) return;

  const positions = [
    { field: 'def_total', rankField: 'def_rank' },
    { field: 'mid_total', rankField: 'mid_rank' },
    { field: 'fwd_total', rankField: 'fwd_rank' },
    { field: 'ruc_total', rankField: 'ruc_rank' },
    { field: 'utl_total', rankField: 'utl_rank' },
  ];

  for (const { field, rankField } of positions) {
    // Sort teams by this position total (descending)
    const sorted = [...snapshots].sort(
      (a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0)
    );

    // Assign ranks
    for (let i = 0; i < sorted.length; i++) {
      await supabase
        .from('team_snapshots')
        .update({ [rankField]: i + 1 })
        .eq('round_number', roundNumber)
        .eq('team_id', sorted[i].team_id);
    }
  }

  // Compute season line rankings (average across all rounds)
  const { data: allSnapshots } = await supabase
    .from('team_snapshots')
    .select('*')
    .lte('round_number', roundNumber)
    .gt('round_number', 0);

  if (!allSnapshots || allSnapshots.length === 0) return;

  // Compute averages per team per position
  const teamAvgs = new Map<number, Record<string, { total: number; count: number }>>();

  for (const snap of allSnapshots) {
    if (!teamAvgs.has(snap.team_id)) {
      teamAvgs.set(snap.team_id, {
        def: { total: 0, count: 0 },
        mid: { total: 0, count: 0 },
        fwd: { total: 0, count: 0 },
        ruc: { total: 0, count: 0 },
        utl: { total: 0, count: 0 },
      });
    }
    const avgs = teamAvgs.get(snap.team_id)!;
    avgs.def.total += Number(snap.def_total || 0); avgs.def.count++;
    avgs.mid.total += Number(snap.mid_total || 0); avgs.mid.count++;
    avgs.fwd.total += Number(snap.fwd_total || 0); avgs.fwd.count++;
    avgs.ruc.total += Number(snap.ruc_total || 0); avgs.ruc.count++;
    avgs.utl.total += Number(snap.utl_total || 0); avgs.utl.count++;
  }

  const seasonPositions = [
    { key: 'def', rankField: 'def_season_rank' },
    { key: 'mid', rankField: 'mid_season_rank' },
    { key: 'fwd', rankField: 'fwd_season_rank' },
    { key: 'ruc', rankField: 'ruc_season_rank' },
    { key: 'utl', rankField: 'utl_season_rank' },
  ];

  for (const { key, rankField } of seasonPositions) {
    const entries = Array.from(teamAvgs.entries()).map(([teamId, avgs]) => ({
      teamId,
      avg: avgs[key].count > 0 ? avgs[key].total / avgs[key].count : 0,
    }));

    entries.sort((a, b) => b.avg - a.avg);

    for (let i = 0; i < entries.length; i++) {
      await supabase
        .from('team_snapshots')
        .update({ [rankField]: i + 1 })
        .eq('round_number', roundNumber)
        .eq('team_id', entries[i].teamId);
    }
  }
}
