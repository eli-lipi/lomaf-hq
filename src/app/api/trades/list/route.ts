import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadTradesList } from '@/lib/trades/load-list';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    const data = await loadTradesList(supabase);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[trades/list]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'List failed' },
      { status: 500 }
    );
  }
}
