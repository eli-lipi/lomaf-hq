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

  return (
    <div className={large ? 'space-y-2' : 'space-y-1.5'}>
      <div className={`flex items-center justify-between ${large ? 'text-base' : 'text-sm'} font-semibold`}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorA }} />
          <span className="truncate">{teamAName}</span>
          <span style={{ color: colorA }}>{probA.toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: colorB }}>{probB.toFixed(0)}%</span>
          <span className="truncate">{teamBName}</span>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorB }} />
        </div>
      </div>
      <div className={`w-full ${large ? 'h-4' : 'h-2.5'} rounded-full overflow-hidden flex bg-muted`}>
        <div style={{ width: `${probA}%`, backgroundColor: colorA }} className="h-full transition-all" />
        <div style={{ width: `${probB}%`, backgroundColor: colorB }} className="h-full transition-all" />
      </div>
    </div>
  );
}
