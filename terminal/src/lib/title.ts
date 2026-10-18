export const BRAND = 'MANIPULATION';

const PAGES: Array<[prefix: string, label: string]> = [
  ['/bots', '实盘'],
  ['/positions', '持仓'],
  ['/history', '历史'],
  ['/profit', '盈亏'],
  ['/balance', '余额'],
  ['/pairs', '交易对'],
  ['/logs', '日志'],
  ['/system', '系统'],
];

/** `DOGE/USDC:USDC` becomes `DOGE`, the same short market name a trade tab uses. */
export function baseAsset(pair: string): string {
  const head = pair.split('/')[0]?.split(':')[0]?.trim();
  return head || pair;
}

/** `{市场或页面} | MANIPULATION`. The chart uses the coin; other pages use their name. */
export function documentTitle(pathname: string, pair?: string | null): string {
  if (pathname === '/chart' || pathname.startsWith('/chart/')) {
    return pair ? `${baseAsset(pair)} | ${BRAND}` : `图表 | ${BRAND}`;
  }
  const page = PAGES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return page ? `${page[1]} | ${BRAND}` : BRAND;
}
