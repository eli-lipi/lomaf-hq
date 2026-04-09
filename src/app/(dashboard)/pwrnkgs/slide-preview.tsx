'use client';

/**
 * Client-side PWRNKGs slide preview — renders at 540×540 in the browser.
 * Exact design from the approved mockup. Export is 1080×1080 (handled by Satori route).
 *
 * RANK-BASED COLOR SYSTEM:
 *   1st–2nd:  Electric Green  #00FF87
 *   3rd–4th:  Cyan/Ice Blue   #00D4FF
 *   5th–6th:  Amber/Gold      #FFB800
 *   7th–8th:  Burnt Orange     #FF7B3A
 *   9th–10th: Crimson Red      #FF4757
 */

export interface SlidePreviewData {
  ranking: number;
  previousRanking: number | null;
  teamName: string;
  coachName: string;
  coachPhotoUrls: string[]; // 0, 1, or 2 URLs
  scoreThisWeek: number | null;
  scoreThisWeekRank: number | null;
  seasonTotal: number | null;
  seasonTotalRank: number | null;
  record: { wins: number; losses: number; ties: number };
  ladderPosition: number | null;
  luckScore: number | null;
  luckRank: number | null;
  lineRanks: { def: number | null; mid: number | null; fwd: number | null; ruc: number | null; utl: number | null };
  pwrnkgsHistory: { round: string; ranking: number }[];
  writeup: string;
  roundNumber: number;
}

// ── Theme helpers ──

function getRankTheme(ranking: number) {
  if (ranking <= 2) return { primary: '#00FF87', glow: 'rgba(0,255,135,0.12)', subtle: 'rgba(0,255,135,0.06)', border: 'rgba(0,255,135,0.25)', label: 'ELITE' };
  if (ranking <= 4) return { primary: '#00D4FF', glow: 'rgba(0,212,255,0.12)', subtle: 'rgba(0,212,255,0.06)', border: 'rgba(0,212,255,0.25)', label: 'CONTENDER' };
  if (ranking <= 6) return { primary: '#FFB800', glow: 'rgba(255,184,0,0.12)', subtle: 'rgba(255,184,0,0.06)', border: 'rgba(255,184,0,0.25)', label: 'MID-PACK' };
  if (ranking <= 8) return { primary: '#FF7B3A', glow: 'rgba(255,123,58,0.12)', subtle: 'rgba(255,123,58,0.06)', border: 'rgba(255,123,58,0.25)', label: 'DANGER' };
  return { primary: '#FF4757', glow: 'rgba(255,71,87,0.12)', subtle: 'rgba(255,71,87,0.06)', border: 'rgba(255,71,87,0.25)', label: 'BASEMENT' };
}

function getLineRankColor(rank: number | null) {
  if (!rank) return { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', text: '#6B7588' };
  if (rank <= 3) return { bg: 'rgba(0,255,135,0.12)', border: 'rgba(0,255,135,0.45)', text: '#00FF87' };
  if (rank <= 7) return { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', text: '#6B7588' };
  return { bg: 'rgba(255,71,87,0.10)', border: 'rgba(255,71,87,0.35)', text: '#FF6B6B' };
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Sub-components ──

function MovementBadge({ current, previous, previousRound }: { current: number; previous: number | null; previousRound: string | null }) {
  if (previous === null) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <span style={{ color: '#5A6577', fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>NEW</span>
    </div>
  );
  const diff = previous - current;
  let badge;
  if (diff > 0) badge = <span style={{ color: '#00FF87', fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>+{diff}</span>;
  else if (diff < 0) badge = <span style={{ color: '#FF4757', fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{diff}</span>;
  else badge = <span style={{ color: '#3A4A5A', fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      {badge}
      {previousRound && <span style={{ fontSize: 7, color: '#4A5568', fontWeight: 500, fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.3 }}>From {previousRound}</span>}
    </div>
  );
}

function RankPill({ rank }: { rank: number | null }) {
  if (rank === null) return null;
  const c = getLineRankColor(rank);
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: 20, fontWeight: 700, fontSize: 10, padding: '2px 8px',
      fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap',
    }}>
      {ordinal(rank)}
    </span>
  );
}

function LineCircle({ label, rank }: { label: string; rank: number | null }) {
  const c = getLineRankColor(rank);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: '#8892A2', textTransform: 'uppercase' as const }}>{label}</span>
      <div style={{
        width: 38, height: 38, borderRadius: '50%',
        background: c.bg, border: `1.5px solid ${c.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ color: c.text, fontWeight: 800, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
          {rank !== null ? ordinal(rank) : '—'}
        </span>
      </div>
    </div>
  );
}

function Sparkline({ history, width = 190, height = 58, theme }: {
  history: { round: string; ranking: number }[];
  width?: number; height?: number;
  theme: ReturnType<typeof getRankTheme>;
}) {
  if (!history || history.length < 1) return null;
  const padding = { top: 6, bottom: 20, left: 22, right: 10 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const yTicks = [1, 5, 10];

  const points = history.map((pt, i) => ({
    x: padding.left + (history.length === 1 ? w / 2 : (i / (history.length - 1)) * w),
    y: padding.top + ((pt.ranking - 1) / 9) * h,
    round: pt.round,
    ranking: pt.ranking,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const gradientId = `sparkArea-${theme.primary.replace('#', '')}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={theme.primary} stopOpacity={0.12} />
          <stop offset="100%" stopColor={theme.primary} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={padding.left - 2} y1={padding.top} x2={padding.left - 2} y2={padding.top + h} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      {yTicks.map((tick) => {
        const y = padding.top + ((tick - 1) / 9) * h;
        return (
          <g key={tick}>
            <line x1={padding.left - 5} y1={y} x2={padding.left + w} y2={y} stroke="rgba(255,255,255,0.035)" strokeWidth={0.5} strokeDasharray="3,3" />
            <text x={padding.left - 7} y={y + 3} textAnchor="end" fill="#5A6577" fontSize={7} fontFamily="'JetBrains Mono', monospace">{tick}</text>
          </g>
        );
      })}
      {points.length > 1 && (
        <path d={`${pathD} L ${points[points.length - 1].x} ${padding.top + h} L ${points[0].x} ${padding.top + h} Z`} fill={`url(#${gradientId})`} />
      )}
      {points.length > 1 && <path d={pathD} fill="none" stroke={theme.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill="#0B1120" stroke={theme.primary} strokeWidth={2} />
          <text x={p.x} y={height - 4} textAnchor="middle" fill="#5A6577" fontSize={7} fontFamily="'JetBrains Mono', monospace">{p.round}</text>
        </g>
      ))}
    </svg>
  );
}

function renderWriteup(text: string) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let bodyBuffer: string[] = [];

  const flushBody = () => {
    if (bodyBuffer.length > 0) {
      elements.push(
        <p key={`body-${elements.length}`} style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12.5, lineHeight: 1.7, margin: '0 0 10px 0', fontFamily: "'DM Sans', sans-serif" }}>
          {bodyBuffer.join(' ')}
        </p>
      );
      bodyBuffer = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushBody();
      elements.push(
        <h3 key={`h-${elements.length}`} style={{
          color: '#B0B8C8', fontSize: 11, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase' as const,
          margin: elements.length === 0 ? '0 0 6px 0' : '22px 0 6px 0',
          fontFamily: "'DM Sans', sans-serif",
          borderLeft: '2px solid rgba(176,184,200,0.25)', paddingLeft: 8,
        }}>
          {line.replace('## ', '')}
        </h3>
      );
    } else if (line.trim() === '') {
      flushBody();
    } else {
      bodyBuffer.push(line);
    }
  }
  flushBody();
  return elements;
}

// ── Main component ──

export default function SlidePreview({ data }: { data: SlidePreviewData }) {
  const d = data;
  const theme = getRankTheme(d.ranking);
  const previousRound = d.pwrnkgsHistory.length >= 2 ? d.pwrnkgsHistory[d.pwrnkgsHistory.length - 2].round : null;
  const coachInitials = d.coachName.split(/[\s&]+/).filter(Boolean).map(n => n[0]).join('').slice(0, 2);

  return (
    <div style={{
      width: 540, height: 540, background: '#0B1120', position: 'relative', overflow: 'hidden',
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", display: 'flex', flexDirection: 'column',
    }}>
      {/* Ambient glow */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 10% 35%, ${theme.glow} 0%, transparent 50%)`, pointerEvents: 'none' }} />

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 20px 0', position: 'relative', zIndex: 1, flexShrink: 0 }}>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 3, color: '#3A4A5A' }}>R{d.roundNumber} PWRNKGS</span>
      </div>

      <div style={{ display: 'flex', flex: 1, padding: '8px 20px 0', position: 'relative', zIndex: 1, minHeight: 0 }}>
        {/* LEFT PANEL (40%) */}
        <div style={{ width: '40%', display: 'flex', flexDirection: 'column', paddingRight: 16 }}>
          {/* Rank + movement */}
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <span style={{
              fontSize: 84, fontWeight: 900, lineHeight: 0.85, color: theme.primary,
              fontFamily: "'JetBrains Mono', monospace",
              textShadow: `0 0 80px ${theme.glow}`,
            }}>
              {d.ranking}
            </span>
            <div style={{ marginBottom: 4 }}>
              <MovementBadge current={d.ranking} previous={d.previousRanking} previousRound={previousRound} />
            </div>
          </div>

          {/* Stat rows */}
          <div style={{
            background: 'rgba(255,255,255,0.025)', borderRadius: 12, padding: '10px 12px',
            border: '1px solid rgba(255,255,255,0.05)', marginBottom: 10,
            display: 'flex', flexDirection: 'column', gap: 9,
          }}>
            {[
              { label: 'THIS WEEK', value: d.scoreThisWeek !== null ? d.scoreThisWeek.toLocaleString() : '—', rank: d.scoreThisWeekRank },
              { label: 'SEASON', value: d.seasonTotal !== null ? d.seasonTotal.toLocaleString() : '—', rank: d.seasonTotalRank },
              { label: 'LADDER', value: `${d.record.wins}W-${d.record.losses}L${d.record.ties ? `-${d.record.ties}T` : ''}`, rank: d.ladderPosition },
              { label: 'LUCK', value: d.luckScore !== null ? (d.luckScore > 0 ? `+${d.luckScore.toFixed(2)}` : d.luckScore.toFixed(2)) : '—', rank: d.luckRank },
            ].map((stat) => (
              <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: '#8892A2', textTransform: 'uppercase' as const, width: 64 }}>{stat.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#D0D5DD', fontFamily: "'JetBrains Mono', monospace", flex: 1, textAlign: 'right' as const, marginRight: 8 }}>{stat.value}</span>
                <RankPill rank={stat.rank} />
              </div>
            ))}
          </div>

          {/* Line circles */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' }}>
            {([
              { label: 'DEF', rank: d.lineRanks.def },
              { label: 'MID', rank: d.lineRanks.mid },
              { label: 'FWD', rank: d.lineRanks.fwd },
              { label: 'RUC', rank: d.lineRanks.ruc },
              { label: 'UTL', rank: d.lineRanks.utl },
            ] as const).map((l) => <LineCircle key={l.label} label={l.label} rank={l.rank} />)}
          </div>

          {/* Sparkline */}
          <div style={{
            background: 'rgba(255,255,255,0.025)', borderRadius: 10, padding: '8px 8px 4px',
            border: '1px solid rgba(255,255,255,0.05)', flex: 1, minHeight: 0,
            display: 'flex', flexDirection: 'column',
          }}>
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 2, color: '#8892A2', textTransform: 'uppercase' as const, marginBottom: 2 }}>PWRNKGS TREND</span>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <Sparkline history={d.pwrnkgsHistory} width={190} height={58} theme={theme} />
            </div>
          </div>
        </div>

        {/* RIGHT PANEL (60%) */}
        <div style={{
          width: '60%', display: 'flex', flexDirection: 'column',
          borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: 16,
        }}>
          {/* Team name + coach + photo */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ flex: 1, paddingTop: 2 }}>
              <h2 style={{ color: '#FFFFFF', fontSize: 19, fontWeight: 800, lineHeight: 1.2, margin: 0, letterSpacing: -0.3 }}>{d.teamName}</h2>
              <p style={{ color: '#5A6577', fontSize: 11.5, margin: '4px 0 0', fontWeight: 500 }}>{d.coachName}</p>
            </div>
            {/* Coach photo */}
            <div style={{
              width: 56, height: 56, borderRadius: '50%', flexShrink: 0, marginLeft: 12,
              overflow: 'hidden',
              background: d.coachPhotoUrls.length > 0 ? 'transparent' : `linear-gradient(135deg, ${theme.subtle}, rgba(0,100,200,0.04))`,
              border: `2px solid ${theme.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, color: theme.primary, opacity: d.coachPhotoUrls.length > 0 ? 1 : 0.7,
              position: 'relative',
            }}>
              {d.coachPhotoUrls.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.coachPhotoUrls[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                coachInitials
              )}
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: `linear-gradient(90deg, ${theme.border}, transparent)`, marginBottom: 14, flexShrink: 0 }} />

          {/* Writeup */}
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
            {renderWriteup(d.writeup)}
          </div>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${theme.primary}, ${theme.subtle}, transparent)`, flexShrink: 0, marginTop: 8 }} />
    </div>
  );
}

// Export theme helpers for use in Rankings Editor
export { getRankTheme };
