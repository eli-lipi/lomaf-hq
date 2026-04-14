'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Loader2, Image as ImageIcon, Send, Save, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { TEAMS } from '@/lib/constants';
import { getWorkingRound } from '@/lib/get-working-round';
import { computeSlideData, type SlideTeamData } from '@/lib/compute-slide-data';
import SlidePreview, { type SlidePreviewData } from './slide-preview';

export default function PreviewPublishTab() {
  const [roundNumber, setRoundNumber] = useState<number | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [slides, setSlides] = useState<(string | null)[]>(Array(12).fill(null));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [enlargedSlide, setEnlargedSlide] = useState<string | null>(null);

  // Data for client-side slide rendering (same as Rankings Editor)
  const [slideDataList, setSlideDataList] = useState<{ slideIndex: number; data: SlidePreviewData }[]>([]);
  const slideRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Checklist state
  const [checklist, setChecklist] = useState<{
    previewText: boolean;
    weekAheadText: boolean;
    teamWriteups: { teamName: string; done: boolean }[];
  } | null>(null);

  const setSlideRef = useCallback((slideIndex: number, el: HTMLDivElement | null) => {
    if (el) slideRefs.current.set(slideIndex, el);
    else slideRefs.current.delete(slideIndex);
  }, []);

  useEffect(() => {
    async function loadData() {
      const { round: workingRound, roundNumber } = await getWorkingRound();
      if (!roundNumber || !workingRound) return;

      const currentRound = roundNumber;
      setRoundNumber(currentRound);
      setRoundId(workingRound.id);
      setIsPublished(workingRound.status === 'published');

      // Fetch rankings
      const { data: rankings } = await supabase
        .from('pwrnkgs_rankings')
        .select('*')
        .eq('round_number', currentRound)
        .order('ranking', { ascending: true });

      // Build checklist
      setChecklist({
        previewText: !!workingRound.preview_text?.trim(),
        weekAheadText: !!workingRound.week_ahead_text?.trim(),
        teamWriteups: (rankings || []).map((r) => ({
          teamName: r.team_name,
          done: !!r.writeup?.trim(),
        })),
      });

      if (!rankings || rankings.length === 0) return;

      // Compute slide data (same as Rankings Editor)
      const computed = await computeSlideData(supabase, currentRound);

      // Fetch sparkline data
      const { data: allRankings } = await supabase
        .from('pwrnkgs_rankings')
        .select('team_id, ranking, round_number')
        .lte('round_number', currentRound)
        .order('round_number', { ascending: true });

      const sparkMap = new Map<number, { round: string; ranking: number }[]>();
      allRankings?.forEach((r: { team_id: number; ranking: number; round_number: number }) => {
        if (!sparkMap.has(r.team_id)) sparkMap.set(r.team_id, []);
        sparkMap.get(r.team_id)!.push({ round: `R${r.round_number}`, ranking: r.ranking });
      });

      // Fetch coach photos
      const coachPhotoMap = new Map<string, string>();
      const { data: photoFiles } = await supabase.storage.from('coach-photos').list('', { limit: 100 });
      if (photoFiles) {
        for (const f of photoFiles) {
          const key = f.name.split('.')[0];
          const { data: urlData } = supabase.storage.from('coach-photos').getPublicUrl(f.name);
          coachPhotoMap.set(key, urlData.publicUrl);
        }
      }

      // Build SlidePreviewData for each team (slides 1–10)
      const slideList: { slideIndex: number; data: SlidePreviewData }[] = [];
      for (const r of rankings) {
        const team = TEAMS.find(t => t.team_id === r.team_id);
        const cd = computed.get(r.team_id);
        const photoKeys = team ? (Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key]) : [];
        const photoUrls = photoKeys.map(k => coachPhotoMap.get(k)).filter(Boolean) as string[];

        const previewData: SlidePreviewData = {
          ranking: r.ranking,
          previousRanking: r.previous_ranking,
          teamName: r.team_name,
          coachName: team?.coach || '',
          coachPhotoUrls: photoUrls,
          isCoCoached: team?.is_co_coached,
          scoreThisWeek: cd?.scoreThisWeek ?? null,
          scoreThisWeekRank: cd?.scoreThisWeekRank ?? null,
          seasonTotal: cd?.seasonTotal ?? null,
          seasonTotalRank: cd?.seasonTotalRank ?? null,
          record: cd?.record ?? { wins: 0, losses: 0, ties: 0 },
          ladderPosition: cd?.ladderPosition ?? null,
          luckScore: cd?.luckScore ?? null,
          luckRank: cd?.luckRank ?? null,
          lineRanks: cd?.lineRanks ?? { def: null, mid: null, fwd: null, ruc: null, utl: null },
          pwrnkgsHistory: sparkMap.get(r.team_id) || [],
          writeup: r.writeup || '',
          roundNumber: currentRound,
        };

        // Slide index: rank 10 → slide 1, rank 1 → slide 10
        const slideIndex = 11 - r.ranking;
        slideList.push({ slideIndex, data: previewData });
      }

      setSlideDataList(slideList);
    }
    loadData();
  }, []);

  const generateAll = async () => {
    if (!roundNumber) return;
    setGenerating(true);
    setProgress(0);
    setError(null);
    const newSlides: (string | null)[] = Array(12).fill(null);

    try {
      // Import html-to-image for client-side capture
      const { toPng } = await import('html-to-image');

      // Slide 0 (Preview) and Slide 11 (Summary) — still use API route
      for (const i of [0, 11]) {
        try {
          const res = await fetch(`/api/carousel/slide/${i}?round=${roundNumber}&v=${Date.now()}`);
          if (!res.ok) {
            let errMsg = `Slide ${i === 0 ? 'Preview' : 'Summary'}: HTTP ${res.status}`;
            try { const body = await res.json(); errMsg += ` — ${body.error || JSON.stringify(body)}`; } catch { /* not JSON */ }
            throw new Error(errMsg);
          }
          const blob = await res.blob();
          newSlides[i] = URL.createObjectURL(blob);
        } catch (slideErr) {
          console.error(`Failed to generate slide ${i}:`, slideErr);
          setError((prev) => {
            const msg = slideErr instanceof Error ? slideErr.message : `Slide ${i} failed`;
            return prev ? `${prev}\n${msg}` : msg;
          });
        }
        setProgress(i === 0 ? 1 : 12);
        setSlides([...newSlides]);
      }

      // Slides 1–10 (Team rankings) — render client-side using SlidePreview
      for (const { slideIndex } of slideDataList) {
        try {
          const el = slideRefs.current.get(slideIndex);
          if (!el) {
            throw new Error(`Slide #${11 - slideIndex}: DOM element not found`);
          }
          // Capture at 2x pixel ratio: 540 × 2 = 1080
          const dataUrl = await toPng(el, {
            width: 540,
            height: 540,
            pixelRatio: 2,
            cacheBust: true,
          });
          newSlides[slideIndex] = dataUrl;
        } catch (slideErr) {
          console.error(`Failed to capture slide ${slideIndex}:`, slideErr);
          setError((prev) => {
            const msg = slideErr instanceof Error ? slideErr.message : `Slide ${slideIndex} failed`;
            return prev ? `${prev}\n${msg}` : msg;
          });
        }
        setProgress(slideIndex + 1);
        setSlides([...newSlides]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const downloadAll = async () => {
    const { default: JSZip } = await import('jszip');
    const { saveAs } = await import('file-saver');
    const zip = new JSZip();

    for (let i = 0; i < slides.length; i++) {
      if (!slides[i]) continue;
      const response = await fetch(slides[i]!);
      const blob = await response.blob();
      const name = i === 0 ? 'slide-01-preview.png' : i === 11 ? 'slide-12-summary.png' : `slide-${String(i + 1).padStart(2, '0')}-rank${11 - i}.png`;
      zip.file(name, blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `r${roundNumber}-pwrnkgs.zip`);
  };

  const downloadSlide = (index: number) => {
    if (!slides[index]) return;
    const a = document.createElement('a');
    a.href = slides[index]!;
    const name = index === 0 ? 'slide-01-preview.png' : index === 11 ? 'slide-12-summary.png' : `slide-${String(index + 1).padStart(2, '0')}-rank${11 - index}.png`;
    a.download = name;
    a.click();
  };

  const saveDraft = async () => {
    setSaving(true);
    setMessage(null);
    try {
      setMessage({ type: 'success', text: 'Draft saved!' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally { setSaving(false); }
  };

  const publish = async () => {
    if (!roundId) return;
    setPublishing(true);
    setMessage(null);
    try {
      await supabase.from('pwrnkgs_rounds')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', roundId);
      setIsPublished(true);
      setMessage({ type: 'success', text: 'Published! This round is now locked and visible in Previous Weeks.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Publish failed' });
    } finally { setPublishing(false); }
  };

  if (!roundNumber) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Upload data first to preview and publish.</p>
      </div>
    );
  }

  const slideLabel = (i: number) => {
    if (i === 0) return 'Preview';
    if (i === 11) return 'Summary';
    return `#${11 - i}`;
  };

  const allWriteupsDone = checklist?.teamWriteups.every((t) => t.done) ?? false;
  const readyToPublish = checklist ? checklist.previewText && allWriteupsDone : false;

  return (
    <div>
      {/* Hidden off-screen container for client-side slide rendering */}
      <div style={{ position: 'fixed', left: '-9999px', top: 0, pointerEvents: 'none' }} aria-hidden>
        {slideDataList.map(({ slideIndex, data }) => (
          <div
            key={slideIndex}
            ref={(el) => setSlideRef(slideIndex, el)}
            style={{ width: 540, height: 540 }}
          >
            <SlidePreview data={data} />
          </div>
        ))}
      </div>

      {/* Enlarged slide modal */}
      {enlargedSlide && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8" onClick={() => setEnlargedSlide(null)}>
          <div className="relative max-w-[80vh] max-h-[80vh]">
            <button className="absolute -top-10 right-0 text-white hover:text-gray-300" onClick={() => setEnlargedSlide(null)}>
              &times;
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enlargedSlide} alt="Slide" className="w-full h-full object-contain rounded-lg" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded-full text-sm">R{roundNumber}</span>
          {isPublished && <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">Published</span>}
        </div>
        <div className="flex gap-3">
          <button onClick={generateAll} disabled={generating}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm',
              generating ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary/90')}>
            {generating ? <><Loader2 size={16} className="animate-spin" /> Generating ({progress}/12)</> : <><ImageIcon size={16} /> Generate All</>}
          </button>
          {slides.some((s) => s !== null) && (
            <button onClick={downloadAll} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-card border border-border hover:bg-muted transition-colors shadow-sm">
              <Download size={16} /> Download ZIP
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {generating && (
        <div className="mb-6">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${(progress / 12) * 100}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1 text-center">Generating slide {progress} of 12...</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Slide gallery (2/3) */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Carousel Gallery</h3>
            {slides.every((s) => s === null) && !generating && (
              <span className="text-xs text-muted-foreground">Click &quot;Generate All&quot; to render slides</span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i}
                className="aspect-square bg-card border border-border rounded-lg overflow-hidden relative group cursor-pointer shadow-sm"
                onClick={() => slides[i] ? setEnlargedSlide(slides[i]!) : undefined}>
                {slides[i] ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={slides[i]!} alt={`Slide ${i + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Download size={20} className="text-white" onClick={(e) => { e.stopPropagation(); downloadSlide(i); }} />
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                    <ImageIcon size={20} className="mb-1 opacity-30" />
                    <span className="text-xs">{slideLabel(i)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Checklist + Actions (1/3) */}
        <div className="space-y-4">
          {/* Checklist */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-4">
            <h3 className="text-sm font-semibold mb-3">Publish Checklist</h3>
            <div className="space-y-2">
              <CheckItem label="Preview text written" done={checklist?.previewText ?? false} />
              <CheckItem label="Week ahead text written" done={checklist?.weekAheadText ?? false} />
              <div className="border-t border-border my-2" />
              {checklist?.teamWriteups.map((t, i) => (
                <CheckItem key={i} label={t.teamName} done={t.done} />
              ))}
            </div>
          </div>

          {/* Actions */}
          {!isPublished && (
            <div className="bg-card rounded-lg border border-border shadow-sm p-4 space-y-3">
              <button onClick={saveDraft} disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                <Save size={16} /> {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button onClick={publish} disabled={publishing || !readyToPublish}
                className={cn('w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50',
                  readyToPublish ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-gray-200 text-gray-500')}>
                <Send size={16} /> {publishing ? 'Publishing...' : 'Publish'}
              </button>
              {!readyToPublish && (
                <p className="text-xs text-muted-foreground text-center">Complete all checklist items to publish</p>
              )}
            </div>
          )}

          {message && (
            <div className={cn('p-3 rounded-lg text-sm font-medium',
              message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
            )}>{message.text}</div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm whitespace-pre-wrap">{error}</div>
      )}
    </div>
  );
}

function CheckItem({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {done ? (
        <CheckCircle size={16} className="text-green-500 shrink-0" />
      ) : (
        <AlertCircle size={16} className="text-gray-300 shrink-0" />
      )}
      <span className={cn('text-sm', done ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}
