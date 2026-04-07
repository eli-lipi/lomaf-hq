import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';
import { TEAMS } from '@/lib/constants';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const runtime = 'nodejs';

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

  // Common styles
  const BG = '#0A0F1C';
  const CARD = '#111827';
  const CARD_EL = '#1A2332';
  const PRIMARY = '#A3FF12';
  const FG = '#E2E8F0';
  const MUTED = '#64748B';
  const GREEN = '#22C55E';
  const RED = '#EF4444';
  const BLUE = '#3B82F6';

  let element: React.ReactElement;

  if (slideIndex === 0) {
    // === SLIDE 1: PREVIEW ===
    element = (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: BG, padding: '60px' }}>
        {/* Top branding */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <div style={{ display: 'flex', fontSize: '24px', fontWeight: 700, color: MUTED }}>LOMAF HQ</div>
          <div style={{ display: 'flex', fontSize: '18px', color: MUTED }}>2026</div>
        </div>

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: '72px', fontWeight: 800, color: PRIMARY, marginBottom: '16px' }}>PWRNKGS</div>
          <div style={{ display: 'flex', fontSize: '48px', fontWeight: 700, color: FG, marginBottom: '24px' }}>ROUND {roundNumber}</div>
          {roundData.theme && (
            <div style={{ display: 'flex', fontSize: '28px', color: PRIMARY, marginBottom: '40px' }}>
              &quot;{roundData.theme}&quot;
            </div>
          )}
          {roundData.preview_text && (
            <div style={{ display: 'flex', fontSize: '18px', color: MUTED, textAlign: 'center', maxWidth: '800px', lineHeight: '1.6' }}>
              {roundData.preview_text.length > 400 ? roundData.preview_text.slice(0, 400) + '...' : roundData.preview_text}
            </div>
          )}
        </div>

        {/* Bottom accent line */}
        <div style={{ display: 'flex', height: '4px', backgroundColor: PRIMARY, borderRadius: '2px' }} />
      </div>
    );
  } else if (slideIndex === 11) {
    // === SLIDE 12: SUMMARY ===
    element = (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: BG, padding: '50px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
          <div style={{ display: 'flex', fontSize: '36px', fontWeight: 800, color: PRIMARY }}>PWRNKGS LADDER</div>
          <div style={{ display: 'flex', fontSize: '24px', color: MUTED }}>R{roundNumber}</div>
        </div>

        {/* Rankings table */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {rankings?.map((r, i) => {
            const movement = r.previous_ranking ? r.previous_ranking - r.ranking : 0;
            const moveText = r.previous_ranking === null ? 'NEW' : movement > 0 ? `↑${movement}` : movement < 0 ? `↓${Math.abs(movement)}` : '—';
            const moveColor = r.previous_ranking === null ? BLUE : movement > 0 ? GREEN : movement < 0 ? RED : MUTED;
            const snap = snapshotMap.get(r.team_id);

            return (
              <div
                key={r.team_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  backgroundColor: i % 2 === 0 ? CARD : 'transparent',
                  borderRadius: '8px',
                  marginBottom: '4px',
                }}
              >
                <div style={{ display: 'flex', width: '50px', fontSize: '24px', fontWeight: 800, color: PRIMARY }}>{r.ranking}</div>
                <div style={{ display: 'flex', width: '60px', fontSize: '16px', fontWeight: 600, color: moveColor }}>{moveText}</div>
                <div style={{ display: 'flex', flex: 1, fontSize: '18px', fontWeight: 600, color: FG }}>{r.team_name}</div>
                <div style={{ display: 'flex', fontSize: '16px', color: MUTED }}>
                  {snap ? Math.round(Number(snap.pts_for)) : '—'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Week ahead */}
        {roundData.week_ahead_text && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: '20px', padding: '16px', backgroundColor: CARD_EL, borderRadius: '12px' }}>
            <div style={{ display: 'flex', fontSize: '14px', fontWeight: 700, color: PRIMARY, marginBottom: '8px' }}>WEEK AHEAD</div>
            <div style={{ display: 'flex', fontSize: '14px', color: MUTED, lineHeight: '1.5' }}>
              {roundData.week_ahead_text.length > 200 ? roundData.week_ahead_text.slice(0, 200) + '...' : roundData.week_ahead_text}
            </div>
          </div>
        )}

        {/* Bottom accent */}
        <div style={{ display: 'flex', height: '4px', backgroundColor: PRIMARY, borderRadius: '2px', marginTop: '16px' }} />
      </div>
    );
  } else {
    // === SLIDES 2-11: TEAM RANKINGS (10th to 1st) ===
    const rankIndex = 11 - slideIndex; // slideIndex 1 = rank 10, slideIndex 10 = rank 1
    const ranking = rankings?.find((r) => r.ranking === rankIndex);

    if (!ranking) {
      return new Response(`No ranking found for position ${rankIndex}`, { status: 404 });
    }

    const team = TEAMS.find((t) => t.team_id === ranking.team_id);
    const snapshot = snapshotMap.get(ranking.team_id);
    const sparkline = sparklineMap.get(ranking.team_id) || [];

    const movement = ranking.previous_ranking ? ranking.previous_ranking - ranking.ranking : 0;
    const moveText = ranking.previous_ranking === null ? 'NEW' : movement > 0 ? `↑${movement}` : movement < 0 ? `↓${Math.abs(movement)}` : '—';
    const moveColor = ranking.previous_ranking === null ? BLUE : movement > 0 ? GREEN : movement < 0 ? RED : MUTED;

    // Generate sparkline SVG path
    let sparklinePath = '';
    if (sparkline.length > 1) {
      const maxRank = 10;
      const w = 180;
      const h = 40;
      const points = sparkline.map((rank, i) => {
        const x = (i / (sparkline.length - 1)) * w;
        const y = ((rank - 1) / (maxRank - 1)) * h; // rank 1 = top (y=0), rank 10 = bottom (y=h)
        return `${x},${y}`;
      });
      sparklinePath = points.join(' ');
    }

    // Ordinal helper
    const ord = (n: number) => {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    element = (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: BG, padding: '50px' }}>
        {/* Top branding bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
          <div style={{ display: 'flex', fontSize: '18px', color: MUTED }}>LOMAF HQ</div>
          <div style={{ display: 'flex', fontSize: '18px', color: MUTED }}>R{ranking.round_number} PWRNKGS</div>
        </div>

        {/* Main content */}
        <div style={{ display: 'flex', flex: 1 }}>
          {/* Left: Rank + Movement */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', width: '280px', paddingTop: '40px' }}>
            <div style={{ display: 'flex', fontSize: '140px', fontWeight: 900, color: PRIMARY, lineHeight: 1 }}>
              {ranking.ranking}
            </div>
            <div style={{ display: 'flex', fontSize: '28px', fontWeight: 700, color: moveColor, marginTop: '8px' }}>
              {moveText}
            </div>
          </div>

          {/* Right: Team info + writeup */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingLeft: '30px', paddingTop: '20px' }}>
            <div style={{ display: 'flex', fontSize: '32px', fontWeight: 800, color: FG, marginBottom: '4px' }}>
              {ranking.team_name}
            </div>
            <div style={{ display: 'flex', fontSize: '18px', color: MUTED, marginBottom: '24px' }}>
              {team?.coach || ''}
            </div>
            <div style={{ display: 'flex', fontSize: '18px', color: '#94A3B8', lineHeight: '1.6', flex: 1 }}>
              {ranking.writeup.length > 500 ? ranking.writeup.slice(0, 500) + '...' : ranking.writeup}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: 'flex', backgroundColor: CARD_EL, borderRadius: '12px', padding: '16px 20px', gap: '24px' }}>
          {snapshot ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: '11px', color: MUTED }}>SCORE</div>
                <div style={{ display: 'flex', fontSize: '18px', fontWeight: 700, color: FG }}>{Math.round(Number(snapshot.pts_for))}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: '11px', color: MUTED }}>RECORD</div>
                <div style={{ display: 'flex', fontSize: '18px', fontWeight: 700, color: FG }}>{snapshot.wins}W-{snapshot.losses}L</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: '11px', color: MUTED }}>DEF</div>
                <div style={{ display: 'flex', fontSize: '14px', color: FG }}>{snapshot.def_rank ? ord(snapshot.def_rank) : '—'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: '11px', color: MUTED }}>MID</div>
                <div style={{ display: 'flex', fontSize: '14px', color: FG }}>{snapshot.mid_rank ? ord(snapshot.mid_rank) : '—'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: '11px', color: MUTED }}>FWD</div>
                <div style={{ display: 'flex', fontSize: '14px', color: FG }}>{snapshot.fwd_rank ? ord(snapshot.fwd_rank) : '—'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: '11px', color: MUTED }}>RUC</div>
                <div style={{ display: 'flex', fontSize: '14px', color: FG }}>{snapshot.ruc_rank ? ord(snapshot.ruc_rank) : '—'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: '11px', color: MUTED }}>UTL</div>
                <div style={{ display: 'flex', fontSize: '14px', color: FG }}>{snapshot.utl_rank ? ord(snapshot.utl_rank) : '—'}</div>
              </div>
              {sparkline.length > 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 'auto' }}>
                  <div style={{ display: 'flex', fontSize: '11px', color: MUTED, marginBottom: '4px' }}>TREND</div>
                  <svg width="180" height="40" viewBox="0 0 180 40">
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
            </>
          ) : (
            <div style={{ display: 'flex', fontSize: '14px', color: MUTED }}>No stats available for this round</div>
          )}
        </div>

        {/* Bottom accent */}
        <div style={{ display: 'flex', height: '4px', backgroundColor: PRIMARY, borderRadius: '2px', marginTop: '16px' }} />
      </div>
    );
  }

  return new ImageResponse(element, {
    width: 1080,
    height: 1080,
  });
}
