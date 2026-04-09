'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Upload, User, Trash2 } from 'lucide-react';
import { TEAMS, LEAGUE_FULL_NAME, SEASON } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import ScoreAdjustmentsTab from './score-adjustments-tab';
import UploadContent from '../upload/upload-content';

const TABS = [
  { id: 'upload', label: 'Data Upload' },
  { id: 'general', label: 'General' },
  { id: 'adjustments', label: 'Score Adjustments' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading...</div>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TabId>(
    (TABS.find((t) => t.id === tabParam)?.id) ?? 'upload'
  );

  useEffect(() => {
    if (tabParam && TABS.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
    }
  }, [tabParam]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-muted-foreground text-sm mb-6">Manage data uploads, league settings, and score adjustments</p>

      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              window.history.replaceState(null, '', `/settings?tab=${tab.id}`);
            }}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'upload' && (
        <div className="space-y-8">
          <UploadContent />
          <UploadHistory />
        </div>
      )}

      {activeTab === 'general' && (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">League Info</h2>
            <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">League</span>
                  <p className="font-medium">{LEAGUE_FULL_NAME}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Season</span>
                  <p className="font-medium">{SEASON}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Teams</span>
                  <p className="font-medium">{TEAMS.length}</p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">Coach Photos</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {TEAMS.map((team) => (
                <CoachCard key={team.team_id} team={team} />
              ))}
            </div>
          </section>
        </>
      )}

      {activeTab === 'adjustments' && <ScoreAdjustmentsTab />}
    </div>
  );
}

// ── Upload History ──────────────────────────────────────────────────

interface CsvUploadRecord {
  id: string;
  round_number: number;
  upload_type: string;
  uploaded_at: string;
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

  // Group by round_number, sorted descending
  const byRound = new Map<number, CsvUploadRecord[]>();
  for (const r of records) {
    if (!byRound.has(r.round_number)) byRound.set(r.round_number, []);
    byRound.get(r.round_number)!.push(r);
  }
  const sortedRounds = [...byRound.keys()].sort((a, b) => b - a);

  const CSV_TYPES = ['lineups', 'teams', 'matchups', 'points_grid', 'draft'] as const;
  const TYPE_LABELS: Record<string, string> = {
    lineups: 'Lineups',
    teams: 'Teams',
    matchups: 'Matchups',
    points_grid: 'Points Grid',
    draft: 'Draft',
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
          // Deduplicate: keep only the latest upload per type
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
                    // Only show missing types for non-draft rounds
                    if (round === 0 && type !== 'draft') return null;
                    if (round !== 0 && type === 'draft') return null;
                    return (
                      <span
                        key={type}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-muted/50 text-muted-foreground border border-border"
                      >
                        {TYPE_LABELS[type]}
                      </span>
                    );
                  }
                  return (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-green-50 text-green-700 border border-green-200"
                      title={`Uploaded ${formatDate(rec.uploaded_at)}`}
                    >
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

// ── Coach Card ──────────────────────────────────────────────────────

function CoachCard({ team }: { team: (typeof TEAMS)[number] }) {
  const [uploading, setUploading] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string | null>>({});
  const [fileNames, setFileNames] = useState<Record<string, string | null>>({});

  const photoKeys = Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key];

  useEffect(() => {
    async function loadPhotos() {
      const { data: files } = await supabase.storage.from('coach-photos').list('', { limit: 100 });
      if (!files) return;

      const urls: Record<string, string | null> = {};
      const names: Record<string, string | null> = {};

      for (const key of photoKeys) {
        const match = files.find((f) => f.name.startsWith(key + '.'));
        if (match) {
          const { data } = supabase.storage.from('coach-photos').getPublicUrl(match.name);
          urls[key] = data.publicUrl + '?t=' + Date.now();
          names[key] = match.name;
        } else {
          urls[key] = null;
          names[key] = null;
        }
      }

      setPhotoUrls(urls);
      setFileNames(names);
    }
    loadPhotos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      if (fileNames[key]) {
        await supabase.storage.from('coach-photos').remove([fileNames[key]!]);
      }

      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${key}.${ext}`;

      const { error } = await supabase.storage.from('coach-photos').upload(path, file, { upsert: true });
      if (error) throw error;

      const { data } = supabase.storage.from('coach-photos').getPublicUrl(path);
      setPhotoUrls((prev) => ({ ...prev, [key]: data.publicUrl + '?t=' + Date.now() }));
      setFileNames((prev) => ({ ...prev, [key]: path }));
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      if (fileNames[key]) {
        await supabase.storage.from('coach-photos').remove([fileNames[key]!]);
      }
      setPhotoUrls((prev) => ({ ...prev, [key]: null }));
      setFileNames((prev) => ({ ...prev, [key]: null }));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex -space-x-2">
          {photoKeys.map((key) => (
            <div
              key={key}
              className="w-12 h-12 rounded-full bg-muted flex items-center justify-center border-2 border-card overflow-hidden"
            >
              {photoUrls[key] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrls[key]!} alt={key} className="w-full h-full object-cover" />
              ) : (
                <User size={20} className="text-muted-foreground" />
              )}
            </div>
          ))}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{team.team_name}</p>
          <p className="text-xs text-muted-foreground truncate">{team.coach}</p>
        </div>
      </div>
      <div className="flex gap-3">
        {photoKeys.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:underline font-medium">
              <Upload size={12} />
              {photoKeys.length > 1 ? `Upload ${key}` : 'Upload'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUpload(e, key)}
                disabled={uploading}
              />
            </label>
            {photoUrls[key] && (
              <button
                onClick={() => handleDelete(key)}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:underline"
              >
                <Trash2 size={12} />
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
