import { NextResponse } from 'next/server';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export interface UsageRow {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  team_name: string | null;
  role: string;
  last_login: string | null;
  minutes_30d: number;
  minutes_total: number;
  ai_calls: number;
  ai_cost: number;
}

export interface UsageResponse {
  rows: UsageRow[];
  totals: {
    ai_calls: number;
    ai_cost: number;
    ai_unattributed_calls: number;
    ai_unattributed_cost: number;
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();

  // Users
  const { data: users } = await supabase
    .from('users')
    .select('id, email, display_name, avatar_url, team_name, role, last_login')
    .order('display_name');

  if (!users) {
    return NextResponse.json({ rows: [], totals: { ai_calls: 0, ai_cost: 0, ai_unattributed_calls: 0, ai_unattributed_cost: 0 } });
  }

  // Activity (paginate to be safe)
  const activityRows: { user_id: string; activity_date: string; minutes_active: number }[] = [];
  {
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('user_activity')
        .select('user_id, activity_date, minutes_active')
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      activityRows.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
  }

  // AI usage
  const aiRows: { user_id: string | null; cost_estimate: number | null }[] = [];
  {
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('ai_usage_log')
        .select('user_id, cost_estimate')
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      aiRows.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
  }

  // Aggregate
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const minutes30 = new Map<string, number>();
  const minutesTotal = new Map<string, number>();
  for (const a of activityRows) {
    minutesTotal.set(a.user_id, (minutesTotal.get(a.user_id) ?? 0) + a.minutes_active);
    if (a.activity_date >= cutoff30d) {
      minutes30.set(a.user_id, (minutes30.get(a.user_id) ?? 0) + a.minutes_active);
    }
  }

  const aiCalls = new Map<string, number>();
  const aiCost = new Map<string, number>();
  let totalCalls = 0;
  let totalCost = 0;
  let unattributedCalls = 0;
  let unattributedCost = 0;
  for (const r of aiRows) {
    const cost = Number(r.cost_estimate ?? 0);
    totalCalls += 1;
    totalCost += cost;
    if (r.user_id) {
      aiCalls.set(r.user_id, (aiCalls.get(r.user_id) ?? 0) + 1);
      aiCost.set(r.user_id, (aiCost.get(r.user_id) ?? 0) + cost);
    } else {
      unattributedCalls += 1;
      unattributedCost += cost;
    }
  }

  const rows: UsageRow[] = users.map(u => ({
    user_id: u.id,
    email: u.email,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    team_name: u.team_name,
    role: u.role,
    last_login: u.last_login,
    minutes_30d: minutes30.get(u.id) ?? 0,
    minutes_total: minutesTotal.get(u.id) ?? 0,
    ai_calls: aiCalls.get(u.id) ?? 0,
    ai_cost: Math.round((aiCost.get(u.id) ?? 0) * 10000) / 10000,
  }));

  const response: UsageResponse = {
    rows,
    totals: {
      ai_calls: totalCalls,
      ai_cost: Math.round(totalCost * 10000) / 10000,
      ai_unattributed_calls: unattributedCalls,
      ai_unattributed_cost: Math.round(unattributedCost * 10000) / 10000,
    },
  };

  return NextResponse.json(response);
}
