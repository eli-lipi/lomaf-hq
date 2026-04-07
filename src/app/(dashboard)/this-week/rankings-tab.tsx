'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Save, Send, Bold, Italic, X, Maximize2 } from 'lucide-react';
import { cn, ordinal, movementLabel, movementColor } from '@/lib/utils';
import { TEAMS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { PwrnkgsRound, TeamSnapshot } from '@/lib/types';

interface RankingItem {
  id: string;
  team_id: number;
  team_name: string;
  coach: string;
  ranking: number;
  previous_ranking: number | null;
  writeup: string;
  snapshot?: TeamSnapshot;
  slideUrl?: string;
  slideLoading?: boolean;
}

export default function RankingsTab() {
  const [round, setRound] = useState<PwrnkgsRound | null>(null);
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [theme, setTheme] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [weekAheadText, setWeekAheadText] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [latestRound, setLatestRound] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [enlargedSlide, setEnlargedSlide] = useState<string | null>(null);
  const [previewSlideUrl, setPreviewSlideUrl] = useState<string | null>(null);
  const [summarySlideUrl, setSummarySlideUrl] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    async function loadData() {
      const { data: snapshots } = await supabase
        .from('team_snapshots')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1);

      const currentRound = snapshots?.[0]?.round_number;
      if (!currentRound) return;
      setLatestRound(currentRound);

      let { data: roundData } = await supabase
        .from('pwrnkgs_rounds')
        .select('*')
        .eq('round_number', currentRound)
        .single();

      if (!roundData) {
        const { data: newRound } = await supabase
          .from('pwrnkgs_rounds')
          .insert({ round_number: currentRound })
          .select()
          .single();
        roundData = newRound;
      }

      if (!roundData) return;
      setRound(roundData as PwrnkgsRound);
      setTheme(roundData.theme || '');
      setPreviewText(roundData.preview_text || '');
      setWeekAheadText(roundData.week_ahead_text || '');

      // Load existing rankings for this round
      const { data: existingRankings } = await supabase
        .from('pwrnkgs_rankings')
        .select('*')
        .eq('round_number', currentRound)
        .order('ranking', { ascending: true });

      // Load team snapshots
      const { data: teamSnapshots } = await supabase
        .from('team_snapshots')
        .select('*')
        .eq('round_number', currentRound);

      // Get MOST RECENT published PWRNKGs rankings (for default order)
      const { data: prevRankings } = await supabase
        .from('pwrnkgs_rankings')
        .select('team_id, ranking, round_number')
        .eq('round_number', currentRound - 1)
        .order('ranking', { ascending: true });

      // If no previous round rankings, try any previous published round
      let prevRankData = prevRankings;
      if (!prevRankData || prevRankData.length === 0) {
        const { data: lastPublished } = await supabase
          .from('pwrnkgs_rounds')
          .select('round_number')
          .eq('status', 'published')
          .order('round_number', { ascending: false })
          .limit(1);

        if (lastPublished && lastPublished.length > 0) {
          const { data: pubRankings } = await supabase
            .from('pwrnkgs_rankings')
            .select('team_id, ranking, round_number')
            .eq('round_number', lastPublished[0].round_number)
            .order('ranking', { ascending: true });
          prevRankData = pubRankings;
        }
      }

      const prevRankMap = new Map<number, number>();
      prevRankData?.forEach((r) => prevRankMap.set(r.team_id, r.ranking));

      const snapshotMap = new Map<number, TeamSnapshot>();
      teamSnapshots?.forEach((s) => snapshotMap.set(s.team_id, s as TeamSnapshot));

      if (existingRankings && existingRankings.length > 0) {
        // Existing rankings for this round
        setRankings(
          existingRankings.map((r) => {
            const team = TEAMS.find((t) => t.team_id === r.team_id);
            return {
              id: String(r.team_id),
              team_id: r.team_id,
              team_name: r.team_name,
              coach: team?.coach || '',
              ranking: r.ranking,
              previous_ranking: r.previous_ranking,
              writeup: r.writeup || '',
              snapshot: snapshotMap.get(r.team_id),
            };
          })
        );
      } else {
        // Default order: use previous PWRNKGs rankings (not points for)
        let sorted: typeof TEAMS;
        if (prevRankMap.size > 0) {
          sorted = [...TEAMS].sort((a, b) => {
            const rankA = prevRankMap.get(a.team_id) ?? 99;
            const rankB = prevRankMap.get(b.team_id) ?? 99;
            return rankA - rankB;
          });
        } else {
          sorted = [...TEAMS].sort((a, b) => {
            const snapA = snapshotMap.get(a.team_id);
            const snapB = snapshotMap.get(b.team_id);
            if (snapA && snapB) return (snapA.league_rank || 99) - (snapB.league_rank || 99);
            return a.team_name.localeCompare(b.team_name);
          });
        }

        setRankings(
          sorted.map((team, i) => ({
            id: String(team.team_id),
            team_id: team.team_id,
            team_name: team.team_name,
            coach: team.coach,
            ranking: i + 1,
            previous_ranking: prevRankMap.get(team.team_id) ?? null,
            writeup: '',
            snapshot: snapshotMap.get(team.team_id),
          }))
        );
      }
    }

    loadData();
  }, []);

  // Generate slide preview for a specific team ranking
  const generateSlidePreview = useCallback(async (teamRanking: number) => {
    if (!round) return;
    const slideIndex = 11 - teamRanking; // rank 1 = slide 10, rank 10 = slide 1
    if (slideIndex < 1 || slideIndex > 10) return;

    // Save current data first
    const rankingRows = rankings.map((r) => ({
      round_id: round.id,
      round_number: round.round_number,
      team_id: r.team_id,
      team_name: r.team_name,
      ranking: r.ranking,
      previous_ranking: r.previous_ranking,
      writeup: r.writeup,
    }));

    await supabase.from('pwrnkgs_rounds')
      .update({ theme: theme || null, preview_text: previewText || null, week_ahead_text: weekAheadText || null })
      .eq('id', round.id);
    await supabase.from('pwrnkgs_rankings')
      .upsert(rankingRows, { onConflict: 'round_number,team_id' });

    // Set loading state
    setRankings((prev) =>
      prev.map((r) => r.ranking === teamRanking ? { ...r, slideLoading: true } : r)
    );

    try {
      const res = await fetch(`/api/carousel/slide/${slideIndex}?round=${round.round_number}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setRankings((prev) =>
          prev.map((r) => {
            if (r.ranking === teamRanking) {
              if (r.slideUrl) URL.revokeObjectURL(r.slideUrl);
              return { ...r, slideUrl: url, slideLoading: false };
            }
            return r;
          })
        );
      }
    } catch {
      setRankings((prev) =>
        prev.map((r) => r.ranking === teamRanking ? { ...r, slideLoading: false } : r)
      );
    }
  }, [round, rankings, theme, previewText, weekAheadText]);

  // Generate preview/summary slides
  const generateSpecialSlide = useCallback(async (slideIndex: 0 | 11) => {
    if (!round) return;

    const rankingRows = rankings.map((r) => ({
      round_id: round.id,
      round_number: round.round_number,
      team_id: r.team_id,
      team_name: r.team_name,
      ranking: r.ranking,
      previous_ranking: r.previous_ranking,
      writeup: r.writeup,
    }));

    await supabase.from('pwrnkgs_rounds')
      .update({ theme: theme || null, preview_text: previewText || null, week_ahead_text: weekAheadText || null })
      .eq('id', round.id);
    await supabase.from('pwrnkgs_rankings')
      .upsert(rankingRows, { onConflict: 'round_number,team_id' });

    try {
      const res = await fetch(`/api/carousel/slide/${slideIndex}?round=${round.round_number}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (slideIndex === 0) {
          setPreviewSlideUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
        } else {
          setSummarySlideUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
        }
      }
    } catch (err) {
      console.error('Slide generation failed:', err);
    }
  }, [round, rankings, theme, previewText, weekAheadText]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setRankings((items) => {
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      const reordered = arrayMove(items, oldIndex, newIndex);
      return reordered.map((item, i) => ({ ...item, ranking: i + 1, slideUrl: undefined }));
    });
  };

  const updateWriteup = useCallback((teamId: number, writeup: string) => {
    setRankings((prev) =>
      prev.map((r) => (r.team_id === teamId ? { ...r, writeup } : r))
    );
  }, []);

  const save = async () => {
    if (!round) return;
    setSaving(true);
    setMessage(null);

    try {
      await supabase.from('pwrnkgs_rounds')
        .update({ theme: theme || null, preview_text: previewText || null, week_ahead_text: weekAheadText || null })
        .eq('id', round.id);

      const rankingRows = rankings.map((r) => ({
        round_id: round.id,
        round_number: round.round_number,
        team_id: r.team_id,
        team_name: r.team_name,
        ranking: r.ranking,
        previous_ranking: r.previous_ranking,
        writeup: r.writeup,
      }));

      const { error } = await supabase.from('pwrnkgs_rankings')
        .upsert(rankingRows, { onConflict: 'round_number,team_id' });
      if (error) throw error;
      setMessage({ type: 'success', text: 'Rankings saved!' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!round) return;
    setPublishing(true);
    setMessage(null);

    try {
      await save();
      await supabase.from('pwrnkgs_rounds')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', round.id);
      setRound((prev) => (prev ? { ...prev, status: 'published' } : prev));
      setMessage({ type: 'success', text: 'Published!' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Publish failed' });
    } finally {
      setPublishing(false);
    }
  };

  if (!latestRound) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Upload data first to start editing rankings.</p>
      </div>
    );
  }

  const isPublished = round?.status === 'published';

  return (
    <div>
      {/* Enlarged slide modal */}
      {enlargedSlide && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8" onClick={() => setEnlargedSlide(null)}>
          <div className="relative max-w-[80vh] max-h-[80vh]">
            <button className="absolute -top-10 right-0 text-white hover:text-gray-300" onClick={() => setEnlargedSlide(null)}>
              <X size={24} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enlargedSlide} alt="Slide" className="w-full h-full object-contain rounded-lg" />
          </div>
        </div>
      )}

      {/* Round header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded-full text-sm">R{latestRound}</span>
        {isPublished && (
          <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">Published</span>
        )}
      </div>

      {/* Theme + Preview Text section with slide preview */}
      <div className="bg-card rounded-lg border border-border shadow-sm mb-6">
        <div className="flex gap-4 p-5">
          <div className="flex-1 space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Week&apos;s Theme</label>
              <input
                type="text"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder='e.g., "What Went Right? What Went Wrong?"'
                disabled={isPublished}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Preview Text (Slide 1)</label>
              <textarea
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder="The intro paragraph for the first carousel slide..."
                rows={5}
                disabled={isPublished}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
              />
            </div>
          </div>
          {/* Preview slide */}
          <div className="w-44 shrink-0">
            <div
              className="aspect-square bg-gray-100 rounded-lg overflow-hidden relative cursor-pointer group border border-border"
              onClick={() => previewSlideUrl && setEnlargedSlide(previewSlideUrl)}
            >
              {previewSlideUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewSlideUrl} alt="Preview slide" className="w-full h-full object-contain" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 size={20} className="text-white" />
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                  Slide 1
                </div>
              )}
            </div>
            <button
              onClick={() => generateSpecialSlide(0)}
              className="w-full mt-2 text-xs text-primary hover:underline font-medium"
            >
              Refresh Preview
            </button>
          </div>
        </div>
      </div>

      {/* Rankings list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rankings.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {rankings.map((item) => (
              <SortableRankingCard
                key={item.id}
                item={item}
                onWriteupChange={updateWriteup}
                onGenerateSlide={generateSlidePreview}
                onEnlargeSlide={setEnlargedSlide}
                disabled={isPublished}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Week Ahead + Summary slide */}
      <div className="bg-card rounded-lg border border-border shadow-sm mt-6">
        <div className="flex gap-4 p-5">
          <div className="flex-1">
            <label className="block text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Week Ahead Text (Slide 12)</label>
            <textarea
              value={weekAheadText}
              onChange={(e) => setWeekAheadText(e.target.value)}
              placeholder="Closing paragraph about the upcoming round..."
              rows={4}
              disabled={isPublished}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
            />
          </div>
          <div className="w-44 shrink-0">
            <div
              className="aspect-square bg-gray-100 rounded-lg overflow-hidden relative cursor-pointer group border border-border"
              onClick={() => summarySlideUrl && setEnlargedSlide(summarySlideUrl)}
            >
              {summarySlideUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={summarySlideUrl} alt="Summary slide" className="w-full h-full object-contain" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Maximize2 size={20} className="text-white" />
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                  Slide 12
                </div>
              )}
            </div>
            <button
              onClick={() => generateSpecialSlide(11)}
              className="w-full mt-2 text-xs text-primary hover:underline font-medium"
            >
              Refresh Summary
            </button>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {!isPublished && (
        <div className="flex gap-3 mt-6">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 shadow-sm"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            onClick={publish}
            disabled={publishing}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Send size={16} />
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      )}

      {message && (
        <div className={cn(
          'mt-4 p-3 rounded-lg text-sm font-medium',
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        )}>
          {message.text}
        </div>
      )}
    </div>
  );
}

function SortableRankingCard({
  item,
  onWriteupChange,
  onGenerateSlide,
  onEnlargeSlide,
  disabled,
}: {
  item: RankingItem;
  onWriteupChange: (teamId: number, writeup: string) => void;
  onGenerateSlide: (ranking: number) => void;
  onEnlargeSlide: (url: string) => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const movement = movementLabel(item.ranking, item.previous_ranking);
  const moveColor = movementColor(item.ranking, item.previous_ranking);

  const insertFormatting = (before: string, after: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = item.writeup;
    const selected = text.slice(start, end);

    const newText = text.slice(0, start) + before + selected + after + text.slice(end);
    onWriteupChange(item.team_id, newText);

    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      const newPos = start + before.length + selected.length + after.length;
      textarea.setSelectionRange(
        selected.length > 0 ? start : start + before.length,
        selected.length > 0 ? newPos : start + before.length
      );
    }, 0);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-card border border-border rounded-lg shadow-sm',
        isDragging && 'opacity-50 z-50 shadow-lg'
      )}
    >
      <div className="flex gap-4 p-4">
        {/* Left: Drag + Rank */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <div
            {...attributes}
            {...listeners}
            className={cn('cursor-grab active:cursor-grabbing', disabled && 'cursor-default')}
          >
            <GripVertical size={18} className="text-gray-400" />
          </div>
          <span className="text-2xl font-bold text-primary">{item.ranking}</span>
          <span className={cn('text-xs font-medium', moveColor)}>{movement}</span>
        </div>

        {/* Middle: Team info + writeup */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-semibold text-sm truncate">{item.team_name}</span>
            <span className="text-xs text-muted-foreground">{item.coach}</span>
          </div>

          {item.snapshot && (
            <div className="flex gap-4 text-xs text-muted-foreground mb-2">
              <span>Score: {Math.round(item.snapshot.pts_for)}</span>
              <span>{item.snapshot.wins}W-{item.snapshot.losses}L</span>
              <span>Rank: {ordinal(item.snapshot.league_rank || 0)}</span>
            </div>
          )}

          {/* Formatting toolbar */}
          <div className="flex items-center gap-1 mb-1">
            <button
              type="button"
              onClick={() => insertFormatting('**', '**')}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Bold"
            >
              <Bold size={14} />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting('*', '*')}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Italic"
            >
              <Italic size={14} />
            </button>
            <span className="text-xs text-muted-foreground ml-2">Use **bold** and *italic* markdown</span>
          </div>

          <textarea
            ref={textareaRef}
            value={item.writeup}
            onChange={(e) => onWriteupChange(item.team_id, e.target.value)}
            placeholder="Write 2-3 sentences about this team..."
            rows={3}
            disabled={disabled}
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
          />
        </div>

        {/* Right: Slide preview */}
        <div className="w-28 shrink-0 flex flex-col">
          <div
            className="aspect-square bg-gray-100 rounded-lg overflow-hidden relative cursor-pointer group border border-border"
            onClick={() => item.slideUrl && onEnlargeSlide(item.slideUrl)}
          >
            {item.slideLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {item.slideUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.slideUrl} alt={`Slide for ${item.team_name}`} className="w-full h-full object-contain" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Maximize2 size={16} className="text-white" />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[10px]">
                #{item.ranking}
              </div>
            )}
          </div>
          <button
            onClick={() => onGenerateSlide(item.ranking)}
            disabled={item.slideLoading}
            className="mt-1 text-[10px] text-primary hover:underline font-medium disabled:opacity-50"
          >
            {item.slideLoading ? 'Generating...' : 'Refresh Slide'}
          </button>
        </div>
      </div>
    </div>
  );
}
