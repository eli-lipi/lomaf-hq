'use client';

import { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import type { UsageResponse, UsageRow } from '@/app/api/usage/route';

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function formatCost(usd: number): string {
  if (usd === 0) return '—';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export default function UsageTab() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/usage')
      .then(r => {
        if (!r.ok) throw new Error(r.status === 403 ? 'Admin access required' : 'Failed to load usage');
        return r.json();
      })
      .then((d: UsageResponse) => setData(d))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground py-8">Loading usage data…</p>;
  if (error) return <p className="text-sm text-red-600 py-8">{error}</p>;
  if (!data) return null;

  // Sort by activity desc, then last login desc
  const sorted: UsageRow[] = [...data.rows].sort((a, b) => {
    if (b.minutes_total !== a.minutes_total) return b.minutes_total - a.minutes_total;
    const al = a.last_login ? new Date(a.last_login).getTime() : 0;
    const bl = b.last_login ? new Date(b.last_login).getTime() : 0;
    return bl - al;
  });

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Usage</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Last login, time spent on the platform, and AI cost per coach. Activity is counted in 1-minute increments while a tab is visible.
      </p>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Total AI cost" value={formatCost(data.totals.ai_cost)} />
        <Stat label="Total AI calls" value={String(data.totals.ai_calls)} />
        <Stat label="Unattributed cost" value={formatCost(data.totals.ai_unattributed_cost)}
          hint="AI calls logged before user attribution shipped, or made by background jobs." />
        <Stat label="Unattributed calls" value={String(data.totals.ai_unattributed_calls)} />
      </div>

      {/* Per-user table */}
      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Coach</th>
                <th className="text-left font-medium px-4 py-2.5">Last login</th>
                <th className="text-right font-medium px-4 py-2.5">Active (30d)</th>
                <th className="text-right font-medium px-4 py-2.5">Active (all-time)</th>
                <th className="text-right font-medium px-4 py-2.5">AI calls</th>
                <th className="text-right font-medium px-4 py-2.5">AI cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map(r => (
                <tr key={r.user_id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                        {r.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.avatar_url} alt={r.display_name} className="w-full h-full object-cover" />
                        ) : (
                          <User size={14} className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.display_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.team_name || (r.role === 'admin' ? 'Admin' : '—')}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{formatRelative(r.last_login)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMinutes(r.minutes_30d)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMinutes(r.minutes_total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.ai_calls || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCost(r.ai_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-sm">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground" title={hint}>{label}</p>
      <p className="text-xl font-semibold mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}
