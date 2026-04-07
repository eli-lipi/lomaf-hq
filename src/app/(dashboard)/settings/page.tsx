'use client';

import { useState } from 'react';
import { Upload, User } from 'lucide-react';
import { TEAMS, LEAGUE_NAME, LEAGUE_FULL_NAME, SEASON } from '@/lib/constants';
import { supabase } from '@/lib/supabase';

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-muted-foreground text-sm mb-6">Manage coach photos and league info</p>

      {/* League Info */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">League Info</h2>
        <div className="bg-card border border-border rounded-lg p-5">
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

      {/* Coach Photos */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Coach Photos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TEAMS.map((team) => (
            <CoachCard key={team.team_id} team={team} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CoachCard({ team }: { team: (typeof TEAMS)[number] }) {
  const [uploading, setUploading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const photoKeys = Array.isArray(team.coach_photo_key) ? team.coach_photo_key : [team.coach_photo_key];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${key}.${ext}`;

      const { error } = await supabase.storage.from('coach-photos').upload(path, file, { upsert: true });
      if (error) throw error;

      const { data } = supabase.storage.from('coach-photos').getPublicUrl(path);
      setPhotoUrl(data.publicUrl);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex -space-x-2">
          {photoKeys.map((key) => (
            <div
              key={key}
              className="w-12 h-12 rounded-full bg-muted flex items-center justify-center border-2 border-card overflow-hidden"
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={key} className="w-full h-full object-cover" />
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
      <div className="flex gap-2">
        {photoKeys.map((key) => (
          <label
            key={key}
            className="flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:underline"
          >
            <Upload size={12} />
            {photoKeys.length > 1 ? key : 'Upload Photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleUpload(e, key)}
              disabled={uploading}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
