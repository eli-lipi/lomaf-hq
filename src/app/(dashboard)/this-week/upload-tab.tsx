'use client';

import { useState, useCallback, useEffect } from 'react';
import { Upload, CheckCircle, AlertCircle, FileText, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

type CsvType = 'lineups' | 'teams' | 'matchups' | 'points_grid' | 'draft';

interface UploadState {
  status: 'idle' | 'parsed' | 'uploading' | 'uploaded' | 'error';
  filename?: string;
  rowCount?: number;
  error?: string;
  data?: Record<string, unknown>[];
}

interface RoundStatus {
  playerRounds: boolean;
  teamSnapshots: boolean;
}

function detectCsvType(filename: string): CsvType | null {
  const lower = filename.toLowerCase();
  if (lower.includes('lineup')) return 'lineups';
  if (lower.includes('matchup')) return 'matchups';
  if (lower.includes('team')) return 'teams';
  if (lower.includes('points') || lower.includes('grid')) return 'points_grid';
  if (lower.includes('draft')) return 'draft';
  return null;
}

const TOTAL_ROUNDS = 23;

export default function UploadTab() {
  const [uploads, setUploads] = useState<Record<CsvType, UploadState>>({
    lineups: { status: 'idle' },
    teams: { status: 'idle' },
    matchups: { status: 'idle' },
    points_grid: { status: 'idle' },
    draft: { status: 'idle' },
  });
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<string | null>(null);
  const [stepLog, setStepLog] = useState<string[]>([]);
  const [roundStatuses, setRoundStatuses] = useState<Record<number, RoundStatus>>({});
  const [hasDraft, setHasDraft] = useState(false);
  const [loadingDb, setLoadingDb] = useState(true);

  useEffect(() => {
    loadDbSummary();
  }, []);

  const loadDbSummary = async () => {
    setLoadingDb(true);
    try {
      const { data: pr } = await supabase.from('player_rounds').select('round_number');
      const { data: ts } = await supabase.from('team_snapshots').select('round_number');
      const { count: draftCount } = await supabase.from('draft_picks').select('*', { count: 'exact', head: true });

      const statuses: Record<number, RoundStatus> = {};
      pr?.forEach((r) => {
        if (!statuses[r.round_number]) statuses[r.round_number] = { playerRounds: false, teamSnapshots: false };
        statuses[r.round_number].playerRounds = true;
      });
      ts?.forEach((r) => {
        if (!statuses[r.round_number]) statuses[r.round_number] = { playerRounds: false, teamSnapshots: false };
        statuses[r.round_number].teamSnapshots = true;
      });

      setRoundStatuses(statuses);
      setHasDraft((draftCount || 0) > 0);
    } catch (err) {
      console.error('Failed to load DB summary:', err);
    } finally {
      setLoadingDb(false);
    }
  };

  const handleFile = useCallback((file: File, type: CsvType) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as Record<string, unknown>[];

        if (results.errors.length > 0) {
          setUploads((prev) => ({
            ...prev,
            [type]: { status: 'error', filename: file.name, error: results.errors[0].message },
          }));
          return;
        }

        setUploads((prev) => ({
          ...prev,
          [type]: { status: 'parsed', filename: file.name, rowCount: data.length, data },
        }));

        setProcessResult(null);
        setStepLog([]);
      },
    });
  }, []);

  const handleMultiDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith('.csv'));

      for (const file of files) {
        const detected = detectCsvType(file.name);
        if (detected) {
          handleFile(file, detected);
        }
      }
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        const detected = detectCsvType(file.name);
        if (detected) {
          handleFile(file, detected);
        }
      }
    },
    [handleFile]
  );

  const processRound = async () => {
    setProcessing(true);
    setProcessResult(null);
    setStepLog([]);

    try {
      let filesProcessed = 0;

      // Upload in correct order: lineups first, then teams, then matchups, then points_grid
      const uploadOrder: CsvType[] = ['lineups', 'teams', 'matchups', 'points_grid'];
      for (const type of uploadOrder) {
        const upload = uploads[type];
        if (upload.status !== 'parsed' || !upload.data) {
          setStepLog((prev) => [...prev, `Skipping ${type} (no file)`]);
          continue;
        }

        setStepLog((prev) => [...prev, `Uploading ${type}... (${upload.rowCount} rows)`]);
        setUploads((prev) => ({
          ...prev,
          [type]: { ...prev[type], status: 'uploading' },
        }));

        const res = await fetch(`/api/upload/${type.replace('_', '-')}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: upload.data }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(`${type}: ${err.error || 'Upload failed'}`);
        }

        const result = await res.json();
        filesProcessed++;

        setUploads((prev) => ({
          ...prev,
          [type]: { ...prev[type], status: 'uploaded' },
        }));

        let logMsg = `${type} uploaded successfully`;
        if (result.rounds) {
          const roundList = Object.entries(result.rounds).map(([r, c]) => `R${r}: ${c}`).join(', ');
          logMsg += ` (${roundList})`;
        } else if (result.target_round) {
          logMsg += ` (applied to R${result.target_round}, computed ${result.rounds_computed?.length || 0} rounds)`;
        } else {
          logMsg += ` (${result.count} records)`;
        }
        if (result.new_discrepancies > 0) {
          logMsg += ` — ⚠️ ${result.new_discrepancies} score discrepancies detected`;
        }
        setStepLog((prev) => [...prev, logMsg]);
      }

      // Process draft if parsed
      if (uploads.draft.status === 'parsed' && uploads.draft.data) {
        setStepLog((prev) => [...prev, `Uploading draft... (${uploads.draft.rowCount} picks)`]);
        setUploads((prev) => ({ ...prev, draft: { ...prev.draft, status: 'uploading' } }));

        const res = await fetch('/api/upload/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: uploads.draft.data }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(`draft: ${err.error || 'Upload failed'}`);
        }

        setUploads((prev) => ({ ...prev, draft: { ...prev.draft, status: 'uploaded' } }));
        setStepLog((prev) => [...prev, `Draft uploaded successfully`]);
        filesProcessed++;
      }

      if (filesProcessed === 0) {
        setProcessResult('No files to process. Upload at least one CSV first.');
      } else {
        setProcessResult(`Done! ${filesProcessed} file${filesProcessed > 1 ? 's' : ''} processed.`);
      }

      await loadDbSummary();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setStepLog((prev) => [...prev, `Error: ${errorMsg}`]);
      setProcessResult(`Error: ${errorMsg}`);
    } finally {
      setProcessing(false);
    }
  };

  const csvSlots: { type: CsvType; label: string }[] = [
    { type: 'lineups', label: 'Lineups' },
    { type: 'teams', label: 'Teams' },
    { type: 'matchups', label: 'Matchups' },
    { type: 'points_grid', label: 'Points Grid' },
  ];

  const hasAnyParsed = Object.values(uploads).some((u) => u.status === 'parsed');

  return (
    <div>
      {/* Season Round Timeline */}
      <div className="bg-card border border-border rounded-lg p-5 mb-6 shadow-sm">
        <h3 className="font-semibold text-sm mb-3">Season Progress</h3>
        {loadingDb ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {/* Draft pill */}
            <div
              className={cn(
                'flex items-center justify-center h-8 px-2.5 rounded-md text-xs font-medium shrink-0 border',
                hasDraft
                  ? 'bg-green-100 text-green-700 border-green-300'
                  : 'bg-gray-100 text-gray-400 border-gray-200'
              )}
            >
              Draft
            </div>
            <div className="w-1 h-px bg-border shrink-0" />
            {/* Round pills R1–R23 */}
            {Array.from({ length: TOTAL_ROUNDS }, (_, i) => i + 1).map((round) => {
              const status = roundStatuses[round];
              const hasData = status?.playerRounds || status?.teamSnapshots;
              return (
                <div
                  key={round}
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium shrink-0 border',
                    hasData
                      ? 'bg-green-100 text-green-700 border-green-300'
                      : 'bg-gray-100 text-gray-400 border-gray-200'
                  )}
                  title={hasData ? `R${round}: data uploaded` : `R${round}: no data`}
                >
                  {round}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Multi-file drop zone */}
      <div
        onDrop={handleMultiDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-border rounded-xl p-8 mb-6 text-center hover:border-primary/50 transition-colors bg-card"
      >
        <Upload size={32} className="mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-2">
          Drop all your CSVs here at once — types auto-detected from filenames
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          (lineups, teams, matchups, points-grid)
        </p>
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium cursor-pointer hover:bg-primary/90 transition-colors">
          <Upload size={14} />
          Browse Files
          <input
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
        </label>
      </div>

      {/* Parsed files summary */}
      {csvSlots.some(({ type }) => uploads[type].status !== 'idle') && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
          {csvSlots.map(({ type, label }) => {
            const upload = uploads[type];
            if (upload.status === 'idle') return (
              <div key={type} className="border border-border rounded-lg p-3 bg-card text-muted-foreground text-sm">
                {label}: not loaded
              </div>
            );
            return (
              <div
                key={type}
                className={cn(
                  'border rounded-lg p-3',
                  upload.status === 'uploaded' ? 'border-green-300 bg-green-50'
                    : upload.status === 'uploading' ? 'border-blue-300 bg-blue-50'
                    : upload.status === 'parsed' ? 'border-primary/30 bg-blue-50/30'
                    : upload.status === 'error' ? 'border-red-300 bg-red-50'
                    : 'border-border bg-card'
                )}
              >
                <div className="flex items-center gap-2">
                  {upload.status === 'uploaded' ? <CheckCircle size={16} className="text-green-600" />
                    : upload.status === 'uploading' ? <Loader2 size={16} className="text-blue-600 animate-spin" />
                    : upload.status === 'error' ? <AlertCircle size={16} className="text-red-600" />
                    : <FileText size={16} className="text-primary" />
                  }
                  <span className="text-sm font-medium">{label}</span>
                  {upload.rowCount && <span className="text-xs text-muted-foreground ml-auto">{upload.rowCount} rows</span>}
                </div>
                {upload.filename && <p className="text-xs text-muted-foreground mt-1 truncate">{upload.filename}</p>}
                {upload.error && <p className="text-xs text-red-600 mt-1">{upload.error}</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* Process button */}
      {hasAnyParsed && (
        <button
          onClick={processRound}
          disabled={processing}
          className={cn(
            'w-full py-3 rounded-lg font-medium text-sm transition-colors',
            processing
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
          )}
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              Processing...
            </span>
          ) : (
            'Process Upload'
          )}
        </button>
      )}

      {/* Step log */}
      {stepLog.length > 0 && (
        <div className="mt-4 bg-card border border-border rounded-lg p-4 space-y-1 shadow-sm">
          {stepLog.map((log, i) => (
            <p
              key={i}
              className={cn(
                'text-sm font-mono',
                log.startsWith('Error') ? 'text-red-600' : log.includes('successfully') ? 'text-green-600' : 'text-muted-foreground'
              )}
            >
              {log.includes('successfully') ? '✓' : log.startsWith('Error') ? '✗' : '→'} {log}
            </p>
          ))}
        </div>
      )}

      {/* Result */}
      {processResult && (
        <div
          className={cn(
            'mt-4 p-4 rounded-lg text-sm font-medium',
            processResult.startsWith('Error')
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-green-50 text-green-700 border border-green-200'
          )}
        >
          {processResult}
        </div>
      )}
    </div>
  );
}
