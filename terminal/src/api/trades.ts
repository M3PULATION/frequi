import type { ApiClient } from './client';
import type { Trade } from '@/types';

export function fetchOpenTrades(client: ApiClient): Promise<Trade[]> {
  return client.get('/status');
}
