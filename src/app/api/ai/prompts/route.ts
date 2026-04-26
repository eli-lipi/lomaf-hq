import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PROMPT_DEFAULTS, PROMPT_LABELS, type EditablePromptKey } from '@/lib/ai';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const KEYS: EditablePromptKey[] = ['intelligence_brief', 'chart_insights'];

// GET all editable prompts, merged with defaults so the UI always has a full pair per key.
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('ai_system_prompts')
      .select('prompt_key, prompt_text, updated_at, updated_by');
    if (error) throw error;

    const byKey = new Map<string, { prompt_text: string; updated_at: string | null; updated_by: string | null }>();
    (data || []).forEach(row => {
      byKey.set(row.prompt_key, {
        prompt_text: row.prompt_text,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
      });
    });

    const prompts = KEYS.map(key => {
      const row = byKey.get(key);
      const defaultText = PROMPT_DEFAULTS[key];
      const currentText = row?.prompt_text?.trim() ? row.prompt_text : defaultText;
      return {
        key,
        title: PROMPT_LABELS[key].title,
        description: PROMPT_LABELS[key].description,
        text: currentText,
        default_text: defaultText,
        is_custom: !!row && row.prompt_text?.trim() && row.prompt_text !== defaultText,
        updated_at: row?.updated_at || null,
        updated_by: row?.updated_by || null,
      };
    });

    return NextResponse.json({ prompts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load prompts' },
      { status: 500 }
    );
  }
}

// POST: upsert a single prompt by key.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, text, updated_by } = body as { key?: string; text?: string; updated_by?: string };

    if (!key || !KEYS.includes(key as EditablePromptKey)) {
      return NextResponse.json({ error: 'Invalid prompt key' }, { status: 400 });
    }
    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Prompt text cannot be empty' }, { status: 400 });
    }

    const { error } = await supabase
      .from('ai_system_prompts')
      .upsert(
        {
          prompt_key: key,
          prompt_text: text,
          updated_at: new Date().toISOString(),
          updated_by: updated_by || null,
        },
        { onConflict: 'prompt_key' }
      );

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save prompt' },
      { status: 500 }
    );
  }
}
