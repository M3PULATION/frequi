import { toEpochMs } from '@/lib/format';
import type { ClosedTrade, TimeSummaryRecord } from '@/types';

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation (n − 1), matching the series Freqtrade annualizes. */
export function sampleStdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const center = mean(values);
  if (center == null) return null;
  const square = values.reduce((sum, value) => sum + (value - center) ** 2, 0);
  return Math.sqrt(square / (values.length - 1));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper == null) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1];
  return lower == null ? upper : (lower + upper) / 2;
}

export function recoveryFactor(profit: number | null | undefined, drawdownAbs: number | null | undefined): number | null {
  if (profit == null || drawdownAbs == null || !Number.isFinite(profit) || !(drawdownAbs > 0)) return null;
  return profit / drawdownAbs;
}

/** Keep days on or after the bot start. Without a start, drop the leading flat days. */
export function activeDailyRows(rows: TimeSummaryRecord[], startDate?: string | null): TimeSummaryRecord[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const start = startDate?.slice(0, 10);
  if (start) return sorted.filter((row) => row.date >= start);
  const first = sorted.findIndex((row) => row.trade_count > 0 || row.abs_profit !== 0);
  return first < 0 ? [] : sorted.slice(first);
}

export type DailyRisk = {
  days: number;
  upDays: number;
  downDays: number;
  flatDays: number;
  meanDaily: number | null;
  bestDay: number | null;
  worstDay: number | null;
  dailyVol: number | null;
  annualVol: number | null;
  downsideDev: number | null;
  annualDownside: number | null;
};

/** Root-mean-square of negative returns. The divisor includes flat and positive days. */
export function downsideDeviation(returns: number[]): number | null {
  if (returns.length === 0) return null;
  const square = returns.reduce((sum, value) => sum + (value < 0 ? value * value : 0), 0);
  return Math.sqrt(square / returns.length);
}

export function dailyRisk(rows: TimeSummaryRecord[], startDate?: string | null): DailyRisk {
  const active = activeDailyRows(rows, startDate);
  const returns = active.map((row) => row.rel_profit).filter((value) => Number.isFinite(value));
  const vol = sampleStdev(returns);
  const downside = downsideDeviation(returns);
  return {
    days: active.length,
    upDays: returns.filter((value) => value > 0).length,
    downDays: returns.filter((value) => value < 0).length,
    flatDays: returns.filter((value) => value === 0).length,
    meanDaily: mean(returns),
    bestDay: returns.length ? Math.max(...returns) : null,
    worstDay: returns.length ? Math.min(...returns) : null,
    dailyVol: vol,
    annualVol: vol == null ? null : vol * Math.sqrt(365),
    downsideDev: downside,
    annualDownside: downside == null ? null : downside * Math.sqrt(365),
  };
}

export type EquityRisk = {
  maxDrawdown: number | null;
  ulcer: number | null;
  recovery: number | null;
};

/** Ulcer index is the root-mean-square of percentage drawdowns, returned as a ratio. */
export function equityRisk(values: number[]): EquityRisk {
  const series = values.filter((value) => Number.isFinite(value) && value > 0);
  if (series.length < 2) return { maxDrawdown: null, ulcer: null, recovery: null };
  let peak = series[0] ?? 0;
  const drawdowns: number[] = [];
  for (const value of series) {
    peak = Math.max(peak, value);
    drawdowns.push(peak > 0 ? (peak - value) / peak : 0);
  }
  const maxDrawdown = Math.max(...drawdowns);
  const ulcer = Math.sqrt(drawdowns.reduce((sum, value) => sum + value * value, 0) / drawdowns.length);
  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? first;
  const recovery = maxDrawdown > 0 && first > 0 ? (last / first - 1) / maxDrawdown : null;
  return { maxDrawdown, ulcer, recovery };
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function closeMs(trade: ClosedTrade): number {
  if (typeof trade.close_timestamp === 'number') return toEpochMs(trade.close_timestamp);
  return trade.trade_id;
}

/** Positive means the fill was worse than the requested price. */
export function entrySlippage(trade: ClosedTrade): number | null {
  if (!finite(trade.open_rate) || !finite(trade.open_rate_requested) || trade.open_rate_requested === 0) return null;
  const raw = (trade.open_rate - trade.open_rate_requested) / trade.open_rate_requested;
  return trade.is_short ? -raw : raw;
}

export function exitSlippage(trade: ClosedTrade): number | null {
  if (!finite(trade.close_rate) || !finite(trade.close_rate_requested) || trade.close_rate_requested === 0) return null;
  const raw = (trade.close_rate - trade.close_rate_requested) / trade.close_rate_requested;
  return trade.is_short ? raw : -raw;
}

export function adverseExcursion(trade: ClosedTrade): number | null {
  if (!finite(trade.open_rate) || trade.open_rate === 0 || !finite(trade.min_rate) || !finite(trade.max_rate)) return null;
  return trade.is_short ? (trade.max_rate - trade.open_rate) / trade.open_rate : (trade.open_rate - trade.min_rate) / trade.open_rate;
}

export function favorableExcursion(trade: ClosedTrade): number | null {
  if (!finite(trade.open_rate) || trade.open_rate === 0 || !finite(trade.min_rate) || !finite(trade.max_rate)) return null;
  return trade.is_short ? (trade.open_rate - trade.min_rate) / trade.open_rate : (trade.max_rate - trade.open_rate) / trade.open_rate;
}

export type TradeRisk = {
  closedCount: number;
  medianProfitRatio: number | null;
  avgWinRatio: number | null;
  avgLossRatio: number | null;
  bestRatio: number | null;
  worstRatio: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  grossProfit: number;
  grossLoss: number;
  fees: number;
  funding: number;
  avgEntrySlippage: number | null;
  avgExitSlippage: number | null;
  avgAdverse: number | null;
  avgFavorable: number | null;
  avgDurationSeconds: number | null;
};

export function tradeRisk(trades: ClosedTrade[]): TradeRisk {
  const closed = trades.filter((trade) => trade.is_open === false);
  const ordered = [...closed].sort((a, b) => closeMs(a) - closeMs(b));
  const ratios = ordered.map((trade) => trade.profit_ratio).filter(finite);
  const wins = ratios.filter((value) => value > 0);
  const losses = ratios.filter((value) => value < 0);
  let winStreak = 0;
  let lossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  for (const ratio of ratios) {
    if (ratio > 0) {
      winStreak += 1;
      lossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, winStreak);
    } else if (ratio < 0) {
      lossStreak += 1;
      winStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      winStreak = 0;
      lossStreak = 0;
    }
  }
  const durations = ordered.map((trade) => trade.trade_duration_s).filter(finite);
  return {
    closedCount: closed.length,
    medianProfitRatio: median(ratios),
    avgWinRatio: mean(wins),
    avgLossRatio: mean(losses),
    bestRatio: ratios.length ? Math.max(...ratios) : null,
    worstRatio: ratios.length ? Math.min(...ratios) : null,
    maxWinStreak,
    maxLossStreak,
    grossProfit: ordered.reduce((sum, trade) => sum + (finite(trade.profit_abs) && trade.profit_abs > 0 ? trade.profit_abs : 0), 0),
    grossLoss: ordered.reduce((sum, trade) => sum + (finite(trade.profit_abs) && trade.profit_abs < 0 ? -trade.profit_abs : 0), 0),
    fees: ordered.reduce((sum, trade) => sum + (finite(trade.fee_open_cost) ? trade.fee_open_cost : 0) + (finite(trade.fee_close_cost) ? trade.fee_close_cost : 0), 0),
    funding: ordered.reduce((sum, trade) => sum + (finite(trade.funding_fees) ? trade.funding_fees : 0), 0),
    avgEntrySlippage: mean(ordered.map(entrySlippage).filter(finite)),
    avgExitSlippage: mean(ordered.map(exitSlippage).filter(finite)),
    avgAdverse: mean(ordered.map(adverseExcursion).filter(finite)),
    avgFavorable: mean(ordered.map(favorableExcursion).filter(finite)),
    avgDurationSeconds: mean(durations),
  };
}
