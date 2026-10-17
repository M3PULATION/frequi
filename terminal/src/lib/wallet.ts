import { unixSeconds } from '@/lib/candles';
import type { WalletHistory } from '@/types';

export function balancePoints(history: WalletHistory): Array<{ time: number; value: number }> {
  const dateIndex = history.columns.indexOf('__date_ts');
  const valueIndex = history.columns.findIndex((name) => name === 'total_quote' || name === 'balance');
  if (dateIndex < 0 || valueIndex < 0) return [];
  return history.data
    .map((row) => {
      const raw = row[dateIndex];
      const value = row[valueIndex];
      if (typeof raw !== 'number' || typeof value !== 'number') return null;
      return { time: unixSeconds(raw), value };
    })
    .filter((point): point is { time: number; value: number } => point != null)
    .sort((a, b) => a.time - b.time);
}

/** Rebase each curve to 0% at its first point so different account sizes can share one chart. */
export function indexedReturn(points: Array<{ time: number; value: number }>): Array<{ time: number; value: number }> {
  const base = points[0]?.value;
  if (!base) return [];
  return points.map((point) => ({ time: point.time, value: (point.value / base - 1) * 100 }));
}
