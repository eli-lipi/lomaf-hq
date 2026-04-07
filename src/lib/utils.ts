import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatScore(score: number): string {
  return score.toLocaleString();
}

export function movementLabel(current: number, previous: number | null): string {
  if (previous === null) return 'NEW';
  const diff = previous - current;
  if (diff > 0) return `↑${diff}`;
  if (diff < 0) return `↓${Math.abs(diff)}`;
  return '—';
}

export function movementColor(current: number, previous: number | null): string {
  if (previous === null) return 'text-blue-400';
  const diff = previous - current;
  if (diff > 0) return 'text-green-400';
  if (diff < 0) return 'text-red-400';
  return 'text-gray-500';
}

export function parseRoundFromId(roundId: string): number {
  // roundId format: "202601" → 2026 season, Round 1 → return 1
  const str = String(roundId);
  if (str.length === 6) {
    return parseInt(str.slice(4), 10);
  }
  return parseInt(str, 10);
}
