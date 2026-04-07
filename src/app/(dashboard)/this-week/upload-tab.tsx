'use client';

import { useState, useCallback } from 'react';
import { Upload, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import Papa from 'papaparse';
import { cn } from '@/lib/utils';

type CsvType = 'lineups' | 'teams' | 'points_grid' | 'draft';

interface UploadState {
  status: 'idle' | 'parsed' | 'uploading' | 'uploaded' | 'error';
  filename?: string;
  rowCount?: number;
  error?: string;
  data?: Record<string, unknown>[];
}

function detectCsvType(filename: string): CsvType | null {
  const lower = filename.toLowerCase();
  if (lower.includes('lineup')) return 'lineups';
  if (lower.includes('team')) return 'teams';
  if (lower.includes('points') || lower.includes('grid')) return 'points_grid';
  if (lower.includes('draft')) return 'draft';
  return null;
}

function detectRoundNumber(data: Record<string, unknown>[]): number | null {
  // Look for round_id column (format: 202601 = 2026, Round 1)
  for (const row of data) {
    const roundId = row['round_id'] || row['Round ID'] || row['roundId'];
    if (roundId) {
      const str = String(roundId);
      if (str.length === 6) {
        return parseInt(str.slice(4), 10);
      }
    }
  }
  return null;
}

export default function UploadTab() {
  const [roundNumber, setRoundNumber] = useState<number | null>(null);
  const [uploads, setUploads] = useState<Record<CsvType, UploadState>>({
    lineups: { status: 'idle' },
    teams: { status: 'idle' },
    points_grid: { status: 'idle' },
    draft: { status: 'idle' },
  });
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<string | null>(null);

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

        // Auto-detect round from lineups CSV
        if (type === 'lineups') {
          const detected = detectRoundNumber(data);
          if (detected) setRoundNumber(detected);
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
    if (!roundNumber) return;
    setProcessing(true);
    setProcessResult(null);

    try {
      const uploadTypes: CsvType[] = ['lineups', 'teams', 'points_grid'];
      for (const type of uploadTypes) {
        const upload = uploads[type];
        if (upload.status !== 'parsed' || !upload.data) continue;

        setUploads((prev) => ({
          ...prev,
          [type]: { ...prev[type], status: 'uploading' },
        }));

        const res = await fetch(`/api/upload/${type.replace('_', '-')}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ round_number: roundNumber, data: upload.data }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(`${type}: ${err.error || 'Upload failed'}`);
        }

        setUploads((prev) => ({
          ...prev,
          [type]: { ...prev[type], status: 'uploaded' },
        }));
      }

      // Process draft if parsed
      if (uploads.draft.status === 'parsed' && uploads.draft.data) {
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
      }

      const totalRows = uploadTypes.reduce(
        (sum, type) => sum + (uploads[type].rowCount || 0),
        0
      );
      setProcessResult(
        `Round ${roundNumber} processed. ${totalRows} records across ${uploadTypes.filter((t) => uploads[t].status === 'uploaded').length} files.`
      );
    } catch (err) {
      setProcessResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setProcessing(false);
    }
  };

  const csvSlots: { type: CsvType; label: string; description: string }[] = [
    { type: 'lineups', label: 'Lineups CSV', description: 'Player lineups with positions and scoring status' },
    { type: 'teams', label: 'Teams CSV', description: 'Team standings, wins, losses, points' },
    { type: 'points_grid', label: 'Points Grid CSV', description: 'Scoring grid with player points' },
  ];

  const allUploaded = csvSlots.every(
    (s) => uploads[s.type].status === 'parsed' || uploads[s.type].status === 'uploaded'
  );

  return (
    <div>
      {/* Round indicator */}
      <div className="flex items-center gap-4 mb-6">
        <label className="text-sm text-muted-foreground">Round:</label>
        {roundNumber ? (
          <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded text-sm">R{roundNumber}</span>
        ) : (
          <span className="text-muted-foreground text-sm">Auto-detected from lineups CSV</span>
        )}
      </div>

      {/* Auto-detect drop zone */}
      <div
        onDrop={handleAutoDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-border rounded-xl p-8 mb-6 text-center hover:border-primary/50 transition-colors"
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
      {allUploaded && roundNumber && (
        <button
          onClick={processRound}
          disabled={processing}
          className={cn(
            'w-full py-3 rounded-lg font-medium text-sm transition-colors',
            processing
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
        >
          {processing ? 'Processing...' : `Process Round ${roundNumber}`}
        </button>
      )}

      {/* Result */}
      {processResult && (
        <div
          className={cn(
            'mt-4 p-4 rounded-lg text-sm',
            processResult.startsWith('Error') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'
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
        'border rounded-lg p-4 transition-colors',
        upload.status === 'uploaded'
          ? 'border-green-500/30 bg-green-500/5'
          : upload.status === 'parsed'
            ? 'border-primary/30 bg-primary/5'
            : upload.status === 'error'
              ? 'border-red-500/30 bg-red-500/5'
              : 'border-border hover:border-muted-foreground/30'
      )}
    >
      <div className="flex items-start gap-3">
        {upload.status === 'uploaded' ? (
          <CheckCircle size={20} className="text-green-400 mt-0.5 shrink-0" />
        ) : upload.status === 'error' ? (
          <AlertCircle size={20} className="text-red-400 mt-0.5 shrink-0" />
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
            <p className="text-xs text-primary mt-1">{upload.rowCount} rows</p>
          )}
          {upload.error && <p className="text-xs text-red-400 mt-1">{upload.error}</p>}
          {upload.status === 'idle' && (
            <label className="text-xs text-primary cursor-pointer mt-1 inline-block hover:underline">
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
