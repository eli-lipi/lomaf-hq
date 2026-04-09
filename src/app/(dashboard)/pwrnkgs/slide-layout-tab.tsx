'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, GripVertical, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { PwrnkgsRound } from '@/lib/types';
import { getWorkingRound } from '@/lib/get-working-round';
import IntelligenceBrief from '@/components/ai/intelligence-brief';

interface WriteupSection {
  title: string;
}

export default function SlideLayoutTab() {
  const [round, setRound] = useState<PwrnkgsRound | null>(null);
  const [latestRound, setLatestRound] = useState<number | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [weekAheadText, setWeekAheadText] = useState('');
  const [sections, setSections] = useState<WriteupSection[]>([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataLoaded = useRef(false);

  // Special slide previews (generated via API)
  const [previewSlideUrl, setPreviewSlideUrl] = useState<string | null>(null);
  const [summarySlideUrl, setSummarySlideUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    async function loadData() {
      const { round: workingRound, roundNumber } = await getWorkingRound();
      if (!roundNumber || !workingRound) return;

      setLatestRound(roundNumber);
      setRound(workingRound);
      setPreviewText(workingRound.preview_text || '');
      setWeekAheadText(workingRound.week_ahead_text || '');
      const currentRound = roundNumber;

      // Load section templates from localStorage
      const saved = localStorage.getItem(`lomaf-section-templates-${currentRound}`);
      if (saved) {
        try { setSections(JSON.parse(saved)); } catch { /* ignore */ }
      }

      dataLoaded.current = true;
    }
    loadData();
  }, []);

  // Save sections to localStorage
  useEffect(() => {
    if (latestRound !== null && dataLoaded.current) {
      localStorage.setItem(`lomaf-section-templates-${latestRound}`, JSON.stringify(sections));
    }
  }, [sections, latestRound]);

  // Auto-save round data
  const doAutoSave = useCallback(async () => {
    if (!round || round.status === 'published') return;
    setAutoSaveStatus('saving');
    try {
      await supabase.from('pwrnkgs_rounds')
        .update({ preview_text: previewText || null, week_ahead_text: weekAheadText || null })
        .eq('id', round.id);
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch { setAutoSaveStatus('idle'); }
  }, [round, previewText, weekAheadText]);

  useEffect(() => {
    if (!dataLoaded.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doAutoSave(), 3000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [previewText, weekAheadText, doAutoSave]);

  // Generate slide previews
  const generateSlide = async (type: 'preview' | 'summary') => {
    if (!round) return;
    // Save first
    await supabase.from('pwrnkgs_rounds')
      .update({ preview_text: previewText || null, week_ahead_text: weekAheadText || null })
      .eq('id', round.id);

    const slideIndex = type === 'preview' ? 0 : 11;
    const setLoading = type === 'preview' ? setPreviewLoading : setSummaryLoading;
    const setUrl = type === 'preview' ? setPreviewSlideUrl : setSummarySlideUrl;

    setLoading(true);
    try {
      const res = await fetch(`/api/carousel/slide/${slideIndex}?round=${round.round_number}`);
      if (res.ok) {
        const blob = await res.blob();
        setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      } else {
        const errText = await res.text();
        console.error(`Slide gen returned ${res.status}:`, errText);
      }
    } catch (err) { console.error('Slide gen failed:', err); }
    finally { setLoading(false); }
  };

  const addSection = () => {
    setSections((prev) => [...prev, { title: '' }]);
  };

  const removeSection = (index: number) => {
    setSections((prev) => prev.filter((_, i) => i !== index));
  };

  const updateSection = (index: number, title: string) => {
    setSections((prev) => prev.map((s, i) => (i === index ? { title } : s)));
  };

  const moveSection = (from: number, to: number) => {
    if (to < 0 || to >= sections.length) return;
    setSections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const isPublished = round?.status === 'published';

  if (!latestRound) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Upload data first to start configuring slides.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded-full text-sm">R{latestRound}</span>
        {isPublished && <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">Published</span>}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {autoSaveStatus === 'saving' && <><div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Saving...</>}
          {autoSaveStatus === 'saved' && <><Check size={14} className="text-green-600" /> Saved</>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Fields */}
        <div className="space-y-6">
          {/* Preview Text (Slide 1) */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Preview Text (Slide 1)</label>
              <button onClick={() => generateSlide('preview')} disabled={previewLoading}
                className="text-xs text-primary hover:underline font-medium disabled:opacity-50">
                {previewLoading ? 'Generating...' : 'Generate Preview'}
              </button>
            </div>
            <textarea value={previewText} onChange={(e) => setPreviewText(e.target.value)}
              placeholder="The intro/hype paragraph for the first carousel slide..." rows={5} disabled={isPublished}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y" />
          </div>

          {/* Week Ahead (Slide 12) */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Week Ahead Text (Slide 12)</label>
              <button onClick={() => generateSlide('summary')} disabled={summaryLoading}
                className="text-xs text-primary hover:underline font-medium disabled:opacity-50">
                {summaryLoading ? 'Generating...' : 'Generate Summary'}
              </button>
            </div>
            <textarea value={weekAheadText} onChange={(e) => setWeekAheadText(e.target.value)}
              placeholder="Closing paragraph about the upcoming round..." rows={5} disabled={isPublished}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 resize-y" />
          </div>

          {/* Writeup Section Templates */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Writeup Section Templates</label>
              <button onClick={addSection} disabled={isPublished}
                className="flex items-center gap-1 text-xs text-primary font-medium hover:underline disabled:opacity-50">
                <Plus size={14} /> Add Section
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Define the structure for team writeups. These become pre-populated <code className="bg-muted px-1 rounded">##</code> headers in every team&apos;s writeup textarea. Leave empty for freeform writeups.
            </p>
            {sections.length > 0 ? (
              <div className="space-y-2">
                {sections.map((section, i) => (
                  <div key={i} className="flex items-center gap-2 bg-background rounded-lg p-3 border border-border">
                    <button onClick={() => moveSection(i, i - 1)} disabled={i === 0 || isPublished}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <GripVertical size={14} />
                    </button>
                    <span className="text-xs text-muted-foreground font-mono w-6 shrink-0">##</span>
                    <input type="text" value={section.title}
                      onChange={(e) => updateSection(i, e.target.value)}
                      placeholder={`Section ${i + 1} title (e.g., "What's Gone Right")`}
                      disabled={isPublished}
                      className="flex-1 bg-card border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                    <button onClick={() => removeSection(i)} disabled={isPublished}
                      className="p-1 text-red-400 hover:text-red-600 disabled:opacity-30">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                No sections defined — writeups will be freeform
              </div>
            )}
            {sections.length > 0 && (
              <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Preview: each team&apos;s writeup will start with:</p>
                <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">
                  {sections.filter(s => s.title.trim()).map(s => `## ${s.title}\n\n`).join('')}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Right column: AI Brief + Slide previews */}
        <div className="space-y-6">
          {/* Intelligence Brief */}
          {!isPublished && <IntelligenceBrief roundNumber={latestRound} />}

          {/* Preview slide */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-5">
            <label className="block text-xs text-muted-foreground mb-3 font-semibold uppercase tracking-wide">Slide 1 Preview</label>
            <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden border border-border">
              {previewSlideUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewSlideUrl} alt="Slide 1 Preview" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  Click &quot;Generate Preview&quot; to see Slide 1
                </div>
              )}
            </div>
          </div>

          {/* Summary slide */}
          <div className="bg-card rounded-lg border border-border shadow-sm p-5">
            <label className="block text-xs text-muted-foreground mb-3 font-semibold uppercase tracking-wide">Slide 12 Summary</label>
            <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden border border-border">
              {summarySlideUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={summarySlideUrl} alt="Slide 12 Summary" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  Click &quot;Generate Summary&quot; to see Slide 12
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
