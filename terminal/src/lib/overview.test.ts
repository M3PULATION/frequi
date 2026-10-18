import { describe, expect, it } from 'vitest';

import { openProfitOf, overviewFromSnapshot } from './overview';
import type { ProfitStats, Trade } from '@/types';

describe('open profit', () => {
  it('sums live trade profit and treats an empty book as zero', () => {
    const trades = [{ profit_abs: 1.5 }, { profit_abs: -0.5 }] as Trade[];
    expect(openProfitOf(null, trades)).toBe(1);
    expect(openProfitOf(null, [])).toBe(0);
    expect(openProfitOf({ profit_all_coin: 8, profit_closed_coin: 5 } as ProfitStats, null)).toBe(3);
  });
});

describe('overview from snapshot', () => {
  it('keeps the catalog strategy when the bot is offline', () => {
    const overview = overviewFromSnapshot({ id: 'a', name: 'A', online: false, strategy: 'Martingale' }, undefined);
    expect(overview.strategy).toBe('Martingale');
    expect(overview.equity).toBeNull();
    expect(overview.openCount).toBeNull();
  });
});
