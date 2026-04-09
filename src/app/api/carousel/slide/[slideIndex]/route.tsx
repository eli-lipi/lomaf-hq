import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';
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

// ── Satori-compatible sub-components ──
// All sizes are 2× the 540px preview (for 1080px export)

function SatoriRankPill({ rank }: { rank: number | null }) {
  if (rank === null) return null;
  const c = getLineRankColor(rank);
  return (
    <div style={{
      display: 'flex',
      background: c.bg, border: `2px solid ${c.border}`, color: c.text,
      borderRadius: 40, fontWeight: 700, fontSize: 20, padding: '4px 16px',
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {ord(rank)}
    </div>
  );
}

function SatoriLineCircle({ label, rank }: { label: string; rank: number | null }) {
  const c = getLineRankColor(rank);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
      <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, letterSpacing: 3, color: '#8892A2' }}>{label}</div>
      <div style={{
        display: 'flex', width: 76, height: 76, borderRadius: '50%',
        background: c.bg, border: `3px solid ${c.border}`,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ display: 'flex', color: c.text, fontWeight: 800, fontSize: 24, fontFamily: "'JetBrains Mono', monospace" }}>
          {rank !== null ? ord(rank) : '—'}
        </div>
      </div>
    </div>
  );
}

// Build sparkline as raw SVG string (Satori doesn't support <g>, <text>, strokeDasharray, textAnchor in JSX)
function buildSparklineSvg(
  points: { x: number; y: number; round: string }[],
  path: string,
  areaPath: string,
  w: number,
  h: number,
  pad: { top: number; bottom: number; left: number; right: number },
  sh: number,
  theme: { primary: string; subtle: string },
) {
  const ticks = [1, 5, 10].map(tick => {
    const y = pad.top + ((tick - 1) / 9) * sh;
    return `<line x1="${pad.left - 10}" y1="${y}" x2="${pad.left + (w - pad.left - pad.right)}" y2="${y}" stroke="rgba(255,255,255,0.035)" stroke-width="1" stroke-dasharray="6,6"/>
<text x="${pad.left - 14}" y="${y + 5}" text-anchor="end" fill="#5A6577" font-size="14" font-family="monospace">${tick}</text>`;
  }).join('');

  const area = areaPath ? `<path d="${areaPath}" fill="${theme.primary}" fill-opacity="0.08"/>` : '';
  const line = points.length > 1 ? `<path d="${path}" fill="none" stroke="${theme.primary}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="8" fill="#0B1120" stroke="${theme.primary}" stroke-width="3"/>
<text x="${p.x}" y="${h - 8}" text-anchor="middle" fill="#5A6577" font-size="14" font-family="monospace">${p.round}</text>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${ticks}${area}${line}${dots}</svg>`;
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

  // Load fonts (from local files, cached)
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

  // Fetch team snapshots for this round
  const { data: snapshots } = await supabase
    .from('team_snapshots')
    .select('*')
    .eq('round_number', roundNumber);

  const snapshotMap = new Map(snapshots?.map((s) => [s.team_id, s]) || []);

  let element: React.ReactElement;

  // ============================================================
  // SLIDE 0 — Preview (unchanged layout)
  // ============================================================
  if (slideIndex === 0) {
    element = (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#0B1120', padding: '80px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: '#3A4A5A', letterSpacing: 4 }}>LOMAF HQ</div>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: '#3A4A5A', letterSpacing: 4 }}>R{roundNumber} PWRNKGS</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: 128, fontWeight: 900, color: '#00FF87', letterSpacing: 6, marginBottom: 40, fontFamily: "'JetBrains Mono', monospace" }}>
            R{roundNumber}
          </div>
          <div style={{ display: 'flex', fontSize: 48, fontWeight: 800, color: '#FFFFFF', letterSpacing: 8, marginBottom: 48 }}>
            PWRNKGS
          </div>
          {roundData.theme && (
            <div style={{ display: 'flex', fontSize: 36, fontWeight: 400, color: '#B0B8C8', marginBottom: 40 }}>
              {roundData.theme}
            </div>
          )}
          {roundData.preview_text && (
            <div style={{ display: 'flex', fontSize: 28, color: 'rgba(255,255,255,0.7)', textAlign: 'center', maxWidth: 800, lineHeight: 1.7 }}>
              {roundData.preview_text.length > 400 ? roundData.preview_text.slice(0, 400) + '...' : roundData.preview_text}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', height: 6, backgroundColor: '#00FF87' }} />
      </div>
    );

  // ============================================================
  // SLIDE 11 — Summary
  // ============================================================
  } else if (slideIndex === 11) {
    element = (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#0B1120', padding: '60px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: '#3A4A5A', letterSpacing: 4 }}>LOMAF HQ</div>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: '#3A4A5A', letterSpacing: 4 }}>R{roundNumber} PWRNKGS</div>
        </div>
        <div style={{ display: 'flex', fontSize: 56, fontWeight: 900, color: '#00FF87', marginBottom: 36, letterSpacing: 2 }}>
          SUMMARY
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {rankings?.map((r) => {
            const th = getRankTheme(r.ranking);
            const movement = r.previous_ranking ? r.previous_ranking - r.ranking : 0;
            const isNew = r.previous_ranking === null;
            const moveText = isNew ? 'NEW' : movement > 0 ? `+${movement}` : movement < 0 ? `${movement}` : '—';
            const moveColor = isNew ? th.primary : movement > 0 ? '#00FF87' : movement < 0 ? '#FF4757' : '#3A4A5A';

            return (
              <div key={r.team_id} style={{ display: 'flex', alignItems: 'center', height: 72, paddingLeft: 20, paddingRight: 20 }}>
                <div style={{ display: 'flex', width: 80, fontSize: 36, fontWeight: 900, color: th.primary, fontFamily: "'JetBrains Mono', monospace" }}>{r.ranking}</div>
                <div style={{ display: 'flex', width: 80, fontSize: 24, fontWeight: 600, color: moveColor, fontFamily: "'JetBrains Mono', monospace" }}>{moveText}</div>
                <div style={{ display: 'flex', flex: 1, fontSize: 28, fontWeight: 600, color: '#FFFFFF' }}>{r.team_name}</div>
              </div>
            );
          })}
        </div>
        {roundData.week_ahead_text && (
          <div style={{ display: 'flex', fontSize: 24, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginTop: 20 }}>
            {roundData.week_ahead_text.length > 250 ? roundData.week_ahead_text.slice(0, 250) + '...' : roundData.week_ahead_text}
          </div>
        )}
        <div style={{ display: 'flex', height: 6, background: 'linear-gradient(90deg, #00FF87, rgba(0,255,135,0.06), transparent)', marginTop: 20 }} />
      </div>
    );

  // ============================================================
  // SLIDES 1–10 — Team Rankings (Split Panel, 2× scale)
  // ============================================================
  } else {
    const rankIndex = 11 - slideIndex;
    const ranking = rankings?.find((r) => r.ranking === rankIndex);

    if (!ranking) {
      return new Response(`No ranking found for position ${rankIndex}`, { status: 404 });
    }

    const team = TEAMS.find((t) => t.team_id === ranking.team_id);
    const theme = getRankTheme(ranking.ranking);

    // ── Use shared computation for all slide data ──
    const allComputedData = await computeSlideData(supabase, roundNumber);
    const cd = allComputedData.get(ranking.team_id);

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

    // Fetch all historical rankings for sparkline
    const { data: allRankings } = await supabase
      .from('pwrnkgs_rankings')
      .select('team_id, ranking, round_number')
      .eq('team_id', ranking.team_id)
      .lte('round_number', roundNumber)
      .order('round_number', { ascending: true });

    const sparklineData = allRankings?.map((r: { round_number: number; ranking: number }) => ({ round: `R${r.round_number}`, ranking: r.ranking })) || [];

    // Sparkline SVG (2× scale: 380×116)
    const sparkW = 380, sparkH = 116;
    const sparkPad = { top: 12, bottom: 40, left: 44, right: 20 };
    const sw = sparkW - sparkPad.left - sparkPad.right;
    const sh = sparkH - sparkPad.top - sparkPad.bottom;
    const sparkPoints = sparklineData.map((d: { round: string; ranking: number }, i: number) => ({
      x: sparkPad.left + (sparklineData.length === 1 ? sw / 2 : (i / (sparklineData.length - 1)) * sw),
      y: sparkPad.top + ((d.ranking - 1) / 9) * sh,
      round: d.round,
    }));
    const sparkPath = sparkPoints.map((p: { x: number; y: number }, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const sparkAreaPath = sparkPoints.length > 1
      ? `${sparkPath} L ${sparkPoints[sparkPoints.length - 1].x} ${sparkPad.top + sh} L ${sparkPoints[0].x} ${sparkPad.top + sh} Z`
      : '';

    // Coach photo URL
    const { data: photoFiles } = await supabase.storage.from('coach-photos').list('', { limit: 100 });
    const photoUrlMap = new Map<string, string>();
    if (photoFiles) {
      for (const f of photoFiles) {
        const key = f.name.split('.')[0];
        const { data } = supabase.storage.from('coach-photos').getPublicUrl(f.name);
        photoUrlMap.set(key, data.publicUrl);
      }
    }
    const photoKeys = team ? (Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key]) : [];
    const photoUrls = photoKeys.map(k => photoUrlMap.get(k)).filter(Boolean) as string[];
    const coachInitials = (team?.coach || ranking.team_name).split(/[\s&]+/).filter(Boolean).map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

    // Parse writeup with auto-fit sizing
    const writeupBlocks = parseWriteupBlocks(ranking.writeup || '');
    const totalWriteupChars = writeupBlocks.reduce((sum, b) => sum + b.text.length, 0);
    // Auto-fit: reduce font size for longer writeups
    let writeupBodySize = 25;
    let writeupHeaderSize = 22;
    let writeupLineHeight = 1.7;
    if (totalWriteupChars > 600) { writeupBodySize = 19; writeupHeaderSize = 18; writeupLineHeight = 1.5; }
    else if (totalWriteupChars > 400) { writeupBodySize = 22; writeupHeaderSize = 20; writeupLineHeight = 1.6; }
    else if (totalWriteupChars > 250) { writeupBodySize = 24; writeupHeaderSize = 21; writeupLineHeight = 1.65; }
    const displayBlocks = writeupBlocks; // Show all blocks, auto-fit handles overflow

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
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '28px 40px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, letterSpacing: 6, color: '#3A4A5A' }}>R{roundNumber} PWRNKGS</div>
        </div>

        <div style={{ display: 'flex', flex: 1, padding: '16px 40px 0' }}>
          {/* ======== LEFT PANEL (40%) ======== */}
          <div style={{ width: '40%', display: 'flex', flexDirection: 'column', paddingRight: 32 }}>
            {/* Rank number + movement */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
              <div style={{
                display: 'flex', fontSize: 168, fontWeight: 900, lineHeight: '0.85',
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
                  <div style={{ display: 'flex', fontSize: 14, color: '#4A5568', fontWeight: 500 }}>From {prevRound}</div>
                )}
              </div>
            </div>

            {/* Stat card */}
            <div style={{
              display: 'flex', flexDirection: 'column',
              background: 'rgba(255,255,255,0.025)', borderRadius: 24, padding: '20px 24px',
              border: '1px solid rgba(255,255,255,0.05)', marginBottom: 20, gap: 18,
            }}>
              {stats.map((stat) => (
                <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, letterSpacing: 3, color: '#8892A2', width: 128 }}>{stat.label}</div>
                  <div style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', marginRight: 16, fontSize: 26, fontWeight: 700, color: '#D0D5DD', fontFamily: "'JetBrains Mono', monospace" }}>{stat.value}</div>
                  <SatoriRankPill rank={stat.rank} />
                </div>
              ))}
            </div>

            {/* Line circles */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, padding: '0 4px' }}>
              {lineRanks.map((l) => <SatoriLineCircle key={l.label} label={l.label} rank={l.rank} />)}
            </div>

            {/* Sparkline as data URI img (Satori doesn't support <g>, <text>, or many SVG attrs) */}
            <div style={{
              display: 'flex', flexDirection: 'column',
              background: 'rgba(255,255,255,0.025)', borderRadius: 20, padding: '16px 16px 8px',
              border: '1px solid rgba(255,255,255,0.05)', flex: 1,
            }}>
              <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, letterSpacing: 4, color: '#8892A2', marginBottom: 4 }}>PWRNKGS TREND</div>
              <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/svg+xml,${encodeURIComponent(buildSparklineSvg(sparkPoints, sparkPath, sparkAreaPath, sparkW, sparkH, sparkPad, sh, theme))}`}
                  alt=""
                  width={sparkW}
                  height={sparkH}
                />
              </div>
            </div>
          </div>

          {/* ======== RIGHT PANEL (60%) ======== */}
          <div style={{
            width: '60%', display: 'flex', flexDirection: 'column',
            borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: 32,
          }}>
            {/* Team name + coach + photo */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingTop: 4 }}>
                <div style={{ display: 'flex', color: '#FFFFFF', fontSize: 38, fontWeight: 800, lineHeight: '1.2', letterSpacing: -0.6 }}>{ranking.team_name}</div>
                <div style={{ display: 'flex', color: '#5A6577', fontSize: 23, marginTop: 8, fontWeight: 500 }}>{team?.coach || ''}</div>
              </div>
              {/* Coach photo circle */}
              <div style={{
                display: 'flex', width: 112, height: 112, borderRadius: '56px', flexShrink: 0, marginLeft: 24,
                overflow: 'hidden',
                background: photoUrls.length > 0 ? 'transparent' : `linear-gradient(135deg, ${theme.subtle}, rgba(0,100,200,0.04))`,
                border: `3px solid ${theme.border}`,
                alignItems: 'center', justifyContent: 'center',
                fontSize: 32, fontWeight: 700, color: theme.primary,
              }}>
                {photoUrls.length > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrls[0]} alt="" width={112} height={112} style={{ objectFit: 'cover' }} />
                ) : (
                  coachInitials
                )}
              </div>
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', height: 2, background: `linear-gradient(90deg, ${theme.border}, transparent)`, marginBottom: 28, flexShrink: 0 }} />

            {/* Writeup (auto-fit font size) */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {displayBlocks.length > 0 ? (
                displayBlocks.map((block, i) => (
                  block.type === 'header' ? (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center',
                      fontSize: writeupHeaderSize, fontWeight: 700, letterSpacing: 3.6, color: '#B0B8C8',
                      marginTop: i > 0 ? 32 : 0, marginBottom: 10,
                      borderLeft: '4px solid rgba(176,184,200,0.25)', paddingLeft: 16,
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
        <div style={{ display: 'flex', height: 6, background: `linear-gradient(90deg, ${theme.primary}, ${theme.subtle}, transparent)`, flexShrink: 0, marginTop: 16 }} />
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
