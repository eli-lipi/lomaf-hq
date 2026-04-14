'use client';

import { useState, useEffect, useCallback, useRef, memo } from 'react';
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
import { GripVertical, Save, Check, Sparkles } from 'lucide-react';
import { cn, ordinal, movementLabel, movementColor } from '@/lib/utils';
import { TEAMS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { PwrnkgsRound, TeamSnapshot } from '@/lib/types';
import { computeSlideData, type SlideTeamData } from '@/lib/compute-slide-data';
import SlidePreview, { getRankTheme, type SlidePreviewData } from './slide-preview';
import { getWorkingRound } from '@/lib/get-working-round';

interface RankingItem {
  id: string;
  team_id: number;
  team_name: string;
  coach: string;
  ranking: number;
  previous_ranking: number | null;
  writeup: string;
  snapshot?: TeamSnapshot;
}

export default function RankingsTab() {
  const [round, setRound] = useState<PwrnkgsRound | null>(null);
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [latestRound, setLatestRound] = useState<number | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [aiDrafting, setAiDrafting] = useState(false);

  // Extra data for live preview
  const [sparklineMap, setSparklineMap] = useState<Map<number, { round: string; ranking: number }[]>>(new Map());
  const [coachPhotoMap, setCoachPhotoMap] = useState<Map<string, string>>(new Map());
  const [computedData, setComputedData] = useState<Map<number, SlideTeamData>>(new Map());

  // Preview scaling
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoaded = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setPreviewScale(Math.min(w / 540, 1));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load data
  useEffect(() => {
    async function loadData() {
      const { round: workingRound, roundNumber, hasSnapshots } = await getWorkingRound();
      if (!roundNumber || !workingRound) return;

      const currentRound = roundNumber;
      setLatestRound(currentRound);
      setRound(workingRound);

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
          sorted = [...TEAMS].sort((a, b) => (prevRankMap.get(a.team_id) ?? 99) - (prevRankMap.get(b.team_id) ?? 99));
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

      // Pre-populate writeups with section templates
      const savedSections = localStorage.getItem(`lomaf-section-templates-${currentRound}`);
      if (savedSections) {
        try {
          const sectionTemplates = JSON.parse(savedSections) as { title: string }[];
          const templateText = sectionTemplates
            .filter(s => s.title.trim())
            .map(s => `## ${s.title}\n\n`)
            .join('');
          if (templateText) {
            items = items.map(item => ({
              ...item,
              writeup: item.writeup || templateText,
            }));
          }
        } catch { /* ignore */ }
      }

      setRankings(items);
      if (items.length > 0) setSelectedTeamId(items[0].team_id);
      dataLoaded.current = true;

      // ── Compute all slide data from raw sources ──
      const computed = await computeSlideData(supabase, currentRound);
      setComputedData(computed);

      // ── Fetch sparkline data ──
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
      setSparklineMap(sparkMap);

      // ── Fetch coach photos ──
      const { data: photoFiles } = await supabase.storage.from('coach-photos').list('', { limit: 100 });
      if (photoFiles) {
        const urlMap = new Map<string, string>();
        for (const f of photoFiles) {
          const key = f.name.split('.')[0];
          const { data: urlData } = supabase.storage.from('coach-photos').getPublicUrl(f.name);
          urlMap.set(key, urlData.publicUrl);
        }
        setCoachPhotoMap(urlMap);
      }
    }

    loadData();
  }, []);

  // Auto-save (debounced 5s)
  const doAutoSave = useCallback(async () => {
    if (!round || round.status === 'published') return;
    setAutoSaveStatus('saving');
    try {
      const rankingRows = rankings.map((r) => ({
        round_id: round.id, round_number: round.round_number,
        team_id: r.team_id, team_name: r.team_name, ranking: r.ranking,
        previous_ranking: r.previous_ranking, writeup: r.writeup,
      }));
      await supabase.from('pwrnkgs_rankings').upsert(rankingRows, { onConflict: 'round_number,team_id' });
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch {
      setAutoSaveStatus('idle');
    }
  }, [round, rankings]);

  const triggerAutoSave = useCallback(() => {
    if (!dataLoaded.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doAutoSave(), 5000);
  }, [doAutoSave]);

  useEffect(() => {
    triggerAutoSave();
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [rankings, triggerAutoSave]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRankings((items) => {
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      const reordered = arrayMove(items, oldIndex, newIndex);
      return reordered.map((item, i) => ({ ...item, ranking: i + 1 }));
    });
  };

  const updateWriteup = useCallback((teamId: number, text: string) => {
    setRankings((prev) => prev.map((r) => r.team_id === teamId ? { ...r, writeup: text } : r));
  }, []);

  const save = async () => {
    if (!round) return;
    setSaving(true);
    setMessage(null);
    try {
      const rankingRows = rankings.map((r) => ({
        round_id: round.id, round_number: round.round_number,
        team_id: r.team_id, team_name: r.team_name, ranking: r.ranking,
        previous_ranking: r.previous_ranking, writeup: r.writeup,
      }));
      const { error } = await supabase.from('pwrnkgs_rankings').upsert(rankingRows, { onConflict: 'round_number,team_id' });
      if (error) throw error;
      setMessage({ type: 'success', text: 'Rankings saved!' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally { setSaving(false); }
  };

  const draftWriteup = async () => {
    if (!selectedTeamId || !round || !latestRound) return;
    const item = rankings.find(r => r.team_id === selectedTeamId);
    if (!item) return;

    if (item.writeup.trim() && !confirm('This will replace the current writeup. Continue?')) return;

    setAiDrafting(true);
    try {
      const cd = computedData.get(item.team_id);
      const savedSections = localStorage.getItem(`lomaf-section-templates-${latestRound}`);
      let sections: { title: string }[] = [];
      if (savedSections) try { sections = JSON.parse(savedSections); } catch { /* ignore */ }

      const alreadyWritten = rankings
        .filter(r => r.team_id !== selectedTeamId && r.writeup.trim().length > 20)
        .map(r => ({ teamName: r.team_name, writeup: r.writeup }));

      const res = await fetch('/api/ai/writeup-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundNumber: latestRound,
          teamId: item.team_id,
          ranking: item.ranking,
          previousRanking: item.previous_ranking,
          sections,
          alreadyWritten,
          scoreThisWeek: cd?.scoreThisWeek,
          scoreThisWeekRank: cd?.scoreThisWeekRank,
          seasonTotal: cd?.seasonTotal,
          seasonTotalRank: cd?.seasonTotalRank,
          record: cd?.record,
          ladderPosition: cd?.ladderPosition,
          luckScore: cd?.luckScore,
          luckRank: cd?.luckRank,
          lineRanks: cd?.lineRanks,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Draft failed');
      }
      const data = await res.json();
      updateWriteup(item.team_id, data.writeup);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'AI draft failed' });
    } finally {
      setAiDrafting(false);
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
  const selectedItem = selectedTeamId ? rankings.find((r) => r.team_id === selectedTeamId) : null;

  const currentIndex = rankings.findIndex(r => r.team_id === selectedTeamId);
  const navigateTeam = (delta: number) => {
    const newIndex = currentIndex + delta;
    if (newIndex >= 0 && newIndex < rankings.length) {
      setSelectedTeamId(rankings[newIndex].team_id);
    }
  };

  // Build live preview data for the selected team using computed data
  const buildPreviewData = (item: RankingItem): SlidePreviewData => {
    const cd = computedData.get(item.team_id);
    const team = TEAMS.find(t => t.team_id === item.team_id);
    const photoKeys = team ? (Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key]) : [];
    const photoUrls = photoKeys.map(k => coachPhotoMap.get(k)).filter(Boolean) as string[];

    return {
      ranking: item.ranking,
      previousRanking: item.previous_ranking,
      teamName: item.team_name,
      coachName: item.coach,
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
      pwrnkgsHistory: sparklineMap.get(item.team_id) || [],
      writeup: item.writeup,
      roundNumber: latestRound,
    };
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-200px)] min-h-[600px]">
      {/* ==================== LEFT PANEL (40%) ==================== */}
      <div className="w-[40%] flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4 shrink-0">
          <span
            className="bg-primary/10 text-primary font-bold px-3 py-1 rounded-full text-sm"
            title={`PWRNKGs for the state of the league after Round ${latestRound} has been played`}
          >
            After R{latestRound}
          </span>
          {isPublished && (
            <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">Published</span>
          )}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {autoSaveStatus === 'saving' && <><div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Saving...</>}
            {autoSaveStatus === 'saved' && <><Check size={14} className="text-green-600" /> Saved</>}
          </div>
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
                    isSelected={selectedTeamId === item.team_id}
                    onSelect={() => { setSelectedTeamId(item.team_id); }}
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
        {selectedItem ? (
          <>
            {/* Writeup textarea */}
            <div className="mb-4 shrink-0">
              <WriteupTextarea
                key={selectedItem.team_id}
                value={selectedItem.writeup}
                onChange={(text) => updateWriteup(selectedItem.team_id, text)}
                disabled={isPublished}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-muted-foreground">Tip: Start a line with <code className="bg-muted px-1 rounded">##</code> to create a section header on the slide</p>
                {!isPublished && (
                  <button
                    onClick={draftWriteup}
                    disabled={aiDrafting}
                    className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-500 font-medium transition-colors disabled:opacity-50"
                  >
                    <Sparkles size={13} />
                    {aiDrafting ? 'Drafting...' : 'Draft Writeup'}
                  </button>
                )}
              </div>
            </div>

            {/* Next/prev navigation */}
            <div className="flex items-center justify-between mb-2 shrink-0">
              <button disabled={currentIndex <= 0} onClick={() => navigateTeam(-1)} className="text-xs text-primary hover:underline disabled:opacity-30">&larr; Previous Team</button>
              <span className="text-xs text-muted-foreground">{selectedItem.ranking} of {rankings.length}</span>
              <button disabled={currentIndex >= rankings.length - 1} onClick={() => navigateTeam(1)} className="text-xs text-primary hover:underline disabled:opacity-30">Next Team &rarr;</button>
            </div>

            {/* Live slide preview */}
            <div className="flex-1 flex flex-col min-h-0">
              <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2 shrink-0">Slide Preview</label>
              <div ref={previewContainerRef} className="bg-[#080C18] rounded-lg border border-border overflow-hidden" style={{ width: '100%', aspectRatio: '1 / 1', position: 'relative' }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0,
                  width: 540, height: 540,
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                }}>
                  <SlidePreview data={buildPreviewData(selectedItem)} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a team from the left panel
          </div>
        )}
      </div>
    </div>
  );
}

// ── Writeup textarea with local state ──
// Isolates re-renders so typing doesn't trigger the full rankings re-render cycle.
// Syncs external value changes (e.g., AI draft) via the `value` prop.

const WriteupTextarea = memo(function WriteupTextarea({
  value, onChange, disabled,
}: {
  value: string; onChange: (text: string) => void; disabled: boolean;
}) {
  const [local, setLocal] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from parent when value changes externally (AI draft, team switch)
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = (text: string) => {
    setLocal(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(text), 300);
  };

  // Flush pending changes on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Writeup</label>
        <span className="text-xs text-muted-foreground">{local.length} chars</span>
      </div>
      <textarea
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Write about this team..."
        rows={8}
        disabled={disabled}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
      />
    </>
  );
});

// ── Sortable row ──

function SortableRankRow({
  item, isSelected, onSelect, disabled,
}: {
  item: RankingItem; isSelected: boolean; onSelect: () => void; disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const movement = movementLabel(item.ranking, item.previous_ranking);
  const moveColor = movementColor(item.ranking, item.previous_ranking);
  const hasWriteup = item.writeup.trim().length > 0;
  const theme = getRankTheme(item.ranking);

  return (
    <div ref={setNodeRef} style={style} onClick={onSelect}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors',
        isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50',
        isDragging && 'opacity-50 z-50 shadow-lg'
      )}>
      <div {...attributes} {...listeners}
        className={cn('cursor-grab active:cursor-grabbing shrink-0', disabled && 'cursor-default')}
        onClick={(e) => e.stopPropagation()}>
        <GripVertical size={16} className="text-gray-400" />
      </div>
      <span className="text-lg font-bold w-7 text-center shrink-0" style={{ color: theme.primary }}>{item.ranking}</span>
      <span className={cn('text-xs font-medium w-8 text-center shrink-0', moveColor)}>{movement}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{item.team_name}</div>
        <div className="text-xs text-muted-foreground truncate">{item.coach}</div>
      </div>
      {item.snapshot && (
        <div className="text-xs text-muted-foreground shrink-0 text-right">
          <div>{item.snapshot.wins}W-{item.snapshot.losses}L</div>
        </div>
      )}
      <div className={cn('w-2 h-2 rounded-full shrink-0', hasWriteup ? 'bg-green-500' : 'bg-gray-300')}
        title={hasWriteup ? 'Writeup done' : 'No writeup'} />
    </div>
  );
}
