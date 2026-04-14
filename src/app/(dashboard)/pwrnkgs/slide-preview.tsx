'use client';

/**
 * Client-side PWRNKGs slide preview — renders at 540×540 in the browser.
 * All sizes are HALF the 1080×1080 export values.
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
  isCoCoached?: boolean;
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

// ── Sub-components (all sizes at 540px = half of 1080px spec) ──

function MovementBadge({ current, previous, previousRound }: { current: number; previous: number | null; previousRound: string | null }) {
  if (previous === null) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
      <span style={{ color: '#5A6577', fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>NEW</span>
    </div>
  );
  const diff = previous - current;
  let badge;
  if (diff > 0) badge = <span style={{ color: '#00FF87', fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>+{diff}</span>;
  else if (diff < 0) badge = <span style={{ color: '#FF4757', fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{diff}</span>;
  else badge = <span style={{ color: '#3A4A5A', fontSize: 14, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
      {badge}
      {previousRound && <span style={{ fontSize: 6.5, color: '#4A5568', fontWeight: 500, fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.3 }}>From {previousRound}</span>}
    </div>
  );
}

function RankPill({ rank }: { rank: number | null }) {
  if (rank === null) return null;
  const c = getLineRankColor(rank);
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: 10, fontWeight: 700, fontSize: 10, padding: '2px 7px',
      fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap',
    }}>
      {ordinal(rank)}
    </span>
  );
}

function LineCircle({ label, rank }: { label: string; rank: number | null }) {
  const c = getLineRankColor(rank);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: 1, color: '#8892A2', textTransform: 'uppercase' as const }}>{label}</span>
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        background: c.bg, border: `1.5px solid ${c.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ color: c.text, fontWeight: 800, fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace" }}>
          {rank !== null ? ordinal(rank) : '—'}
        </span>
      </div>
    </div>
  );
}

function TrendChart({ history, width = 176, height = 65, theme }: {
  history: { round: string; ranking: number }[];
  width?: number; height?: number;
  theme: ReturnType<typeof getRankTheme>;
}) {
  if (!history || history.length < 1) return null;
  const padding = { top: 8, bottom: 16, left: 18, right: 8 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const points = history.map((pt, i) => ({
    x: padding.left + (history.length === 1 ? w / 2 : (i / (history.length - 1)) * w),
    y: padding.top + ((pt.ranking - 1) / 9) * h,
    round: pt.round,
    ranking: pt.ranking,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Midline at position 5.5
  const midY = padding.top + ((5.5 - 1) / 9) * h;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Simple midline divider */}
      <line x1={padding.left} y1={midY} x2={padding.left + w} y2={midY} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} strokeDasharray="2,2" />

      {/* Data line */}
      {points.length > 1 && <path d={pathD} fill="none" stroke={theme.primary} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}

      {/* Data dots + round labels */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4.5} fill="#0B1120" stroke={theme.primary} strokeWidth={1.5} />
          <text x={p.x} y={p.y + 2} textAnchor="middle" fill={theme.primary} fontSize={5.5} fontWeight="bold" fontFamily="'JetBrains Mono', monospace">{p.ranking}</text>
          <text x={p.x} y={height - 3} textAnchor="middle" fill="#5A6577" fontSize={5} fontFamily="'JetBrains Mono', monospace">{p.round}</text>
        </g>
      ))}
    </svg>
  );
}

function renderWriteup(text: string) {
  if (!text) return null;

  const totalChars = text.length;
  let bodySize: number, headerSize: number, lineH: number, headerMargin: number;
  if (totalChars > 1200)     { bodySize = 9.5;  headerSize = 8.5;  lineH = 1.55; headerMargin = 13; }
  else if (totalChars > 900) { bodySize = 10.5; headerSize = 9;    lineH = 1.60; headerMargin = 15; }
  else                       { bodySize = 12;   headerSize = 10.5; lineH = 1.65; headerMargin = 18; }

  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let bodyBuffer: string[] = [];

  const flushBody = () => {
    if (bodyBuffer.length > 0) {
      elements.push(
        <p key={`body-${elements.length}`} style={{ color: 'rgba(255,255,255,0.78)', fontSize: bodySize, lineHeight: lineH, margin: `0 0 ${Math.round(lineH * 4)}px 0`, fontFamily: "'DM Sans', sans-serif" }}>
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
          color: '#B0B8C8', fontSize: headerSize, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' as const,
          margin: elements.length === 0 ? '0 0 4px 0' : `${headerMargin}px 0 4px 0`,
          fontFamily: "'DM Sans', sans-serif",
          borderLeft: '1.5px solid rgba(176,184,200,0.25)', paddingLeft: 7,
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
  const isCoCoached = d.isCoCoached && d.coachPhotoUrls.length >= 2;

  return (
    <div style={{
      width: 540, height: 540, background: '#0B1120', position: 'relative', overflow: 'hidden',
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif", display: 'flex', flexDirection: 'column',
    }}>
      {/* Ambient glow */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 10% 35%, ${theme.glow} 0%, transparent 50%)`, pointerEvents: 'none' }} />

      {/* Top bar — only R[X] PWRNKGS in top-right */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 18px 0', position: 'relative', zIndex: 1, flexShrink: 0 }}>
        <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: 2.5, color: '#3A4A5A' }}>R{d.roundNumber} PWRNKGS</span>
      </div>

      <div style={{ display: 'flex', flex: 1, padding: '6px 18px 0', position: 'relative', zIndex: 1, minHeight: 0 }}>
        {/* LEFT PANEL (35%) */}
        <div style={{ width: '35%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingRight: 14 }}>
          {/* Rank + movement */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <span style={{
              fontSize: 78, fontWeight: 900, lineHeight: 0.85, color: theme.primary,
              fontFamily: "'JetBrains Mono', monospace",
              textShadow: `0 0 60px ${theme.glow}`,
            }}>
              {d.ranking}
            </span>
            <div style={{ marginBottom: 4 }}>
              <MovementBadge current={d.ranking} previous={d.previousRanking} previousRound={previousRound} />
            </div>
          </div>

          {/* Stat rows */}
          <div style={{
            background: 'rgba(255,255,255,0.025)', borderRadius: 10, padding: '8px 10px',
            border: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', flexDirection: 'column', gap: 7,
          }}>
            {[
              { label: 'THIS WEEK', value: d.scoreThisWeek !== null ? d.scoreThisWeek.toLocaleString() : '—', rank: d.scoreThisWeekRank },
              { label: 'SEASON', value: d.seasonTotal !== null ? d.seasonTotal.toLocaleString() : '—', rank: d.seasonTotalRank },
              { label: 'LADDER', value: `${d.record.wins}W ${d.record.losses}L${d.record.ties ? ` ${d.record.ties}T` : ''}`, rank: d.ladderPosition },
              { label: 'LUCK', value: d.luckScore !== null ? (d.luckScore > 0 ? `+${d.luckScore.toFixed(2)}` : d.luckScore.toFixed(2)) : '—', rank: d.luckRank },
            ].map((stat) => (
              <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: 1, color: '#8892A2', textTransform: 'uppercase' as const, width: 56 }}>{stat.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#D0D5DD', fontFamily: "'JetBrains Mono', monospace", flex: 1, textAlign: 'right' as const, marginRight: 6, whiteSpace: 'nowrap' }}>{stat.value}</span>
                <RankPill rank={stat.rank} />
              </div>
            ))}
          </div>

          {/* Line circles */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
            {([
              { label: 'DEF', rank: d.lineRanks.def },
              { label: 'MID', rank: d.lineRanks.mid },
              { label: 'FWD', rank: d.lineRanks.fwd },
              { label: 'RUC', rank: d.lineRanks.ruc },
              { label: 'UTL', rank: d.lineRanks.utl },
            ] as const).map((l) => <LineCircle key={l.label} label={l.label} rank={l.rank} />)}
          </div>

          {/* PWRNKGs Trend Chart */}
          <div style={{
            background: 'rgba(255,255,255,0.025)', borderRadius: 8, padding: '6px 6px 4px',
            border: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', flexDirection: 'column',
          }}>
            <span style={{ fontSize: 6, fontWeight: 700, letterSpacing: 1.5, color: '#6B7588', textTransform: 'uppercase' as const, marginBottom: 2 }}>PWRNKGS TREND</span>
            <TrendChart history={d.pwrnkgsHistory} width={176} height={65} theme={theme} />
          </div>
        </div>

        {/* RIGHT PANEL (65%) */}
        <div style={{
          width: '65%', display: 'flex', flexDirection: 'column',
          borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: 14,
        }}>
          {/* Team name + coach + photo */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ flex: 1, paddingTop: 2 }}>
              <h2 style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 800, lineHeight: 1.2, margin: 0, letterSpacing: -0.3 }}>{d.teamName}</h2>
              <p style={{ color: '#5A6577', fontSize: 11, margin: '3px 0 0', fontWeight: 500 }}>{d.coachName}</p>
            </div>
            {/* Coach photo(s) */}
            {isCoCoached ? (
              <div style={{ display: 'flex', position: 'relative', width: 68, height: 40, flexShrink: 0, marginLeft: 10 }}>
                {d.coachPhotoUrls.slice(0, 2).map((url, i) => (
                  <div key={i} style={{
                    width: 40, height: 40, borderRadius: 20, overflow: 'hidden',
                    border: `1.5px solid ${theme.border}`, position: 'absolute',
                    left: i * 18, zIndex: 2 - i,
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', display: 'block' }} />
                  </div>
                ))}
              </div>
            ) : d.coachPhotoUrls.length > 0 ? (
              <div style={{
                width: 50, height: 50, borderRadius: 25, flexShrink: 0, marginLeft: 10,
                overflow: 'hidden', border: `1.5px solid ${theme.border}`,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.coachPhotoUrls[0]} alt="" style={{ width: 50, height: 50, objectFit: 'cover', display: 'block' }} />
              </div>
            ) : (
              <div style={{
                width: 50, height: 50, borderRadius: 25, flexShrink: 0, marginLeft: 10,
                background: `linear-gradient(135deg, ${theme.subtle}, rgba(0,100,200,0.04))`,
                border: `1.5px solid ${theme.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: theme.primary, opacity: 0.7,
              }}>
                {coachInitials}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: `linear-gradient(90deg, ${theme.border}, transparent)`, marginBottom: 10, flexShrink: 0 }} />

          {/* Writeup */}
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
            {renderWriteup(d.writeup)}
          </div>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div style={{ height: 2.5, background: `linear-gradient(90deg, ${theme.primary}, ${theme.subtle}, transparent)`, flexShrink: 0, marginTop: 6 }} />
    </div>
  );
}

// Export theme helpers for use in Rankings Editor
export { getRankTheme };
