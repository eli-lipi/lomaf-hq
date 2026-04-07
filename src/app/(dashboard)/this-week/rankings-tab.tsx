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
import { GripVertical, Save, Send, Bold, Italic, X, Maximize2, Plus, Trash2, Check } from 'lucide-react';
import { cn, ordinal, movementLabel, movementColor } from '@/lib/utils';
import { TEAMS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { PwrnkgsRound, TeamSnapshot } from '@/lib/types';

interface WriteupSection {
  title: string;
  color: string;
  fontSize: number;
  bold: boolean;
}

interface RankingItem {
  id: string;
  team_id: number;
  team_name: string;
  coach: string;
  ranking: number;
  previous_ranking: number | null;
  sectionTexts: string[]; // one per section
  snapshot?: TeamSnapshot;
  slideUrl?: string;
  slideLoading?: boolean;
}

// Parse writeup string into section texts
function parseWriteup(writeup: string, sections: WriteupSection[]): string[] {
  if (!writeup || sections.length === 0) {
    return sections.map(() => '');
  }
  // If sections exist, try splitting by section headers
  if (sections.length > 1) {
    const texts: string[] = [];
    let remaining = writeup;
    for (let i = 0; i < sections.length; i++) {
      const header = `**${sections[i].title}**`;
      const nextHeader = i + 1 < sections.length ? `**${sections[i + 1].title}**` : null;

      const headerIdx = remaining.indexOf(header);
      if (headerIdx !== -1) {
        const afterHeader = remaining.slice(headerIdx + header.length).replace(/^\n+/, '');
        if (nextHeader) {
          const nextIdx = afterHeader.indexOf(nextHeader);
          if (nextIdx !== -1) {
            texts.push(afterHeader.slice(0, nextIdx).trim());
            remaining = afterHeader.slice(nextIdx);
          } else {
            texts.push(afterHeader.trim());
            remaining = '';
          }
        } else {
          texts.push(afterHeader.trim());
        }
      } else {
        texts.push('');
      }
    }
    // If parsing failed (no headers found), put everything in first section
    if (texts.every((t) => !t) && writeup.trim()) {
      texts[0] = writeup;
    }
    return texts;
  }
  return [writeup];
}

// Combine section texts back into writeup string
function buildWriteup(sectionTexts: string[], sections: WriteupSection[]): string {
  if (sections.length <= 1) {
    return sectionTexts[0] || '';
  }
  return sections
    .map((s, i) => {
      const text = sectionTexts[i] || '';
      if (!text) return '';
      return `**${s.title}**\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

const DEFAULT_SECTIONS: WriteupSection[] = [{ title: '', color: '#111827', fontSize: 14, bold: false }];

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
  const [sections, setSections] = useState<WriteupSection[]>(DEFAULT_SECTIONS);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
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

      // Get or create round entry
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

      // Load section config from localStorage
      const savedSections = localStorage.getItem(`lomaf-sections-${currentRound}`);
      const loadedSections: WriteupSection[] = savedSections
        ? JSON.parse(savedSections)
        : DEFAULT_SECTIONS;
      setSections(loadedSections);

      // Load existing rankings for this round
      const { data: existingRankings } = await supabase
        .from('pwrnkgs_rankings')
        .select('*')
        .eq('round_number', currentRound)
        .order('ranking', { ascending: true });

      const { data: teamSnapshots } = await supabase
        .from('team_snapshots')
        .select('*')
        .eq('round_number', currentRound);

      // Get MOST RECENT PUBLISHED rankings for default order
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

      if (existingRankings && existingRankings.length > 0) {
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
              sectionTexts: parseWriteup(r.writeup || '', loadedSections),
              snapshot: snapshotMap.get(r.team_id),
            };
          })
        );
      } else {
        // Default order: previous published PWRNKGs
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

        setRankings(
          sorted.map((team, i) => ({
            id: String(team.team_id),
            team_id: team.team_id,
            team_name: team.team_name,
            coach: team.coach,
            ranking: i + 1,
            previous_ranking: prevRankMap.get(team.team_id) ?? null,
            sectionTexts: loadedSections.map(() => ''),
            snapshot: snapshotMap.get(team.team_id),
          }))
        );
      }
      dataLoaded.current = true;
    }

    loadData();
  }, []);

  // Auto-save (debounced 5s)
  const triggerAutoSave = useCallback(() => {
    if (!dataLoaded.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      doAutoSave();
    }, 5000);
  }, []);

  const doAutoSave = async () => {
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
        writeup: buildWriteup(r.sectionTexts, sections),
      }));

      await supabase.from('pwrnkgs_rankings')
        .upsert(rankingRows, { onConflict: 'round_number,team_id' });

      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch {
      setAutoSaveStatus('idle');
    }
  };

  // Trigger auto-save when data changes
  useEffect(() => {
    triggerAutoSave();
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankings, theme, previewText, weekAheadText]);

  // Save sections config to localStorage when changed
  useEffect(() => {
    if (latestRound !== null) {
      localStorage.setItem(`lomaf-sections-${latestRound}`, JSON.stringify(sections));
    }
  }, [sections, latestRound]);

  // When sections change, update rankings to match section count
  const updateSections = (newSections: WriteupSection[]) => {
    setSections(newSections);
    setRankings((prev) =>
      prev.map((r) => {
        const newTexts = newSections.map((_, i) => r.sectionTexts[i] || '');
        return { ...r, sectionTexts: newTexts };
      })
    );
  };

  const addSection = () => {
    updateSections([...sections, { title: '', color: '#111827', fontSize: 14, bold: true }]);
  };

  const removeSection = (index: number) => {
    if (sections.length <= 1) return;
    const newSections = sections.filter((_, i) => i !== index);
    setSections(newSections);
    setRankings((prev) =>
      prev.map((r) => ({
        ...r,
        sectionTexts: r.sectionTexts.filter((_, i) => i !== index),
      }))
    );
  };

  const updateSectionConfig = (index: number, updates: Partial<WriteupSection>) => {
    const newSections = sections.map((s, i) => (i === index ? { ...s, ...updates } : s));
    setSections(newSections);
  };

  // Slide generation
  const generateSlidePreview = useCallback(async (teamRanking: number) => {
    if (!round) return;
    const slideIndex = 11 - teamRanking;
    if (slideIndex < 1 || slideIndex > 10) return;

    // Save first
    const rankingRows = rankings.map((r) => ({
      round_id: round.id, round_number: round.round_number,
      team_id: r.team_id, team_name: r.team_name, ranking: r.ranking,
      previous_ranking: r.previous_ranking, writeup: buildWriteup(r.sectionTexts, sections),
    }));
    await supabase.from('pwrnkgs_rounds')
      .update({ theme: theme || null, preview_text: previewText || null, week_ahead_text: weekAheadText || null })
      .eq('id', round.id);
    await supabase.from('pwrnkgs_rankings')
      .upsert(rankingRows, { onConflict: 'round_number,team_id' });

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
  }, [round, rankings, theme, previewText, weekAheadText, sections]);

  const generateSpecialSlide = useCallback(async (slideIndex: 0 | 11) => {
    if (!round) return;
    const rankingRows = rankings.map((r) => ({
      round_id: round.id, round_number: round.round_number,
      team_id: r.team_id, team_name: r.team_name, ranking: r.ranking,
      previous_ranking: r.previous_ranking, writeup: buildWriteup(r.sectionTexts, sections),
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
        if (slideIndex === 0) setPreviewSlideUrl((p) => { if (p) URL.revokeObjectURL(p); return url; });
        else setSummarySlideUrl((p) => { if (p) URL.revokeObjectURL(p); return url; });
      }
    } catch (err) { console.error('Slide gen failed:', err); }
  }, [round, rankings, theme, previewText, weekAheadText, sections]);

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

  const updateSectionText = useCallback((teamId: number, sectionIdx: number, text: string) => {
    setRankings((prev) =>
      prev.map((r) => {
        if (r.team_id !== teamId) return r;
        const newTexts = [...r.sectionTexts];
        newTexts[sectionIdx] = text;
        return { ...r, sectionTexts: newTexts };
      })
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
        round_id: round.id, round_number: round.round_number,
        team_id: r.team_id, team_name: r.team_name, ranking: r.ranking,
        previous_ranking: r.previous_ranking, writeup: buildWriteup(r.sectionTexts, sections),
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

      {/* Header with auto-save status */}
      <div className="flex items-center gap-3 mb-6">
        <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded-full text-sm">R{latestRound}</span>
        {isPublished && (
          <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">Published</span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {autoSaveStatus === 'saving' && <><div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Saving...</>}
          {autoSaveStatus === 'saved' && <><Check size={14} className="text-green-600" /> Saved</>}
        </div>
      </div>

      {/* Theme + Preview Text + Slide 1 */}
      <div className="bg-card rounded-lg border border-border shadow-sm mb-6">
        <div className="flex gap-6 p-5">
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
                rows={6}
                disabled={isPublished}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
              />
            </div>
          </div>
          <SlidePreview url={previewSlideUrl} label="Slide 1" onRefresh={() => generateSpecialSlide(0)} onEnlarge={setEnlargedSlide} />
        </div>
      </div>

      {/* Writeup Sections Config */}
      <div className="bg-card rounded-lg border border-border shadow-sm mb-6 p-5">
        <div className="flex items-center justify-between mb-3">
          <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Writeup Sections</label>
          <button onClick={addSection} className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
            <Plus size={14} /> Add Section
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Define the structure for each team&apos;s writeup. Leave title empty for a single freeform section.</p>
        <div className="space-y-2">
          {sections.map((section, i) => (
            <div key={i} className="flex items-center gap-3 bg-background rounded-lg p-3 border border-border">
              <input
                type="text"
                value={section.title}
                onChange={(e) => updateSectionConfig(i, { title: e.target.value })}
                placeholder={sections.length === 1 ? 'Freeform (no title)' : `Section ${i + 1} title...`}
                className="flex-1 bg-card border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Color:</label>
                <input
                  type="color"
                  value={section.color}
                  onChange={(e) => updateSectionConfig(i, { color: e.target.value })}
                  className="w-7 h-7 rounded border border-border cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Size:</label>
                <select
                  value={section.fontSize}
                  onChange={(e) => updateSectionConfig(i, { fontSize: Number(e.target.value) })}
                  className="bg-card border border-border rounded px-1 py-1 text-xs"
                >
                  <option value={12}>12</option>
                  <option value={14}>14</option>
                  <option value={16}>16</option>
                  <option value={18}>18</option>
                  <option value={20}>20</option>
                </select>
              </div>
              <button
                onClick={() => updateSectionConfig(i, { bold: !section.bold })}
                className={cn('p-1 rounded border', section.bold ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground')}
                title="Bold header"
              >
                <Bold size={14} />
              </button>
              {sections.length > 1 && (
                <button onClick={() => removeSection(i)} className="p-1 text-red-400 hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Rankings list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rankings.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {rankings.map((item) => (
              <SortableRankingCard
                key={item.id}
                item={item}
                sections={sections}
                onSectionTextChange={updateSectionText}
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
        <div className="flex gap-6 p-5">
          <div className="flex-1">
            <label className="block text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Week Ahead Text (Slide 12)</label>
            <textarea
              value={weekAheadText}
              onChange={(e) => setWeekAheadText(e.target.value)}
              placeholder="Closing paragraph about the upcoming round..."
              rows={6}
              disabled={isPublished}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
            />
          </div>
          <SlidePreview url={summarySlideUrl} label="Slide 12" onRefresh={() => generateSpecialSlide(11)} onEnlarge={setEnlargedSlide} />
        </div>
      </div>

      {/* Actions */}
      {!isPublished && (
        <div className="flex gap-3 mt-6">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 shadow-sm">
            <Save size={16} /> {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button onClick={publish} disabled={publishing}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm">
            <Send size={16} /> {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      )}

      {message && (
        <div className={cn('mt-4 p-3 rounded-lg text-sm font-medium',
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        )}>{message.text}</div>
      )}
    </div>
  );
}

function SlidePreview({ url, label, onRefresh, onEnlarge }: {
  url: string | null; label: string;
  onRefresh: () => void; onEnlarge: (url: string) => void;
}) {
  return (
    <div className="w-52 shrink-0">
      <div
        className="aspect-square bg-gray-100 rounded-lg overflow-hidden relative cursor-pointer group border border-border"
        onClick={() => url && onEnlarge(url)}
      >
        {url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={label} className="w-full h-full object-contain" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Maximize2 size={20} className="text-white" />
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">{label}</div>
        )}
      </div>
      <button onClick={onRefresh} className="w-full mt-2 text-xs text-primary hover:underline font-medium">
        Refresh {label}
      </button>
    </div>
  );
}

function SortableRankingCard({
  item, sections, onSectionTextChange, onGenerateSlide, onEnlargeSlide, disabled,
}: {
  item: RankingItem; sections: WriteupSection[];
  onSectionTextChange: (teamId: number, sectionIdx: number, text: string) => void;
  onGenerateSlide: (ranking: number) => void;
  onEnlargeSlide: (url: string) => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id, disabled,
  });
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const style = { transform: CSS.Transform.toString(transform), transition };
  const movement = movementLabel(item.ranking, item.previous_ranking);
  const moveColor = movementColor(item.ranking, item.previous_ranking);

  const insertFormatting = (sectionIdx: number, before: string, after: string) => {
    const textarea = textareaRefs.current[sectionIdx];
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = item.sectionTexts[sectionIdx] || '';
    const selected = text.slice(start, end);
    const newText = text.slice(0, start) + before + selected + after + text.slice(end);
    onSectionTextChange(item.team_id, sectionIdx, newText);
  };

  return (
    <div ref={setNodeRef} style={style}
      className={cn('bg-card border border-border rounded-lg shadow-sm', isDragging && 'opacity-50 z-50 shadow-lg')}>
      <div className="flex gap-4 p-5">
        {/* Left: Drag + Rank */}
        <div className="flex flex-col items-center gap-2 pt-1 w-14 shrink-0">
          <div {...attributes} {...listeners}
            className={cn('cursor-grab active:cursor-grabbing', disabled && 'cursor-default')}>
            <GripVertical size={18} className="text-gray-400" />
          </div>
          <span className="text-3xl font-bold text-primary">{item.ranking}</span>
          <span className={cn('text-xs font-medium', moveColor)}>{movement}</span>
        </div>

        {/* Middle: Team info + sections */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-semibold truncate">{item.team_name}</span>
            <span className="text-xs text-muted-foreground">{item.coach}</span>
          </div>

          {item.snapshot && (
            <div className="flex gap-4 text-xs text-muted-foreground mb-3">
              <span>Score: {Math.round(item.snapshot.pts_for)}</span>
              <span>{item.snapshot.wins}W-{item.snapshot.losses}L</span>
              <span>Rank: {ordinal(item.snapshot.league_rank || 0)}</span>
            </div>
          )}

          {/* Section text areas */}
          <div className="space-y-3">
            {sections.map((section, sectionIdx) => (
              <div key={sectionIdx}>
                {section.title && (
                  <div className="flex items-center gap-2 mb-1">
                    <span style={{ color: section.color, fontSize: `${section.fontSize}px`, fontWeight: section.bold ? 700 : 400 }}>
                      {section.title}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1 mb-1">
                  <button type="button" onClick={() => insertFormatting(sectionIdx, '**', '**')}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Bold">
                    <Bold size={12} />
                  </button>
                  <button type="button" onClick={() => insertFormatting(sectionIdx, '*', '*')}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Italic">
                    <Italic size={12} />
                  </button>
                </div>
                <textarea
                  ref={(el) => { textareaRefs.current[sectionIdx] = el; }}
                  value={item.sectionTexts[sectionIdx] || ''}
                  onChange={(e) => onSectionTextChange(item.team_id, sectionIdx, e.target.value)}
                  placeholder={section.title ? `Write about ${section.title.toLowerCase()}...` : 'Write about this team...'}
                  rows={3}
                  disabled={disabled}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Right: Slide preview */}
        <div className="w-40 shrink-0 flex flex-col">
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
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">#{item.ranking}</div>
            )}
          </div>
          <button onClick={() => onGenerateSlide(item.ranking)} disabled={item.slideLoading}
            className="mt-1.5 text-xs text-primary hover:underline font-medium disabled:opacity-50">
            {item.slideLoading ? 'Generating...' : 'Refresh Slide'}
          </button>
        </div>
      </div>
    </div>
  );
}
