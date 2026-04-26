import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAnthropicClient, AI_MODEL, logAIUsage, COACH_PERSONALITIES } from '@/lib/ai';
import { getCurrentUser } from '@/lib/auth';
import { TEAMS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

export async function POST(request: Request) {
  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  const {
    roundNumber,
    teamId,
    ranking,
    previousRanking,
    sections,
    alreadyWritten,
    scoreThisWeek,
    scoreThisWeekRank,
    seasonTotal,
    seasonTotalRank,
    record,
    ladderPosition,
    luckScore,
    luckRank,
    lineRanks,
  } = await request.json();

  if (!roundNumber || !teamId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const team = TEAMS.find(t => t.team_id === teamId);
  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  try {
    // Fetch example writeups from previous published rounds
    const { data: pastWriteups } = await supabase
      .from('pwrnkgs_rankings')
      .select('writeup, round_number, team_name')
      .neq('writeup', '')
      .order('round_number', { ascending: false })
      .limit(5);

    const exampleWriteups = (pastWriteups || [])
      .filter(w => w.writeup && w.writeup.trim().length > 50)
      .slice(0, 3)
      .map(w => `[R${w.round_number} - ${w.team_name}]\n${w.writeup}`)
      .join('\n\n---\n\n');

    const coachPersonality = COACH_PERSONALITIES[team.coach] || '';
    const movement = previousRanking
      ? ranking < previousRanking ? `UP ${previousRanking - ranking}` : ranking > previousRanking ? `DOWN ${ranking - previousRanking}` : 'UNCHANGED'
      : 'NEW';

    const sectionHeaders = (sections || [])
      .filter((s: { title: string }) => s.title.trim())
      .map((s: { title: string }) => `## ${s.title}`)
      .join('\n');

    const systemPrompt = `You are writing PWRNKGs (Power Rankings) writeups for LOMAF, a fantasy AFL league.

Write in Lipi's voice: punchy, roast-heavy, data-as-ammunition, reference real life. 2-3 short paragraphs plus section headers.

Section structure: ${sectionHeaders || 'Freeform — no required sections'}

${exampleWriteups ? `Here are examples of Lipi's actual writing style:\n---\n${exampleWriteups}\n---\n` : ''}

Write the writeup for the team below. Use the ## section headers if provided. Be specific with stats and player names. Don't be generic. Return ONLY the writeup text (not JSON).`;

    const userPrompt = `Write the PWRNKGs writeup for:

Team: ${team.team_name} (Ranked #${ranking})
Coach: ${team.coach}
${coachPersonality ? `Personality: ${coachPersonality}` : ''}

Data:
- This Week: ${scoreThisWeek || 'N/A'} (${scoreThisWeekRank ? ordinal(scoreThisWeekRank) : 'N/A'})
- Season Total: ${seasonTotal || 'N/A'} (${seasonTotalRank ? ordinal(seasonTotalRank) : 'N/A'})
- Record: ${record?.wins || 0}W-${record?.losses || 0}L${record?.ties ? `-${record.ties}T` : ''}
- Ladder: ${ladderPosition ? ordinal(ladderPosition) : 'N/A'}
- Luck: ${luckScore !== null && luckScore !== undefined ? (luckScore > 0 ? '+' : '') + luckScore : 'N/A'} (${luckRank ? ordinal(luckRank) + ' luckiest' : 'N/A'})
- Lines: DEF ${lineRanks?.def ? ordinal(lineRanks.def) : 'N/A'}, MID ${lineRanks?.mid ? ordinal(lineRanks.mid) : 'N/A'}, FWD ${lineRanks?.fwd ? ordinal(lineRanks.fwd) : 'N/A'}, RUC ${lineRanks?.ruc ? ordinal(lineRanks.ruc) : 'N/A'}, UTL ${lineRanks?.utl ? ordinal(lineRanks.utl) : 'N/A'}
- Previous PWRNKGs: ${previousRanking ? ordinal(previousRanking) : 'N/A'}
- Movement: ${movement}

${alreadyWritten && alreadyWritten.length > 0 ? `Other teams already written (avoid repeating their angles):\n${alreadyWritten.map((t: { teamName: string; writeup: string }) => `${t.teamName}: ${t.writeup.substring(0, 100)}...`).join('\n')}` : ''}`;

    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const writeup = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    const user = await getCurrentUser();
    await logAIUsage(supabase, 'writeup_draft', roundNumber, response.usage.input_tokens, response.usage.output_tokens, user?.id ?? null);

    return NextResponse.json({ writeup: writeup.trim() });
  } catch (err) {
    console.error('Writeup draft error:', err);
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
