import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
import { TEAMS, SEASON } from '@/lib/constants';
import { computeSlideData } from '@/lib/compute-slide-data';
import { readFileSync } from 'fs';
import { join } from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const runtime = 'nodejs';

// ── Fonts (loaded from local files) ──
const fontsDir = join(process.cwd(), 'src/app/api/carousel/fonts');

let fontsCache: { name: string; data: ArrayBuffer; weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style: 'normal' | 'italic' }[] | null = null;

function getFonts() {
  if (fontsCache) return fontsCache;
  fontsCache = [
    { name: 'DM Sans', data: readFileSync(join(fontsDir, 'dm-sans-400.woff2')).buffer as ArrayBuffer, weight: 400 as const, style: 'normal' as const },
    { name: 'DM Sans', data: readFileSync(join(fontsDir, 'dm-sans-700.woff2')).buffer as ArrayBuffer, weight: 700 as const, style: 'normal' as const },
    { name: 'DM Sans', data: readFileSync(join(fontsDir, 'dm-sans-900.woff2')).buffer as ArrayBuffer, weight: 900 as const, style: 'normal' as const },
    { name: 'JetBrains Mono', data: readFileSync(join(fontsDir, 'jetbrains-mono-400.woff2')).buffer as ArrayBuffer, weight: 400 as const, style: 'normal' as const },
    { name: 'JetBrains Mono', data: readFileSync(join(fontsDir, 'jetbrains-mono-700.woff2')).buffer as ArrayBuffer, weight: 700 as const, style: 'normal' as const },
  ];
  return fontsCache;
}

// ── Color helpers (rank-based theming) ──

function getRankTheme(ranking: number) {
  if (ranking <= 2) return { primary: '#00FF87', glow: 'rgba(0,255,135,0.12)', subtle: 'rgba(0,255,135,0.06)', border: 'rgba(0,255,135,0.25)' };
  if (ranking <= 4) return { primary: '#00D4FF', glow: 'rgba(0,212,255,0.12)', subtle: 'rgba(0,212,255,0.06)', border: 'rgba(0,212,255,0.25)' };
  if (ranking <= 6) return { primary: '#FFB800', glow: 'rgba(255,184,0,0.12)', subtle: 'rgba(255,184,0,0.06)', border: 'rgba(255,184,0,0.25)' };
  if (ranking <= 8) return { primary: '#FF7B3A', glow: 'rgba(255,123,58,0.12)', subtle: 'rgba(255,123,58,0.06)', border: 'rgba(255,123,58,0.25)' };
  return { primary: '#FF4757', glow: 'rgba(255,71,87,0.12)', subtle: 'rgba(255,71,87,0.06)', border: 'rgba(255,71,87,0.25)' };
}

function getLineRankColor(rank: number | null) {
  if (!rank) return { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', text: '#6B7588' };
  if (rank <= 3) return { bg: 'rgba(0,255,135,0.12)', border: 'rgba(0,255,135,0.45)', text: '#00FF87' };
  if (rank <= 7) return { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', text: '#6B7588' };
  return { bg: 'rgba(255,71,87,0.10)', border: 'rgba(255,71,87,0.35)', text: '#FF6B6B' };
}

const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const fmt = (n: number) => n.toLocaleString('en-US');

// ── Parse ## writeup headers ──

function parseWriteupBlocks(text: string): { type: 'header' | 'body'; text: string }[] {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks: { type: 'header' | 'body'; text: string }[] = [];
  let bodyLines: string[] = [];

  const flushBody = () => {
    if (bodyLines.length > 0) {
      blocks.push({ type: 'body', text: bodyLines.join(' ') });
      bodyLines = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushBody();
      blocks.push({ type: 'header', text: line.slice(3).trim() });
    } else if (line.trim() === '') {
      flushBody();
    } else {
      bodyLines.push(line);
    }
  }
  flushBody();
  return blocks;
}

// ── Satori-compatible sub-components (1080px export) ──

function SatoriRankPill({ rank }: { rank: number | null }) {
  if (rank === null) return null;
  const c = getLineRankColor(rank);
  return (
    <div style={{
      display: 'flex',
      background: c.bg, border: `2px solid ${c.border}`, color: c.text,
      borderRadius: 20, fontWeight: 700, fontSize: 20, padding: '4px 14px',
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {ord(rank)}
    </div>
  );
}

function SatoriLineCircle({ label, rank }: { label: string; rank: number | null }) {
  const c = getLineRankColor(rank);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: '#8892A2' }}>{label}</div>
      <div style={{
        display: 'flex', width: 68, height: 68, borderRadius: '50%',
        background: c.bg, border: `3px solid ${c.border}`,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ display: 'flex', color: c.text, fontWeight: 800, fontSize: 21, fontFamily: "'JetBrains Mono', monospace" }}>
          {rank !== null ? ord(rank) : '—'}
        </div>
      </div>
    </div>
  );
}

// Build trend chart as raw SVG string (Satori doesn't support <g>, <text>, strokeDasharray, textAnchor)
function buildTrendChartSvg(
  history: { round: string; ranking: number }[],
  w: number,
  h: number,
  themeColor: string,
) {
  if (!history || history.length < 1) return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`;

  const pad = { top: 16, bottom: 32, left: 36, right: 16 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const midY = pad.top + ((5.5 - 1) / 9) * ch;

  // Zone shading
  const zones = `<rect x="${pad.left}" y="${pad.top}" width="${cw}" height="${midY - pad.top}" fill="rgba(0,255,135,0.03)"/>` +
    `<rect x="${pad.left}" y="${midY}" width="${cw}" height="${pad.top + ch - midY}" fill="rgba(255,71,87,0.03)"/>`;

  // Gridlines + Y-axis labels for all 10 positions
  const gridlines = Array.from({ length: 10 }, (_, i) => i + 1).map(pos => {
    const y = pad.top + ((pos - 1) / 9) * ch;
    return `<line x1="${pad.left}" y1="${y}" x2="${pad.left + cw}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>` +
      `<text x="${pad.left - 6}" y="${y + 5}" text-anchor="end" fill="#5A6577" font-size="12" font-family="monospace">${pos}</text>`;
  }).join('');

  // Midline (more visible)
  const midline = `<line x1="${pad.left}" y1="${midY}" x2="${pad.left + cw}" y2="${midY}" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" stroke-dasharray="6,6"/>`;

  // Data points
  const points = history.map((pt, i) => ({
    x: pad.left + (history.length === 1 ? cw / 2 : (i / (history.length - 1)) * cw),
    y: pad.top + ((pt.ranking - 1) / 9) * ch,
    round: pt.round,
    ranking: pt.ranking,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const line = points.length > 1 ? `<path d="${pathD}" fill="none" stroke="${themeColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : '';

  // Dots with ranking numbers inside
  const dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="10" fill="#0B1120" stroke="${themeColor}" stroke-width="2.5"/>` +
    `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" fill="${themeColor}" font-size="11" font-weight="bold" font-family="monospace">${p.ranking}</text>` +
    `<text x="${p.x}" y="${h - 6}" text-anchor="middle" fill="#5A6577" font-size="12" font-family="monospace">${p.round}</text>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${zones}${gridlines}${midline}${line}${dots}</svg>`;
}

// ── Fetch coach photos helper ──
async function getCoachPhotoMap(): Promise<Map<string, string>> {
  const { data: photoFiles } = await supabase.storage.from('coach-photos').list('', { limit: 100 });
  const map = new Map<string, string>();
  if (photoFiles) {
    for (const f of photoFiles) {
      const key = f.name.split('.')[0];
      const { data } = supabase.storage.from('coach-photos').getPublicUrl(f.name);
      map.set(key, data.publicUrl);
    }
  }
  return map;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slideIndex: string }> }
) {
  try {
  const { slideIndex: slideIndexStr } = await params;
  const slideIndex = parseInt(slideIndexStr, 10);
  const { searchParams } = new URL(request.url);
  const roundNumber = parseInt(searchParams.get('round') || '0', 10);

  const fonts = getFonts();

  // Fetch round data
  const { data: roundData } = await supabase
    .from('pwrnkgs_rounds')
    .select('*')
    .eq('round_number', roundNumber)
    .single();

  if (!roundData) {
    return new Response('Round not found', { status: 404 });
  }

  // Fetch rankings
  const { data: rankings } = await supabase
    .from('pwrnkgs_rankings')
    .select('*')
    .eq('round_number', roundNumber)
    .order('ranking', { ascending: true });

  let element: React.ReactElement;

  // ============================================================
  // SLIDE 0 — Preview
  // ============================================================
  if (slideIndex === 0) {
    const ptLen = (roundData.preview_text || '').length;
    const ptSize = ptLen > 1200 ? 17 : ptLen > 900 ? 19 : 21;
    const ptLH = ptLen > 1200 ? 1.65 : ptLen > 900 ? 1.70 : 1.75;

    element = (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#0B1120', padding: '80px', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Top bar — only R[X] PWRNKGS in top-right */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '40px' }}>
          <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, color: '#3A4A5A', letterSpacing: 5 }}>R{roundNumber} PWRNKGS</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: 72, fontWeight: 900, color: '#00FF87', letterSpacing: 4, marginBottom: 24, fontFamily: "'JetBrains Mono', monospace" }}>
            R{roundNumber}
          </div>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, color: '#FFFFFF', letterSpacing: 7, marginBottom: 36 }}>
            PWRNKGS
          </div>
          {/* Gradient divider */}
          <div style={{ display: 'flex', width: 400, height: 2, marginBottom: 36, background: 'linear-gradient(90deg, transparent, #00FF87, transparent)' }} />
          {roundData.preview_text && (
            <div style={{ display: 'flex', fontSize: ptSize, color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: 800, lineHeight: ptLH }}>
              {roundData.preview_text}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', height: 5, backgroundColor: '#00FF87' }} />
      </div>
    );

  // ============================================================
  // SLIDE 11 — Summary (Fox Footy Style)
  // ============================================================
  } else if (slideIndex === 11) {
    const photoMap = await getCoachPhotoMap();

    // Round name for subtitle
    const roundWords = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
      'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN', 'TWENTY',
      'TWENTY-ONE', 'TWENTY-TWO', 'TWENTY-THREE'];
    const roundWord = roundWords[roundNumber] || `${roundNumber}`;

    element = (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#0B1120', padding: '50px 60px', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 30 }}>
          <div style={{ display: 'flex', fontSize: 18, fontWeight: 600, color: '#5A6577', letterSpacing: 4, marginBottom: 6 }}>{SEASON}</div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ display: 'flex', fontSize: 52, fontWeight: 900, color: '#FFFFFF', letterSpacing: 2 }}>POWER</div>
            <div style={{ display: 'flex', fontSize: 52, fontWeight: 900, color: '#00FF87', letterSpacing: 2 }}>RANKINGS</div>
          </div>
          <div style={{ display: 'flex', fontSize: 16, fontWeight: 600, color: '#5A6577', letterSpacing: 4, marginTop: 6 }}>AFTER ROUND {roundWord}</div>
        </div>

        {/* Rankings list */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {rankings?.map((r) => {
            const th = getRankTheme(r.ranking);
            const team = TEAMS.find((t) => t.team_id === r.team_id);
            const isCoCoached = team?.is_co_coached;
            const photoKeys = team ? (Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key]) : [];
            const photoUrls = photoKeys.map(k => photoMap.get(k)).filter(Boolean) as string[];

            const movement = r.previous_ranking ? r.previous_ranking - r.ranking : 0;
            const isNew = r.previous_ranking === null;
            const moveText = isNew ? '—' : movement > 0 ? '▲' : movement < 0 ? '▼' : '—';
            const moveColor = isNew ? '#5A6577' : movement > 0 ? '#00FF87' : movement < 0 ? '#FF4757' : '#5A6577';

            return (
              <div key={r.team_id} style={{ display: 'flex', alignItems: 'center', height: 68, paddingLeft: 10, paddingRight: 10, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', width: 60, fontSize: 42, fontWeight: 900, color: th.primary, fontFamily: "'JetBrains Mono', monospace" }}>{r.ranking}</div>
                <div style={{ display: 'flex', flex: 1, fontSize: 24, fontWeight: 700, color: '#FFFFFF', letterSpacing: 1 }}>{r.team_name.toUpperCase()}</div>
                {/* Coach photo(s) */}
                {isCoCoached && photoUrls.length >= 2 ? (
                  <div style={{ display: 'flex', position: 'relative', width: 72, height: 44, marginRight: 16 }}>
                    {photoUrls.slice(0, 2).map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt="" width={44} height={44} style={{
                        borderRadius: '50%', objectFit: 'cover',
                        border: '2px solid rgba(255,255,255,0.15)',
                        position: 'absolute', left: i * 28, top: 0,
                      }} />
                    ))}
                  </div>
                ) : photoUrls.length > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrls[0]} alt="" width={48} height={48} style={{
                    borderRadius: '50%', objectFit: 'cover', marginRight: 16,
                    border: '2px solid rgba(255,255,255,0.15)',
                  }} />
                ) : (
                  <div style={{ display: 'flex', width: 48, height: 48, borderRadius: '50%', marginRight: 16, background: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#5A6577', fontWeight: 700 }}>
                    {(team?.coach || '').split(/[\s&]+/).filter(Boolean).map(n => n[0]).join('').slice(0, 2)}
                  </div>
                )}
                <div style={{ display: 'flex', width: 40, fontSize: 22, color: moveColor, justifyContent: 'center' }}>{moveText}</div>
              </div>
            );
          })}
        </div>

        {/* Week ahead text */}
        {roundData.week_ahead_text && (
          <div style={{ display: 'flex', fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, textAlign: 'center', justifyContent: 'center', marginTop: 16 }}>
            {roundData.week_ahead_text.length > 300 ? roundData.week_ahead_text.slice(0, 300) + '...' : roundData.week_ahead_text}
          </div>
        )}

        {/* Bottom accent bar */}
        <div style={{ display: 'flex', height: 5, background: 'linear-gradient(90deg, #00FF87, rgba(0,255,135,0.06), transparent)', marginTop: 16 }} />
      </div>
    );

  // ============================================================
  // SLIDES 1–10 — Team Rankings (35% / 65% Split Panel)
  // ============================================================
  } else {
    const rankIndex = 11 - slideIndex;
    const ranking = rankings?.find((r) => r.ranking === rankIndex);

    if (!ranking) {
      return new Response(`No ranking found for position ${rankIndex}`, { status: 404 });
    }

    const team = TEAMS.find((t) => t.team_id === ranking.team_id);
    const theme = getRankTheme(ranking.ranking);
    const isCoCoached = team?.is_co_coached;

    // ── Compute slide data ──
    const allComputedData = await computeSlideData(supabase, roundNumber);
    const cd = allComputedData.get(ranking.team_id);

    // Log data for debugging
    console.log(`[Slide ${slideIndex}] Team: ${ranking.team_name}, Data:`, JSON.stringify({
      scoreThisWeek: cd?.scoreThisWeek,
      scoreThisWeekRank: cd?.scoreThisWeekRank,
      seasonTotal: cd?.seasonTotal,
      lineRanks: cd?.lineRanks,
      luckScore: cd?.luckScore,
    }));

    const weekScore = cd?.scoreThisWeek ?? null;
    const weekRank = cd?.scoreThisWeekRank ?? null;
    const seasonTotal = cd?.seasonTotal ?? null;
    const seasonRank = cd?.seasonTotalRank ?? null;
    const ladderPos = cd?.ladderPosition ?? null;
    const luckScore = cd?.luckScore ?? null;
    const luckRank = cd?.luckRank ?? null;

    const lineRanks = [
      { label: 'DEF', rank: cd?.lineRanks.def ?? null },
      { label: 'MID', rank: cd?.lineRanks.mid ?? null },
      { label: 'FWD', rank: cd?.lineRanks.fwd ?? null },
      { label: 'RUC', rank: cd?.lineRanks.ruc ?? null },
      { label: 'UTL', rank: cd?.lineRanks.utl ?? null },
    ];

    const movement = ranking.previous_ranking ? ranking.previous_ranking - ranking.ranking : 0;
    const isNew = ranking.previous_ranking === null;

    // Historical rankings for trend chart
    const { data: allRankings } = await supabase
      .from('pwrnkgs_rankings')
      .select('team_id, ranking, round_number')
      .eq('team_id', ranking.team_id)
      .lte('round_number', roundNumber)
      .order('round_number', { ascending: true });

    const sparklineData = allRankings?.map((r: { round_number: number; ranking: number }) => ({ round: `R${r.round_number}`, ranking: r.ranking })) || [];

    // Trend chart SVG (350×130 at 1080px)
    const trendSvg = buildTrendChartSvg(sparklineData, 350, 130, theme.primary);

    // Coach photos
    const photoMap = await getCoachPhotoMap();
    const photoKeys = team ? (Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key]) : [];
    const photoUrls = photoKeys.map(k => photoMap.get(k)).filter(Boolean) as string[];
    const coachInitials = (team?.coach || ranking.team_name).split(/[\s&]+/).filter(Boolean).map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

    // Writeup parsing with auto-fit
    const writeupBlocks = parseWriteupBlocks(ranking.writeup || '');
    const totalWriteupChars = (ranking.writeup || '').length;
    let writeupBodySize: number, writeupHeaderSize: number, writeupLineHeight: number, writeupSectionGap: number;
    if (totalWriteupChars > 1200)     { writeupBodySize = 19; writeupHeaderSize = 17; writeupLineHeight = 1.55; writeupSectionGap = 26; }
    else if (totalWriteupChars > 900) { writeupBodySize = 21; writeupHeaderSize = 18; writeupLineHeight = 1.60; writeupSectionGap = 30; }
    else                              { writeupBodySize = 24; writeupHeaderSize = 21; writeupLineHeight = 1.65; writeupSectionGap = 36; }

    // Previous round label for movement badge
    const prevRound = sparklineData.length >= 2 ? sparklineData[sparklineData.length - 2].round : null;

    // Stats data
    const record = cd?.record ?? { wins: 0, losses: 0, ties: 0 };
    const stats = [
      { label: 'THIS WEEK', value: weekScore !== null ? fmt(weekScore) : '—', rank: weekRank },
      { label: 'SEASON', value: seasonTotal !== null ? fmt(seasonTotal) : '—', rank: seasonRank },
      { label: 'LADDER', value: `${record.wins}W ${record.losses}L${record.ties ? ` ${record.ties}T` : ''}`, rank: ladderPos },
      { label: 'LUCK', value: luckScore !== null ? (luckScore > 0 ? `+${luckScore.toFixed(2)}` : luckScore.toFixed(2)) : '—', rank: luckRank },
    ];

    element = (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#0B1120', fontFamily: "'DM Sans', sans-serif", overflow: 'hidden' }}>
        {/* Top bar — only R[X] PWRNKGS */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '24px 36px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, letterSpacing: 5, color: '#3A4A5A' }}>R{roundNumber} PWRNKGS</div>
        </div>

        <div style={{ display: 'flex', flex: 1, padding: '12px 36px 0' }}>
          {/* ======== LEFT PANEL (35%) ======== */}
          <div style={{ width: '35%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingRight: 28 }}>
            {/* Rank number + movement */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
              <div style={{
                display: 'flex', fontSize: 156, fontWeight: 900, lineHeight: '0.85',
                color: theme.primary, fontFamily: "'JetBrains Mono', monospace",
              }}>
                {ranking.ranking}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 8, gap: 4 }}>
                {isNew ? (
                  <div style={{ display: 'flex', color: '#5A6577', fontSize: 24, fontWeight: 600 }}>NEW</div>
                ) : movement > 0 ? (
                  <div style={{ display: 'flex', color: '#00FF87', fontSize: 28, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>+{movement}</div>
                ) : movement < 0 ? (
                  <div style={{ display: 'flex', color: '#FF4757', fontSize: 28, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{movement}</div>
                ) : (
                  <div style={{ display: 'flex', color: '#3A4A5A', fontSize: 28, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>—</div>
                )}
                {prevRound && (
                  <div style={{ display: 'flex', fontSize: 13, color: '#4A5568', fontWeight: 500 }}>From {prevRound}</div>
                )}
              </div>
            </div>

            {/* Stat card */}
            <div style={{
              display: 'flex', flexDirection: 'column',
              background: 'rgba(255,255,255,0.025)', borderRadius: 20, padding: '16px 20px',
              border: '1px solid rgba(255,255,255,0.05)', gap: 14,
            }}>
              {stats.map((stat) => (
                <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', fontSize: 14, fontWeight: 700, letterSpacing: 2, color: '#8892A2', width: 112 }}>{stat.label}</div>
                  <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', marginRight: 12, fontSize: 24, fontWeight: 700, color: '#D0D5DD', fontFamily: "'JetBrains Mono', monospace" }}>{stat.value}</div>
                  <SatoriRankPill rank={stat.rank} />
                </div>
              ))}
            </div>

            {/* Line circles */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
              {lineRanks.map((l) => <SatoriLineCircle key={l.label} label={l.label} rank={l.rank} />)}
            </div>

            {/* Trend chart */}
            <div style={{
              display: 'flex', flexDirection: 'column',
              background: 'rgba(255,255,255,0.025)', borderRadius: 16, padding: '12px 12px 8px',
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ display: 'flex', fontSize: 12, fontWeight: 700, letterSpacing: 3, color: '#6B7588', marginBottom: 4 }}>PWRNKGS TREND</div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/svg+xml,${encodeURIComponent(trendSvg)}`}
                  alt=""
                  width={350}
                  height={130}
                />
              </div>
            </div>
          </div>

          {/* ======== RIGHT PANEL (65%) ======== */}
          <div style={{
            width: '65%', display: 'flex', flexDirection: 'column',
            borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: 28,
          }}>
            {/* Team name + coach + photo */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingTop: 4 }}>
                <div style={{ display: 'flex', color: '#FFFFFF', fontSize: 36, fontWeight: 800, lineHeight: '1.2', letterSpacing: -0.6 }}>{ranking.team_name}</div>
                <div style={{ display: 'flex', color: '#5A6577', fontSize: 22, marginTop: 6, fontWeight: 500 }}>{team?.coach || ''}</div>
              </div>
              {/* Coach photo(s) */}
              {isCoCoached && photoUrls.length >= 2 ? (
                <div style={{ display: 'flex', position: 'relative', width: 116, height: 80, flexShrink: 0, marginLeft: 20 }}>
                  {photoUrls.slice(0, 2).map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={url} alt="" width={80} height={80} style={{
                      borderRadius: '50%', objectFit: 'cover',
                      border: `3px solid ${theme.border}`,
                      position: 'absolute', left: i * 36, top: 0,
                    }} />
                  ))}
                </div>
              ) : (
                <div style={{
                  display: 'flex', width: 100, height: 100, borderRadius: '50px', flexShrink: 0, marginLeft: 20,
                  overflow: 'hidden',
                  background: photoUrls.length > 0 ? 'transparent' : `linear-gradient(135deg, ${theme.subtle}, rgba(0,100,200,0.04))`,
                  border: `3px solid ${theme.border}`,
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, fontWeight: 700, color: theme.primary,
                }}>
                  {photoUrls.length > 0 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrls[0]} alt="" width={100} height={100} style={{ objectFit: 'cover' }} />
                  ) : (
                    coachInitials
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', height: 2, background: `linear-gradient(90deg, ${theme.border}, transparent)`, marginBottom: 24, flexShrink: 0 }} />

            {/* Writeup (auto-fit font size) */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {writeupBlocks.length > 0 ? (
                writeupBlocks.map((block, i) => (
                  block.type === 'header' ? (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center',
                      fontSize: writeupHeaderSize, fontWeight: 700, letterSpacing: 3, color: '#B0B8C8',
                      marginTop: i > 0 ? writeupSectionGap : 0, marginBottom: 10,
                      borderLeft: '3px solid rgba(176,184,200,0.25)', paddingLeft: 14,
                    }}>
                      {block.text.toUpperCase()}
                    </div>
                  ) : (
                    <div key={i} style={{
                      display: 'flex', fontSize: writeupBodySize, color: 'rgba(255,255,255,0.78)',
                      lineHeight: String(writeupLineHeight),
                    }}>
                      {block.text}
                    </div>
                  )
                ))
              ) : (
                <div style={{ display: 'flex', fontSize: 25, color: '#5A6577', fontStyle: 'italic' }}>No writeup yet</div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom accent bar */}
        <div style={{ display: 'flex', height: 5, background: `linear-gradient(90deg, ${theme.primary}, ${theme.subtle}, transparent)`, flexShrink: 0, marginTop: 12 }} />
      </div>
    );
  }

  return new ImageResponse(element, {
    width: 1080,
    height: 1080,
    fonts,
  });
  } catch (err) {
    console.error('Carousel slide generation error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
