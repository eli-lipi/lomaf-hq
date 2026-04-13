// Backwards-compat export: existing client components import `supabase` from here.
// New code should prefer `createSupabaseBrowserClient()` from './supabase-browser'
// (which is auth-aware and keeps the session cookie in sync with the browser).
import { createSupabaseBrowserClient } from './supabase-browser';

export const supabase = createSupabaseBrowserClient();
