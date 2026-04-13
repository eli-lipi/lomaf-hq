import { createSupabaseServerClient } from './supabase-server';

export type UserRole = 'admin' | 'coach';

export interface AppUser {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  team_id: number | null;
  team_name: string | null;
  avatar_url: string | null;
}

/**
 * Fetches the current signed-in user's row from the `users` table.
 * Returns null if not signed in or if their email isn't on the allow-list.
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

  return (appUser as AppUser) ?? null;
}

export function isAdmin(user: AppUser | null): boolean {
  return user?.role === 'admin';
}
