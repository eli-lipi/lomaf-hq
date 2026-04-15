'use client';

interface Props {
  aiNarrative: string | null;
  updatedRound: number | null;
}

export default function TradeContextBox({ aiNarrative, updatedRound }: Props) {
  if (!aiNarrative) return null;

  return (
    <div className="bg-white border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg leading-none">🧠</span>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Trade Context
        </h3>
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{aiNarrative}</p>
      {updatedRound !== null && (
        <p className="text-[11px] text-muted-foreground text-right mt-3">Updated R{updatedRound}</p>
      )}
    </div>
  );
}
