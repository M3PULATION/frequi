import { describe, expect, it } from 'vitest';

import { baseAsset, documentTitle } from './title';

describe('document title', () => {
  it('uses the coin on the chart and the page name elsewhere', () => {
    expect(baseAsset('DOGE/USDC:USDC')).toBe('DOGE');
    expect(documentTitle('/chart/119', 'DOGE/USDC:USDC')).toBe('DOGE | MANIPULATION');
    expect(documentTitle('/chart')).toBe('图表 | MANIPULATION');
    expect(documentTitle('/positions')).toBe('持仓 | MANIPULATION');
    expect(documentTitle('/history')).toBe('历史 | MANIPULATION');
    expect(documentTitle('/')).toBe('MANIPULATION');
  });
});
