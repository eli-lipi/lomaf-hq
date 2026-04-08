import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const runtime = 'nodejs';

// Color scheme
const BG = '#0B1120';
const BG_RIGHT = '#111B2E';
const CARD = '#151D2E';
const PRIMARY = '#00FF87';
const FG = '#FFFFFF';
const MUTED = '#8B95A5';
const GREEN = '#22C55E';
const RED = '#EF4444';

// Helpers
const fmt = (n: number) => n.toLocaleString('en-US');
const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Rank tier: 1-3 green, 4-7 neutral, 8-10 red
const rankTier = (rank: number | null): 'green' | 'neutral' | 'red' => {
  if (!rank) return 'neutral';
  if (rank <= 3) return 'green';
  if (rank <= 7) return 'neutral';
  return 'red';
};

const tierBg = (tier: 'green' | 'neutral' | 'red') => {
  if (tier === 'green') return 'rgba(0,255,135,0.15)';
  if (tier === 'red') return 'rgba(255,68,68,0.15)';
  return 'rgba(255,255,255,0.06)';
};

const tierBorder = (tier: 'green' | 'neutral' | 'red') => {
  if (tier === 'green') return 'rgba(0,255,135,0.5)';
  if (tier === 'red') return 'rgba(255,68,68,0.5)';
  return 'rgba(255,255,255,0.12)';
};

const tierText = (tier: 'green' | 'neutral' | 'red') => {
  if (tier === 'green') return PRIMARY;
  if (tier === 'red') return RED;
  return FG;
};

// Get initials for fallback avatar
const getInitials = (name: string) => {
  const parts = name.split(/[\s&]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

// Parse writeup with ## section headers
function parseWriteup(text: string): { type: 'header' | 'body'; text: string }[] {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks: { type: 'header' | 'body'; text: string }[] = [];
  let currentBody = '';

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentBody.trim()) {
        blocks.push({ type: 'body', text: currentBody.trim() });
        currentBody = '';
      }
      blocks.push({ type: 'header', text: line.slice(3).trim() });
    } else {
      currentBody += (currentBody ? '\n' : '') + line;
    }
  }
  if (currentBody.trim()) {
    blocks.push({ type: 'body', text: currentBody.trim() });
  }
  return blocks;
}

// Shared top bar
function TopBar({ roundNumber, side }: { roundNumber: number; side: 'left' | 'right' }) {
  return (
    <div style={{ display: 'flex', justifyContent: side === 'left' ? 'flex-start' : 'flex-end', marginBottom: '16px' }}>
      <div style={{ display: 'flex', fontSize: '13px', fontWeight: 600, color: MUTED, letterSpacing: '2px' }}>
        {side === 'left' ? 'LOMAF HQ' : `R${roundNumber} PWRNKGS`}
      </div>
    </div>
  );
}

// Bottom accent bar
function AccentBar() {
  return (
    <div style={{ display: 'flex', height: '4px', width: '100%', backgroundColor: PRIMARY, marginTop: 'auto' }} />
  );
}

// Shared layout for non-split slides (preview + summary)
function FullSlideWrapper({ roundNumber, children }: { roundNumber: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: BG, padding: '50px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', fontSize: '13px', fontWeight: 600, color: MUTED, letterSpacing: '2px' }}>LOMAF HQ</div>
        <div style={{ display: 'flex', fontSize: '13px', fontWeight: 600, color: MUTED, letterSpacing: '2px' }}>R{roundNumber} PWRNKGS</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>{children}</div>
      <AccentBar />
    </div>
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slideIndex: string }> }
) {
  const { slideIndex: slideIndexStr } = await params;
  const slideIndex = parseInt(slideIndexStr, 10);
  const { searchParams } = new URL(request.url);
  const roundNumber = parseInt(searchParams.get('round') || '0', 10);

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

  // Fetch ALL snapshots up to this round (for luck calculation)
  const { data: allSnapshots } = await supabase
    .from('team_snapshots')
    .select('round_number, team_id, pts_for, def_total, mid_total, fwd_total, ruc_total, utl_total')
    .lte('round_number', roundNumber)
    .order('round_number', { ascending: true });

  // Fetch all historical rankings for sparklines
  const { data: allRankings } = await supabase
    .from('pwrnkgs_rankings')
    .select('team_id, ranking, round_number')
    .lte('round_number', roundNumber)
    .order('round_number', { ascending: true });

  const sparklineMap = new Map<number, { rank: number; round: number }[]>();
  allRankings?.forEach((r) => {
    if (!sparklineMap.has(r.team_id)) sparklineMap.set(r.team_id, []);
    sparklineMap.get(r.team_id)!.push({ rank: r.ranking, round: r.round_number });
  });

  // Fetch coach photos from storage
  const { data: photoFiles } = await supabase.storage.from('coach-photos').list('', { limit: 100 });
  const photoUrlMap = new Map<string, string>();
  if (photoFiles) {
    for (const f of photoFiles) {
      const key = f.name.split('.')[0];
      const { data } = supabase.storage.from('coach-photos').getPublicUrl(f.name);
      photoUrlMap.set(key, data.publicUrl);
    }
  }

  // Compute luck scores
  const luckMap = new Map<number, { score: number; rank: number }>();
  if (allSnapshots && allSnapshots.length > 0) {
    // Get per-round scores from line totals in snapshots
    const roundsInData = [...new Set(allSnapshots.map(s => s.round_number))].sort((a, b) => a - b);
    // Filter valid rounds (most teams have data)
    const validRounds = roundsInData.filter(r => {
      const count = allSnapshots.filter(s => s.round_number === r).length;
      return count >= 8;
    });

    // Compute per-round scores per team from snapshots
    const roundScores = new Map<string, number>();
    allSnapshots.forEach(s => {
      const score = Number(s.def_total || 0) + Number(s.mid_total || 0) + Number(s.fwd_total || 0) + Number(s.ruc_total || 0) + Number(s.utl_total || 0);
      roundScores.set(`${s.round_number}-${s.team_id}`, Math.round(score));
    });

    // Compute expected wins per team
    const expectedWinsMap = new Map<number, number>();
    for (const team of TEAMS) {
      let totalExpected = 0;
      for (const round of validRounds) {
        const myScore = roundScores.get(`${round}-${team.team_id}`) || 0;
        let teamsOutscored = 0;
        for (const other of TEAMS) {
          if (other.team_id === team.team_id) continue;
          const otherScore = roundScores.get(`${round}-${other.team_id}`) || 0;
          if (myScore > otherScore) teamsOutscored += 1;
          else if (myScore === otherScore) teamsOutscored += 0.5;
        }
        totalExpected += teamsOutscored / 9;
      }
      expectedWinsMap.set(team.team_id, totalExpected);
    }

    // Compute luck = actual wins - expected wins
    const luckScores: { teamId: number; luck: number }[] = [];
    for (const team of TEAMS) {
      const snap = snapshotMap.get(team.team_id);
      if (!snap) continue;
      const actualWins = (snap.wins || 0) + 0.5 * (snap.ties || 0);
      const expectedWins = expectedWinsMap.get(team.team_id) || 0;
      const luck = Math.round((actualWins - expectedWins) * 100) / 100;
      luckScores.push({ teamId: team.team_id, luck });
    }

    // Rank by luck (highest = 1st)
    luckScores.sort((a, b) => b.luck - a.luck);
    luckScores.forEach((ls, i) => {
      luckMap.set(ls.teamId, { score: ls.luck, rank: i + 1 });
    });
  }

  let element: React.ReactElement;

  // ============================================================
  // SLIDE 0 — Preview
  // ============================================================
  if (slideIndex === 0) {
    element = (
      <FullSlideWrapper roundNumber={roundNumber}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: '64px', fontWeight: 800, color: PRIMARY, letterSpacing: '3px', marginBottom: '24px' }}>
            R{roundNumber} PWRNKGS
          </div>
          {roundData.theme && (
            <div style={{ display: 'flex', fontSize: '28px', fontWeight: 400, color: FG, marginBottom: '32px' }}>
              {roundData.theme}
            </div>
          )}
          {roundData.preview_text && (
            <div style={{ display: 'flex', fontSize: '20px', color: FG, textAlign: 'center', maxWidth: '800px', lineHeight: '1.7' }}>
              {roundData.preview_text.length > 500 ? roundData.preview_text.slice(0, 500) + '...' : roundData.preview_text}
            </div>
          )}
        </div>
      </FullSlideWrapper>
    );

  // ============================================================
  // SLIDE 11 — Summary
  // ============================================================
  } else if (slideIndex === 11) {
    element = (
      <FullSlideWrapper roundNumber={roundNumber}>
        <div style={{ display: 'flex', fontSize: '40px', fontWeight: 800, color: PRIMARY, marginBottom: '28px', letterSpacing: '1px' }}>
          R{roundNumber} PWRNKGS SUMMARY
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {rankings?.map((r) => {
            const movement = r.previous_ranking ? r.previous_ranking - r.ranking : 0;
            const isNew = r.previous_ranking === null;
            const moveText = isNew ? 'NEW' : movement > 0 ? `↑${movement}` : movement < 0 ? `↓${Math.abs(movement)}` : '—';
            const moveColor = isNew ? PRIMARY : movement > 0 ? GREEN : movement < 0 ? RED : MUTED;

            return (
              <div key={r.team_id} style={{ display: 'flex', alignItems: 'center', height: '56px', paddingLeft: '16px', paddingRight: '16px' }}>
                <div style={{ display: 'flex', width: '60px', fontSize: '24px', fontWeight: 800, color: PRIMARY }}>{r.ranking}</div>
                <div style={{ display: 'flex', width: '80px', fontSize: '18px', fontWeight: 600, color: moveColor }}>{moveText}</div>
                <div style={{ display: 'flex', flex: 1, fontSize: '20px', fontWeight: 600, color: FG }}>{r.team_name}</div>
              </div>
            );
          })}
        </div>
        {roundData.week_ahead_text && (
          <div style={{ display: 'flex', fontSize: '18px', color: FG, lineHeight: '1.5', marginTop: '16px' }}>
            {roundData.week_ahead_text.length > 300 ? roundData.week_ahead_text.slice(0, 300) + '...' : roundData.week_ahead_text}
          </div>
        )}
      </FullSlideWrapper>
    );

  // ============================================================
  // SLIDES 1–10 — Team Rankings (Split Panel)
  // ============================================================
  } else {
    const rankIndex = 11 - slideIndex;
    const ranking = rankings?.find((r) => r.ranking === rankIndex);

    if (!ranking) {
      return new Response(`No ranking found for position ${rankIndex}`, { status: 404 });
    }

    const team = TEAMS.find((t) => t.team_id === ranking.team_id);
    const snapshot = snapshotMap.get(ranking.team_id);
    const sparklineData = sparklineMap.get(ranking.team_id) || [];
    const luck = luckMap.get(ranking.team_id);

    const movement = ranking.previous_ranking ? ranking.previous_ranking - ranking.ranking : 0;
    const isNew = ranking.previous_ranking === null;
    const moveText = isNew ? 'NEW' : movement > 0 ? `↑${movement}` : movement < 0 ? `↓${Math.abs(movement)}` : '—';
    const moveBg = isNew ? PRIMARY : movement > 0 ? GREEN : movement < 0 ? RED : '#374151';
    const moveTextColor = isNew ? BG : FG;

    // Compute weekly score from line totals
    const weekScore = snapshot
      ? Math.round(Number(snapshot.def_total || 0) + Number(snapshot.mid_total || 0) + Number(snapshot.fwd_total || 0) + Number(snapshot.ruc_total || 0) + Number(snapshot.utl_total || 0))
      : null;
    const seasonTotal = snapshot ? Math.round(Number(snapshot.pts_for || 0)) : null;

    // Compute ranks
    let weekRank: number | null = null;
    let seasonRank: number | null = null;
    if (snapshot && snapshots) {
      const weekScores = snapshots.map((s) => Math.round(Number(s.def_total || 0) + Number(s.mid_total || 0) + Number(s.fwd_total || 0) + Number(s.ruc_total || 0) + Number(s.utl_total || 0))).sort((a, b) => b - a);
      weekRank = weekScores.indexOf(weekScore!) + 1;

      const seasonTotals = snapshots.map((s) => Math.round(Number(s.pts_for || 0))).sort((a, b) => b - a);
      seasonRank = seasonTotals.indexOf(seasonTotal!) + 1;
    }

    const ladderPos = snapshot?.league_rank ?? null;

    const lineRanks = [
      { label: 'DEF', rank: snapshot?.def_rank ?? null },
      { label: 'MID', rank: snapshot?.mid_rank ?? null },
      { label: 'FWD', rank: snapshot?.fwd_rank ?? null },
      { label: 'RUC', rank: snapshot?.ruc_rank ?? null },
      { label: 'UTL', rank: snapshot?.utl_rank ?? null },
    ];

    // Sparkline SVG
    let sparklineSvg = '';
    let sparklineDots = '';
    if (sparklineData.length > 1) {
      const maxRank = 10;
      const w = 340;
      const h = 60;
      const padX = 20;
      const padY = 8;
      const points = sparklineData.map((d, i) => {
        const x = padX + (i / (sparklineData.length - 1)) * (w - 2 * padX);
        const y = padY + ((d.rank - 1) / (maxRank - 1)) * (h - 2 * padY);
        return { x, y };
      });
      sparklineSvg = points.map((p) => `${p.x},${p.y}`).join(' ');
      sparklineDots = JSON.stringify(points.map((p, i) => ({ ...p, round: sparklineData[i].round })));
    }

    // Coach photo URLs
    const photoKeys = team ? (Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key]) : [];
    const photoUrls = photoKeys.map(k => photoUrlMap.get(k)).filter(Boolean) as string[];

    // Parse writeup
    const writeupBlocks = parseWriteup(ranking.writeup || '');
    // Limit writeup length for slide
    let charCount = 0;
    const maxChars = 450;
    const displayBlocks = writeupBlocks.filter(b => {
      if (charCount >= maxChars) return false;
      charCount += b.text.length;
      return true;
    });

    // Stat rows helper
    const StatRow = ({ label, value, rank }: { label: string; value: string; rank: number | null }) => {
      const tier = rankTier(rank);
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', fontSize: '11px', fontWeight: 700, color: MUTED, letterSpacing: '1.5px' }}>{label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', fontSize: '16px', fontWeight: 700, color: FG }}>{value}</div>
            {rank !== null && (
              <div style={{
                display: 'flex',
                fontSize: '12px',
                fontWeight: 700,
                color: tierText(tier),
                backgroundColor: tierBg(tier),
                border: `1px solid ${tierBorder(tier)}`,
                borderRadius: '6px',
                padding: '2px 8px',
              }}>
                {ord(rank)}
              </div>
            )}
          </div>
        </div>
      );
    };

    element = (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* ==================== LEFT PANEL (Data Side) ==================== */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: '45%',
          height: '100%',
          backgroundColor: BG,
          padding: '36px 32px',
        }}>
          <TopBar roundNumber={roundNumber} side="left" />

          {/* Rank number - hero element */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: '16px',
            marginBottom: '16px',
          }}>
            <div style={{
              display: 'flex',
              fontSize: '200px',
              fontWeight: 900,
              color: PRIMARY,
              lineHeight: '1',
              letterSpacing: '-8px',
            }}>
              {ranking.ranking}
            </div>
            {/* Movement pill */}
            <div style={{
              display: 'flex',
              fontSize: '16px',
              fontWeight: 700,
              color: moveTextColor,
              backgroundColor: moveBg,
              borderRadius: '20px',
              padding: '4px 16px',
              marginTop: '8px',
            }}>
              {moveText}
            </div>
          </div>

          {/* Stat cards */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: CARD,
            borderRadius: '12px',
            overflow: 'hidden',
            marginBottom: '14px',
          }}>
            <StatRow label="THIS WEEK" value={weekScore !== null ? fmt(weekScore) : '—'} rank={weekRank} />
            <StatRow label="SEASON" value={seasonTotal !== null ? fmt(seasonTotal) : '—'} rank={seasonRank} />
            <StatRow label="RECORD" value={snapshot ? `${snapshot.wins}W-${snapshot.losses}L · Ldr: ${ladderPos || '—'}` : '—'} rank={null} />
            {luck && <StatRow label="LUCK" value={`${luck.score >= 0 ? '+' : ''}${luck.score.toFixed(2)}`} rank={luck.rank} />}
          </div>

          {/* Line rankings - icon badges */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', justifyContent: 'center' }}>
            {lineRanks.map((lr) => {
              const tier = rankTier(lr.rank);
              return (
                <div key={lr.label} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: '72px',
                  padding: '8px 4px',
                  backgroundColor: tierBg(tier),
                  border: `1px solid ${tierBorder(tier)}`,
                  borderRadius: '10px',
                }}>
                  <div style={{ display: 'flex', fontSize: '10px', fontWeight: 700, color: MUTED, letterSpacing: '1px', marginBottom: '4px' }}>
                    {lr.label}
                  </div>
                  <div style={{ display: 'flex', fontSize: '16px', fontWeight: 700, color: tierText(tier) }}>
                    {lr.rank ? ord(lr.rank) : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sparkline */}
          {sparklineData.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 'auto' }}>
              <div style={{ display: 'flex', fontSize: '10px', fontWeight: 700, color: MUTED, letterSpacing: '1.5px', marginBottom: '8px' }}>
                PWRNKGS HISTORY
              </div>
              <svg width="340" height="60" viewBox="0 0 340 60">
                <polyline
                  points={sparklineSvg}
                  fill="none"
                  stroke={PRIMARY}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {JSON.parse(sparklineDots).map((dot: { x: number; y: number; round: number }, i: number) => (
                  <circle key={i} cx={dot.x} cy={dot.y} r="4" fill={PRIMARY} />
                ))}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '340px', paddingLeft: '20px', paddingRight: '20px', marginTop: '4px' }}>
                {sparklineData.map((d, i) => (
                  <div key={i} style={{ display: 'flex', fontSize: '9px', color: MUTED, fontWeight: 600 }}>
                    R{d.round}
                  </div>
                ))}
              </div>
            </div>
          )}

          <AccentBar />
        </div>

        {/* Vertical accent divider */}
        <div style={{ display: 'flex', width: '3px', backgroundColor: PRIMARY }} />

        {/* ==================== RIGHT PANEL (Story Side) ==================== */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: '55%',
          height: '100%',
          backgroundColor: BG_RIGHT,
          padding: '36px 36px',
        }}>
          <TopBar roundNumber={roundNumber} side="right" />

          {/* Team name */}
          <div style={{
            display: 'flex',
            fontSize: '32px',
            fontWeight: 800,
            color: FG,
            lineHeight: '1.2',
            marginTop: '12px',
            textAlign: 'center',
            justifyContent: 'center',
          }}>
            {ranking.team_name}
          </div>

          {/* Coach name */}
          <div style={{
            display: 'flex',
            fontSize: '16px',
            color: MUTED,
            marginTop: '6px',
            justifyContent: 'center',
          }}>
            {team?.coach || ''}
          </div>

          {/* Coach photo */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: '16px',
            marginBottom: '16px',
          }}>
            {photoUrls.length >= 2 ? (
              // Co-coached (SEANO): two overlapping circles
              <div style={{ display: 'flex', position: 'relative', width: '160px', height: '100px' }}>
                <div style={{
                  display: 'flex',
                  width: '100px',
                  height: '100px',
                  borderRadius: '50px',
                  overflow: 'hidden',
                  border: `3px solid ${PRIMARY}`,
                  position: 'absolute',
                  left: '0',
                  top: '0',
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrls[0]} alt="" width={100} height={100} style={{ objectFit: 'cover' }} />
                </div>
                <div style={{
                  display: 'flex',
                  width: '100px',
                  height: '100px',
                  borderRadius: '50px',
                  overflow: 'hidden',
                  border: `3px solid ${PRIMARY}`,
                  position: 'absolute',
                  left: '60px',
                  top: '0',
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrls[1]} alt="" width={100} height={100} style={{ objectFit: 'cover' }} />
                </div>
              </div>
            ) : photoUrls.length === 1 ? (
              <div style={{
                display: 'flex',
                width: '110px',
                height: '110px',
                borderRadius: '55px',
                overflow: 'hidden',
                border: `3px solid ${PRIMARY}`,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrls[0]} alt="" width={110} height={110} style={{ objectFit: 'cover' }} />
              </div>
            ) : (
              // Fallback: initials circle
              <div style={{
                display: 'flex',
                width: '110px',
                height: '110px',
                borderRadius: '55px',
                backgroundColor: CARD,
                border: `3px solid ${PRIMARY}`,
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '36px',
                fontWeight: 700,
                color: PRIMARY,
              }}>
                {getInitials(team?.coach || ranking.team_name)}
              </div>
            )}
          </div>

          {/* Separator */}
          <div style={{ display: 'flex', height: '1px', backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: '16px' }} />

          {/* Writeup */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {displayBlocks.length > 0 ? (
              displayBlocks.map((block, i) => (
                block.type === 'header' ? (
                  <div key={i} style={{
                    display: 'flex',
                    fontSize: '15px',
                    fontWeight: 700,
                    color: PRIMARY,
                    marginTop: i > 0 ? '14px' : '0',
                    marginBottom: '6px',
                    letterSpacing: '0.5px',
                  }}>
                    {block.text}
                  </div>
                ) : (
                  <div key={i} style={{
                    display: 'flex',
                    fontSize: '15px',
                    color: FG,
                    lineHeight: '1.65',
                  }}>
                    {block.text}
                  </div>
                )
              ))
            ) : (
              <div style={{ display: 'flex', fontSize: '15px', color: MUTED, fontStyle: 'italic' }}>
                No writeup yet
              </div>
            )}
          </div>

          <AccentBar />
        </div>
      </div>
    );
  }

  return new ImageResponse(element, {
    width: 1080,
    height: 1080,
  });
}
