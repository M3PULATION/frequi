import { describe, expect, it } from 'vitest';

import { candleLimitForTrades, currentRoiRatio, takeProfitPrice } from './levels';

describe('position levels', () => {
  it('uses the ROI step that the trade age has reached', () => {
    const opened = Date.parse('2026-10-17T00:00:00Z');
    const roi = { '0': 0.2, '60': 0.05 };
    expect(currentRoiRatio(roi, opened, opened + 30 * 60_000)).toBe(0.2);
    expect(currentRoiRatio(roi, opened, opened + 90 * 60_000)).toBe(0.05);
  });

  it('places take profit by leverage and direction', () => {
    expect(takeProfitPrice({ openRate: 100, isShort: false, leverage: 10, roiRatio: 0.1 })).toBeCloseTo(101);
    expect(takeProfitPrice({ openRate: 100, isShort: true, leverage: 10, roiRatio: 0.1 })).toBeCloseTo(99);
    expect(takeProfitPrice({ openRate: 100, isShort: true, leverage: 10, roiRatio: 0 })).toBeNull();
  });

  it('asks for enough candles to cover the oldest trade', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    const opened = now - 2 * 60 * 60_000;
    expect(candleLimitForTrades('5m', [opened], now)).toBe(400);
    const older = now - 48 * 60 * 60_000;
    expect(candleLimitForTrades('5m', [older], now)).toBeGreaterThan(400);
  });
});