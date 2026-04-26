import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseTradeScreenshot } from '@/lib/trades/ai-assessment';
import { getCurrentUser } from '@/lib/auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { image_base64, media_type, current_round } = body as {
      image_base64: string;
      media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
      current_round: number | null;
    };

    if (!image_base64 || !media_type) {
      return NextResponse.json({ error: 'Missing image_base64 or media_type' }, { status: 400 });
    }

    const user = await getCurrentUser();
    const parsed = await parseTradeScreenshot(image_base64, media_type, supabase, current_round ?? null, user?.id ?? null);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[trades/parse-screenshot]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse screenshot' },
      { status: 500 }
    );
  }
}
