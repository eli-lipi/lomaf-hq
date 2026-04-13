'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function LoginContent() {
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const signIn = async () => {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  };

  const signOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0E1629] px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0E1629] mb-1">LOMAF HQ</h1>
          <p className="text-sm text-gray-500">Power Rankings for the Land of Milk and Fantasy</p>
        </div>

        {error === 'not_member' ? (
          <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <p className="font-semibold mb-1">You&apos;re not a member of LOMAF.</p>
            <p>Contact Lipi for access.</p>
            <button
              onClick={signOut}
              className="mt-3 text-xs text-amber-900 underline hover:no-underline"
            >
              Sign out and try a different account
            </button>
          </div>
        ) : null}

        {error === 'auth_failed' ? (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            Sign-in failed. Please try again.
          </div>
        ) : null}

        <button
          onClick={signIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors font-medium text-sm text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          {loading ? 'Redirecting…' : 'Sign in with Google'}
        </button>

        <p className="mt-6 text-center text-xs text-gray-400">
          Only authorized LOMAF members can access the portal.
        </p>
      </div>
    </div>
  );
}
