import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentUser, isRealAdmin, VIEW_AS_COOKIE } from '@/lib/auth';

/**
 * Toggle "View as Member" mode for admins.
 * POST body: { mode: 'coach' } to enter member view, { mode: 'admin' } to exit.
 * Only real admins can use this endpoint.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode;

  const cookieStore = await cookies();
  if (mode === 'coach') {
    cookieStore.set(VIEW_AS_COOKIE, 'coach', {
      path: '/',
      httpOnly: false, // readable by client so UI can show banner instantly
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 hours
    });
  } else {
    cookieStore.delete(VIEW_AS_COOKIE);
  }

  return NextResponse.json({ ok: true, mode: mode === 'coach' ? 'coach' : 'admin' });
}
