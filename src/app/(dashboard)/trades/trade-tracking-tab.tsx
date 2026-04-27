'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ArrowLeftRight } from 'lucide-react';
import TradeCard from './trade-card';
import TradeDetail from './trade-detail';
import LogTradeModal from './log-trade-modal';
import { TEAMS } from '@/lib/constants';
import { snap5, colorForTeam, probabilityFromAdvantage, COLOR_POSITIVE } from '@/lib/trades/scale';
import { getCoachByTeam } from '@/lib/team-colors';
import type { Trade, TradePlayer, TradeProbability } from '@/lib/trades/types';

// ── Design tokens (kept in sync with detail page + cards) ─────────
const BG = '#0A0F1C';
const SURFACE = 'rgba(255,255,255,0.03)';
const SURFACE_HOVER = 'rgba(255,255,255,0.05)';
const BORDER = 'rgba(255,255,255,0.08)';
const ACCENT = '#A3FF12';
const TEXT = '#FFFFFF';
const TEXT_BODY = '#9AA3B5';
const TEXT_MUTED = '#6B7589';

interface ListItem {
  trade: Trade;
  players: (TradePlayer & { draft_position?: string | null; injured?: boolean })[];
  latestProbability: TradeProbability | null;
  probabilityHistory: TradeProbability[];
}

type SortKey = 'recent' | 'largest' | 'oldest' | 'closest';

// snap5 imported from @/lib/trades/scale (single source of truth).

export default function TradeTrackingTab({ isAdmin = false }: { isAdmin?: boolean }) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('recent');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/trades/list');
    if (res.ok) {
      const json = await res.json();
      setItems(json.trades ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Browser-back integration ─────────────────────────────────────
  // Without this, opening a trade is a pure React state change — no URL
  // update, no history entry. The browser's Back button then jumps the
  // user out of /trades entirely (back to PWRNKGs or wherever). Push a
  // history entry on trade-open and listen for popstate so the in-page
  // 'Back to all trades' UX matches the browser-back UX.
  const openTrade = useCallback((id: string) => {
    setActiveTradeId(id);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('trade', id);
      window.history.pushState({ trade: id }, '', url.toString());
    }
  }, []);

  const closeTrade = useCallback(() => {
    setActiveTradeId(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('trade')) {
        url.searchParams.delete('trade');
        window.history.pushState({ trade: null }, '', url.toString());
      }
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (typeof window === 'undefined') return;
      const tradeId = new URL(window.location.href).searchParams.get('trade');
      setActiveTradeId(tradeId);
    };
    window.addEventListener('popstate', onPop);
    // Sync on first mount in case user landed with ?trade=... in the URL
    onPop();
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    if (sort === 'recent') {
      arr.sort((a, b) => {
        if (b.trade.round_executed !== a.trade.round_executed) {
          return b.trade.round_executed - a.trade.round_executed;
        }
        return new Date(b.trade.created_at).getTime() - new Date(a.trade.created_at).getTime();
      });
    } else if (sort === 'oldest') {
      arr.sort((a, b) => {
        if (a.trade.round_executed !== b.trade.round_executed) {
          return a.trade.round_executed - b.trade.round_executed;
        }
        return new Date(a.trade.created_at).getTime() - new Date(b.trade.created_at).getTime();
      });
    } else if (sort === 'largest') {
      arr.sort((a, b) => b.players.length - a.players.length);
    } else if (sort === 'closest') {
      const dist = (it: ListItem) => {
        const p = it.latestProbability ? snap5(Number(it.latestProbability.team_a_probability)) : 50;
        return Math.abs(p - 50);
      };
      arr.sort((a, b) => dist(a) - dist(b));
    }
    return arr;
  }, [items, sort]);

  if (activeTradeId) {
    return (
      <TradeDetail
        tradeId={activeTradeId}
        isAdmin={isAdmin}
        onBack={() => {
          closeTrade();
          load();
        }}
        onDeleted={() => {
          closeTrade();
          load();
        }}
      />
    );
  }

  return (
    <div
      className="-mx-6 -my-8 px-6 py-8 min-h-screen space-y-5"
      style={{ background: BG, color: TEXT }}
    >
      {/* Action row — Log Trade is admin-only (matches v11 gating on
          Edit/Delete inside trade detail). Coaches in member-view see
          a read-only homepage. */}
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors"
            style={{
              background: 'transparent',
              color: ACCENT,
              border: `1px solid ${ACCENT}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(163,255,18,0.10)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Plus size={16} /> Log Trade
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center" style={{ color: TEXT_MUTED }}>
          Loading trades...
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          onLog={isAdmin ? () => setModalOpen(true) : null}
        />
      ) : (
        <>
          <NarrativeStats items={items} onOpen={openTrade} />
          <TradeMatrix items={items} onOpen={openTrade} />

          {/* Sort pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <SortPill label="Most Recent" active={sort === 'recent'} onClick={() => setSort('recent')} />
            <SortPill label="Closest" active={sort === 'closest'} onClick={() => setSort('closest')} />
            <SortPill label="Largest" active={sort === 'largest'} onClick={() => setSort('largest')} />
            <SortPill label="Oldest" active={sort === 'oldest'} onClick={() => setSort('oldest')} />
          </div>

          {/* Trade list */}
          {sort === 'largest' || sort === 'closest' ? (
            <div className="flex flex-col gap-4">
              {sortedItems.map((item) => (
                <TradeCard
                  key={item.trade.id}
                  trade={item.trade}
                  players={item.players}
                  latestProbability={item.latestProbability}
                  probabilityHistory={item.probabilityHistory}
                  isAdmin={isAdmin}
                  onViewDetails={() => openTrade(item.trade.id)}
                />
              ))}
            </div>
          ) : (
            <GroupedByRound items={sortedItems} onOpen={openTrade} isAdmin={isAdmin} />
          )}
        </>
      )}

      {modalOpen && (
        <LogTradeModal
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Round-grouped list
// ============================================================
function GroupedByRound({
  items,
  onOpen,
  isAdmin,
}: {
  items: ListItem[];
  onOpen: (tradeId: string) => void;
  isAdmin: boolean;
}) {
  const groups = new Map<number, ListItem[]>();
  for (const it of items) {
    const r = it.trade.round_executed;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(it);
  }
  return (
    <div className="flex flex-col gap-2">
      {Array.from(groups.entries()).map(([round, groupItems], idx) => (
        <div key={round} className={idx === 0 ? 'space-y-4' : 'space-y-4 pt-6'}>
          <RoundDivider round={round} />
          <div className="flex flex-col gap-4">
            {groupItems.map((item) => (
              <TradeCard
                key={item.trade.id}
                trade={item.trade}
                players={item.players}
                latestProbability={item.latestProbability}
                probabilityHistory={item.probabilityHistory}
                isAdmin={isAdmin}
                onViewDetails={() => onOpen(item.trade.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoundDivider({ round }: { round: number }) {
  // v3 — quieter than v1. Thin green line at very low opacity, label as a
  // muted-grey plate that breaks the line. Cards are content; dividers are
  // organisation.
  return (
    <div className="relative flex items-center py-1">
      <div className="h-px flex-1" style={{ background: 'rgba(163,255,18,0.15)' }} />
      <span
        className="text-[11px] uppercase px-3 py-0.5 rounded"
        style={{
          color: TEXT_MUTED,
          background: BG,
          letterSpacing: '0.15em',
        }}
      >
        Round {round}
      </span>
      <div className="h-px flex-1" style={{ background: 'rgba(163,255,18,0.15)' }} />
    </div>
  );
}

// ============================================================
// Empty state
// ============================================================
function EmptyState({ onLog }: { onLog: (() => void) | null }) {
  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
    >
      <div
        className="w-12 h-12 mx-auto rounded-lg flex items-center justify-center mb-3"
        style={{ background: 'rgba(163,255,18,0.12)', color: ACCENT }}
      >
        <ArrowLeftRight size={20} />
      </div>
      <h3 className="text-base font-semibold" style={{ color: TEXT }}>
        No trades logged yet
      </h3>
      <p className="text-sm mt-1 mb-4" style={{ color: TEXT_BODY }}>
        {onLog
          ? 'Log a trade and we’ll start tracking the win probability over time.'
          : 'Once trades start landing, they’ll appear here.'}
      </p>
      {onLog && (
        <button
          onClick={onLog}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md"
          style={{
            background: 'transparent',
            color: ACCENT,
            border: `1px solid ${ACCENT}`,
          }}
        >
          <Plus size={16} /> Log your first trade
        </button>
      )}
    </div>
  );
}

// ============================================================
// Narrative stat strip — replaces the boring counts
// ============================================================
function NarrativeStats({
  items,
  onOpen,
}: {
  items: ListItem[];
  onOpen: (tradeId: string) => void;
}) {
  // 1. Total trades
  const total = items.length;

  // 2. Most active trader
  const tradeCountByTeam = new Map<number, number>();
  for (const it of items) {
    tradeCountByTeam.set(it.trade.team_a_id, (tradeCountByTeam.get(it.trade.team_a_id) ?? 0) + 1);
    tradeCountByTeam.set(it.trade.team_b_id, (tradeCountByTeam.get(it.trade.team_b_id) ?? 0) + 1);
  }
  let mostActiveTeamId = 0;
  let mostActiveCount = 0;
  for (const [tid, c] of tradeCountByTeam.entries()) {
    if (c > mostActiveCount) {
      mostActiveCount = c;
      mostActiveTeamId = tid;
    }
  }
  const mostActiveTeam = TEAMS.find((t) => t.team_id === mostActiveTeamId);

  // Helper to convert a TradeProbability row into a signed advantage on the
  // ±100 scale, polarity-aware. Falls back to deriving from team_a_probability
  // for legacy rows.
  const advantageOfRow = (it: ListItem, p: TradeProbability): number => {
    if (p.advantage != null) return snap5(Number(p.advantage));
    const positiveIsA =
      it.trade.positive_team_id == null
        ? true
        : it.trade.positive_team_id === it.trade.team_a_id;
    const aEdge = (snap5(Number(p.team_a_probability)) - 50) * 2;
    return positiveIsA ? aEdge : -aEdge;
  };

  // 3. Most lopsided trade — biggest |advantage| on the new ±100 scale
  const lopsided = items
    .filter((it) => it.latestProbability)
    .map((it) => {
      const adv = advantageOfRow(it, it.latestProbability!);
      const winningTeamId =
        adv >= 0
          ? it.trade.positive_team_id ?? it.trade.team_a_id
          : it.trade.negative_team_id ?? it.trade.team_b_id;
      return { item: it, adv, winningTeamId };
    })
    .sort((a, b) => Math.abs(b.adv) - Math.abs(a.adv))[0];

  // 4. Biggest swing this week — largest signed delta between snapped advantages
  const swings: { item: ListItem; signed: number; winningTeamId: number }[] = [];
  for (const it of items) {
    const sorted = [...it.probabilityHistory].sort((a, b) => a.round_number - b.round_number);
    if (sorted.length < 2) continue;
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const lastAdv = advantageOfRow(it, last);
    const prevAdv = advantageOfRow(it, prev);
    const signed = lastAdv - prevAdv;
    const winningTeamId =
      signed >= 0
        ? it.trade.positive_team_id ?? it.trade.team_a_id
        : it.trade.negative_team_id ?? it.trade.team_b_id;
    swings.push({ item: it, signed, winningTeamId });
  }
  const biggestSwing = swings.sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed))[0];

  // Format helpers — reused for lopsided/swing
  // v6 — always-positive sign convention. The minus sign never reaches the
  // user; the team association underneath the value carries the polarity.
  const formatSignedPct = (n: number) => `${Math.abs(n)}%`;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard label="Total Trades" value={String(total)} />
      <StatCard
        label="Most Active Trader"
        value={mostActiveTeam ? mostActiveTeam.coach : '—'}
        sub={mostActiveTeam ? `${mostActiveTeam.team_name} · ${mostActiveCount} trades` : undefined}
      />
      <StatCard
        label="Most Lopsided Trade"
        // v8 — show as leading coach's probability (0..100 scale).
        value={
          lopsided
            ? `${probabilityFromAdvantage(Math.abs(lopsided.adv))}% ${getCoachByTeam(lopsided.winningTeamId)}`
            : '—'
        }
        valueColor={
          lopsided
            ? colorForTeam(lopsided.winningTeamId, lopsided.item.trade.positive_team_id)
            : undefined
        }
        sub={
          lopsided
            ? `vs ${getCoachByTeam(lopsided.winningTeamId === lopsided.item.trade.team_a_id ? lopsided.item.trade.team_b_id : lopsided.item.trade.team_a_id)} · R${lopsided.item.trade.round_executed}`
            : undefined
        }
        onClick={lopsided ? () => onOpen(lopsided.item.trade.id) : undefined}
        accent={!!lopsided && Math.abs(lopsided.adv) >= 30}
      />
      <StatCard
        label="Biggest Swing This Week"
        // v8 — swing on the probability scale is half the magnitude of the
        // advantage swing (because adv → prob halves the units). Display
        // as ±N pp toward the leading coach.
        value={
          biggestSwing
            ? `${formatSignedPct(biggestSwing.signed / 2)} → ${getCoachByTeam(biggestSwing.winningTeamId)}`
            : '—'
        }
        valueColor={
          biggestSwing
            ? colorForTeam(biggestSwing.winningTeamId, biggestSwing.item.trade.positive_team_id)
            : undefined
        }
        sub={
          biggestSwing
            ? `${biggestSwing.item.trade.team_a_name} ⇄ ${biggestSwing.item.trade.team_b_name}`
            : 'Need 2+ rounds'
        }
        onClick={biggestSwing ? () => onOpen(biggestSwing.item.trade.id) : undefined}
        accent={!!biggestSwing && Math.abs(biggestSwing.signed) >= 5}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  onClick,
  accent,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
  accent?: boolean;
  valueColor?: string;
}) {
  const isClickable = !!onClick;
  const Tag = (isClickable ? 'button' : 'div') as 'button' | 'div';
  return (
    <Tag
      onClick={onClick}
      className="rounded-xl px-4 py-3 text-left w-full transition-colors"
      style={{
        background: SURFACE,
        border: `1px solid ${accent ? 'rgba(163,255,18,0.30)' : BORDER}`,
        cursor: isClickable ? 'pointer' : 'default',
      }}
      onMouseEnter={
        isClickable
          ? (e) => {
              (e.currentTarget as HTMLElement).style.background = SURFACE_HOVER;
            }
          : undefined
      }
      onMouseLeave={
        isClickable
          ? (e) => {
              (e.currentTarget as HTMLElement).style.background = SURFACE;
            }
          : undefined
      }
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: TEXT_MUTED }}>
        {label}
      </p>
      <p
        className="text-xl font-semibold mt-1.5 tabular-nums truncate"
        style={{ color: valueColor ?? (accent ? ACCENT : TEXT) }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[11px] mt-1 truncate" style={{ color: TEXT_BODY }}>
          {sub}
        </p>
      )}
    </Tag>
  );
}

// ============================================================
// Trade matrix — 10×10 heatmap of trade pairs
// ============================================================
function TradeMatrix({
  items,
  onOpen,
}: {
  items: ListItem[];
  onOpen: (tradeId: string) => void;
}) {
  // Pair counts (undirected key) + per-pair trade ids + per-team totals
  const pairCount = new Map<string, number>();
  const pairTrades = new Map<string, string[]>();
  const totalByTeam = new Map<number, number>();
  for (const it of items) {
    const a = it.trade.team_a_id;
    const b = it.trade.team_b_id;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    if (!pairTrades.has(key)) pairTrades.set(key, []);
    pairTrades.get(key)!.push(it.trade.id);
    totalByTeam.set(a, (totalByTeam.get(a) ?? 0) + 1);
    totalByTeam.set(b, (totalByTeam.get(b) ?? 0) + 1);
  }

  let maxCount = 0;
  for (const v of pairCount.values()) if (v > maxCount) maxCount = v;

  // Short team names for axes
  const SHORT: Record<number, string> = {
    3194002: 'Mansion',
    3194005: 'Dragons',
    3194009: 'SEANO',
    3194003: 'LIPI',
    3194006: 'Melech',
    3194010: 'Cripps',
    3194008: 'Country',
    3194001: 'Doge',
    3194004: 'Gun M',
    3194007: 'Warnered',
  };

  /**
   * Single-hue intensity ramp keyed off raw count. Higher count = louder
   * cell. Same hue across the matrix so the eye is drawn to busy pairs
   * regardless of which two teams are involved.
   */
  const cellStyleFor = (count: number): { bg: string; fg: string; border: string } => {
    if (count === 0) {
      return {
        bg: 'rgba(255,255,255,0.02)',
        fg: 'transparent',
        border: 'rgba(255,255,255,0.04)',
      };
    }
    if (count === 1) {
      return {
        bg: 'rgba(163,255,18,0.16)',
        fg: '#A3FF12',
        border: 'rgba(163,255,18,0.30)',
      };
    }
    if (count === 2) {
      return {
        bg: 'rgba(163,255,18,0.32)',
        fg: '#0A0F1C',
        border: 'rgba(163,255,18,0.50)',
      };
    }
    if (count === 3) {
      return {
        bg: 'rgba(255,159,39,0.55)', // amber — pair has been busy
        fg: '#0A0F1C',
        border: 'rgba(255,159,39,0.70)',
      };
    }
    return {
      bg: 'rgba(226,75,74,0.65)', // red — heavy traders
      fg: '#FFFFFF',
      border: 'rgba(226,75,74,0.80)',
    };
  };

  return (
    <div className="rounded-xl p-5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-1" style={{ color: TEXT_MUTED }}>
        Trade Matrix
      </h3>
      <p className="text-xs mb-3" style={{ color: TEXT_BODY }}>
        Who&apos;s trading with whom. Cell colour scales with trade count: 1 muted, 2 brighter, 3 amber, 4+ red.
        Bottom row sums each coach&apos;s total trades.
      </p>
      <div className="overflow-x-auto">
        <table className="text-[11px] border-collapse">
          <thead>
            <tr>
              <th className="py-2 px-2" />
              {TEAMS.map((t) => (
                <th
                  key={t.team_id}
                  className="py-2 px-1 font-medium text-center"
                  style={{ color: TEXT_MUTED, minWidth: 56 }}
                >
                  {SHORT[t.team_id] ?? t.team_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TEAMS.map((rowTeam) => (
              <tr key={rowTeam.team_id}>
                <th
                  className="py-2 pr-3 text-right font-medium whitespace-nowrap"
                  style={{ color: TEXT_BODY }}
                >
                  {SHORT[rowTeam.team_id] ?? rowTeam.team_name}
                </th>
                {TEAMS.map((colTeam) => {
                  const isDiagonal = rowTeam.team_id === colTeam.team_id;
                  if (isDiagonal) {
                    // Greyed self-intersection — coach trading with himself
                    // makes no sense; mark it visually inert.
                    return (
                      <td key={colTeam.team_id} className="px-1 py-1">
                        <div
                          className="rounded text-center"
                          style={{
                            height: 32,
                            background:
                              'repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 4px, transparent 4px 8px)',
                            border: `1px solid rgba(255,255,255,0.04)`,
                          }}
                        />
                      </td>
                    );
                  }
                  const a = rowTeam.team_id;
                  const b = colTeam.team_id;
                  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
                  const count = pairCount.get(key) ?? 0;
                  const tradeIds = pairTrades.get(key) ?? [];
                  const onClick = tradeIds.length > 0 ? () => onOpen(tradeIds[0]) : undefined;
                  const cell = cellStyleFor(count);
                  return (
                    <td key={colTeam.team_id} className="px-1 py-1">
                      <button
                        onClick={onClick}
                        disabled={!onClick}
                        title={
                          count === 0
                            ? 'No trades'
                            : `${rowTeam.team_name} ⇄ ${colTeam.team_name}: ${count} trade${count === 1 ? '' : 's'}`
                        }
                        className="w-full rounded text-center transition-transform"
                        style={{
                          height: 32,
                          background: cell.bg,
                          color: cell.fg,
                          fontWeight: count >= 2 ? 700 : 600,
                          fontSize: 12,
                          cursor: onClick ? 'pointer' : 'default',
                          border: `1px solid ${cell.border}`,
                        }}
                        onMouseEnter={(e) => {
                          if (onClick) (e.currentTarget as HTMLElement).style.transform = 'scale(1.05)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                        }}
                      >
                        {count > 0 ? count : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Per-team totals row at the bottom — sum of trades each team
                has been involved in. Quick read of who's most/least active. */}
            <tr style={{ borderTop: `1px solid ${BORDER}` }}>
              <th
                className="py-2 pr-3 text-right text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                style={{ color: TEXT_MUTED }}
              >
                Total
              </th>
              {TEAMS.map((t) => {
                const total = totalByTeam.get(t.team_id) ?? 0;
                return (
                  <td key={t.team_id} className="px-1 py-2 text-center">
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: total === 0 ? TEXT_MUTED : TEXT }}
                    >
                      {total}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Sort pill — dark ghost, accent on active
// ============================================================
function SortPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  // v3 — consistent fill-based selection. Selected = green-tinted fill,
  // green text, green border. Unselected = transparent w/ faint border.
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-xs font-medium rounded-full transition-colors"
      style={{
        background: active ? 'rgba(163,255,18,0.15)' : 'transparent',
        color: active ? COLOR_POSITIVE : TEXT_MUTED,
        border: `1px solid ${active ? COLOR_POSITIVE : BORDER}`,
      }}
    >
      {label}
    </button>
  );
}
