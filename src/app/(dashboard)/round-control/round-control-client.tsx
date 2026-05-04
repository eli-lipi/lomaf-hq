'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Circle, RefreshCw, PlayCircle, Mail, ChevronRight, ArrowRight } from 'lucide-react';
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

const TOTAL_ROUNDS = 23;

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diffSec = Math.floor((Date.now() - t) / 1000);
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
  if (status === 'ok') return <CheckCircle2 size={20} className="text-green-600 shrink-0" />;
  if (status === 'partial') return <AlertCircle size={20} className="text-amber-500 shrink-0" />;
  return <Circle size={20} className="text-red-400 shrink-0" />;
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
  // v12.2.1 — single source of truth for "round we're preparing".
  // Default = the next round, but admin can change to re-advance the
  // current round or correct a mistake.
  const [targetRound, setTargetRound] = useState<number>(initialNextRound);

  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [sendEmail, setSendEmail] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [advanceMsg, setAdvanceMsg] = useState<string | null>(null);
  const [advanceErr, setAdvanceErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isReAdvance = targetRound <= currentRound && currentRound > 0;

  const refreshVerify = useCallback(async () => {
    setVerifyLoading(true);
    try {
      const res = await fetch(`/api/round/verify?round=${targetRound}`);
      if (res.ok) setVerify(await res.json());
    } finally {
      setVerifyLoading(false);
    }
  }, [targetRound]);

  const refreshHistory = useCallback(async () => {
    const res = await fetch('/api/round/history');
    if (res.ok) {
      const json = await res.json();
      setHistory(json.history ?? []);
    }
  }, []);

  useEffect(() => {
    refreshVerify();
  }, [refreshVerify]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  // Light auto-poll while a verify is showing partials/misses.
  useEffect(() => {
    if (!verify || verify.ready) return;
    const t = setInterval(refreshVerify, 8_000);
    return () => clearInterval(t);
  }, [verify, refreshVerify]);

  const handleAdvance = async () => {
    setAdvancing(true);
    setAdvanceMsg(
      isReAdvance
        ? `Re-running Round ${targetRound} — recomputing trades and AI narratives. This can take a few minutes.`
        : `Recomputing trades and AI narratives for Round ${targetRound}. This can take a few minutes.`
    );
    setAdvanceErr(null);
    try {
      const res = await fetch('/api/round/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round: targetRound, sendEmail }),
      });
      const json = (await res.json()) as AdvanceResult & { error?: string };
      if (!res.ok) {
        setAdvanceErr(json.error || 'Advance failed.');
        return;
      }
      const note: string[] = [
        isReAdvance
          ? `Round ${targetRound} re-run complete.`
          : `Round ${targetRound} is now live.`,
      ];
      if (json.recalcError) note.push(`Trade recalc had an issue: ${json.recalcError}`);
      if (sendEmail) {
        if (json.emailsSent) note.push('Coaches were emailed.');
        else if (json.emailError) note.push(`Email failed: ${json.emailError}`);
      }
      setAdvanceMsg(note.join(' '));
      setCurrentRound(targetRound);
      setAdvancedAt(new Date().toISOString());
      setTargetRound(Math.min(TOTAL_ROUNDS, targetRound + 1));
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
      {/* ── Hero / current state ─────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Round Control</h1>
        <p className="text-muted-foreground text-sm">
          The single place to push the league forward, round by round.
        </p>
      </div>

      <section className="bg-card border border-border rounded-lg p-6 shadow-sm mb-6 flex items-center gap-6 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Currently live</p>
          <h2 className="text-3xl font-bold tabular-nums">
            {currentRound > 0 ? `Round ${currentRound}` : 'Pre-season'}
          </h2>
          {advancedAt && (
            <p className="text-sm text-muted-foreground mt-1">
              Live since {relativeTime(advancedAt)}
            </p>
          )}
        </div>
        <ArrowRight size={28} className="text-muted-foreground" />
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Preparing next</p>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-bold tabular-nums">Round</h2>
            <select
              value={targetRound}
              onChange={(e) => setTargetRound(Number(e.target.value))}
              className="text-3xl font-bold bg-transparent border-b-2 border-primary text-primary tabular-nums focus:outline-none px-1"
            >
              {Array.from({ length: TOTAL_ROUNDS }, (_, i) => i + 1).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {isReAdvance && (
            <p className="text-xs text-amber-600 mt-1">
              Round {targetRound} is already live — running this re-recomputes trades + (if checked) re-emails coaches.
            </p>
          )}
        </div>
      </section>

      {/* ── Step 1 — upload ─────────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-sm mb-6">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Step 1</span>
          <h2 className="text-lg font-semibold">Upload Round {targetRound}&apos;s data</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Drop in the four CSVs for Round {targetRound} (lineups, teams, matchups, points-grid).
          Status updates automatically as each piece lands.
        </p>

        <UploadContent
          controlledTargetRound={targetRound}
          hideRoundDbSummary
          onUploadComplete={refreshVerify}
        />
      </section>

      {/* ── Step 2 — verify ─────────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-6 shadow-sm mb-6">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Step 2</span>
          <h2 className="text-lg font-semibold">Verify Round {targetRound} is complete</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Each piece needs to be in before we can advance. Auto-refreshes every few seconds.
        </p>

        <div className="flex items-center justify-end mb-3">
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
            <div
              key={c.key}
              className={cn(
                'flex items-start gap-3 px-3 py-3 rounded-md border',
                c.status === 'ok' ? 'border-green-200 bg-green-50' :
                c.status === 'partial' ? 'border-amber-200 bg-amber-50' :
                'border-red-200 bg-red-50'
              )}
            >
              <StatusIcon status={c.status} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
            </div>
          ))}
          {!verify && <p className="text-sm text-muted-foreground">Loading checks…</p>}
        </div>
      </section>

      {/* ── Step 3 — advance ─────────────────────────────────── */}
      <section
        className={cn(
          'border-2 rounded-lg p-6 shadow-sm mb-6',
          ready ? 'border-primary bg-primary/5' : 'bg-card border-border'
        )}
      >
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Step 3</span>
          <h2 className="text-lg font-semibold">
            {isReAdvance ? `Re-run Round ${targetRound}` : `Advance to Round ${targetRound}`}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          {isReAdvance
            ? `Re-runs the round ceremony for Round ${targetRound} — recomputes every trade, refreshes AI narratives, and (optionally) re-emails coaches.`
            : `Closes Round ${currentRound > 0 ? currentRound : 'pre-season'} and opens Round ${targetRound} across the platform: analytics retarget, trade probabilities + narratives recompute, the new PWRNKGs draft becomes the working round, and the round badge flips for everyone.`}
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
              'inline-flex items-center gap-2 px-6 py-3 rounded-md font-semibold text-base',
              ready && !advancing
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
            title={!ready ? blockingChecks.map((c) => `${c.label}: ${c.detail}`).join('\n') : undefined}
          >
            <PlayCircle size={18} />
            {advancing
              ? 'Working…'
              : isReAdvance
                ? `Re-run Round ${targetRound}`
                : `Advance to Round ${targetRound}`}
          </button>
          {!ready && verify && (
            <p className="text-xs text-muted-foreground">
              Disabled — {blockingChecks.length} check{blockingChecks.length === 1 ? '' : 's'} not ok yet.
            </p>
          )}
        </div>

        {advancing && advanceMsg && (
          <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {advanceMsg}
          </p>
        )}
        {!advancing && advanceMsg && (
          <p className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
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
            <h3 className="text-lg font-semibold mb-2">
              {isReAdvance ? `Re-run Round ${targetRound}?` : `Advance to Round ${targetRound}?`}
            </h3>
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
                Yes, run it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
