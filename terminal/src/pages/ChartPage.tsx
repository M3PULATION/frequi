import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { fetchPairCandles } from '@/api/candles';
import { fetchTradeHistory, fetchWhitelist } from '@/api/insights';
import { CandleChart, type ChartPriceLine } from '@/components/CandleChart';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorMessage } from '@/hooks/useBotClient';
import { useTerminal } from '@/hooks/useTerminal';
import { barsFromCandles, candleTimeframe, markersForTrades } from '@/lib/candles';
import { CANDLE_POLL_MS, formatNumber, formatPercentPoints, formatRatio, profitTone, visibleInterval } from '@/lib/format';
import { candleLimitForTrades, currentRoiRatio, takeProfitPrice } from '@/lib/levels';
import { useMemo } from 'react';

export function ChartPage() {
  const terminal = useTerminal();
  const navigate = useNavigate();
  const { tradeId } = useParams();
  const tradesReady = !terminal.tradesLoading;
  const trade = terminal.trades.find((item) => String(item.trade_id) === tradeId) ?? null;
  const shouldUseOpenTrade = tradesReady && terminal.trades.length > 0 && !trade;
  const timeframe =
    candleTimeframe(terminal.config?.timeframe, trade?.timeframe) ??
    (terminal.config?.timeframe && /^\d+[mhdwM]$/.test(terminal.config.timeframe) ? terminal.config.timeframe : null);
  const historyQuery = useQuery({
    queryKey: ['bot', terminal.bot.id, 'chart-trades'],
    queryFn: async () => {
      const head = await fetchTradeHistory(terminal.client, 500, 0);
      if (head.total_trades <= head.trades.length) return head.trades;
      const start = Math.max(0, head.total_trades - 500);
      const tail = await fetchTradeHistory(terminal.client, head.total_trades - start, start);
      return tail.trades;
    },
    refetchInterval: visibleInterval(30_000),
  });
  const historyPair = useMemo(() => {
    const latest = [...(historyQuery.data ?? [])].sort(
      (a, b) => (b.close_timestamp ?? b.open_timestamp ?? 0) - (a.close_timestamp ?? a.open_timestamp ?? 0),
    )[0];
    return latest?.pair ?? null;
  }, [historyQuery.data]);
  const whitelistQuery = useQuery({
    queryKey: ['bot', terminal.bot.id, 'chart-whitelist'],
    queryFn: () => fetchWhitelist(terminal.client),
    enabled: tradesReady && !trade && !historyPair,
  });
  const pair = trade?.pair ?? (!shouldUseOpenTrade ? historyPair ?? whitelistQuery.data?.whitelist?.[0] ?? null : null);
  const pairTrades = useMemo(() => {
    if (!pair) return [];
    const byId = new Map<number, (typeof terminal.trades)[number] | NonNullable<typeof historyQuery.data>[number]>();
    for (const item of historyQuery.data ?? []) {
      if (item.pair === pair) byId.set(item.trade_id, item);
    }
    for (const item of terminal.trades) {
      if (item.pair === pair) byId.set(item.trade_id, item);
    }
    return [...byId.values()];
  }, [historyQuery.data, pair, terminal.trades]);
  const candleLimit = timeframe ? candleLimitForTrades(timeframe, pairTrades.map((item) => item.open_timestamp)) : 400;
  const candleQuery = useQuery({
    queryKey: ['bot', terminal.bot.id, 'candles', pair, timeframe, candleLimit],
    queryFn: () => fetchPairCandles(terminal.client, { pair: pair ?? '', timeframe: timeframe ?? '', limit: candleLimit }),
    enabled: Boolean(pair && timeframe),
    refetchInterval: visibleInterval(CANDLE_POLL_MS),
  });

  if (shouldUseOpenTrade && terminal.trades[0]) {
    return <Navigate to={`/chart/${terminal.trades[0].trade_id}`} replace />;
  }
  const chart = candleQuery.data ? barsFromCandles(candleQuery.data) : { bars: [], volume: [] };
  const markers = markersForTrades(
    pairTrades.map((item) => ({
      trade_id: item.trade_id,
      is_open: item.is_open,
      is_short: item.is_short,
      open_rate: item.open_rate,
      open_timestamp: item.open_timestamp,
      close_rate: 'close_rate' in item ? item.close_rate : undefined,
      close_timestamp: 'close_timestamp' in item ? item.close_timestamp : undefined,
      close_date: 'close_date' in item ? item.close_date : undefined,
    })),
    chart.bars,
  );
  const roiRatio = trade ? currentRoiRatio(terminal.config?.minimal_roi, trade.open_timestamp) : null;
  const takeProfit = trade
    ? takeProfitPrice({
        openRate: trade.open_rate,
        isShort: Boolean(trade.is_short),
        leverage: trade.leverage,
        roiRatio: roiRatio ?? 0,
      })
    : null;
  const priceLines: ChartPriceLine[] = trade
    ? [
        {
          price: trade.open_rate,
          title: '',
          color: trade.is_short ? '#ff5d73' : '#3ddc97',
          style: 'dashed',
        },
        { price: trade.stop_loss_abs, title: '止损', color: '#e8b15a', style: 'dashed' },
        ...(takeProfit ? [{ price: takeProfit, title: '止盈', color: '#3ddc97', style: 'dashed' as const }] : []),
        ...(trade.liquidation_price
          ? [{ price: trade.liquidation_price, title: '清算', color: '#ff5d73', style: 'dotted' as const }]
          : []),
      ]
    : [];
  const percent = trade ? (trade.profit_pct ?? (trade.profit_ratio == null ? null : trade.profit_ratio * 100)) : null;
  const digits = trade?.price_precision ?? 4;

  return (
    <section className="flex min-h-[calc(100svh-3.5rem)] flex-col gap-4 p-4 md:p-6">
      <PageHeader title="图表" description={pair ? `${pair} · ${timeframe ?? ''}` : terminal.tradesLoading ? '正在读取持仓…' : '选择一笔持仓'}>
        {terminal.trades.length > 0 ? (
          <Select value={tradeId ?? ''} onValueChange={(value) => navigate(`/chart/${value}`)}>
            <SelectTrigger className="w-64 font-mono" aria-label="选择持仓">
              <SelectValue placeholder="选择持仓" />
            </SelectTrigger>
            <SelectContent>
              {terminal.trades.map((item) => (
                <SelectItem key={item.trade_id} value={String(item.trade_id)}>
                  {item.pair} #{item.trade_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </PageHeader>
      {!pair ? (
        <Card className="grid flex-1 place-items-center">
          <p className="text-sm text-muted-foreground">
            {terminal.tradesLoading ? '正在读取持仓…' : '这个策略还没有持仓或历史成交。'}
            {!terminal.tradesLoading ? (
              <Link to="/positions" className="mx-1 underline">
                查看持仓
              </Link>
            ) : null}
          </p>
        </Card>
      ) : (
        <>
          {trade ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={trade.is_short ? 'destructive' : 'secondary'}>{trade.is_short ? '空' : '多'}</Badge>
              <span className="font-mono text-muted-foreground">#{trade.trade_id}</span>
              <span className={`font-mono ${profitTone(trade.profit_ratio ?? trade.profit_pct)}`}>{formatPercentPoints(percent)}</span>
              <span className="font-mono text-[#e8b15a]">止损 {formatNumber(trade.stop_loss_abs, digits)}</span>
              <span className="font-mono text-[#3ddc97]">
                止盈 {takeProfit != null ? formatNumber(takeProfit, digits) : roiRatio != null ? `${formatRatio(roiRatio)} 无对应价格` : '—'}
              </span>
              <span className="font-mono text-[#ff5d73]">清算 {formatNumber(trade.liquidation_price, digits)}</span>
            </div>
          ) : null}
          <Card className="min-h-[520px] flex-1 overflow-hidden py-0">
            {timeframe ? (
              <CandleChart
                key={`${terminal.bot.id}:${pair}:${timeframe}`}
                pair={pair}
                timeframe={timeframe}
                bars={chart.bars}
                volume={chart.volume}
                markers={markers}
                priceLines={priceLines}
                loading={candleQuery.isLoading}
                error={errorMessage(candleQuery.error)}
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">还没有读到 K 线周期</p>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
