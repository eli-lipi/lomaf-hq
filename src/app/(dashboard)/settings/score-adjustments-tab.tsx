'use client';

import { useState, useEffect } from 'react';
import { TEAMS } from '@/lib/constants';
import { cn, formatScore } from '@/lib/utils';
import type { ScoreAdjustment } from '@/lib/types';
import { supabase } from '@/lib/supabase';

const LINE_OPTIONS = ['Unassigned', 'DEF', 'MID', 'FWD', 'RUC', 'UTL'] as const;

export default function ScoreAdjustmentsTab() {
  const [adjustments, setAdjustments] = useState<ScoreAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [validRounds, setValidRounds] = useState<number[]>([]);

  // Add form state
  const [addRound, setAddRound] = useState(0);
  const [addTeamId, setAddTeamId] = useState(0);
  const [addCorrectScore, setAddCorrectScore] = useState('');
  const [addLine, setAddLine] = useState('');
  const [addNote, setAddNote] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/score-adjustments');
      const { data } = await res.json();
      setAdjustments(data || []);

      // Get valid rounds for the add form
      const { data: rounds } = await supabase
        .from('player_rounds')
        .select('round_number');
      const unique = [...new Set((rounds || []).map((r: { round_number: number }) => r.round_number))].sort((a, b) => a - b);
      setValidRounds(unique);
      if (unique.length > 0 && addRound === 0) setAddRound(unique[unique.length - 1]);
    } catch (err) {
      console.error('Failed to load adjustments:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateAdjustment = async (adj: ScoreAdjustment, updates: Partial<ScoreAdjustment>) => {
    setSaving(adj.id);
    try {
      const res = await fetch('/api/score-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_number: adj.round_number,
          team_id: adj.team_id,
          team_name: adj.team_name,
          correct_score: updates.correct_score ?? adj.correct_score,
          lineup_score: adj.lineup_score,
          assigned_line: updates.assigned_line !== undefined ? updates.assigned_line : adj.assigned_line,
          note: updates.note !== undefined ? updates.note : adj.note,
          status: updates.status ?? adj.status,
          source: adj.source,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      await loadData();
    } catch (err) {
      console.error('Failed to update:', err);
    } finally {
      setSaving(null);
    }
  };

  const addManualOverride = async () => {
    if (!addRound || !addTeamId || !addCorrectScore) return;
    setSaving('add');
    try {
      const team = TEAMS.find(t => t.team_id === addTeamId);

      // Get lineup score for this team-round
      const { data: playerRounds } = await supabase
        .from('player_rounds')
        .select('points, is_scoring')
        .eq('round_number', addRound)
        .eq('team_id', addTeamId);

      const lineupScore = (playerRounds || [])
        .filter((p: { is_scoring: boolean; points: number | null }) => p.is_scoring && p.points != null)
        .reduce((sum: number, p: { points: number | null }) => sum + Number(p.points), 0);

      const res = await fetch('/api/score-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_number: addRound,
          team_id: addTeamId,
          team_name: team?.team_name || '',
          correct_score: Number(addCorrectScore),
          lineup_score: Math.round(lineupScore),
          assigned_line: addLine || null,
          note: addNote || null,
          status: 'unconfirmed',
          source: 'manual',
        }),
      });
      if (!res.ok) throw new Error('Save failed');

      setShowAddForm(false);
      setAddCorrectScore('');
      setAddLine('');
      setAddNote('');
      await loadData();
    } catch (err) {
      console.error('Failed to add override:', err);
    } finally {
      setSaving(null);
    }
  };

  const deleteAdjustment = async (id: string) => {
    if (!confirm('Delete this adjustment?')) return;
    try {
      const res = await fetch('/api/score-adjustments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Delete failed');
      await loadData();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  if (loading) return <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm"><p className="text-muted-foreground">Loading score adjustments...</p></div>;

  const unconfirmedCount = adjustments.filter(a => a.status === 'unconfirmed').length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {adjustments.length} adjustment{adjustments.length !== 1 ? 's' : ''} tracked
            {unconfirmedCount > 0 && (
              <span className="ml-2 text-amber-600 font-medium">{unconfirmedCount} unconfirmed</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          + Add Manual Override
        </button>
      </div>

      {/* Add Manual Override Form */}
      {showAddForm && (
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">Add Manual Override</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Round</label>
              <select value={addRound} onChange={e => setAddRound(Number(e.target.value))} className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background">
                {validRounds.map(r => <option key={r} value={r}>R{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Team</label>
              <select value={addTeamId} onChange={e => setAddTeamId(Number(e.target.value))} className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background">
                <option value={0}>Select...</option>
                {TEAMS.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Correct Score</label>
              <input type="number" value={addCorrectScore} onChange={e => setAddCorrectScore(e.target.value)} placeholder="1394" className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Line (optional)</label>
              <select value={addLine} onChange={e => setAddLine(e.target.value)} className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background">
                <option value="">Unassigned</option>
                <option value="DEF">DEF</option>
                <option value="MID">MID</option>
                <option value="FWD">FWD</option>
                <option value="RUC">RUC</option>
                <option value="UTL">UTL</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Note</label>
              <input type="text" value={addNote} onChange={e => setAddNote(e.target.value)} placeholder="Reason..." className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={addManualOverride}
              disabled={saving === 'add' || !addTeamId || !addCorrectScore}
              className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving === 'add' ? 'Saving...' : 'Save Override'}
            </button>
            <button onClick={() => setShowAddForm(false)} className="px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {/* Adjustments Table */}
      {adjustments.length > 0 ? (
        <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Round</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Team</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Correct</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Lineup</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-right">Adj</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Line</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Note</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground text-center">Status</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground w-10"></th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adj) => (
                  <AdjustmentRow key={adj.id} adj={adj} saving={saving === adj.id} onUpdate={updateAdjustment} onDelete={deleteAdjustment} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-border rounded-lg shadow-sm">
          <p className="text-muted-foreground">No score adjustments detected. Upload matchups and lineups CSVs to auto-detect discrepancies.</p>
        </div>
      )}
    </div>
  );
}

function AdjustmentRow({ adj, saving, onUpdate, onDelete }: {
  adj: ScoreAdjustment;
  saving: boolean;
  onUpdate: (adj: ScoreAdjustment, updates: Partial<ScoreAdjustment>) => void;
  onDelete: (id: string) => void;
}) {
  const [editNote, setEditNote] = useState(adj.note || '');
  const [noteChanged, setNoteChanged] = useState(false);

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2.5 font-medium">R{adj.round_number}</td>
      <td className="px-3 py-2.5">
        <span className="font-medium">{adj.team_name}</span>
        <span className="text-xs text-muted-foreground ml-1">({adj.source})</span>
      </td>
      <td className="px-3 py-2.5 text-right font-medium">{formatScore(adj.correct_score)}</td>
      <td className="px-3 py-2.5 text-right text-muted-foreground">{formatScore(adj.lineup_score)}</td>
      <td className={cn('px-3 py-2.5 text-right font-bold',
        adj.adjustment > 0 ? 'text-green-600' : adj.adjustment < 0 ? 'text-red-600' : 'text-muted-foreground'
      )}>
        {adj.adjustment > 0 ? '+' : ''}{adj.adjustment}
      </td>
      <td className="px-3 py-2.5">
        <select
          value={adj.assigned_line || ''}
          onChange={e => onUpdate(adj, { assigned_line: e.target.value || null })}
          className="border border-border rounded px-1.5 py-1 text-xs bg-background w-20"
          disabled={saving}
        >
          {LINE_OPTIONS.map(opt => (
            <option key={opt} value={opt === 'Unassigned' ? '' : opt}>{opt}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={editNote}
            onChange={e => { setEditNote(e.target.value); setNoteChanged(true); }}
            onBlur={() => { if (noteChanged) { onUpdate(adj, { note: editNote }); setNoteChanged(false); } }}
            placeholder="Add note..."
            className="border border-border rounded px-2 py-1 text-xs bg-background w-full max-w-[200px]"
            disabled={saving}
          />
        </div>
      </td>
      <td className="px-3 py-2.5 text-center">
        <button
          onClick={() => onUpdate(adj, { status: adj.status === 'confirmed' ? 'unconfirmed' : 'confirmed' })}
          disabled={saving}
          className={cn('text-xs font-medium px-2 py-1 rounded-full border transition-colors',
            adj.status === 'confirmed'
              ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
              : 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200'
          )}
        >
          {adj.status === 'confirmed' ? 'Confirmed' : 'Unconfirmed'}
        </button>
      </td>
      <td className="px-3 py-2.5">
        <button onClick={() => onDelete(adj.id)} className="text-red-400 hover:text-red-600 text-xs">
          {'\u2715'}
        </button>
      </td>
    </tr>
  );
}
