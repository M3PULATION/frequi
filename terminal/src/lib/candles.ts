import { parseUtcDate } from '@/lib/format';

export type CandleCell = string | number | null;

export type PairCandleResponse = {
  pair: string;
  timeframe: string;
  timeframe_ms: number;
  columns: string[];
  data: CandleCell[][];
  length: number;
};

export type CandleBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type VolumeBar = {
  time: number;
  value: number;
  color: string;
};

export type TradeMarker = {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'atPriceMiddle';
  price?: number;
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  text?: string;
  size?: number;
  /** Entry and exit marks are drawn as chart badges. Other markers stay on the series. */
  kind?: 'entry' | 'exit';
};

export type MarkerOrder = {
  ft_order_side: string;
  status?: string;
  filled?: number | null;
  order_filled_timestamp?: number;
  order_timestamp?: number;
};

const UP = '#3fd68b';
const DOWN = '#ff5470';
const EXIT = '#97fce4';

/** Freqtrade serializes API 2.50 as the JSON number 2.5. Compare floats, never version strings. */
export function apiAtLeast(apiVersion: number, minVersion: number): boolean {
  return apiVersion >= minVersion;
}

/**
 * Candle requests need the config timeframe string ("5m").
 * Open trades on this bot report timeframe as an integer minute count, which pair_candles rejects.
 */
export function candleTimeframe(configTimeframe: unknown, tradeTimeframe: unknown): string | null {
  if (typeof configTimeframe === 'string' && /^\d+[mhdwM]$/.test(configTimeframe)) return configTimeframe;
  if (typeof tradeTimeframe === 'string' && /^\d+[mhdwM]$/.test(tradeTimeframe)) return tradeTimeframe;
  return null;
}

export function assertCandleTimeframe(timeframe: string): string {
  if (!/^\d+[mhdwM]$/.test(timeframe)) {
    throw new Error(`K 线周期必须是 5m 这种字符串，收到了 ${String(timeframe)}`);
  }
  return timeframe;
}

export function unixSeconds(value: number): number {
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function columnIndex(columns: string[], name: string): number {
  return columns.indexOf(name);
}

function asNumber(value: CandleCell | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function timeFromRow(columns: string[], row: CandleCell[]): number | null {
  const ts = asNumber(row[columnIndex(columns, '__date_ts')]);
  if (ts != null) return unixSeconds(ts);
  const dateIndex = columnIndex(columns, 'date');
  const date = dateIndex >= 0 ? row[dateIndex] : undefined;
  if (typeof date === 'number') return unixSeconds(date);
  if (typeof date === 'string') {
    const parsed = Date.parse(date);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
}

export function barsFromCandles(payload: PairCandleResponse): { bars: CandleBar[]; volume: VolumeBar[] } {
  const { columns, data } = payload;
  const openIndex = columnIndex(columns, 'open');
  const highIndex = columnIndex(columns, 'high');
  const lowIndex = columnIndex(columns, 'low');
  const closeIndex = columnIndex(columns, 'close');
  const volumeIndex = columnIndex(columns, 'volume');
  const byTime = new Map<number, { bar: CandleBar; volume: VolumeBar }>();

  for (const row of data) {
    const time = timeFromRow(columns, row);
    const open = asNumber(row[openIndex]);
    const high = asNumber(row[highIndex]);
    const low = asNumber(row[lowIndex]);
    const close = asNumber(row[closeIndex]);
    if (time == null || open == null || high == null || low == null || close == null) continue;
    const rising = close >= open;
    byTime.set(time, {
      bar: { time, open, high, low, close },
      volume: {
        time,
        value: asNumber(volumeIndex >= 0 ? row[volumeIndex] : undefined) ?? 0,
        color: rising ? UP : DOWN,
      },
    });
  }

  const ordered = [...byTime.values()].sort((a, b) => a.bar.time - b.bar.time);
  return {
    bars: ordered.map((item) => item.bar),
    volume: ordered.map((item) => item.volume),
  };
}

function isFilled(order: MarkerOrder): boolean {
  if (order.status === 'canceled' || order.status === 'cancelled' || order.status === 'expired') return false;
  if (order.status === 'closed') return true;
  return typeof order.filled === 'number' && order.filled > 0;
}

function classify(side: string, isShort: boolean): 'entry' | 'exit' | 'stop' | null {
  if (side === 'stoploss') return 'stop';
  if (isShort) {
    if (side === 'sell') return 'entry';
    if (side === 'buy') return 'exit';
    return null;
  }
  if (side === 'buy') return 'entry';
  if (side === 'sell') return 'exit';
  return null;
}

function snapToBar(orderSeconds: number, bars: CandleBar[]): number | null {
  let match: number | null = null;
  for (const bar of bars) {
    if (bar.time <= orderSeconds) match = bar.time;
    else break;
  }
  return match;
}

export function markersForOrders(input: {
  orders: MarkerOrder[];
  isShort: boolean;
  bars: CandleBar[];
}): TradeMarker[] {
  const markers: TradeMarker[] = [];
  for (const order of input.orders) {
    if (!isFilled(order)) continue;
    const kind = classify(order.ft_order_side, input.isShort);
    if (!kind) continue;
    const rawTime = order.order_filled_timestamp ?? order.order_timestamp;
    if (typeof rawTime !== 'number') continue;
    const time = snapToBar(unixSeconds(rawTime), input.bars);
    if (time == null) continue;
    if (kind === 'entry') {
      markers.push(
        input.isShort
          ? { time, position: 'aboveBar', color: DOWN, shape: 'arrowDown', text: '开空' }
          : { time, position: 'belowBar', color: UP, shape: 'arrowUp', text: '开多' },
      );
    } else if (kind === 'exit') {
      markers.push({ time, position: input.isShort ? 'belowBar' : 'aboveBar', color: EXIT, shape: 'circle', text: '平仓' });
    } else {
      markers.push({ time, position: 'aboveBar', color: EXIT, shape: 'circle', text: '止损' });
    }
  }
  return markers.sort((a, b) => a.time - b.time);
}

export type ChartTradePoint = {
  trade_id: number;
  is_open?: boolean;
  is_short?: boolean;
  open_rate: number;
  open_timestamp: number;
  close_rate?: number;
  close_timestamp?: number;
  close_date?: string;
};

function closeSeconds(trade: ChartTradePoint): number | null {
  if (typeof trade.close_timestamp === 'number') return unixSeconds(trade.close_timestamp);
  if (!trade.close_date) return null;
  const parsed = parseUtcDate(trade.close_date);
  return parsed == null ? null : Math.floor(parsed / 1000);
}

function barByTime(bars: CandleBar[], time: number): CandleBar | undefined {
  return bars.find((bar) => bar.time === time);
}

/** Entry and exit anchor on the wick. The chart offsets them in pixels so they stay clear of the candle. */
export function markersForTrades(trades: ChartTradePoint[], bars: CandleBar[]): TradeMarker[] {
  const markers: TradeMarker[] = [];
  for (const trade of trades) {
    const entryTime = snapToBar(unixSeconds(trade.open_timestamp), bars);
    const entryBar = entryTime == null ? undefined : barByTime(bars, entryTime);
    if (entryBar && trade.open_rate > 0) {
      const above = Boolean(trade.is_short);
      const open = trade.is_open !== false;
      markers.push({
        time: entryBar.time,
        position: above ? 'aboveBar' : 'belowBar',
        price: above ? entryBar.high : entryBar.low,
        color: above ? DOWN : UP,
        shape: above ? 'arrowDown' : 'arrowUp',
        text: open ? (above ? '开空' : '开多') : undefined,
        kind: 'entry',
      });
    }
    const exitAt = closeSeconds(trade);
    const exitTime = exitAt == null ? null : snapToBar(exitAt, bars);
    const exitBar = exitTime == null ? undefined : barByTime(bars, exitTime);
    if (!trade.is_open && exitBar && trade.close_rate != null && trade.close_rate > 0) {
      const above = !trade.is_short;
      markers.push({
        time: exitBar.time,
        position: above ? 'aboveBar' : 'belowBar',
        price: above ? exitBar.high : exitBar.low,
        color: '#c5c8ce',
        shape: 'circle',
        kind: 'exit',
      });
    }
  }
  return markers.sort((a, b) => a.time - b.time || (a.price ?? 0) - (b.price ?? 0));
}
