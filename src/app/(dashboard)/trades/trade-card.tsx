'use client';

import { TEAMS } from '@/lib/constants';
import {
  snap5,
  buildDisplayLabels,
  colorForTeam,
  probabilityFromAdvantage,
} from '@/lib/trades/scale';
import { getTradeColorPair, getCoachByTeam, getTeamColor } from '@/lib/team-colors';
import { cleanPositionDisplay } from '@/lib/trades/positions';
import type { Trade, TradePlayer, TradeProbability } from '@/lib/trades/types';

// Shared dark-theme tokens (kept in sync with trade-detail.tsx)
const SURFACE = 'rgba(255,255,255,0.03)';
const SURFACE_HOVER = 'rgba(255,255,255,0.05)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#FFFFFF';
const TEXT_BODY = '#9AA3B5';
const TEXT_MUTED = '#6B7589';

// List-view API adds these computed fields onto each trade player.
type ListPlayer = TradePlayer & {
  draft_position?: string | null;
  injured?: boolean;
};

interface Props {
  trade: Trade;
  players: ListPlayer[];
  latestProbability?: TradeProbability | null;
  probabilityHistory?: TradeProbability[];
  /** Whether the current viewer is admin — gates v11 backfill nags. */
  isAdmin?: boolean;
  onViewDetails: () => void;
}

function coachFor(teamId: number): string {
  return TEAMS.find((t) => t.team_id === teamId)?.coach ?? '';
}

/** Short verdict label for the homepage card, on the v8 0..100 prob scale. */
function shortVerdict(probability: number): string {
  // Probability of the LEADING coach is always >= 50.
  const leader = probability >= 50 ? probability : 100 - probability;
  if (leader <= 50) return 'COIN FLIP';
  if (leader <= 65) return 'SLIGHT EDGE';
  if (leader <= 80) return 'EDGE';
  if (leader <= 95) return 'BIG EDGE';
  return 'ROBBERY';
}

export default function TradeCard({
  trade,
  players,
  latestProbability,
  probabilityHistory,
  isAdmin = false,
  onViewDetails,
}: Props) {
  const teamAPlayers = players.filter((p) => p.receiving_team_id === trade.team_a_id);
  const teamBPlayers = players.filter((p) => p.receiving_team_id === trade.team_b_id);

  // v11 backfill nag: trade hasn't had expected tiers set on any player.
  // Only surfaced to admins — coaches don't need to see incomplete data
  // markers. Pure visual cue ("v2"), no click action — the action lives
  // inside the trade detail page banner per v11 addendum §3.2.
  const needsTierBackfill =
    isAdmin && players.length > 0 && players.every((p) => !p.expected_tier);

  // Per-trade colours — green for positive side, cyan for negative
  const colorA = colorForTeam(trade.team_a_id, trade.positive_team_id);
  const colorB = colorForTeam(trade.team_b_id, trade.positive_team_id);

  // Per-trade colour pair (positive team, negative team) used for sparkline
  // gradient — green-above / cyan-below logic from v3 is now per-team.
  const pair = getTradeColorPair(trade.positive_team_id, trade.negative_team_id);

  const labels = buildDisplayLabels(
    players.map((p) => ({ player_id: p.player_id, player_name: p.player_name }))
  );

  // Polarity-aware advantage on the ±100 scale. Falls back to deriving from
  // team_a_probability for legacy rows.
  const positiveIsA = trade.positive_team_id == null
    ? true
    : trade.positive_team_id === trade.team_a_id;
  const advantage: number | null = (() => {
    if (latestProbability?.advantage != null) return snap5(Number(latestProbability.advantage));
    if (latestProbability == null) return null;
    const aEdge = (snap5(Number(latestProbability.team_a_probability)) - 50) * 2;
    return positiveIsA ? aEdge : -aEdge;
  })();
  const showProb =
    advantage != null &&
    latestProbability != null &&
    latestProbability.round_number > trade.round_executed;

  const positiveTeamName = positiveIsA ? trade.team_a_name : trade.team_b_name;
  const negativeTeamName = positiveIsA ? trade.team_b_name : trade.team_a_name;

  // Sparkline points: probability over time on the 0..100 scale (anchored
  // at 50 = wash). Kept on the home card; the two-coach stack underneath
  // collapses in v11.4 to a single subtle 'chance of winning' label.
  const sortedHistory = [...(probabilityHistory ?? [])].sort(
    (a, b) => a.round_number - b.round_number
  );
  const sparkPoints: { x: number; y: number }[] = [];
  sparkPoints.push({ x: trade.round_executed, y: 50 });
  for (const p of sortedHistory) {
    if (p.round_number === trade.round_executed) continue;
    let adv: number;
    if (p.advantage != null) adv = snap5(Number(p.advantage));
    else {
      const aEdge = (snap5(Number(p.team_a_probability)) - 50) * 2;
      adv = positiveIsA ? aEdge : -aEdge;
    }
    sparkPoints.push({ x: p.round_number, y: probabilityFromAdvantage(adv) });
  }
  void negativeTeamName;

  const coachA = coachFor(trade.team_a_id);
  const coachB = coachFor(trade.team_b_id);

  return (
    <button
      onClick={onViewDetails}
      className="text-left w-full rounded-xl px-5 py-4 transition-all"
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = SURFACE_HOVER;
        e.currentTarget.style.borderColor = 'rgba(163,255,18,0.30)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = SURFACE;
        e.currentTarget.style.borderColor = BORDER;
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
        {/* LEFT — surname-first headline */}
        <div className="min-w-0">
          <CardPlayerHeadline
            teamAPlayers={teamAPlayers}
            teamBPlayers={teamBPlayers}
            colorA={colorA}
            colorB={colorB}
            labels={labels}
          />
          <p className="text-[11px] mt-3 uppercase tracking-[0.10em] flex items-center gap-2 flex-wrap" style={{ color: TEXT_MUTED }}>
            <span>R{trade.round_executed}</span>
            {coachA && coachB && (
              <>
                <span className="normal-case" style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
                <span className="normal-case">{coachA} vs {coachB}</span>
              </>
            )}
            {needsTierBackfill && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded normal-case tracking-normal"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  color: TEXT_MUTED,
                  border: `1px solid rgba(255,255,255,0.10)`,
                }}
                title="Expected tiers not set — using v2 fallback. Open the trade and click Edit to add."
              >
                v2 fallback
              </span>
            )}
          </p>
        </div>

        {/* RIGHT — sparkline + single subtle 'chance of winning' label.
            v11.4: replaces the two-coach stack. Mirrors the detail page's
            endpoint label, just smaller and without the dominant team-name
            highlight. The card remains a glance-read; the deep view lives
            on the trade detail page. */}
        {showProb && advantage != null ? (
          (() => {
            const probability = probabilityFromAdvantage(advantage);
            const isEven = probability === 50;
            const positiveLeading = probability >= 50;
            const leaderPct = positiveLeading ? probability : 100 - probability;
            // v12 — colour the leader by the leading TEAM's actual palette
            // colour (not by positive/negative slot). Legacy trades without
            // a stored polarity were falling back to abstract orange/blue,
            // which made the leader's accent unrecognisable.
            const leaderTeamId = positiveLeading
              ? (positiveIsA ? trade.team_a_id : trade.team_b_id)
              : (positiveIsA ? trade.team_b_id : trade.team_a_id);
            const leaderTeamName = positiveLeading
              ? (positiveIsA ? trade.team_a_name : trade.team_b_name)
              : (positiveIsA ? trade.team_b_name : trade.team_a_name);
            const leaderColor = getTeamColor(leaderTeamId);
            return (
              <div className="flex flex-col items-end gap-2 shrink-0 min-w-[200px] max-w-[260px]">
                <Sparkline
                  points={sparkPoints}
                  colorPositive={pair.positive}
                  colorNegative={pair.negative}
                />
                <div className="text-right">
                  {isEven ? (
                    <>
                      <span
                        className="text-[20px] font-bold tabular-nums leading-none"
                        style={{ color: TEXT }}
                      >
                        50/50
                      </span>
                      <p className="text-[11px] mt-1 leading-snug" style={{ color: TEXT_BODY }}>
                        Too close to call — neither side ahead yet.
                      </p>
                    </>
                  ) : (
                    <>
                      <span
                        className="text-[20px] font-bold tabular-nums leading-none"
                        style={{ color: leaderColor }}
                      >
                        {leaderPct}%
                      </span>
                      <p className="text-[11px] mt-1 leading-snug" style={{ color: TEXT_BODY }}>
                        chance of{' '}
                        <span style={{ color: leaderColor, fontWeight: 600 }}>
                          {leaderTeamName}
                        </span>{' '}
                        winning the trade.
                      </p>
                    </>
                  )}
                </div>
              </div>
            );
          })()
        ) : (
          <div className="text-[10px] italic shrink-0" style={{ color: TEXT_MUTED }}>
            tracking…
          </div>
        )}
      </div>
    </button>
  );
}

/** Surname-first card headline. 1-for-1 → side-by-side; multi-player → stacked rows. */
function CardPlayerHeadline({
  teamAPlayers,
  teamBPlayers,
  colorA,
  colorB,
  labels,
}: {
  teamAPlayers: ListPlayer[];
  teamBPlayers: ListPlayer[];
  colorA: string;
  colorB: string;
  labels: Map<number, string>;
}) {
  const isOneForOne = teamAPlayers.length === 1 && teamBPlayers.length === 1;
  if (isOneForOne) {
    return (
      <div className="flex items-baseline gap-3 flex-wrap">
        <CardSinglePlayer player={teamAPlayers[0]} color={colorA} labels={labels} />
        <span className="text-[18px] font-light" style={{ color: 'rgba(255,255,255,0.45)' }}>⇄</span>
        <CardSinglePlayer player={teamBPlayers[0]} color={colorB} labels={labels} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <CardPlayerRow players={teamAPlayers} color={colorA} labels={labels} />
      <span className="text-[14px] font-light" style={{ color: 'rgba(255,255,255,0.45)' }}>⇅</span>
      <CardPlayerRow players={teamBPlayers} color={colorB} labels={labels} />
    </div>
  );
}

function CardSinglePlayer({
  player,
  color,
  labels,
}: {
  player: ListPlayer;
  color: string;
  labels: Map<number, string>;
}) {
  const label = labels.get(player.player_id) ?? player.player_name;
  const pos = cleanPositionDisplay(player.draft_position) ?? cleanPositionDisplay(player.raw_position);
  return (
    <div className="flex flex-col items-start">
      <span className="text-[22px] md:text-[24px] font-medium leading-none" style={{ color }}>
        {label}
      </span>
      {pos && (
        <span className="text-[10px] uppercase tracking-[0.15em] mt-1" style={{ color: TEXT_MUTED }}>
          {pos}
        </span>
      )}
    </div>
  );
}

function CardPlayerRow({
  players,
  color,
  labels,
}: {
  players: ListPlayer[];
  color: string;
  labels: Map<number, string>;
}) {
  return (
    <span className="text-[16px] md:text-[18px] font-medium leading-tight">
      {players.map((p, i) => {
        const label = labels.get(p.player_id) ?? p.player_name;
        const pos = cleanPositionDisplay(p.draft_position) ?? cleanPositionDisplay(p.raw_position);
        return (
          <span key={p.id}>
            <span style={{ color }}>{label}</span>
            {pos && (
              <span className="text-[10px] ml-1 uppercase" style={{ color: TEXT_MUTED }}>
                ({pos})
              </span>
            )}
            {i < players.length - 1 && (
              <span style={{ color: 'rgba(255,255,255,0.18)' }}> · </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Compact SVG sparkline — positive team colour above 0, negative below.
 *  Colours are pulled from the trade's two teams so each card carries its
 *  own team identity. */
function Sparkline({
  points,
  colorPositive,
  colorNegative,
}: {
  points: { x: number; y: number }[];
  colorPositive: string;
  colorNegative: string;
}) {
  if (points.length < 2) {
    return <div className="text-[10px] italic" style={{ color: TEXT_MUTED }}>tracking…</div>;
  }

  const width = 110;
  const height = 30;
  const padding = 2;

  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const xRange = Math.max(1, maxX - minX);

  // Y axis fixed −100..+100 to match the detail chart
  // v8 — y axis is now probability 0..100 with 50 as wash baseline.
  const yMin = 0;
  const yMax = 100;
  const yRange = yMax - yMin;

  const toX = (x: number) => padding + ((x - minX) / xRange) * (width - padding * 2);
  const toY = (y: number) => padding + ((yMax - y) / yRange) * (height - padding * 2);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`)
    .join(' ');

  const baselineY = toY(50);
  const last = points[points.length - 1];
  const lastColor = last.y > 50 ? colorPositive : last.y < 50 ? colorNegative : TEXT;
  const gradientId = `spark-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        {/* Vertical gradient — positive team colour above 0, negative below */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorPositive} />
          <stop offset="50%" stopColor={colorPositive} />
          <stop offset="50%" stopColor={colorNegative} />
          <stop offset="100%" stopColor={colorNegative} />
        </linearGradient>
      </defs>
      {/* Faint baseline */}
      {baselineY >= padding && baselineY <= height - padding && (
        <line
          x1={padding}
          x2={width - padding}
          y1={baselineY}
          y2={baselineY}
          stroke="rgba(255,255,255,0.30)"
          strokeWidth={1}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={toX(last.x)} cy={toY(last.y)} r={2.5} fill={lastColor} />
    </svg>
  );
}
