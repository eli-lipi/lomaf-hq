import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getCurrentUser, isAdmin } from '@/lib/auth';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, email, display_name, role, team_id, team_name, avatar_url, created_at, last_login')
    .order('role', { ascending: true })
    .order('display_name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const body = await req.json();
  const { email, display_name, role, team_id, team_name } = body ?? {};

  if (!email || !display_name || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .insert({
      email: email.toLowerCase().trim(),
      display_name: display_name.trim(),
      role,
      team_id: team_id ?? null,
      team_name: team_name ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}

export async function PATCH(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const body = await req.json();
  const { id, email, display_name, role, team_id, team_name } = body ?? {};

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (email !== undefined) updates.email = String(email).toLowerCase().trim();
  if (display_name !== undefined) updates.display_name = String(display_name).trim();
  if (role !== undefined) updates.role = role;
  if (team_id !== undefined) updates.team_id = team_id;
  if (team_name !== undefined) updates.team_name = team_name;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}

export async function DELETE(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('users').delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
