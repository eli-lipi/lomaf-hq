/**
 * Round badge — server-rendered top bar visible to all signed-in users.
 *
 * Reads round_advances and shows "Round N — Live since {time}". Click
 * routes admins to /round-control, coaches to /pwrnkgs (where the
 * latest published rankings live).
 */

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getCurrentRoundRow } from '@/lib/round';
import { createSupabaseServerClient } from '@/lib/supabase-server';

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function RoundBadge({ isAdmin }: { isAdmin: boolean }) {
  const supabase = await createSupabaseServerClient();
  const row = await getCurrentRoundRow(supabase);

  // Pre-season — show a soft state.
  if (!row || row.round_number === 0) {
    return (
      <div
        className="border-b border-border bg-card/60 backdrop-blur-sm"
        style={{ position: 'sticky', top: 0, zIndex: 40 }}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Pre-season — no round live yet</span>
          {isAdmin && (
            <Link href="/round-control" className="text-primary hover:underline inline-flex items-center gap-1">
              Round Control <ChevronRight size={14} />
            </Link>
          )}
        </div>
      </div>
    );
  }

  const dest = isAdmin ? '/round-control' : '/pwrnkgs';
  return (
    <div
      className="border-b border-border bg-card/80 backdrop-blur-sm"
      style={{ position: 'sticky', top: 0, zIndex: 40 }}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold text-xs uppercase tracking-wider">
            Round {row.round_number}
          </span>
          <span className="text-muted-foreground">
            Live since {relativeTime(row.advanced_at)}
          </span>
        </span>
        <Link
          href={dest}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          {isAdmin ? 'Round Control' : 'View round'}
          <ChevronRight size={13} />
        </Link>
      </div>
    </div>
  );
}
