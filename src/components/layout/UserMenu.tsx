'use client';

import { LogOut } from 'lucide-react';
import type { AppUser } from '@/lib/auth';

export default function UserMenu({ user }: { user: AppUser }) {
  const initial = (user.display_name || user.email).slice(0, 1).toUpperCase();

  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
      {user.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatar_url}
          alt={user.display_name}
          className="w-8 h-8 rounded-full object-cover shrink-0"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-white/10 text-white text-xs font-semibold flex items-center justify-center shrink-0">
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-white text-xs font-medium truncate">{user.display_name}</p>
          {user.role === 'admin' && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 font-bold">
              Admin
            </span>
          )}
        </div>
        <button
          onClick={signOut}
          className="text-[11px] text-sidebar-foreground hover:text-white transition-colors flex items-center gap-1"
        >
          <LogOut size={10} /> Sign out
        </button>
      </div>
    </div>
  );
}
