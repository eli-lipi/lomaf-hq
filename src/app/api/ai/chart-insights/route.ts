import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAnthropicClient, AI_MODEL, parseAIJson, logAIUsage, getSystemPrompt } from '@/lib/ai';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roundNumber = parseInt(searchParams.get('round') || '0', 10);
  const sectionKey = searchParams.get('section') || '';

  if (!sectionKey) {
    return NextResponse.json({ error: 'Missing section' }, { status: 400 });
  }

  const { data: cached } = await supabase
    .from('ai_chart_insights')
    .select('insights, generated_at')
    .eq('round_number', roundNumber)
    .eq('section_key', sectionKey)
    .single();

  if (cached) {
    return NextResponse.json({ insights: cached.insights, generated_at: cached.generated_at, cached: true });
  }

  return NextResponse.json({ insights: null, cached: false });
}

export async function POST(request: Request) {
  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  const { roundNumber, sectionKey, sectionData, sectionName } = await request.json();
  if (!roundNumber || !sectionKey || !sectionData) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const systemPrompt = await getSystemPrompt(supabase, 'chart_insights');
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Here is the ${sectionName || sectionKey} data for LOMAF after Round ${roundNumber}:\n\n${typeof sectionData === 'string' ? sectionData : JSON.stringify(sectionData, null, 2)}\n\nGive me 2-3 insights.`,
      }],
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    const insights = parseAIJson<string[]>(text);

    // Cache
    await supabase.from('ai_chart_insights').upsert(
      { round_number: roundNumber, section_key: sectionKey, insights, generated_at: new Date().toISOString() },
      { onConflict: 'round_number,section_key' }
    );

    await logAIUsage(supabase, 'chart_insights', roundNumber, response.usage.input_tokens, response.usage.output_tokens);

    return NextResponse.json({ insights, cached: false });
  } catch (err) {
    console.error('Chart insights error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI generation failed' },
      { status: 500 }
    );
  }
}
