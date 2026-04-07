'use client';

import { useState, useCallback, useEffect } from 'react';
import { Upload, CheckCircle, AlertCircle, FileText, Loader2, Database } from 'lucide-react';
import Papa from 'papaparse';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

type CsvType = 'lineups' | 'teams' | 'points_grid' | 'draft';

interface UploadState {
  status: 'idle' | 'parsed' | 'uploading' | 'uploaded' | 'error';
  filename?: string;
  rowCount?: number;
  error?: string;
  data?: Record<string, unknown>[];
}

interface DbSummary {
  playerRounds: Record<number, number>;
  teamSnapshots: Record<number, number>;
  draftPicks: number;
  pwrnkgsRounds: { round_number: number; status: string }[];
}

function detectCsvType(filename: string): CsvType | null {
  const lower = filename.toLowerCase();
  if (lower.includes('lineup')) return 'lineups';
  if (lower.includes('team')) return 'teams';
  if (lower.includes('points') || lower.includes('grid')) return 'points_grid';
  if (lower.includes('draft')) return 'draft';
  return null;
}

export default function UploadTab() {
  const [uploads, setUploads] = useState<Record<CsvType, UploadState>>({
    lineups: { status: 'idle' },
    teams: { status: 'idle' },
    points_grid: { status: 'idle' },
    draft: { status: 'idle' },
  });
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<string | null>(null);
  const [stepLog, setStepLog] = useState<string[]>([]);
  const [dbSummary, setDbSummary] = useState<DbSummary | null>(null);
  const [loadingDb, setLoadingDb] = useState(true);

  // Load current DB state on mount
  useEffect(() => {
    loadDbSummary();
  }, []);

  const loadDbSummary = async () => {
    setLoadingDb(true);
    try {
      // Player rounds by round
      const { data: pr } = await supabase.from('player_rounds').select('round_number');
      const prByRound: Record<number, number> = {};
      pr?.forEach((r) => { prByRound[r.round_number] = (prByRound[r.round_number] || 0) + 1; });

      // Team snapshots by round
      const { data: ts } = await supabase.from('team_snapshots').select('round_number');
      const tsByRound: Record<number, number> = {};
      ts?.forEach((r) => { tsByRound[r.round_number] = (tsByRound[r.round_number] || 0) + 1; });

      // Draft picks count
      const { count: draftCount } = await supabase.from('draft_picks').select('*', { count: 'exact', head: true });

      // PWRNKGs rounds
      const { data: pwr } = await supabase.from('pwrnkgs_rounds').select('round_number, status').order('round_number');

      setDbSummary({
        playerRounds: prByRound,
        teamSnapshots: tsByRound,
        draftPicks: draftCount || 0,
        pwrnkgsRounds: pwr || [],
      });
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
            [type]: {
              status: 'error',
              filename: file.name,
              error: results.errors[0].message,
            },
          }));
          return;
        }

        setUploads((prev) => ({
          ...prev,
          [type]: {
            status: 'parsed',
            filename: file.name,
            rowCount: data.length,
            data,
          },
        }));

        setProcessResult(null);
        setStepLog([]);
      },
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, type: CsvType) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        handleFile(file, type);
      }
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, type: CsvType) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file, type);
    },
    [handleFile]
  );

  const handleAutoDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file || !file.name.endsWith('.csv')) return;

      const detected = detectCsvType(file.name);
      if (detected) {
        handleFile(file, detected);
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

      // Upload lineups first (routes auto-detect rounds from data)
      const uploadOrder: CsvType[] = ['lineups', 'teams', 'points_grid'];
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

        // Build detailed log message
        let logMsg = `${type} uploaded successfully`;
        if (result.rounds) {
          const roundList = Object.entries(result.rounds).map(([r, c]) => `R${r}: ${c} rows`).join(', ');
          logMsg += ` (${roundList})`;
        } else if (result.target_round) {
          logMsg += ` (applied to R${result.target_round})`;
        } else {
          logMsg += ` (${result.count} records)`;
        }
        setStepLog((prev) => [...prev, logMsg]);
      }

      // Process draft if parsed
      if (uploads.draft.status === 'parsed' && uploads.draft.data) {
        setStepLog((prev) => [...prev, `Uploading draft... (${uploads.draft.rowCount} picks)`]);
        setUploads((prev) => ({
          ...prev,
          draft: { ...prev.draft, status: 'uploading' },
        }));

        const res = await fetch('/api/upload/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: uploads.draft.data }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(`draft: ${err.error || 'Upload failed'}`);
        }

        setUploads((prev) => ({
          ...prev,
          draft: { ...prev.draft, status: 'uploaded' },
        }));
        setStepLog((prev) => [...prev, `Draft uploaded successfully`]);
        filesProcessed++;
      }

      if (filesProcessed === 0) {
        setProcessResult('No files to process. Upload at least one CSV first.');
      } else {
        setProcessResult(`Done! ${filesProcessed} file${filesProcessed > 1 ? 's' : ''} processed.`);
      }

      // Refresh DB summary
      await loadDbSummary();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setStepLog((prev) => [...prev, `Error: ${errorMsg}`]);
      setProcessResult(`Error: ${errorMsg}`);
    } finally {
      setProcessing(false);
    }
  };

  const csvSlots: { type: CsvType; label: string; description: string }[] = [
    { type: 'lineups', label: 'Lineups CSV', description: 'Player lineups — auto-detects rounds from round_id column' },
    { type: 'teams', label: 'Teams CSV', description: 'Team standings — applied to latest round' },
    { type: 'points_grid', label: 'Points Grid CSV', description: 'Wide format scores (R0, R1, R2... columns)' },
  ];

  const hasAnyParsed = Object.values(uploads).some((u) => u.status === 'parsed');

  return (
    <div>
      {/* DB Status Summary */}
      <div className="bg-card border border-border rounded-lg p-5 mb-6 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Database size={18} className="text-primary" />
          <h3 className="font-semibold text-sm">Current Data in Database</h3>
        </div>
        {loadingDb ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : dbSummary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground block text-xs">Player Rounds</span>
              {Object.keys(dbSummary.playerRounds).length > 0 ? (
                <div className="font-medium">
                  {Object.entries(dbSummary.playerRounds)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([r, c]) => (
                      <span key={r} className="inline-block bg-muted px-2 py-0.5 rounded text-xs mr-1 mb-1">
                        R{r}: {c}
                      </span>
                    ))}
                </div>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">Team Snapshots</span>
              {Object.keys(dbSummary.teamSnapshots).length > 0 ? (
                <div className="font-medium">
                  {Object.entries(dbSummary.teamSnapshots)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([r, c]) => (
                      <span key={r} className="inline-block bg-muted px-2 py-0.5 rounded text-xs mr-1 mb-1">
                        R{r}: {c}
                      </span>
                    ))}
                </div>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">Draft Picks</span>
              <span className="font-medium">{dbSummary.draftPicks || 'None'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs">PWRNKGs</span>
              {dbSummary.pwrnkgsRounds.length > 0 ? (
                <div className="font-medium">
                  {dbSummary.pwrnkgsRounds.map((r) => (
                    <span
                      key={r.round_number}
                      className={cn(
                        'inline-block px-2 py-0.5 rounded text-xs mr-1 mb-1',
                        r.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      )}
                    >
                      R{r.round_number} ({r.status})
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Auto-detect drop zone */}
      <div
        onDrop={handleAutoDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-border rounded-xl p-8 mb-6 text-center hover:border-primary/50 transition-colors bg-card"
      >
        <Upload size={32} className="mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drop any CSV here — type will be auto-detected from filename
        </p>
      </div>

      {/* Individual CSV slots */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {csvSlots.map(({ type, label, description }) => {
          const upload = uploads[type];
          return (
            <CsvDropZone
              key={type}
              type={type}
              label={label}
              description={description}
              upload={upload}
              onDrop={handleDrop}
              onFileInput={handleFileInput}
            />
          );
        })}
      </div>

      {/* Draft CSV (separate, one-time) */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Draft Data (one-time upload)</h3>
        <CsvDropZone
          type="draft"
          label="Draft CSV"
          description="Draft picks — upload once for the season"
          upload={uploads.draft}
          onDrop={handleDrop}
          onFileInput={handleFileInput}
        />
      </div>

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

      {/* Step-by-step log */}
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

function CsvDropZone({
  type,
  label,
  description,
  upload,
  onDrop,
  onFileInput,
}: {
  type: CsvType;
  label: string;
  description: string;
  upload: UploadState;
  onDrop: (e: React.DragEvent, type: CsvType) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>, type: CsvType) => void;
}) {
  return (
    <div
      onDrop={(e) => onDrop(e, type)}
      onDragOver={(e) => e.preventDefault()}
      className={cn(
        'border rounded-lg p-4 transition-colors bg-card',
        upload.status === 'uploaded'
          ? 'border-green-300 bg-green-50'
          : upload.status === 'uploading'
            ? 'border-blue-300 bg-blue-50'
            : upload.status === 'parsed'
              ? 'border-primary/30 bg-red-50/30'
              : upload.status === 'error'
                ? 'border-red-300 bg-red-50'
                : 'border-border hover:border-gray-300'
      )}
    >
      <div className="flex items-start gap-3">
        {upload.status === 'uploaded' ? (
          <CheckCircle size={20} className="text-green-600 mt-0.5 shrink-0" />
        ) : upload.status === 'uploading' ? (
          <Loader2 size={20} className="text-blue-600 mt-0.5 shrink-0 animate-spin" />
        ) : upload.status === 'error' ? (
          <AlertCircle size={20} className="text-red-600 mt-0.5 shrink-0" />
        ) : upload.status === 'parsed' ? (
          <FileText size={20} className="text-primary mt-0.5 shrink-0" />
        ) : (
          <Upload size={20} className="text-muted-foreground mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {upload.filename ? (
            <p className="text-xs text-muted-foreground truncate">{upload.filename}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {upload.rowCount !== undefined && (
            <p className="text-xs text-primary font-medium mt-1">{upload.rowCount} rows parsed</p>
          )}
          {upload.status === 'uploading' && (
            <p className="text-xs text-blue-600 mt-1">Uploading...</p>
          )}
          {upload.error && <p className="text-xs text-red-600 mt-1">{upload.error}</p>}
          {upload.status === 'idle' && (
            <label className="text-xs text-primary cursor-pointer mt-1 inline-block hover:underline font-medium">
              Browse
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => onFileInput(e, type)}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
