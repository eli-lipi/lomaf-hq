'use client';

interface Props {
  contextNotes: string | null;
  aiNarrative: string | null;
  updatedRound: number | null;
}

export default function TradeContextBox({ contextNotes, aiNarrative, updatedRound }: Props) {
  if (!contextNotes && !aiNarrative) return null;

  return (
    <div className="bg-white border border-border rounded-lg p-5 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trade Context</h3>

      {contextNotes && (
        <div className="flex items-start gap-3">
          <span className="text-xl leading-none">💬</span>
          <div className="flex-1">
            <p className="text-sm italic text-foreground">&quot;{contextNotes}&quot;</p>
            <p className="text-xs text-muted-foreground mt-1">— Admin note</p>
          </div>
        </div>
      )}

      {aiNarrative && (
        <div className="flex items-start gap-3">
          <span className="text-xl leading-none">🧠</span>
          <div className="flex-1">
            <p className="text-sm text-foreground whitespace-pre-wrap">{aiNarrative}</p>
          </div>
        </div>
      )}

      {updatedRound !== null && (
        <p className="text-[11px] text-muted-foreground text-right">Updated R{updatedRound}</p>
      )}
    </div>
  );
}
