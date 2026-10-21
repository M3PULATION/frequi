/** Freqtrade returns trades oldest-first. Page 0 is the newest page. */
export function tradePageRange(total: number, page: number, pageSize: number): { start: number; limit: number } {
  const safeTotal = Math.max(0, total);
  const start = Math.max(0, safeTotal - (page + 1) * pageSize);
  const end = Math.max(start, safeTotal - page * pageSize);
  return { start, limit: end - start };
}

export function latestTradeRange(total: number, limit: number): { start: number; limit: number } {
  const size = Math.max(0, Math.min(limit, Math.max(0, total)));
  return { start: Math.max(0, total - size), limit: size };
}
