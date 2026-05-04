'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Circle, RefreshCw, PlayCircle, Mail, ChevronRight } from 'lucide-react';
import UploadContent from '../upload/upload-content';
import { cn } from '@/lib/utils';

interface RoundCheck {
  key: string;
  label: string;
  status: 'ok' | 'partial' | 'missing';
  detail: string;
}

interface VerifyResponse {
  round: number;
  ready: boolean;
  checks: RoundCheck[];
}

interface HistoryRow {
  round_number: number;
  advanced_at: string;
  advanced_by_name: string;
  emails_sent: boolean;
  email_sent_at: string | null;
}

interface AdvanceResult {
  ok: boolean;
  round: number;
  emailsSent: boolean;
  emailError: string | null;
  recalcError: string | null;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffSec = Math.floor((now - t) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusIcon({ status }: { status: RoundCheck['status'] }) {
  if (status === 'ok') return <CheckCircle2 size={18} className="text-green-600 shrink-0" />;
  if (status === 'partial') return <AlertCircle size={18} className="text-amber-500 shrink-0" />;
  return <Circle size={18} className="text-red-400 shrink-0" />;
}

export default function RoundControlClient({
  initialCurrentRound,
  initialAdvancedAt,
  initialNextRound,
}: {
  initialCurrentRound: number;
  initialAdvancedAt: string | null;
  initialEmailsSent: boolean;
  initialNextRound: number;
}) {
  const [currentRound, setCurrentRound] = useState(initialCurrentRound);
  const [advancedAt, setAdvancedAt] = useState<string | null>(initialAdvancedAt);
  const [nextRound, setNextRound] = useState(initialNextRound);

  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [sendEmail, setSendEmail] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [advanceMsg, setAdvanceMsg] = useState<string | null>(null);
  const [advanceErr, setAdvanceErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const refreshVerify = useCallback(async () => {
    setVerifyLoading(true);
    try {
      const res = await fetch(`/api/round/verify?round=${nextRound}`);
      if (res.ok) setVerify(await res.json());
    } finally {
      setVerifyLoading(false);
    }
  }, [nextRound]);

  const refreshHistory = useCallback(async () => {
    const res = await fetch('/api/round/history');
    if (res.ok) {
      const json = await res.json();
      setHistory(json.history ?? []);
    }
  }, []);

  useEffect(() => {
    refreshVerify();
    refreshHistory();
  }, [refreshVerify, refreshHistory]);

  // Light auto-poll while a verify is showing partials/misses, so newly
  // landed CSVs flip checks green without the admin clicking Refresh.
  useEffect(() => {
    if (!verify || verify.ready) return;
    const t = setInterval(refreshVerify, 8_000);
    return () => clearInterval(t);
  }, [verify, refreshVerify]);

  const handleAdvance = async () => {
    setAdvancing(true);
    setAdvanceMsg('Recomputing trades and AI narratives… this can take a few minutes.');
    setAdvanceErr(null);
    try {
      const res = await fetch('/api/round/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round: nextRound, sendEmail }),
      });
      const json = (await res.json()) as AdvanceResult & { error?: string };
      if (!res.ok) {
        setAdvanceErr(json.error || 'Advance failed.');
        return;
      }
      // Success — pull updated state and clear progress.
      const note: string[] = [`Round ${nextRound} is now live.`];
      if (json.recalcError) note.push(`Trade recalc had an issue: ${json.recalcError}`);
      if (sendEmail) {
        if (json.emailsSent) note.push('Coaches were emailed.');
        else if (json.emailError) note.push(`Email failed: ${json.emailError}`);
      }
      setAdvanceMsg(note.join(' '));
      setCurrentRound(nextRound);
      setAdvancedAt(new Date().toISOString());
      setNextRound(nextRound + 1);
      await Promise.all([refreshVerify(), refreshHistory()]);
    } catch (e) {
      setAdvanceErr(e instanceof Error ? e.message : 'Advance failed.');
    } finally {
      setAdvancing(false);
      setConfirming(false);
    }
  };

  const handleResendEmail = async (round: number) => {
    const ok = window.confirm(`Resend the "Round ${round} is live" email to all coaches?`);
    if (!ok) return;
    const res = await fetch(`/api/round/${round}/resend-email`, { method: 'POST' });
    if (res.ok) await refreshHistory();
    else {
      const json = await res.json().catch(() => ({}));
      window.alert(`Resend failed: ${json.error || 'unknown error'}`);
    }
  };

  const ready = !!verify?.ready;
  const blockingChecks = verify?.checks.filter((c) => c.status !== 'ok') ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Round Control</h1>
      <p className="text-muted-foreground text-sm mb-6">
        The platform&apos;s round-rhythm. Upload data, verify, and push the league forward.
      </p>

      {/* ── Header — current round ─────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-sm mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Current round</p>
        <div className="flex items-baseline gap-4 flex-wrap">
          <h2 className="text-4xl font-bold tabular-nums">
            {currentRound > 0 ? `Round ${currentRound}` : 'Pre-season'}
          </h2>
          {advancedAt && (
            <span className="text-sm text-muted-foreground">
              Live since {relativeTime(advancedAt)}
            </span>
          )}
        </div>
      </section>

      {/* ── Prepare next round ─────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-sm mb-6">
        <h2 className="text-lg font-semibold mb-1">Prepare Round {nextRound}</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Upload all CSVs for Round {nextRound}. The checks beneath the uploaders will turn green when each piece is in.
        </p>

        <UploadContent />

        {/* Verification checklist */}
        <div className="mt-8 border-t border-border pt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Verification — Round {nextRound}</h3>
            <button
              onClick={refreshVerify}
              disabled={verifyLoading}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={13} className={verifyLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <div className="space-y-2">
            {(verify?.checks ?? []).map((c) => (
              <div key={c.key} className="flex items-start gap-3 px-3 py-2 rounded-md border border-border">
                <StatusIcon status={c.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </div>
            ))}
            {!verify && (
              <p className="text-sm text-muted-foreground">Loading checks…</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Advance ─────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-sm mb-6">
        <h2 className="text-lg font-semibold mb-3">Advance to Round {nextRound}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Closes Round {currentRound > 0 ? currentRound : 'pre-season'} and opens Round {nextRound} across the platform: analytics retarget, trade probabilities + narratives recompute, the new PWRNKGs draft becomes the working round, and the round badge flips for everyone.
        </p>

        <label className="inline-flex items-center gap-2 text-sm mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="w-4 h-4"
          />
          <Mail size={14} className="text-muted-foreground" />
          Send announcement email to all coaches
        </label>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setConfirming(true)}
            disabled={!ready || advancing}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-md font-semibold text-sm',
              ready && !advancing
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
            title={!ready ? blockingChecks.map((c) => `${c.label}: ${c.detail}`).join('\n') : undefined}
          >
            <PlayCircle size={16} />
            {advancing ? 'Advancing…' : `Advance to Round ${nextRound}`}
          </button>
          {!ready && verify && (
            <p className="text-xs text-muted-foreground">
              Disabled — {blockingChecks.length} check{blockingChecks.length === 1 ? '' : 's'} not ok yet.
            </p>
          )}
        </div>

        {advanceMsg && !advancing && (
          <p className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            {advanceMsg}
          </p>
        )}
        {advancing && (
          <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {advanceMsg}
          </p>
        )}
        {advanceErr && (
          <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {advanceErr}
          </p>
        )}
      </section>

      {/* ── History ─────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rounds advanced yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-2">Round</th>
                <th className="text-left py-2">Advanced at</th>
                <th className="text-left py-2">By</th>
                <th className="text-left py-2">Emails</th>
                <th className="text-right py-2">Resend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((h) => (
                <tr key={h.round_number}>
                  <td className="py-2.5 font-semibold tabular-nums">R{h.round_number}</td>
                  <td className="py-2.5 text-muted-foreground tabular-nums">{relativeTime(h.advanced_at)}</td>
                  <td className="py-2.5 text-muted-foreground">{h.advanced_by_name}</td>
                  <td className="py-2.5">
                    {h.emails_sent ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                        <CheckCircle2 size={11} /> Sent
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => handleResendEmail(h.round_number)}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Mail size={11} /> Resend
                      <ChevronRight size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Confirmation modal ──────────────────────────────── */}
      {confirming && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-card rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-2">Advance to Round {nextRound}?</h3>
            <p className="text-sm text-muted-foreground mb-5">
              This will recompute every trade and may take a few minutes.
              {sendEmail && ' All coaches will receive an email.'} You can&apos;t roll this back from the UI.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="px-4 py-2 text-sm font-medium border border-border rounded-md hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleAdvance}
                className="px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                Yes, advance
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
