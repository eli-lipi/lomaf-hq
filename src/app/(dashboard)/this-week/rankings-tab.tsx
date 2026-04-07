'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { GripVertical, Save, Send } from 'lucide-react';
import { cn, ordinal, movementLabel, movementColor } from '@/lib/utils';
import { TEAMS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { PwrnkgsRound, PwrnkgsRanking, TeamSnapshot } from '@/lib/types';

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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Load latest round data
  useEffect(() => {
    async function loadData() {
      // Find the latest round with team_snapshots
      const { data: snapshots } = await supabase
        .from('team_snapshots')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1);

      const currentRound = snapshots?.[0]?.round_number;
      if (!currentRound) return;
      setLatestRound(currentRound);

      // Check if a pwrnkgs_rounds entry exists for this round
      let { data: roundData } = await supabase
        .from('pwrnkgs_rounds')
        .select('*')
        .eq('round_number', currentRound)
        .single();

      // If not, create one
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

      // Load team snapshots for stats
      const { data: teamSnapshots } = await supabase
        .from('team_snapshots')
        .select('*')
        .eq('round_number', currentRound);

      // Get previous round's rankings for movement
      const { data: prevRankings } = await supabase
        .from('pwrnkgs_rankings')
        .select('team_id, ranking')
        .eq('round_number', currentRound - 1);

      const prevRankMap = new Map<number, number>();
      prevRankings?.forEach((r) => prevRankMap.set(r.team_id, r.ranking));

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
              writeup: r.writeup || '',
              snapshot: snapshotMap.get(r.team_id),
            };
          })
        );
      } else {
        // Initialize with all teams, sorted by league rank or alphabetically
        const sorted = [...TEAMS].sort((a, b) => {
          const snapA = snapshotMap.get(a.team_id);
          const snapB = snapshotMap.get(b.team_id);
          if (snapA && snapB) return (snapA.league_rank || 99) - (snapB.league_rank || 99);
          return a.team_name.localeCompare(b.team_name);
        });

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
      // Update round metadata
      await supabase
        .from('pwrnkgs_rounds')
        .update({ theme: theme || null, preview_text: previewText || null, week_ahead_text: weekAheadText || null })
        .eq('id', round.id);

      // Upsert rankings
      const rankingRows = rankings.map((r) => ({
        round_id: round.id,
        round_number: round.round_number,
        team_id: r.team_id,
        team_name: r.team_name,
        ranking: r.ranking,
        previous_ranking: r.previous_ranking,
        writeup: r.writeup,
      }));

      const { error } = await supabase
        .from('pwrnkgs_rankings')
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
      await supabase
        .from('pwrnkgs_rounds')
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
      {/* Round header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded text-sm">R{latestRound}</span>
        {isPublished && (
          <span className="bg-green-500/10 text-green-400 text-xs font-medium px-2 py-1 rounded">Published</span>
        )}
      </div>

      {/* Round metadata */}
      <div className="space-y-4 mb-8 bg-card rounded-lg p-5 border border-border">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Theme (optional)</label>
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="e.g., The Gap"
            disabled={isPublished}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Preview Text (Slide 1)</label>
          <textarea
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="The intro paragraph for the first carousel slide..."
            rows={4}
            disabled={isPublished}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 resize-y"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Week Ahead Text (Slide 12)</label>
          <textarea
            value={weekAheadText}
            onChange={(e) => setWeekAheadText(e.target.value)}
            placeholder="Closing paragraph about the upcoming round..."
            rows={3}
            disabled={isPublished}
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 resize-y"
          />
        </div>
      </div>

      {/* Rankings list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rankings.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {rankings.map((item) => (
              <SortableRankingCard
                key={item.id}
                item={item}
                onWriteupChange={updateWriteup}
                disabled={isPublished}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Action buttons */}
      {!isPublished && (
        <div className="flex gap-3 mt-6">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            onClick={publish}
            disabled={publishing}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Send size={16} />
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      )}

      {/* Message */}
      {message && (
        <div
          className={cn(
            'mt-4 p-3 rounded-lg text-sm',
            message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          )}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

function SortableRankingCard({
  item,
  onWriteupChange,
  disabled,
}: {
  item: RankingItem;
  onWriteupChange: (teamId: number, writeup: string) => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const movement = movementLabel(item.ranking, item.previous_ranking);
  const moveColor = movementColor(item.ranking, item.previous_ranking);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-card border border-border rounded-lg p-4 flex gap-4',
        isDragging && 'opacity-50 z-50'
      )}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className={cn('flex items-center cursor-grab active:cursor-grabbing', disabled && 'cursor-default')}
      >
        <GripVertical size={18} className="text-muted-foreground" />
      </div>

      {/* Rank number */}
      <div className="w-10 shrink-0 flex items-start justify-center pt-1">
        <span className="text-2xl font-bold text-primary">{item.ranking}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <span className="font-semibold text-sm truncate">{item.team_name}</span>
          <span className="text-xs text-muted-foreground">{item.coach}</span>
          <span className={cn('text-xs font-medium', moveColor)}>{movement}</span>
        </div>

        {/* Stats row */}
        {item.snapshot && (
          <div className="flex gap-4 text-xs text-muted-foreground mb-2">
            <span>Score: {Math.round(item.snapshot.pts_for)}</span>
            <span>
              {item.snapshot.wins}W-{item.snapshot.losses}L
            </span>
            <span>Rank: {ordinal(item.snapshot.league_rank || 0)}</span>
          </div>
        )}

        {/* Writeup textarea */}
        <textarea
          value={item.writeup}
          onChange={(e) => onWriteupChange(item.team_id, e.target.value)}
          placeholder="Write 2-3 sentences about this team..."
          rows={2}
          disabled={disabled}
          className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 resize-y"
        />
      </div>
    </div>
  );
}
