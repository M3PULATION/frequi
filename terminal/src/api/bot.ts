import type { ApiClient } from './client';
import type { Balance, BotState, Logs, ProfitStats } from '@/types';

export function fetchConfig(client: ApiClient): Promise<BotState> {
  return client.get('/show_config');
}

export function fetchProfit(client: ApiClient): Promise<ProfitStats> {
  return client.get('/profit');
}

export function fetchBalance(client: ApiClient): Promise<Balance> {
  return client.get('/balance');
}

export function fetchLogs(client: ApiClient): Promise<Logs> {
  return client.get('/logs');
}
