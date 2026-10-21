import type { ApiClient } from './client';
import type {
  AllProfitStats,
  EntryStats,
  ExitStats,
  LockResponse,
  MixTagStats,
  PairListResponse,
  PerformanceEntry,
  PlotConfig,
  SysInfo,
  TimeSummary,
  TradeCustomData,
  TradeHistory,
  WalletHistory,
} from '@/types';

export function fetchTradeHistory(client: ApiClient, limit: number, offset: number): Promise<TradeHistory> {
  return client.get(`/trades?limit=${limit}&offset=${offset}`);
}

/**
 * One small probe learns the total. Later calls pass that total and fetch only the window.
 * If the total moved, the window is fetched once more.
 */
export async function loadTradeWindow(
  client: ApiClient,
  rangeFor: (total: number) => { start: number; limit: number },
  knownTotal: number | null,
): Promise<{ trades: TradeHistory['trades']; total: number }> {
  let total = knownTotal;
  if (total == null) {
    const probe = await fetchTradeHistory(client, 1, 0);
    total = probe.total_trades;
  }
  let range = rangeFor(total);
  if (range.limit === 0) return { trades: [], total };
  let page = await fetchTradeHistory(client, range.limit, range.start);
  if (page.total_trades !== total) {
    total = page.total_trades;
    const next = rangeFor(total);
    if (next.start !== range.start || next.limit !== range.limit) {
      if (next.limit === 0) return { trades: [], total };
      page = await fetchTradeHistory(client, next.limit, next.start);
      total = page.total_trades;
    }
  }
  return { trades: page.trades, total };
}

export async function fetchAllTrades(client: ApiClient): Promise<TradeHistory['trades']> {
  const pageSize = 500;
  const trades: TradeHistory['trades'] = [];
  let total = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < total && offset < pageSize * 20; offset += pageSize) {
    const page = await fetchTradeHistory(client, pageSize, offset);
    total = page.total_trades;
    trades.push(...page.trades);
    if (page.trades.length === 0) break;
  }
  return trades;
}

export function fetchTradeCustomData(client: ApiClient, tradeId: number): Promise<TradeCustomData> {
  return client.get(`/trades/${tradeId}/custom-data`);
}

export function fetchProfitAll(client: ApiClient): Promise<AllProfitStats> {
  return client.get('/profit_all');
}

export function fetchTimeSummary(
  client: ApiClient,
  period: 'daily' | 'weekly' | 'monthly',
  timescale: number,
): Promise<TimeSummary> {
  return client.get(`/${period}?timescale=${timescale}`);
}

export function fetchPerformance(client: ApiClient): Promise<PerformanceEntry[]> {
  return client.get('/performance');
}

export function fetchEntryStats(client: ApiClient): Promise<EntryStats[]> {
  return client.get('/entries');
}

export function fetchExitStats(client: ApiClient): Promise<ExitStats[]> {
  return client.get('/exits');
}

export function fetchMixTagStats(client: ApiClient): Promise<MixTagStats[]> {
  return client.get('/mix_tags');
}

export function fetchHistoricBalance(client: ApiClient): Promise<WalletHistory> {
  return client.get('/historic_balance');
}

export function fetchWhitelist(client: ApiClient): Promise<PairListResponse> {
  return client.get('/whitelist');
}

export function fetchBlacklist(client: ApiClient): Promise<PairListResponse> {
  return client.get('/blacklist');
}

export function fetchLocks(client: ApiClient): Promise<LockResponse> {
  return client.get('/locks');
}

export function fetchSysInfo(client: ApiClient): Promise<SysInfo> {
  return client.get('/sysinfo');
}

export function fetchPlotConfig(client: ApiClient): Promise<PlotConfig> {
  return client.get('/plot_config');
}
