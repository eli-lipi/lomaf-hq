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
const rankColor = (rank: number | null) => {
  if (!rank) return FG;
  if (rank <= 3) return GREEN;
  if (rank <= 7) return FG;
  return RED;
};

// Shared layout wrapper: top bar + bottom accent + BG + padding
function SlideWrapper({
  roundNumber,
  children,
}: {
  roundNumber: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: BG,
        padding: '50px',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: '16px',
            fontWeight: 600,
            color: MUTED,
            letterSpacing: '2px',
          }}
        >
          LOMAF HQ
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: '16px',
            fontWeight: 600,
            color: MUTED,
            letterSpacing: '2px',
          }}
        >
          R{roundNumber} PWRNKGS
        </div>
      </div>

      {/* Content area */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {children}
      </div>

      {/* Bottom accent line */}
      <div
        style={{
          display: 'flex',
          height: '4px',
          width: '100%',
          backgroundColor: PRIMARY,
          marginTop: '24px',
        }}
      />
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

  // Fetch team snapshots
  const { data: snapshots } = await supabase
    .from('team_snapshots')
    .select('*')
    .eq('round_number', roundNumber);

  const snapshotMap = new Map(snapshots?.map((s) => [s.team_id, s]) || []);

  // Fetch all historical rankings for sparklines
  const { data: allRankings } = await supabase
    .from('pwrnkgs_rankings')
    .select('team_id, ranking, round_number')
    .lte('round_number', roundNumber)
    .order('round_number', { ascending: true });

  const sparklineMap = new Map<number, number[]>();
  allRankings?.forEach((r) => {
    if (!sparklineMap.has(r.team_id)) sparklineMap.set(r.team_id, []);
    sparklineMap.get(r.team_id)!.push(r.ranking);
  });

  let element: React.ReactElement;

  // ============================================================
  // SLIDE 0 — Preview
  // ============================================================
  if (slideIndex === 0) {
    element = (
      <SlideWrapper roundNumber={roundNumber}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: '64px',
              fontWeight: 800,
              color: PRIMARY,
              letterSpacing: '3px',
              marginBottom: '24px',
            }}
          >
            R{roundNumber} PWRNKGS
          </div>

          {roundData.theme && (
            <div
              style={{
                display: 'flex',
                fontSize: '28px',
                fontWeight: 400,
                color: FG,
                marginBottom: '32px',
              }}
            >
              {roundData.theme}
            </div>
          )}

          {roundData.preview_text && (
            <div
              style={{
                display: 'flex',
                fontSize: '20px',
                color: FG,
                textAlign: 'center',
                maxWidth: '800px',
                lineHeight: '1.7',
              }}
            >
              {roundData.preview_text.length > 500
                ? roundData.preview_text.slice(0, 500) + '...'
                : roundData.preview_text}
            </div>
          )}
        </div>
      </SlideWrapper>
    );

  // ============================================================
  // SLIDE 11 — Summary
  // ============================================================
  } else if (slideIndex === 11) {
    element = (
      <SlideWrapper roundNumber={roundNumber}>
        {/* Title */}
        <div
          style={{
            display: 'flex',
            fontSize: '40px',
            fontWeight: 800,
            color: PRIMARY,
            marginBottom: '28px',
            letterSpacing: '1px',
          }}
        >
          R{roundNumber} PWRNKGS SUMMARY
        </div>

        {/* Ladder rows */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {rankings?.map((r) => {
            const movement = r.previous_ranking
              ? r.previous_ranking - r.ranking
              : 0;
            const isNew = r.previous_ranking === null;
            const moveText = isNew
              ? 'NEW'
              : movement > 0
                ? `↑${movement}`
                : movement < 0
                  ? `↓${Math.abs(movement)}`
                  : '—';
            const moveColor = isNew
              ? PRIMARY
              : movement > 0
                ? GREEN
                : movement < 0
                  ? RED
                  : MUTED;

            return (
              <div
                key={r.team_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: '56px',
                  paddingLeft: '16px',
                  paddingRight: '16px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    width: '60px',
                    fontSize: '24px',
                    fontWeight: 800,
                    color: PRIMARY,
                  }}
                >
                  {r.ranking}
                </div>
                <div
                  style={{
                    display: 'flex',
                    width: '80px',
                    fontSize: '18px',
                    fontWeight: 600,
                    color: moveColor,
                  }}
                >
                  {moveText}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flex: 1,
                    fontSize: '20px',
                    fontWeight: 600,
                    color: FG,
                  }}
                >
                  {r.team_name}
                </div>
              </div>
            );
          })}
        </div>

        {/* Week ahead */}
        {roundData.week_ahead_text && (
          <div
            style={{
              display: 'flex',
              fontSize: '18px',
              color: FG,
              lineHeight: '1.5',
              marginTop: '16px',
            }}
          >
            {roundData.week_ahead_text.length > 300
              ? roundData.week_ahead_text.slice(0, 300) + '...'
              : roundData.week_ahead_text}
          </div>
        )}
      </SlideWrapper>
    );

  // ============================================================
  // SLIDES 1–10 — Team Rankings (10th down to 1st)
  // ============================================================
  } else {
    const rankIndex = 11 - slideIndex; // slideIndex 1 = rank 10, slideIndex 10 = rank 1
    const ranking = rankings?.find((r) => r.ranking === rankIndex);

    if (!ranking) {
      return new Response(`No ranking found for position ${rankIndex}`, {
        status: 404,
      });
    }

    const team = TEAMS.find((t) => t.team_id === ranking.team_id);
    const snapshot = snapshotMap.get(ranking.team_id);
    const sparkline = sparklineMap.get(ranking.team_id) || [];

    const movement = ranking.previous_ranking
      ? ranking.previous_ranking - ranking.ranking
      : 0;
    const isNew = ranking.previous_ranking === null;
    const moveText = isNew
      ? 'NEW'
      : movement > 0
        ? `↑${movement}`
        : movement < 0
          ? `↓${Math.abs(movement)}`
          : '—';
    const moveColor = isNew
      ? PRIMARY
      : movement > 0
        ? GREEN
        : movement < 0
          ? RED
          : MUTED;

    // Sparkline SVG points
    let sparklinePath = '';
    if (sparkline.length > 1) {
      const maxRank = 10;
      const w = 160;
      const h = 40;
      const points = sparkline.map((rank, i) => {
        const x = (i / (sparkline.length - 1)) * w;
        const y = ((rank - 1) / (maxRank - 1)) * h;
        return `${x},${y}`;
      });
      sparklinePath = points.join(' ');
    }

    // Snapshot-derived stats
    // Weekly score = sum of line totals (DEF + MID + FWD + RUC + UTL)
    const computeWeekScore = (s: typeof snapshot) =>
      s
        ? Math.round(
            Number(s.def_total || 0) +
              Number(s.mid_total || 0) +
              Number(s.fwd_total || 0) +
              Number(s.ruc_total || 0) +
              Number(s.utl_total || 0)
          )
        : 0;
    const weekScore = snapshot ? computeWeekScore(snapshot) : null;
    const seasonTotal = snapshot ? Math.round(Number(snapshot.pts_for || 0)) : null;

    // Compute weekly score rank among all snapshots
    let weekRank: number | null = null;
    let seasonRank: number | null = null;
    if (snapshot && snapshots) {
      const weekScores = snapshots
        .map((s) => computeWeekScore(s))
        .sort((a, b) => b - a);
      weekRank = weekScores.indexOf(weekScore!) + 1;

      const seasonTotals = snapshots
        .map((s) => Math.round(Number(s.pts_for || 0)))
        .sort((a, b) => b - a);
      seasonRank = seasonTotals.indexOf(seasonTotal!) + 1;
    }

    const ladderPos = snapshot?.league_rank ?? null;

    // Line rank items
    const lineRanks = [
      { label: 'DEF', rank: snapshot?.def_rank ?? null },
      { label: 'MID', rank: snapshot?.mid_rank ?? null },
      { label: 'FWD', rank: snapshot?.fwd_rank ?? null },
      { label: 'RUC', rank: snapshot?.ruc_rank ?? null },
      { label: 'UTL', rank: snapshot?.utl_rank ?? null },
    ];

    element = (
      <SlideWrapper roundNumber={roundNumber}>
        {/* ---- Header area ---- */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '24px',
          }}
        >
          {/* Left: rank + movement */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: '120px',
                fontWeight: 900,
                color: PRIMARY,
                lineHeight: '1',
              }}
            >
              {ranking.ranking}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '24px',
                fontWeight: 700,
                color: moveColor,
                marginTop: '4px',
              }}
            >
              {moveText}
            </div>
          </div>

          {/* Right: team name + coach */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              paddingTop: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '36px',
                fontWeight: 800,
                color: FG,
                marginBottom: '4px',
              }}
            >
              {ranking.team_name}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '18px',
                color: MUTED,
              }}
            >
              {team?.coach || ''}
            </div>
          </div>
        </div>

        {/* ---- Writeup area ---- */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            fontSize: '20px',
            color: FG,
            lineHeight: '1.7',
            paddingTop: '8px',
            paddingBottom: '8px',
          }}
        >
          {ranking.writeup.length > 550
            ? ranking.writeup.slice(0, 550) + '...'
            : ranking.writeup}
        </div>

        {/* ---- Stats panel ---- */}
        {snapshot ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: CARD,
              borderRadius: '16px',
              padding: '20px',
            }}
          >
            {/* Row 1: main stats */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}
            >
              {/* This Week */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: MUTED,
                    letterSpacing: '1px',
                    marginBottom: '4px',
                  }}
                >
                  THIS WEEK
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: '16px',
                    fontWeight: 600,
                    color: FG,
                  }}
                >
                  {weekScore !== null ? fmt(weekScore) : '—'}
                  {weekRank ? ` (${ord(weekRank)})` : ''}
                </div>
              </div>

              {/* Season */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: MUTED,
                    letterSpacing: '1px',
                    marginBottom: '4px',
                  }}
                >
                  SEASON
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: '16px',
                    fontWeight: 600,
                    color: FG,
                  }}
                >
                  {seasonTotal !== null ? fmt(seasonTotal) : '—'}
                  {seasonRank ? ` (${ord(seasonRank)})` : ''}
                </div>
              </div>

              {/* Record + Ladder */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: MUTED,
                    letterSpacing: '1px',
                    marginBottom: '4px',
                  }}
                >
                  RECORD
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: '16px',
                    fontWeight: 600,
                    color: FG,
                  }}
                >
                  {snapshot.wins}W-{snapshot.losses}L
                  {ladderPos ? ` · Ladder: ${ord(ladderPos)}` : ''}
                </div>
              </div>
            </div>

            {/* Row 2: line rankings + sparkline */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {/* Line rankings */}
              <div style={{ display: 'flex', gap: '24px' }}>
                {lineRanks.map((lr) => (
                  <div
                    key={lr.label}
                    style={{ display: 'flex', flexDirection: 'column' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: MUTED,
                        letterSpacing: '1px',
                        marginBottom: '4px',
                      }}
                    >
                      {lr.label}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        fontSize: '16px',
                        fontWeight: 600,
                        color: lr.rank ? rankColor(lr.rank) : MUTED,
                      }}
                    >
                      {lr.rank ? ord(lr.rank) : '—'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Sparkline */}
              {sparkline.length > 1 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: MUTED,
                      letterSpacing: '1px',
                      marginBottom: '4px',
                    }}
                  >
                    TREND
                  </div>
                  <svg width="160" height="40" viewBox="0 0 160 40">
                    <polyline
                      points={sparklinePath}
                      fill="none"
                      stroke={PRIMARY}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              backgroundColor: CARD,
              borderRadius: '16px',
              padding: '20px',
              fontSize: '14px',
              color: MUTED,
            }}
          >
            No stats available for this round
          </div>
        )}
      </SlideWrapper>
    );
  }

  return new ImageResponse(element, {
    width: 1080,
    height: 1080,
  });
}
