'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type PromptRow = {
  key: 'intelligence_brief' | 'chart_insights';
  title: string;
  description: string;
  text: string;
  default_text: string;
  is_custom: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

export default function AIPromptsTab() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/prompts');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setPrompts(json.prompts);
      const d: Record<string, string> = {};
      json.prompts.forEach((p: PromptRow) => { d[p.key] = p.text; });
      setDrafts(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const save = async (key: string) => {
    setSaving(key);
    setError(null);
    setSavedKey(null);
    try {
      const res = await fetch('/api/ai/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, text: drafts[key] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2500);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  const resetToDefault = (p: PromptRow) => {
    setDrafts((prev) => ({ ...prev, [p.key]: p.default_text }));
  };

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading prompts...</div>;
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">AI Prompts</h2>
      <p className="text-sm text-muted-foreground mb-5">
        These prompts control how the AI writes the Intelligence Brief and Chart Insights. Changes take effect on the next generation.
      </p>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <div className="space-y-5">
        {prompts.map((p) => {
          const dirty = drafts[p.key] !== p.text;
          const matchesDefault = drafts[p.key] === p.default_text;
          return (
            <div key={p.key} className="bg-card border border-border rounded-lg p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h3 className="font-semibold text-base">{p.title}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{p.description}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  {p.is_custom ? (
                    <span className="inline-block rounded bg-primary/10 text-primary px-2 py-0.5 font-medium">Customized</span>
                  ) : (
                    <span className="inline-block rounded bg-muted px-2 py-0.5">Using default</span>
                  )}
                  {p.updated_at && (
                    <div className="mt-1">
                      Last edited {new Date(p.updated_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              <textarea
                value={drafts[p.key] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [p.key]: e.target.value }))}
                rows={Math.min(24, Math.max(10, (drafts[p.key] || '').split('\n').length + 1))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/50"
                spellCheck={false}
              />

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {(drafts[p.key] || '').length.toLocaleString()} characters
                  {matchesDefault && <span className="ml-2 text-muted-foreground">· matches default</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => resetToDefault(p)}
                    disabled={matchesDefault}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors',
                      matchesDefault
                        ? 'text-muted-foreground cursor-not-allowed'
                        : 'hover:bg-muted'
                    )}
                    title="Replace the editor with the built-in default (does not save until you click Save)"
                  >
                    <RotateCcw size={13} />
                    Reset to default
                  </button>
                  <button
                    type="button"
                    onClick={() => save(p.key)}
                    disabled={!dirty || saving === p.key || !(drafts[p.key] || '').trim()}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
                      !dirty || !(drafts[p.key] || '').trim()
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-primary text-primary-foreground hover:opacity-90'
                    )}
                  >
                    {saving === p.key ? 'Saving...' : savedKey === p.key ? (
                      <>
                        <Check size={13} />
                        Saved
                      </>
                    ) : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
