import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

const BUCKET = 'trade-screenshots';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/);
    const ext = (extMatch?.[1] ?? 'png').toLowerCase();
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const arrayBuf = await file.arrayBuffer();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(key, arrayBuf, { contentType: file.type || `image/${ext}`, upsert: false });
    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
    return NextResponse.json({ url: data.publicUrl, key });
  } catch (err) {
    console.error('[trades/upload-screenshot]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
