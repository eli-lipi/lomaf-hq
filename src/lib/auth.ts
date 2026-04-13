import { cookies } from 'next/headers';
import { createSupabaseServerClient } from './supabase-server';

export type UserRole = 'admin' | 'coach';

export const VIEW_AS_COOKIE = 'lomaf_view_as';

export interface AppUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;           // EFFECTIVE role — may be downgraded for "View as Member"
  real_role: UserRole;      // ACTUAL role from DB (used for security checks and UI toggles)
  team_id: number | null;
  team_name: string | null;
  avatar_url: string | null;
}

/**
 * Fetches the current signed-in user's row from the `users` table.
 * Returns null if not signed in or if their email isn't on the allow-list.
 * Honors the "View as Member" cookie: if a real admin has opted into member
 * view, their effective `role` is downgraded to 'coach' (but `real_role`
 * remains 'admin' so the UI can render the toggle to exit).
 * Server-side only (uses cookies).
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser?.email) return null;

  const { data: appUser } = await supabase
    .from('users')
    .select('id, email, display_name, role, team_id, team_name, avatar_url')
    .eq('email', authUser.email.toLowerCase())
    .single();

  if (!appUser) return null;

  const cookieStore = await cookies();
  const viewAs = cookieStore.get(VIEW_AS_COOKIE)?.value;
  const realRole = appUser.role as UserRole;
  const effectiveRole: UserRole =
    realRole === 'admin' && viewAs === 'coach' ? 'coach' : realRole;

  return {
    id: appUser.id,
    email: appUser.email,
    display_name: appUser.display_name,
    role: effectiveRole,
    real_role: realRole,
    team_id: appUser.team_id,
    team_name: appUser.team_name,
    avatar_url: appUser.avatar_url,
  };
}

export function isAdmin(user: AppUser | null): boolean {
  return user?.role === 'admin';
}

/** For security-critical checks that must ignore "View as Member". */
export function isRealAdmin(user: AppUser | null): boolean {
  return user?.real_role === 'admin';
}
