'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import UploadContent from './upload-content';

interface CsvUploadRecord {
  id: string;
  round_number: number;
  upload_type: string;
  uploaded_at: string;
}

export default function UploadPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Data Upload</h1>
      <p className="text-muted-foreground text-sm mb-6">Upload CSVs to import round data</p>
      <div className="space-y-8">
        <UploadContent />
        <UploadHistory />
      </div>
    </div>
  );
}

function UploadHistory() {
  const [records, setRecords] = useState<CsvUploadRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('csv_uploads')
        .select('id, round_number, upload_type, uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(200);
      setRecords((data ?? []) as CsvUploadRecord[]);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
        <h3 className="font-semibold text-sm mb-3">Upload History</h3>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
        <h3 className="font-semibold text-sm mb-3">Upload History</h3>
        <p className="text-sm text-muted-foreground">No uploads recorded yet.</p>
      </div>
    );
  }

  const byRound = new Map<number, CsvUploadRecord[]>();
  for (const r of records) {
    if (!byRound.has(r.round_number)) byRound.set(r.round_number, []);
    byRound.get(r.round_number)!.push(r);
  }
  const sortedRounds = [...byRound.keys()].sort((a, b) => b - a);

  const CSV_TYPES = ['lineups', 'teams', 'matchups', 'points_grid', 'draft'] as const;
  const TYPE_LABELS: Record<string, string> = {
    lineups: 'Lineups', teams: 'Teams', matchups: 'Matchups',
    points_grid: 'Points Grid', draft: 'Draft',
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) +
      ' ' +
      d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
      <h3 className="font-semibold text-sm mb-4">Upload History</h3>
      <div className="space-y-3">
        {sortedRounds.map((round) => {
          const roundRecords = byRound.get(round)!;
          const latestByType = new Map<string, CsvUploadRecord>();
          for (const rec of roundRecords) {
            const existing = latestByType.get(rec.upload_type);
            if (!existing || new Date(rec.uploaded_at) > new Date(existing.uploaded_at)) {
              latestByType.set(rec.upload_type, rec);
            }
          }

          return (
            <div key={round} className="border border-border rounded-lg p-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="bg-primary/10 text-primary font-bold px-2.5 py-0.5 rounded-full text-xs">
                  {round === 0 ? 'Draft' : `R${round}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {latestByType.size} CSV{latestByType.size !== 1 ? 's' : ''} uploaded
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {CSV_TYPES.map((type) => {
                  const rec = latestByType.get(type);
                  if (!rec) {
                    if (round === 0 && type !== 'draft') return null;
                    if (round !== 0 && type === 'draft') return null;
                    return (
                      <span key={type} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-muted/50 text-muted-foreground border border-border">
                        {TYPE_LABELS[type]}
                      </span>
                    );
                  }
                  return (
                    <span key={type} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-green-50 text-green-700 border border-green-200"
                      title={`Uploaded ${formatDate(rec.uploaded_at)}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      {TYPE_LABELS[type]}
                      <span className="text-green-500 ml-0.5">{formatDate(rec.uploaded_at)}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
