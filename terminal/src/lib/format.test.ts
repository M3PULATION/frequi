import { describe, expect, it } from 'vitest';

import { formatChinaTime, formatNumber, formatPrice, formatRatio, pricePrecision, profitTone } from './format';

describe('format', () => {
  it('colors profit by sign and prints ratios as percents', () => {
    expect(profitTone(0.01)).toBe('text-up');
    expect(profitTone(-0.2)).toBe('text-down');
    expect(profitTone(0)).toBe('text-foreground');
    expect(formatRatio(0.0123)).toBe('+1.23%');
    expect(formatRatio(-0.5)).toBe('-50.00%');
  });

  it('shows UTC timestamps in China time', () => {
    expect(formatChinaTime(Date.UTC(2026, 9, 17, 3, 53, 0))).toContain('11:53');
    expect(formatChinaTime('2026-10-17 03:53:00')).toContain('11:53');
  });

  it('keeps enough decimals to separate sub-dollar prices', () => {
    expect(pricePrecision([0.079135, 0.080686])).toBe(6);
    expect(formatPrice(0.079135, 6)).toBe('0.079135');
    expect(formatPrice(0.080686, 6)).toBe('0.080686');
  });

  it('treats sub-1 precision as a tick size', () => {
    expect(formatNumber(0.123456, 0.000001)).toBe('0.123456');
    expect(formatNumber(845, 1)).toBe('845');
  });
});
