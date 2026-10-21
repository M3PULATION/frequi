import { describe, expect, it } from 'vitest';

import { latestTradeRange, tradePageRange } from './trades';

describe('trade page range', () => {
  it('puts the newest trades on page 0', () => {
    expect(tradePageRange(0, 0, 20)).toEqual({ start: 0, limit: 0 });
    expect(tradePageRange(5, 0, 20)).toEqual({ start: 0, limit: 5 });
    expect(tradePageRange(50, 0, 20)).toEqual({ start: 30, limit: 20 });
    expect(tradePageRange(50, 1, 20)).toEqual({ start: 10, limit: 20 });
    expect(tradePageRange(50, 2, 20)).toEqual({ start: 0, limit: 10 });
  });
});

describe('latest trade range', () => {
  it('asks only for the tail of a long history', () => {
    expect(latestTradeRange(50, 500)).toEqual({ start: 0, limit: 50 });
    expect(latestTradeRange(800, 500)).toEqual({ start: 300, limit: 500 });
  });
});
