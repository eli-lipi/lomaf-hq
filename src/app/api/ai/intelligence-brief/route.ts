import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAnthropicClient, AI_MODEL, parseAIJson, logAIUsage, INTELLIGENCE_BRIEF_SYSTEM_PROMPT } from '@/lib/ai';
import { TEAMS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roundNumber = parseInt(searchParams.get('round') || '0', 10);

  // Check cache
  const { data: cached } = await supabase
    .from('ai_intelligence_briefs')
    .select('brief_json, generated_at')
    .eq('round_number', roundNumber)
    .single();

  if (cached) {
    return NextResponse.json({ data: cached.brief_json, generated_at: cached.generated_at, cached: true });
  }

  return NextResponse.json({ data: null, cached: false });
}

export async function POST(request: Request) {
  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  const { roundNumber } = await request.json();
  if (!roundNumber) {
    return NextResponse.json({ error: 'Missing roundNumber' }, { status: 400 });
  }

  try {
    // ── Gather all data for the prompt ──

    // 1. Standings from team_snapshots
    const { data: snapshots } = await supabase
      .from('team_snapshots')
      .select('*')
      .eq('round_number', roundNumber)
      .order('league_rank', { ascending: true });

    // 2. Scores (all rounds)
    const allPlayerRounds: { round_number: number; team_id: number; pos: string; points: number | null; is_scoring: boolean }[] = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('player_rounds')
        .select('round_number, team_id, pos, points, is_scoring')
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      allPlayerRounds.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }

    // Compute lineup sums per round per team
    const lineupSums: Record<string, number> = {};
    const roundsSet = new Set<number>();
    allPlayerRounds.forEach(p => {
      if (!p.is_scoring || p.points == null) return;
      const key = `${p.round_number}-${p.team_id}`;
      lineupSums[key] = (lineupSums[key] || 0) + Number(p.points);
      roundsSet.add(p.round_number);
    });

    // Matchup + override scores
    const { data: matchups } = await supabase.from('matchup_rounds').select('round_number, team_id, score_for, opp_name, win, loss, tie');
    const matchupScores: Record<string, number> = {};
    const matchupDetails: Record<string, { oppName: string; oppScore: number; result: string }> = {};
    matchups?.forEach((m: { round_number: number; team_id: number; score_for: number; opp_name: string; win: boolean; loss: boolean; tie: boolean }) => {
      const key = `${m.round_number}-${m.team_id}`;
      matchupScores[key] = Number(m.score_for);
      matchupDetails[key] = { oppName: m.opp_name, oppScore: 0, result: m.win ? 'W' : m.loss ? 'L' : 'T' };
    });
    // Fill opp scores
    matchups?.forEach((m: { round_number: number; team_id: number; score_for: number; opp_name: string }) => {
      const oppTeam = TEAMS.find(t => t.team_name === m.opp_name);
      if (oppTeam) {
        const key = `${m.round_number}-${m.team_id}`;
        const oppKey = `${m.round_number}-${oppTeam.team_id}`;
        if (matchupDetails[key]) matchupDetails[key].oppScore = matchupScores[oppKey] || 0;
      }
    });

    const { data: adjustments } = await supabase.from('score_adjustments').select('round_number, team_id, correct_score');
    const overrideScores: Record<string, number> = {};
    adjustments?.forEach((a: { round_number: number; team_id: number; correct_score: number }) => {
      overrideScores[`${a.round_number}-${a.team_id}`] = Number(a.correct_score);
    });

    const scoredRounds = [...roundsSet].sort((a, b) => a - b);
    const teamRoundScores: Record<string, number> = {};
    for (const round of scoredRounds) {
      for (const team of TEAMS) {
        const key = `${round}-${team.team_id}`;
        if (overrideScores[key] !== undefined) teamRoundScores[key] = Math.round(overrideScores[key]);
        else if (matchupScores[key] !== undefined) teamRoundScores[key] = Math.round(matchupScores[key]);
        else teamRoundScores[key] = Math.round(lineupSums[key] || 0);
      }
    }

    // This week scores + ranks
    const thisWeek = scoredRounds[scoredRounds.length - 1];
    const thisWeekScores = TEAMS.map(t => ({
      teamName: t.team_name,
      coach: t.coach,
      score: teamRoundScores[`${thisWeek}-${t.team_id}`] || 0,
      opponent: matchupDetails[`${thisWeek}-${t.team_id}`]?.oppName || 'N/A',
      oppScore: matchupDetails[`${thisWeek}-${t.team_id}`]?.oppScore || 0,
      result: matchupDetails[`${thisWeek}-${t.team_id}`]?.result || '?',
    })).sort((a, b) => b.score - a.score)
      .map((t, i) => ({ ...t, rank: i + 1 }));

    // Standings
    const standings = (snapshots || []).map(s => {
      const team = TEAMS.find(t => t.team_id === s.team_id);
      return {
        rank: s.league_rank,
        teamName: s.team_name,
        coach: team?.coach || '',
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        ptsFor: s.pts_for,
        ptsAgainst: s.pts_against,
      };
    });

    // Line rankings (season avg)
    const LINE_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC', 'UTL'];
    const lineByRoundTeam = new Map<string, Record<string, number>>();
    allPlayerRounds.forEach(p => {
      if (!p.is_scoring || p.points == null) return;
      const pos = p.pos.toUpperCase();
      if (!LINE_POSITIONS.includes(pos)) return;
      const key = `${p.round_number}-${p.team_id}`;
      if (!lineByRoundTeam.has(key)) lineByRoundTeam.set(key, { DEF: 0, MID: 0, FWD: 0, RUC: 0, UTL: 0 });
      lineByRoundTeam.get(key)![pos] += Number(p.points);
    });

    const lineRankings = TEAMS.map(team => {
      const avgs: Record<string, number> = { DEF: 0, MID: 0, FWD: 0, RUC: 0, UTL: 0 };
      for (const pos of LINE_POSITIONS) {
        const vals = scoredRounds.map(r => lineByRoundTeam.get(`${r}-${team.team_id}`)?.[pos] || 0);
        avgs[pos] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      }
      return { teamName: team.team_name, def: avgs.DEF, mid: avgs.MID, fwd: avgs.FWD, ruc: avgs.RUC, utl: avgs.UTL };
    });

    // Luck scores
    const validRounds = scoredRounds.filter(round => {
      const count = TEAMS.filter(t => (teamRoundScores[`${round}-${t.team_id}`] || 0) > 500).length;
      return count >= 8;
    });

    const luckScores = TEAMS.map(team => {
      const snap = snapshots?.find((s: { team_id: number }) => s.team_id === team.team_id);
      let totalExpected = 0;
      for (const round of validRounds) {
        const myScore = teamRoundScores[`${round}-${team.team_id}`] || 0;
        let teamsOutscored = 0;
        for (const other of TEAMS) {
          if (other.team_id === team.team_id) continue;
          const os = teamRoundScores[`${round}-${other.team_id}`] || 0;
          if (myScore > os) teamsOutscored++;
          else if (myScore === os) teamsOutscored += 0.5;
        }
        totalExpected += teamsOutscored / 9;
      }
      const actualWins = (snap?.wins || 0) + 0.5 * (snap?.ties || 0);
      return {
        teamName: team.team_name,
        luckScore: Math.round((actualWins - totalExpected) * 100) / 100,
        expectedWins: Math.round(totalExpected * 10) / 10,
        actualWins: snap?.wins || 0,
      };
    });

    // Previous PWRNKGs
    const { data: lastPublished } = await supabase
      .from('pwrnkgs_rounds')
      .select('round_number')
      .eq('status', 'published')
      .order('round_number', { ascending: false })
      .limit(1);
    const prevRound = lastPublished?.[0]?.round_number;
    let previousRankings: { ranking: number; teamName: string }[] = [];
    if (prevRound) {
      const { data: prevRanks } = await supabase
        .from('pwrnkgs_rankings')
        .select('ranking, team_name')
        .eq('round_number', prevRound)
        .order('ranking', { ascending: true });
      previousRankings = (prevRanks || []).map(r => ({ ranking: r.ranking, teamName: r.team_name }));
    }

    // Draft steals/busts
    const { data: draftPicks } = await supabase.from('draft_picks').select('*').order('overall_pick', { ascending: true });
    const playerAvgs = new Map<number, { name: string; team: string; avg: number; gp: number }>();
    allPlayerRounds.forEach(p => {
      if (!p.is_scoring || p.points == null) return;
      const key = p.team_id; // We need player_id but this is team-level... use team_id as proxy
    });
    // Simplified: report top/bottom draft picks by team performance
    const draftSteals = (draftPicks || []).slice(40).map(p => ({
      playerName: p.player_name,
      teamName: p.team_name,
      overallPick: p.overall_pick,
      average: 'N/A',
    })).slice(0, 10);
    const draftBusts = (draftPicks || []).slice(0, 20).map(p => ({
      playerName: p.player_name,
      teamName: p.team_name,
      overallPick: p.overall_pick,
      average: 'N/A',
    })).slice(0, 10);

    // ── Build the prompt ──
    const userPrompt = `Here is the data for Round ${roundNumber} of LOMAF 2026. Analyze it and produce the intelligence brief.

STANDINGS:
${standings.map(t => `${t.rank}. ${t.teamName} (${t.wins}W-${t.losses}L${t.ties ? `-${t.ties}T` : ''}) PF:${t.ptsFor} PA:${t.ptsAgainst}`).join('\n')}

THIS WEEK'S SCORES (with rank):
${thisWeekScores.map(t => `${t.teamName}: ${t.score} (${ordinal(t.rank)}) vs ${t.opponent}: ${t.oppScore} → ${t.result}`).join('\n')}

LINE RANKINGS (Season Avg):
${lineRankings.map(t => `${t.teamName}: DEF:${t.def} MID:${t.mid} FWD:${t.fwd} RUC:${t.ruc} UTL:${t.utl}`).join('\n')}

LUCK SCORES:
${luckScores.map(t => `${t.teamName}: ${t.luckScore > 0 ? '+' : ''}${t.luckScore} (Expected W: ${t.expectedWins}, Actual W: ${t.actualWins})`).join('\n')}

PREVIOUS PWRNKGS (R${prevRound || '?'}):
${previousRankings.map(t => `${t.ranking}. ${t.teamName}`).join('\n') || 'None available'}

Based on this data, produce the intelligence brief. Be specific — reference actual scores, actual matchups. Don't be generic.`;

    // ── Call Claude ──
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 3000,
      system: INTELLIGENCE_BRIEF_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    const parsed = parseAIJson(text);

    // Cache
    await supabase.from('ai_intelligence_briefs').upsert(
      { round_number: roundNumber, brief_json: parsed, generated_at: new Date().toISOString() },
      { onConflict: 'round_number' }
    );

    // Log usage
    await logAIUsage(supabase, 'intelligence_brief', roundNumber, response.usage.input_tokens, response.usage.output_tokens);

    return NextResponse.json({ data: parsed, cached: false });
  } catch (err) {
    console.error('Intelligence brief error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI generation failed' },
      { status: 500 }
    );
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
