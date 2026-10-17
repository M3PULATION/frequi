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
