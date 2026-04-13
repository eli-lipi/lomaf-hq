import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const url = new URL(request.url);
  const response = NextResponse.redirect(`${url.origin}/login`, { status: 303 });
  // Clear cached role + view-as cookies.
  response.cookies.delete('lomaf_role');
  response.cookies.delete('lomaf_view_as');
  return response;
}
