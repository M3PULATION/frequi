import type { ApiClient } from './client';
import { assertCandleTimeframe, type PairCandleResponse } from '@/lib/candles';

const CANDLE_COLUMNS = ['date', 'open', 'high', 'low', 'close', 'volume', '__date_ts'];

export function fetchPairCandles(
  client: ApiClient,
  input: { pair: string; timeframe: string; limit?: number },
): Promise<PairCandleResponse> {
  return client.post('/pair_candles', {
    pair: input.pair,
    timeframe: assertCandleTimeframe(input.timeframe),
    limit: input.limit ?? 400,
    columns: CANDLE_COLUMNS,
  });
}
