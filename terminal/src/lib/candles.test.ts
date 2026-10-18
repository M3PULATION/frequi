import { describe, expect, it } from 'vitest';

import { barsFromCandles, candleTimeframe, markersForOrders, markersForTrades, unixSeconds, type PairCandleResponse } from './candles';

const payload: PairCandleResponse = {
  pair: 'ABC/USDC:USDC',
  timeframe: '5m',
  timeframe_ms: 300_000,
  columns: ['date', 'open', 'high', 'low', 'close', 'volume', 'enter_long', '__date_ts'],
  length: 2,
  data: [
    ['2026-10-17T00:00:00Z', 10, 12, 9, 11, 100, 0, 1_700_000_000_000],
    ['2026-10-17T00:05:00Z', 11, 11, 8, 9, 80, 1, 1_700_000_300_000],
  ],
};

describe('candle time', () => {
  it('converts __date_ts milliseconds to chart seconds', () => {
    const { bars, volume } = barsFromCandles(payload);
    expect(bars.map((bar) => bar.time)).toEqual([1_700_000_000, 1_700_000_300]);
    expect(volume[0]?.color).toBe('#3fd68b');
    expect(volume[1]?.color).toBe('#ff5470');
    expect(unixSeconds(1_700_000_000_000)).toBe(1_700_000_000);
  });

  it('keeps the config timeframe string and drops an integer trade timeframe', () => {
    expect(candleTimeframe('5m', 5)).toBe('5m');
    expect(candleTimeframe(undefined, 5)).toBeNull();
    expect(candleTimeframe(undefined, '1h')).toBe('1h');
  });
});

describe('markersForOrders', () => {
  it('treats a filled sell on a short as the entry and ignores ft_is_entry', () => {
    const { bars } = barsFromCandles(payload);
    const markers = markersForOrders({
      isShort: true,
      bars,
      orders: [
        {
          ft_order_side: 'sell',
          status: 'closed',
          filled: 1,
          order_filled_timestamp: 1_700_000_060_000,
        },
        {
          ft_order_side: 'stoploss',
          status: 'open',
          filled: 0,
          order_timestamp: 1_700_000_060_000,
        },
      ],
    });
    expect(markers).toEqual([
      { time: 1_700_000_000, position: 'aboveBar', color: '#ff5470', shape: 'arrowDown', text: '开空' },
    ]);
  });
});

describe('markersForTrades', () => {
  it('labels an open short above the wick and leaves closed entries unlabeled', () => {
    const { bars } = barsFromCandles(payload);
    const markers = markersForTrades(
      [
        { trade_id: 7, is_open: true, is_short: true, open_rate: 11, open_timestamp: 1_700_000_060 },
        {
          trade_id: 1,
          is_open: false,
          is_short: false,
          open_rate: 10,
          open_timestamp: 1_700_000_000,
          close_rate: 9,
          close_timestamp: 1_700_000_300,
        },
      ],
      bars,
    );
    expect(markers).toEqual([
      {
        time: 1_700_000_000,
        position: 'belowBar',
        price: 9,
        color: '#3fd68b',
        shape: 'arrowUp',
        text: undefined,
        kind: 'entry',
      },
      {
        time: 1_700_000_000,
        position: 'aboveBar',
        price: 12,
        color: '#ff5470',
        shape: 'arrowDown',
        text: '开空',
        kind: 'entry',
      },
      {
        time: 1_700_000_300,
        position: 'aboveBar',
        price: 11,
        color: '#c5c8ce',
        shape: 'circle',
        kind: 'exit',
      },
    ]);
  });
});
