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
import SlidePreview, { getRankTheme, type SlidePreviewData } from './slide-preview';

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
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [roundFieldsOpen, setRoundFieldsOpen] = useState(true);

  // Extra data for live preview
  const [sparklineMap, setSparklineMap] = useState<Map<number, { round: string; ranking: number }[]>>(new Map());
  const [luckMap, setLuckMap] = useState<Map<number, { score: number; rank: number }>>(new Map());
  const [coachPhotoMap, setCoachPhotoMap] = useState<Map<string, string>>(new Map());

  // Special slide image previews (generated via API)
  const [specialSlideUrls, setSpecialSlideUrls] = useState<{ preview?: string; summary?: string }>({});
  const [specialSlideLoading, setSpecialSlideLoading] = useState<{ preview?: boolean; summary?: boolean }>({});

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

      setRankings(items);
      if (items.length > 0) setSelectedTeamId(items[0].team_id);
      dataLoaded.current = true;

      // ── Fetch sparkline data ──
      const { data: allRankings } = await supabase
        .from('pwrnkgs_rankings')
        .select('team_id, ranking, round_number')
        .lte('round_number', currentRound)
        .order('round_number', { ascending: true });

      const sparkMap = new Map<number, { round: string; ranking: number }[]>();
      allRankings?.forEach((r) => {
        if (!sparkMap.has(r.team_id)) sparkMap.set(r.team_id, []);
        sparkMap.get(r.team_id)!.push({ round: `R${r.round_number}`, ranking: r.ranking });
      });
      setSparklineMap(sparkMap);

      // ── Compute luck scores ──
      const { data: allSnapshots } = await supabase
        .from('team_snapshots')
        .select('round_number, team_id, def_total, mid_total, fwd_total, ruc_total, utl_total')
        .lte('round_number', currentRound);

      if (allSnapshots && allSnapshots.length > 0) {
        const roundsInData = [...new Set(allSnapshots.map(s => s.round_number))].sort((a, b) => a - b);
        const validRounds = roundsInData.filter(r => allSnapshots.filter(s => s.round_number === r).length >= 8);
        const roundScores = new Map<string, number>();
        allSnapshots.forEach(s => {
          roundScores.set(`${s.round_number}-${s.team_id}`, Math.round(
            Number(s.def_total || 0) + Number(s.mid_total || 0) + Number(s.fwd_total || 0) + Number(s.ruc_total || 0) + Number(s.utl_total || 0)
          ));
        });

        const luckScores: { teamId: number; luck: number }[] = [];
        for (const team of TEAMS) {
          const snap = snapshotMap.get(team.team_id);
          if (!snap) continue;
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
          const actualWins = (snap.wins || 0) + 0.5 * (snap.ties || 0);
          luckScores.push({ teamId: team.team_id, luck: Math.round((actualWins - totalExpected) * 100) / 100 });
        }
        luckScores.sort((a, b) => b.luck - a.luck);
        const newLuckMap = new Map<number, { score: number; rank: number }>();
        luckScores.forEach((ls, i) => newLuckMap.set(ls.teamId, { score: ls.luck, rank: i + 1 }));
        setLuckMap(newLuckMap);
      }

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
      await supabase.from('pwrnkgs_rounds')
        .update({ theme: theme || null, preview_text: previewText || null, week_ahead_text: weekAheadText || null })
        .eq('id', round.id);
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
  }, [round, rankings, theme, previewText, weekAheadText]);

  const triggerAutoSave = useCallback(() => {
    if (!dataLoaded.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doAutoSave(), 5000);
  }, [doAutoSave]);

  useEffect(() => {
    triggerAutoSave();
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [rankings, theme, previewText, weekAheadText, triggerAutoSave]);

  const generateSpecialSlide = useCallback(async (type: 'preview' | 'summary') => {
    if (!round) return;
    const slideIndex = type === 'preview' ? 0 : 11;
    // Save first
    await supabase.from('pwrnkgs_rounds')
      .update({ theme: theme || null, preview_text: previewText || null, week_ahead_text: weekAheadText || null })
      .eq('id', round.id);
    const rankingRows = rankings.map((r) => ({
      round_id: round.id, round_number: round.round_number,
      team_id: r.team_id, team_name: r.team_name, ranking: r.ranking,
      previous_ranking: r.previous_ranking, writeup: r.writeup,
    }));
    await supabase.from('pwrnkgs_rankings').upsert(rankingRows, { onConflict: 'round_number,team_id' });

    setSpecialSlideLoading(prev => ({ ...prev, [type]: true }));
    try {
      const res = await fetch(`/api/carousel/slide/${slideIndex}?round=${round.round_number}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setSpecialSlideUrls(prev => {
          if (prev[type]) URL.revokeObjectURL(prev[type]!);
          return { ...prev, [type]: url };
        });
      }
    } catch (err) { console.error('Slide gen failed:', err); }
    finally { setSpecialSlideLoading(prev => ({ ...prev, [type]: false })); }
  }, [round, rankings, theme, previewText, weekAheadText]);

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
      await supabase.from('pwrnkgs_rounds')
        .update({ theme: theme || null, preview_text: previewText || null, week_ahead_text: weekAheadText || null })
        .eq('id', round.id);
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
  const showingSpecialSlide = selectedSpecialSlide !== null;

  // Build live preview data for the selected team
  const buildPreviewData = (item: RankingItem): SlidePreviewData => {
    const snap = item.snapshot;
    const weekScore = snap ? Math.round(Number(snap.def_total || 0) + Number(snap.mid_total || 0) + Number(snap.fwd_total || 0) + Number(snap.ruc_total || 0) + Number(snap.utl_total || 0)) : null;
    const seasonTotal = snap ? Math.round(Number(snap.pts_for || 0)) : null;

    // Compute week/season ranks from all snapshots in rankings
    let weekRank: number | null = null;
    let seasonRank: number | null = null;
    if (snap) {
      const allWeekScores = rankings
        .filter(r => r.snapshot)
        .map(r => Math.round(Number(r.snapshot!.def_total || 0) + Number(r.snapshot!.mid_total || 0) + Number(r.snapshot!.fwd_total || 0) + Number(r.snapshot!.ruc_total || 0) + Number(r.snapshot!.utl_total || 0)))
        .sort((a, b) => b - a);
      weekRank = allWeekScores.indexOf(weekScore!) + 1;

      const allSeasonTotals = rankings
        .filter(r => r.snapshot)
        .map(r => Math.round(Number(r.snapshot!.pts_for || 0)))
        .sort((a, b) => b - a);
      seasonRank = allSeasonTotals.indexOf(seasonTotal!) + 1;
    }

    const luck = luckMap.get(item.team_id);
    const team = TEAMS.find(t => t.team_id === item.team_id);
    const photoKeys = team ? (Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key]) : [];
    const photoUrls = photoKeys.map(k => coachPhotoMap.get(k)).filter(Boolean) as string[];

    return {
      ranking: item.ranking,
      previousRanking: item.previous_ranking,
      teamName: item.team_name,
      coachName: item.coach,
      coachPhotoUrls: photoUrls,
      scoreThisWeek: weekScore,
      scoreThisWeekRank: weekRank,
      seasonTotal,
      seasonTotalRank: seasonRank,
      record: { wins: snap?.wins || 0, losses: snap?.losses || 0, ties: snap?.ties || 0 },
      ladderPosition: snap?.league_rank ?? null,
      luckScore: luck?.score ?? null,
      luckRank: luck?.rank ?? null,
      lineRanks: {
        def: snap?.def_rank ?? null,
        mid: snap?.mid_rank ?? null,
        fwd: snap?.fwd_rank ?? null,
        ruc: snap?.ruc_rank ?? null,
        utl: snap?.utl_rank ?? null,
      },
      pwrnkgsHistory: sparklineMap.get(item.team_id) || [],
      writeup: item.writeup,
      roundNumber: latestRound,
    };
  };

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
                <input type="text" value={theme} onChange={(e) => setTheme(e.target.value)}
                  placeholder='e.g., "What Went Right? What Went Wrong?"' disabled={isPublished}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Preview Text (Slide 1)</label>
                <textarea value={previewText} onChange={(e) => setPreviewText(e.target.value)}
                  placeholder="The intro paragraph..." rows={3} disabled={isPublished}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Week Ahead Text (Slide 12)</label>
                <textarea value={weekAheadText} onChange={(e) => setWeekAheadText(e.target.value)}
                  placeholder="Closing paragraph..." rows={3} disabled={isPublished}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y" />
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
            {/* Writeup textarea */}
            <div className="mb-4 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Writeup</label>
                <span className="text-xs text-muted-foreground">{selectedItem.writeup.length} chars</span>
              </div>
              <textarea
                value={selectedItem.writeup}
                onChange={(e) => updateWriteup(selectedItem.team_id, e.target.value)}
                placeholder="Write about this team..."
                rows={8}
                disabled={isPublished}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
              />
              <p className="text-xs text-muted-foreground mt-1">Tip: Start a line with <code className="bg-muted px-1 rounded">##</code> to create a section header on the slide</p>
            </div>

            {/* Live slide preview */}
            <div className="flex-1 flex flex-col min-h-0">
              <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2 shrink-0">Slide Preview</label>
              <div className="flex-1 flex items-center justify-center bg-[#080C18] rounded-lg border border-border overflow-hidden cursor-pointer"
                onClick={() => setEnlargedSlide('live-preview')}>
                <div style={{ transform: 'scale(0.75)', transformOrigin: 'center center' }}>
                  <SlidePreview data={buildPreviewData(selectedItem)} />
                </div>
              </div>
            </div>
          </>
        ) : showingSpecialSlide ? (
          <>
            {/* Special slide: text field + API-generated image */}
            <div className="mb-4 shrink-0">
              <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-1 block">
                {selectedSpecialSlide === 'preview' ? 'Preview Text (Slide 1)' : 'Week Ahead Text (Slide 12)'}
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
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Slide Preview</label>
                <button onClick={() => generateSpecialSlide(selectedSpecialSlide!)}
                  disabled={specialSlideLoading[selectedSpecialSlide!]}
                  className="text-xs text-primary hover:underline font-medium disabled:opacity-50">
                  {specialSlideLoading[selectedSpecialSlide!] ? 'Generating...' : 'Generate Slide'}
                </button>
              </div>
              <div className="flex-1 bg-gray-100 rounded-lg overflow-hidden relative border border-border"
                onClick={() => specialSlideUrls[selectedSpecialSlide!] && setEnlargedSlide(specialSlideUrls[selectedSpecialSlide!]!)}>
                {specialSlideLoading[selectedSpecialSlide!] && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {specialSlideUrls[selectedSpecialSlide!] ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={specialSlideUrls[selectedSpecialSlide!]!} alt="Special slide" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
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
