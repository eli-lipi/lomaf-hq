'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import { Download, ZoomIn, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

// ── Team config ──────────────────────────────────────────────────────────────

const TEAMS = [
  'Mansion Mambas',
  'South Tel Aviv Dragons',
  'I believe in SEANO',
  "Littl' bit LIPI",
  'Melech Mitchito',
  "Cripps Don't Lie",
  'Take Me Home Country Road',
  'Doge Bombers',
  'Gun M Down',
  'Warnered613',
] as const

const TEAM_COLORS: Record<string, string> = {
  'Mansion Mambas': '#A3FF12',
  'South Tel Aviv Dragons': '#3B82F6',
  'I believe in SEANO': '#F59E0B',
  "Littl' bit LIPI": '#EF4444',
  'Melech Mitchito': '#8B5CF6',
  "Cripps Don't Lie": '#EC4899',
  'Take Me Home Country Road': '#14B8A6',
  'Doge Bombers': '#F97316',
  'Gun M Down': '#06B6D4',
  'Warnered613': '#84CC16',
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PwrnkgsRound {
  id: string
  round_number: number
  status: string
  created_at: string
  [key: string]: unknown
}

interface PwrnkgsRanking {
  id: string
  round_number: number
  ranking: number
  previous_ranking: number | null
  team_name: string
  [key: string]: unknown
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PreviousWeeksTab() {
  const [rounds, setRounds] = useState<PwrnkgsRound[]>([])
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [rankings, setRankings] = useState<PwrnkgsRanking[]>([])
  const [chartData, setChartData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [rankingsLoading, setRankingsLoading] = useState(false)
  const [enlargedSlide, setEnlargedSlide] = useState<number | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [currentSlide, setCurrentSlide] = useState(0)

  const TOTAL_SLIDES = 12

  // Reset carousel to preview slide when the selected round changes.
  useEffect(() => {
    setCurrentSlide(0)
  }, [selectedRound])

  // Keyboard arrow nav for the carousel (when no modal is open).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (enlargedSlide !== null) return
      if (e.key === 'ArrowRight') {
        setCurrentSlide((c) => (c + 1) % TOTAL_SLIDES)
      } else if (e.key === 'ArrowLeft') {
        setCurrentSlide((c) => (c - 1 + TOTAL_SLIDES) % TOTAL_SLIDES)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enlargedSlide])

  // Fetch published rounds + all rankings for chart
  useEffect(() => {
    async function load() {
      setLoading(true)

      const { data: roundsData } = await supabase
        .from('pwrnkgs_rounds')
        .select('*')
        .eq('status', 'published')
        .order('round_number')

      const publishedRounds = (roundsData ?? []) as PwrnkgsRound[]
      setRounds(publishedRounds)

      if (publishedRounds.length > 0) {
        // Fetch all rankings for movement chart
        const roundNumbers = publishedRounds.map((r) => r.round_number)
        const { data: allRankings } = await supabase
          .from('pwrnkgs_rankings')
          .select('*')
          .in('round_number', roundNumbers)
          .order('round_number')

        // Build chart data: one entry per round, each team as a key
        const grouped: Record<number, Record<string, number>> = {}
        for (const r of (allRankings ?? []) as PwrnkgsRanking[]) {
          if (!grouped[r.round_number]) grouped[r.round_number] = {}
          grouped[r.round_number][r.team_name] = r.ranking
        }

        const chart = roundNumbers.map((rn) => ({
          round: `R${rn}`,
          ...grouped[rn],
        }))
        setChartData(chart)

        // Auto-select most recent round
        setSelectedRound(publishedRounds[publishedRounds.length - 1].round_number)
      }

      setLoading(false)
    }

    load()
  }, [])

  // Fetch rankings for selected round
  useEffect(() => {
    if (selectedRound === null) return

    async function fetchRankings() {
      setRankingsLoading(true)
      const { data } = await supabase
        .from('pwrnkgs_rankings')
        .select('*')
        .eq('round_number', selectedRound)
        .order('ranking')

      setRankings((data ?? []) as PwrnkgsRanking[])
      setRankingsLoading(false)
    }

    fetchRankings()
  }, [selectedRound])

  // Download single slide
  const downloadSlide = useCallback(
    async (slideIndex: number) => {
      if (selectedRound === null) return
      const url = `/api/carousel/slide/${slideIndex}?round=${selectedRound}`
      const res = await fetch(url)
      const blob = await res.blob()
      saveAs(blob, `pwrnkgs-round-${selectedRound}-slide-${slideIndex}.png`)
    },
    [selectedRound]
  )

  // Download all slides as ZIP
  const downloadAllSlides = useCallback(async () => {
    if (selectedRound === null) return
    setDownloadingAll(true)

    try {
      const zip = new JSZip()
      const promises = Array.from({ length: 12 }, (_, i) =>
        fetch(`/api/carousel/slide/${i}?round=${selectedRound}`).then((res) =>
          res.blob()
        )
      )
      const blobs = await Promise.all(promises)
      blobs.forEach((blob, i) => {
        zip.file(`pwrnkgs-round-${selectedRound}-slide-${i}.png`, blob)
      })
      const content = await zip.generateAsync({ type: 'blob' })
      saveAs(content, `pwrnkgs-round-${selectedRound}-all-slides.zip`)
    } finally {
      setDownloadingAll(false)
    }
  }, [selectedRound])

  // Movement arrow helper
  const movementDisplay = (movement: number | null) => {
    if (movement === null || movement === 0) return <span className="text-muted-foreground">—</span>
    if (movement > 0)
      return <span className="text-green-400">+{movement} ▲</span>
    return <span className="text-red-400">{movement} ▼</span>
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (rounds.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
        No published rounds yet.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Movement Chart ──────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">
          PWRNKGs Movement Chart
        </h3>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 180, left: 0, bottom: 8 }}>
              <XAxis
                dataKey="round"
                stroke="#94a3b8"
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                axisLine={{ stroke: '#1E293B' }}
                tickLine={{ stroke: '#1E293B' }}
              />
              <YAxis
                reversed
                domain={[1, 10]}
                ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
                stroke="#94a3b8"
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                axisLine={{ stroke: '#1E293B' }}
                tickLine={{ stroke: '#1E293B' }}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  border: '1px solid #1E293B',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#94a3b8',
                }}
                labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
                itemSorter={(item) => (item.value as number) ?? 0}
              />
              {TEAMS.map((team) => (
                <Line
                  key={team}
                  type="monotone"
                  dataKey={team}
                  stroke={TEAM_COLORS[team]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: TEAM_COLORS[team] }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                >
                  {/* Label only on the rightmost (final) data point */}
                  <LabelList
                    dataKey={team}
                    position="right"
                    content={({ x, y, index, value }) => {
                      if (index !== chartData.length - 1) return null
                      if (value === null || value === undefined) return null
                      return (
                        <text
                          x={(x as number) + 8}
                          y={(y as number) + 4}
                          fill={TEAM_COLORS[team]}
                          fontSize={11}
                          fontWeight={600}
                        >
                          {team}
                        </text>
                      )
                    }}
                  />
                </Line>
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Round Selector ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {rounds.map((round) => (
          <button
            key={round.round_number}
            onClick={() => setSelectedRound(round.round_number)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
              selectedRound === round.round_number
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
            )}
          >
            Round {round.round_number}
          </button>
        ))}
      </div>

      {/* ── Selected Round Content ─────────────────────────────────────── */}
      {selectedRound !== null && (
        <div className="space-y-6">
          {/* Carousel gallery */}
          <div className="bg-card border border-border rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground">
                Round {selectedRound} Carousel Slides
              </h3>
              <button
                onClick={downloadAllSlides}
                disabled={downloadingAll}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {downloadingAll ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Download All (ZIP)
              </button>
            </div>

            {/* Instagram-style carousel: one slide at a time with arrows + dots */}
            <div className="relative max-w-md mx-auto">
              {/* Slide image */}
              <div
                className="relative bg-muted/30 border border-border rounded-lg overflow-hidden aspect-square cursor-pointer group"
                onClick={() => setEnlargedSlide(currentSlide)}
              >
                {/* Preload neighbors invisibly so forward/back feels instant */}
                {Array.from({ length: TOTAL_SLIDES }, (_, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={`/api/carousel/slide/${i}?round=${selectedRound}`}
                    alt={`Slide ${i}`}
                    className={cn(
                      'absolute inset-0 w-full h-full object-cover transition-opacity duration-200',
                      i === currentSlide ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    )}
                    loading={Math.abs(i - currentSlide) <= 1 ? 'eager' : 'lazy'}
                  />
                ))}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                  <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>

              {/* Left arrow */}
              <button
                onClick={() =>
                  setCurrentSlide((c) => (c - 1 + TOTAL_SLIDES) % TOTAL_SLIDES)
                }
                aria-label="Previous slide"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 hover:bg-white shadow-md flex items-center justify-center text-foreground transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              {/* Right arrow */}
              <button
                onClick={() => setCurrentSlide((c) => (c + 1) % TOTAL_SLIDES)}
                aria-label="Next slide"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 hover:bg-white shadow-md flex items-center justify-center text-foreground transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

              {/* Slide counter + download current */}
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-muted-foreground font-medium">
                  {currentSlide + 1} / {TOTAL_SLIDES}
                </span>
                <button
                  onClick={() => downloadSlide(currentSlide)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" />
                  Download slide
                </button>
              </div>

              {/* Dot indicators */}
              <div className="flex items-center justify-center gap-1.5 mt-3">
                {Array.from({ length: TOTAL_SLIDES }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentSlide(i)}
                    aria-label={`Go to slide ${i + 1}`}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === currentSlide
                        ? 'w-5 bg-primary'
                        : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60'
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Rankings table */}
          <div className="bg-card border border-border rounded-lg shadow-sm p-4">
            <h3 className="text-sm font-medium text-foreground mb-4">
              Round {selectedRound} Rankings
            </h3>

            {rankingsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rankings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No ranking data for this round.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 pr-4 font-medium">Rank</th>
                      <th className="text-left py-2 pr-4 font-medium">Team</th>
                      <th className="text-left py-2 font-medium">Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="py-2 pr-4 font-medium text-foreground">
                          {r.ranking}
                        </td>
                        <td className="py-2 pr-4 text-foreground flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{
                              backgroundColor:
                                TEAM_COLORS[r.team_name] ?? '#64748b',
                            }}
                          />
                          {r.team_name}
                        </td>
                        <td className="py-2 pr-4">{movementDisplay(r.previous_ranking !== null ? r.previous_ranking - r.ranking : null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Enlarged slide modal ────────────────────────────────────────── */}
      {enlargedSlide !== null && selectedRound !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setEnlargedSlide(null)}
        >
          <div
            className="relative max-w-3xl w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setEnlargedSlide(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/carousel/slide/${enlargedSlide}?round=${selectedRound}`}
              alt={`Slide ${enlargedSlide}`}
              className="w-full rounded-lg"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm text-white/60">
                Slide {enlargedSlide} of 11
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setEnlargedSlide((prev) =>
                      prev !== null && prev > 0 ? prev - 1 : 11
                    )
                  }
                  className="px-3 py-1 text-xs text-white/70 hover:text-white bg-white/10 rounded transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() =>
                    setEnlargedSlide((prev) =>
                      prev !== null && prev < 11 ? prev + 1 : 0
                    )
                  }
                  className="px-3 py-1 text-xs text-white/70 hover:text-white bg-white/10 rounded transition-colors"
                >
                  Next
                </button>
                <button
                  onClick={() => downloadSlide(enlargedSlide)}
                  className="px-3 py-1 text-xs text-white/70 hover:text-white bg-white/10 rounded transition-colors flex items-center gap-1"
                >
                  <Download className="h-3 w-3" />
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
