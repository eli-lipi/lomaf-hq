'use client';

import { useEffect } from 'react';

const HEARTBEAT_MS = 60_000; // 1 minute

// Mounted in the dashboard layout for any signed-in user. Pings /api/heartbeat
// every minute while the tab is visible so we can show "minutes active" in the
// admin usage table. Silent on failure — heartbeat misses are not user-facing.
export default function ActivityHeartbeat() {
  useEffect(() => {
    const ping = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
    };

    ping();
    const timer = setInterval(ping, HEARTBEAT_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
