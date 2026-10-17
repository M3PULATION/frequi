import { describe, expect, it } from 'vitest';

import { activeDailyRows, adverseExcursion, dailyRisk, entrySlippage, equityRisk, recoveryFactor, tradeRisk } from './risk';
import type { ClosedTrade } from '@/types';

function trade(partial: Partial<ClosedTrade> & Pick<ClosedTrade, 'trade_id' | 'profit_ratio'>): ClosedTrade {
  return {
    pair: 'DOGE/USDT:USDT',
    is_open: false,
    amount: 1,
    stake_amount: 10,
    open_rate: 100,
    profit_pct: (partial.profit_ratio ?? 0) * 100,
    stop_loss_abs: 1,
    stop_loss_pct: 0,
    open_timestamp: partial.trade_id,
    ...partial,
  };
}

describe('risk metrics', () => {
  it('drops daily rows before the bot started', () => {
    const rows = [
      { date: '2026-10-01', abs_profit: 0, rel_profit: 0, starting_balance: 10, fiat_value: 0, trade_count: 0 },
      { date: '2026-10-02', abs_profit: 1, rel_profit: 0.1, starting_balance: 10, fiat_value: 0, trade_count: 1 },
      { date: '2026-10-03', abs_profit: 0, rel_profit: 0, starting_balance: 11, fiat_value: 0, trade_count: 0 },
    ];
    expect(activeDailyRows(rows, '2026-10-02 11:41:45').map((row) => row.date)).toEqual(['2026-10-02', '2026-10-03']);
    const risk = dailyRisk(rows, '2026-10-02 11:41:45');
    expect(risk.days).toBe(2);
    expect(risk.upDays).toBe(1);
    expect(risk.flatDays).toBe(1);
    expect(risk.bestDay).toBe(0.1);
  });

  it('measures drawdown and ulcer from the balance curve', () => {
    const risk = equityRisk([100, 100, 90]);
    expect(risk.maxDrawdown).toBeCloseTo(0.1);
    expect(risk.ulcer).toBeCloseTo(Math.sqrt(0.01 / 3));
    expect(risk.recovery).toBeCloseTo(-0.1 / 0.1);
    expect(recoveryFactor(3, 1.5)).toBe(2);
    expect(recoveryFactor(3, 0)).toBeNull();
  });

  it('signs short slippage and excursion from the trade side', () => {
    const short = trade({
      trade_id: 1,
      is_short: true,
      profit_ratio: 0.2,
      open_rate: 0.0913,
      open_rate_requested: 0.0912,
      min_rate: 0.08,
      max_rate: 0.1,
    });
    expect(entrySlippage(short)).toBeLessThan(0);
    expect(adverseExcursion(short)).toBeCloseTo((0.1 - 0.0913) / 0.0913);
  });

  it('counts streaks and skips a missing exit price', () => {
    const stats = tradeRisk([
      trade({ trade_id: 1, profit_ratio: 0.2, profit_abs: 2, close_timestamp: 1, trade_duration_s: 10, fee_open_cost: 0.1, fee_close_cost: 0.2, funding_fees: -0.05 }),
      trade({ trade_id: 2, profit_ratio: 0.1, profit_abs: 1, close_timestamp: 2, trade_duration_s: 30 }),
      trade({ trade_id: 3, profit_ratio: -0.2, profit_abs: -1, close_timestamp: 3, trade_duration_s: 20 }),
      trade({ trade_id: 4, profit_ratio: -0.1, profit_abs: -0.5, close_timestamp: 4, trade_duration_s: 40 }),
    ]);
    expect(stats.maxWinStreak).toBe(2);
    expect(stats.maxLossStreak).toBe(2);
    expect(stats.medianProfitRatio).toBeCloseTo(0);
    expect(stats.grossProfit).toBe(3);
    expect(stats.grossLoss).toBe(1.5);
    expect(stats.fees).toBeCloseTo(0.3);
    expect(stats.funding).toBeCloseTo(-0.05);
    expect(stats.avgExitSlippage).toBeNull();
    expect(stats.avgDurationSeconds).toBe(25);
  });
});
