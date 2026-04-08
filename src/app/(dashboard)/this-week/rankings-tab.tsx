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
import { GripVertical, Save, Send, X, Maximize2, Check, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedSpecialSlide, setSelectedSpecialSlide] = useState<'preview' | 'summary' | null>(null);
  const [specialSlideUrls, setSpecialSlideUrls] = useState<{ preview?: string; summary?: string }>({});
  const [specialSlideLoading, setSpecialSlideLoading] = useState<{ preview?: boolean; summary?: boolean }>({});
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [roundFieldsOpen, setRoundFieldsOpen] = useState(true);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoaded = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Load data
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

      const { data: existingRankings } = await supabase
        .from('pwrnkgs_rankings')
        .select('*')
        .eq('round_number', currentRound)
        .order('ranking', { ascending: true });

      const { data: teamSnapshots } = await supabase
        .from('team_snapshots')
        .select('*')
        .eq('round_number', currentRound);

      const { data: lastPublished } = await supabase
        .from('pwrnkgs_rounds')
        .select('round_number')
        .eq('status', 'published')
        .order('round_number', { ascending: false })
        .limit(1);

      let prevRankData: { team_id: number; ranking: number }[] | null = null;
      if (lastPublished && lastPublished.length > 0) {
        const { data } = await supabase
          .from('pwrnkgs_rankings')
          .select('team_id, ranking')
          .eq('round_number', lastPublished[0].round_number)
          .order('ranking', { ascending: true });
        prevRankData = data;
      }

      const prevRankMap = new Map<number, number>();
      prevRankData?.forEach((r) => prevRankMap.set(r.team_id, r.ranking));

      const snapshotMap = new Map<number, TeamSnapshot>();
      teamSnapshots?.forEach((s) => snapshotMap.set(s.team_id, s as TeamSnapshot));

      let items: RankingItem[];
      if (existingRankings && existingRankings.length > 0) {
        items = existingRankings.map((r) => {
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
        });
      } else {
        let sorted: typeof TEAMS;
        if (prevRankMap.size > 0) {
          sorted = [...TEAMS].sort((a, b) => {
            const rankA = prevRankMap.get(a.team_id) ?? 99;
            const rankB = prevRankMap.get(b.team_id) ?? 99;
            return rankA - rankB;
          });
        } else {
          sorted = [...TEAMS];
        }

        items = sorted.map((team, i) => ({
          id: String(team.team_id),
          team_id: team.team_id,
          team_name: team.team_name,
          coach: team.coach,
          ranking: i + 1,
          previous_ranking: prevRankMap.get(team.team_id) ?? null,
          writeup: '',
          snapshot: snapshotMap.get(team.team_id),
        }));
      }

      setRankings(items);
      // Select first team by default
      if (items.length > 0) setSelectedTeamId(items[0].team_id);
      dataLoaded.current = true;
    }

    loadData();
  }, []);

  // Auto-save (debounced 5s)
  const doAutoSave = useCallback(async () => {
    if (!round || round.status === 'published') return;
    setAutoSaveStatus('saving');
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

      await supabase.from('pwrnkgs_rankings')
        .upsert(rankingRows, { onConflict: 'round_number,team_id' });

      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch {
      setAutoSaveStatus('idle');
    }
  }, [round, rankings, theme, previewText, weekAheadText]);

  const triggerAutoSave = useCallback(() => {
    if (!dataLoaded.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      doAutoSave();
    }, 5000);
  }, [doAutoSave]);

  useEffect(() => {
    triggerAutoSave();
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [rankings, theme, previewText, weekAheadText, triggerAutoSave]);

  // Save data before generating a slide
  const saveBeforeGenerate = useCallback(async () => {
    if (!round) return;
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

    await supabase.from('pwrnkgs_rankings')
      .upsert(rankingRows, { onConflict: 'round_number,team_id' });
  }, [round, rankings, theme, previewText, weekAheadText]);

  // Generate slide for a team
  const generateSlidePreview = useCallback(async (teamRanking: number) => {
    if (!round) return;
    const slideIndex = 11 - teamRanking;
    if (slideIndex < 1 || slideIndex > 10) return;

    await saveBeforeGenerate();

    setRankings((prev) => prev.map((r) => r.ranking === teamRanking ? { ...r, slideLoading: true } : r));

    try {
      const res = await fetch(`/api/carousel/slide/${slideIndex}?round=${round.round_number}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setRankings((prev) => prev.map((r) => {
          if (r.ranking === teamRanking) {
            if (r.slideUrl) URL.revokeObjectURL(r.slideUrl);
            return { ...r, slideUrl: url, slideLoading: false };
          }
          return r;
        }));
      }
    } catch {
      setRankings((prev) => prev.map((r) => r.ranking === teamRanking ? { ...r, slideLoading: false } : r));
    }
  }, [round, saveBeforeGenerate]);

  const generateSpecialSlide = useCallback(async (type: 'preview' | 'summary') => {
    if (!round) return;
    const slideIndex = type === 'preview' ? 0 : 11;
    await saveBeforeGenerate();

    setSpecialSlideLoading((prev) => ({ ...prev, [type]: true }));

    try {
      const res = await fetch(`/api/carousel/slide/${slideIndex}?round=${round.round_number}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setSpecialSlideUrls((prev) => {
          if (prev[type]) URL.revokeObjectURL(prev[type]!);
          return { ...prev, [type]: url };
        });
      }
    } catch (err) {
      console.error('Slide gen failed:', err);
    } finally {
      setSpecialSlideLoading((prev) => ({ ...prev, [type]: false }));
    }
  }, [round, saveBeforeGenerate]);

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

  const updateWriteup = useCallback((teamId: number, text: string) => {
    setRankings((prev) =>
      prev.map((r) => r.team_id === teamId ? { ...r, writeup: text } : r)
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
    } finally { setSaving(false); }
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
    } finally { setPublishing(false); }
  };

  if (!latestRound) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Upload data first to start editing rankings.</p>
      </div>
    );
  }

  const isPublished = round?.status === 'published';
  const selectedItem = selectedTeamId ? rankings.find((r) => r.team_id === selectedTeamId) : null;

  // Determine what to show in the right panel
  const showingSpecialSlide = selectedSpecialSlide !== null;
  const currentSlideUrl = showingSpecialSlide
    ? specialSlideUrls[selectedSpecialSlide!]
    : selectedItem?.slideUrl;
  const currentSlideLoading = showingSpecialSlide
    ? specialSlideLoading[selectedSpecialSlide!]
    : selectedItem?.slideLoading;

  return (
    <div className="flex gap-6 h-[calc(100vh-200px)] min-h-[600px]">
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

      {/* ==================== LEFT PANEL (40%) ==================== */}
      <div className="w-[40%] flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4 shrink-0">
          <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded-full text-sm">R{latestRound}</span>
          {isPublished && (
            <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">Published</span>
          )}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {autoSaveStatus === 'saving' && <><div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Saving...</>}
            {autoSaveStatus === 'saved' && <><Check size={14} className="text-green-600" /> Saved</>}
          </div>
        </div>

        {/* Collapsible round fields */}
        <div className="bg-card rounded-lg border border-border shadow-sm mb-4 shrink-0">
          <button
            onClick={() => setRoundFieldsOpen(!roundFieldsOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            Round Details
            {roundFieldsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {roundFieldsOpen && (
            <div className="px-4 pb-4 space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Theme</label>
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
                <label className="block text-xs text-muted-foreground mb-1">Preview Text (Slide 1)</label>
                <textarea
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  placeholder="The intro paragraph..."
                  rows={3}
                  disabled={isPublished}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Week Ahead Text (Slide 12)</label>
                <textarea
                  value={weekAheadText}
                  onChange={(e) => setWeekAheadText(e.target.value)}
                  placeholder="Closing paragraph..."
                  rows={3}
                  disabled={isPublished}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
                />
              </div>
            </div>
          )}
        </div>

        {/* Special slides row */}
        <div className="flex gap-2 mb-3 shrink-0">
          <button
            onClick={() => { setSelectedSpecialSlide('preview'); setSelectedTeamId(null); }}
            className={cn(
              'flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-colors',
              selectedSpecialSlide === 'preview'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            Slide 1: Preview
          </button>
          <button
            onClick={() => { setSelectedSpecialSlide('summary'); setSelectedTeamId(null); }}
            className={cn(
              'flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-colors',
              selectedSpecialSlide === 'summary'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            Slide 12: Summary
          </button>
        </div>

        {/* Draggable rankings list */}
        <div className="flex-1 overflow-y-auto pr-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={rankings.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {rankings.map((item) => (
                  <SortableRankRow
                    key={item.id}
                    item={item}
                    isSelected={selectedTeamId === item.team_id && !showingSpecialSlide}
                    onSelect={() => { setSelectedTeamId(item.team_id); setSelectedSpecialSlide(null); }}
                    disabled={isPublished}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Actions */}
        {!isPublished && (
          <div className="flex gap-3 mt-4 shrink-0">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 shadow-sm">
              <Save size={16} /> {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button onClick={publish} disabled={publishing}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm">
              <Send size={16} /> {publishing ? 'Publishing...' : 'Publish'}
            </button>
          </div>
        )}

        {message && (
          <div className={cn('mt-3 p-3 rounded-lg text-sm font-medium',
            message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          )}>{message.text}</div>
        )}
      </div>

      {/* ==================== RIGHT PANEL (60%) ==================== */}
      <div className="w-[60%] flex flex-col min-w-0 overflow-hidden">
        {selectedItem && !showingSpecialSlide ? (
          <>
            {/* Team header */}
            <div className="flex items-center gap-3 mb-4 shrink-0">
              <span className="text-3xl font-bold text-primary">{selectedItem.ranking}</span>
              <div className="min-w-0">
                <div className="font-semibold truncate">{selectedItem.team_name}</div>
                <div className="text-xs text-muted-foreground">{selectedItem.coach}</div>
              </div>
              <span className={cn('text-sm font-medium ml-2', movementColor(selectedItem.ranking, selectedItem.previous_ranking))}>
                {movementLabel(selectedItem.ranking, selectedItem.previous_ranking)}
              </span>
              {selectedItem.snapshot && (
                <div className="ml-auto flex gap-4 text-xs text-muted-foreground">
                  <span>{Math.round(selectedItem.snapshot.pts_for)} pts</span>
                  <span>{selectedItem.snapshot.wins}W-{selectedItem.snapshot.losses}L</span>
                  <span>{ordinal(selectedItem.snapshot.league_rank || 0)}</span>
                </div>
              )}
            </div>

            {/* Writeup textarea */}
            <div className="mb-4 shrink-0">
              <label className="block text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Writeup</label>
              <textarea
                value={selectedItem.writeup}
                onChange={(e) => updateWriteup(selectedItem.team_id, e.target.value)}
                placeholder="Write about this team..."
                rows={5}
                disabled={isPublished}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
              />
            </div>

            {/* Slide preview */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Slide Preview</label>
                <button
                  onClick={() => generateSlidePreview(selectedItem.ranking)}
                  disabled={selectedItem.slideLoading}
                  className="text-xs text-primary hover:underline font-medium disabled:opacity-50"
                >
                  {selectedItem.slideLoading ? 'Generating...' : 'Generate Slide'}
                </button>
              </div>
              <div
                className="flex-1 bg-gray-100 rounded-lg overflow-hidden relative cursor-pointer group border border-border"
                onClick={() => currentSlideUrl && setEnlargedSlide(currentSlideUrl)}
              >
                {currentSlideLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {currentSlideUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={currentSlideUrl} alt={`Slide for ${selectedItem.team_name}`} className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Maximize2 size={24} className="text-white" />
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    Click &quot;Generate Slide&quot; to preview
                  </div>
                )}
              </div>
            </div>
          </>
        ) : showingSpecialSlide ? (
          <>
            {/* Special slide header */}
            <div className="flex items-center gap-3 mb-4 shrink-0">
              <span className="text-lg font-bold">
                {selectedSpecialSlide === 'preview' ? 'Slide 1: Preview' : 'Slide 12: Summary'}
              </span>
            </div>

            {/* Relevant text field */}
            <div className="mb-4 shrink-0">
              <label className="block text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wide">
                {selectedSpecialSlide === 'preview' ? 'Preview Text' : 'Week Ahead Text'}
              </label>
              <textarea
                value={selectedSpecialSlide === 'preview' ? previewText : weekAheadText}
                onChange={(e) => selectedSpecialSlide === 'preview' ? setPreviewText(e.target.value) : setWeekAheadText(e.target.value)}
                placeholder={selectedSpecialSlide === 'preview' ? 'The intro paragraph...' : 'Closing paragraph...'}
                rows={5}
                disabled={isPublished}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
              />
            </div>

            {/* Slide preview */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Slide Preview</label>
                <button
                  onClick={() => generateSpecialSlide(selectedSpecialSlide!)}
                  disabled={currentSlideLoading}
                  className="text-xs text-primary hover:underline font-medium disabled:opacity-50"
                >
                  {currentSlideLoading ? 'Generating...' : 'Generate Slide'}
                </button>
              </div>
              <div
                className="flex-1 bg-gray-100 rounded-lg overflow-hidden relative cursor-pointer group border border-border"
                onClick={() => currentSlideUrl && setEnlargedSlide(currentSlideUrl)}
              >
                {currentSlideLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {currentSlideUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={currentSlideUrl} alt="Special slide" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Maximize2 size={24} className="text-white" />
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    Click &quot;Generate Slide&quot; to preview
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a team or slide from the left panel
          </div>
        )}
      </div>
    </div>
  );
}

function SortableRankRow({
  item,
  isSelected,
  onSelect,
  disabled,
}: {
  item: RankingItem;
  isSelected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id, disabled,
  });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const movement = movementLabel(item.ranking, item.previous_ranking);
  const moveColor = movementColor(item.ranking, item.previous_ranking);

  const hasWriteup = item.writeup.trim().length > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors',
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:bg-muted/50',
        isDragging && 'opacity-50 z-50 shadow-lg'
      )}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className={cn('cursor-grab active:cursor-grabbing shrink-0', disabled && 'cursor-default')}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={16} className="text-gray-400" />
      </div>

      {/* Rank */}
      <span className="text-lg font-bold text-primary w-7 text-center shrink-0">{item.ranking}</span>

      {/* Movement */}
      <span className={cn('text-xs font-medium w-8 text-center shrink-0', moveColor)}>{movement}</span>

      {/* Team name + coach */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{item.team_name}</div>
        <div className="text-xs text-muted-foreground truncate">{item.coach}</div>
      </div>

      {/* Quick stats */}
      {item.snapshot && (
        <div className="text-xs text-muted-foreground shrink-0 text-right">
          <div>{item.snapshot.wins}W-{item.snapshot.losses}L</div>
        </div>
      )}

      {/* Writeup indicator */}
      <div className={cn('w-2 h-2 rounded-full shrink-0', hasWriteup ? 'bg-green-500' : 'bg-gray-300')} title={hasWriteup ? 'Writeup done' : 'No writeup'} />
    </div>
  );
}
