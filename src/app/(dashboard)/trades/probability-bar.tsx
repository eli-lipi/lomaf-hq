'use client';

import { getTeamColor } from '@/lib/team-colors';

interface Props {
  teamAId: number;
  teamAName: string;
  teamBId: number;
  teamBName: string;
  probA: number;
  probB: number;
  large?: boolean;
}

/**
 * Hero probability bar — the visual centerpiece of the detail view.
 * Names and % live INSIDE the bar when the segment is >= 25% wide;
 * otherwise they flip outside so they stay legible.
 */
export default function ProbabilityBar({
  teamAId,
  teamAName,
  teamBId,
  teamBName,
  probA,
  probB,
  large = false,
}: Props) {
  const colorA = getTeamColor(teamAId);
  const colorB = getTeamColor(teamBId);

  const height = large ? 44 : 28; // px
  const pctSize = large ? 'text-xl' : 'text-sm';
  const nameSize = large ? 'text-[13px]' : 'text-[11px]';

  const showALabelInside = probA >= 25;
  const showBLabelInside = probB >= 25;

  return (
    <div className="w-full">
      {/* External labels shown only when corresponding side is too narrow to fit inside */}
      {(!showALabelInside || !showBLabelInside) && (
        <div className="flex items-center justify-between mb-1.5 text-sm font-semibold">
          {!showALabelInside ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorA }} />
              <span>{teamAName}</span>
              <span style={{ color: colorA }}>{Math.round(probA)}%</span>
            </span>
          ) : (
            <span />
          )}
          {!showBLabelInside ? (
            <span className="flex items-center gap-1.5">
              <span style={{ color: colorB }}>{Math.round(probB)}%</span>
              <span>{teamBName}</span>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorB }} />
            </span>
          ) : (
            <span />
          )}
        </div>
      )}

      <div
        className="relative w-full rounded-lg overflow-hidden flex shadow-sm"
        style={{ height: `${height}px` }}
      >
        <div
          className="h-full flex items-center pl-3 pr-2 transition-all duration-300"
          style={{ width: `${probA}%`, backgroundColor: colorA }}
        >
          {showALabelInside && (
            <div className="flex items-baseline gap-2 text-white truncate">
              <span className={`${pctSize} font-bold tabular-nums`}>{Math.round(probA)}%</span>
              <span className={`${nameSize} font-medium truncate opacity-95`}>{teamAName}</span>
            </div>
          )}
        </div>
        <div
          className="h-full flex items-center justify-end pr-3 pl-2 transition-all duration-300"
          style={{ width: `${probB}%`, backgroundColor: colorB }}
        >
          {showBLabelInside && (
            <div className="flex items-baseline gap-2 text-white truncate">
              <span className={`${nameSize} font-medium truncate opacity-95`}>{teamBName}</span>
              <span className={`${pctSize} font-bold tabular-nums`}>{Math.round(probB)}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
