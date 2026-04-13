'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Upload, User, Trash2 } from 'lucide-react';
import { TEAMS, LEAGUE_FULL_NAME, SEASON } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import ScoreAdjustmentsTab from './score-adjustments-tab';
import UsersTab from './users-tab';
import DataUploadTab from './data-upload-tab';

const TABS = [
  { id: 'upload', label: 'Data Upload' },
  { id: 'photos', label: 'Coach Photos' },
  { id: 'adjustments', label: 'Score Adjustments' },
  { id: 'users', label: 'Users' },
  { id: 'info', label: 'League Info' },
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
      <p className="text-muted-foreground text-sm mb-6">Manage coach photos, score adjustments, and league info</p>

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

      {activeTab === 'upload' && <DataUploadTab />}

      {activeTab === 'photos' && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Coach Photos</h2>
          <p className="text-sm text-muted-foreground mb-4">Upload photos for each coach. These appear on carousel slides.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEAMS.map((team) => (
              <CoachCard key={team.team_id} team={team} />
            ))}
          </div>
        </section>
      )}

      {activeTab === 'adjustments' && <ScoreAdjustmentsTab />}

      {activeTab === 'users' && <UsersTab />}

      {activeTab === 'info' && (
        <section>
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
      )}
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
