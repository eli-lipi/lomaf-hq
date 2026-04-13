import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const origin = url.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Look up allow-list membership by email.
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser?.email) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const email = authUser.email.toLowerCase();
  const { data: appUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (!appUser) {
    // Sign them back out so they don't retain a dangling session.
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_member`);
  }

  // Update last_login + avatar_url from Google profile.
  const avatarUrl =
    (authUser.user_metadata?.avatar_url as string | undefined) ??
    (authUser.user_metadata?.picture as string | undefined) ??
    null;

  await supabase
    .from('users')
    .update({
      last_login: new Date().toISOString(),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    })
    .eq('email', email);

  return NextResponse.redirect(`${origin}/`);
}
