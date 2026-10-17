import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';

import { fetchTradeCustomData, fetchTradeHistory } from '@/api/insights';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/hooks/useBotClient';
import { useTerminal } from '@/hooks/useTerminal';
import { formatChinaTime, formatNumber, formatPercentPoints, formatSignedNumber, parseUtcDate, profitTone, visibleInterval } from '@/lib/format';
import type { ClosedTrade } from '@/types';

const PAGE_SIZE = 20;

function tradeSortTime(trade: ClosedTrade): number {
  if (typeof trade.close_timestamp === 'number') return trade.close_timestamp;
  if (trade.close_date) {
    const parsed = parseUtcDate(trade.close_date);
    if (parsed != null) return parsed;
  }
  return trade.open_timestamp ?? trade.trade_id;
}

function newestFirst(trades: ClosedTrade[]): ClosedTrade[] {
  return [...trades].sort((a, b) => tradeSortTime(b) - tradeSortTime(a) || b.trade_id - a.trade_id);
}

function formatWhen(text?: string, timestamp?: number): string {
  if (typeof timestamp === 'number') return formatChinaTime(timestamp, true);
  if (text) return formatChinaTime(text, true);
  return '—';
}

function TradeDetail({ trade }: { trade: ClosedTrade }) {
  const { client } = useTerminal();
  const customQuery = useQuery({
    queryKey: ['bot', 'custom-data', trade.trade_id],
    queryFn: () => fetchTradeCustomData(client, trade.trade_id),
    retry: 0,
  });
  const orders = trade.orders ?? [];

  return (
    <div className="grid gap-3 bg-muted/30 px-4 py-3">
      <p className="text-xs text-muted-foreground">
        开仓 {formatWhen(undefined, trade.open_timestamp)} · 平仓 {formatWhen(trade.close_date, trade.close_timestamp)} · 入场标签{' '}
        {trade.enter_tag || '—'}
      </p>
      {orders.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>方向</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">价格</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead>标签</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.order_id}>
                <TableCell>{order.ft_order_side}</TableCell>
                <TableCell>{order.status}</TableCell>
                <TableCell className="text-right font-mono">{formatNumber(order.safe_price, trade.price_precision ?? 6)}</TableCell>
                <TableCell className="text-right font-mono">{formatNumber(order.filled ?? order.amount, 4)}</TableCell>
                <TableCell className="font-mono">{order.ft_order_tag || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">这笔仓位没有订单明细</p>
      )}
      {customQuery.data && customQuery.data.custom_data.length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {customQuery.data.custom_data.map((entry) => (
            <li key={entry.key} className="font-mono">
              <span className="text-muted-foreground">{entry.key}</span> {JSON.stringify(entry.value)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function HistoryPage() {
  const { client, bot } = useTerminal();
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const historyQuery = useQuery({
    queryKey: ['bot', bot.id, 'trades', page],
    queryFn: async () => {
      const head = await fetchTradeHistory(client, PAGE_SIZE, 0);
      const total = head.total_trades;
      const start = Math.max(0, total - (page + 1) * PAGE_SIZE);
      const end = Math.max(start, total - page * PAGE_SIZE);
      if (end === start) return { ...head, total_trades: total, trades: [] };
      const slice =
        start === 0 && end <= head.trades.length
          ? head.trades.slice(start, end)
          : (await fetchTradeHistory(client, end - start, start)).trades;
      return { ...head, total_trades: total, trades: newestFirst(slice) };
    },
    refetchInterval: visibleInterval(30_000),
  });
  const total = historyQuery.data?.total_trades ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader title="历史" />
      {historyQuery.isLoading ? <Skeleton className="h-40" /> : null}
      {historyQuery.error ? <p className="text-sm text-destructive">{errorMessage(historyQuery.error)}</p> : null}
      {historyQuery.data ? (
        <Card>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>交易对</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead className="text-right">开仓价</TableHead>
                  <TableHead className="text-right">平仓价</TableHead>
                  <TableHead className="text-right">盈亏</TableHead>
                  <TableHead>平仓原因</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyQuery.data.trades.map((trade) => {
                  const percent = trade.profit_pct ?? (trade.profit_ratio == null ? null : trade.profit_ratio * 100);
                  const open = openId === trade.trade_id;
                  return (
                    <Fragment key={trade.trade_id}>
                      <TableRow className="cursor-pointer" onClick={() => setOpenId(open ? null : trade.trade_id)}>
                        <TableCell className="font-mono">
                          {trade.pair} <span className="text-muted-foreground">#{trade.trade_id}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={trade.is_short ? 'destructive' : 'secondary'}>{trade.is_short ? '空' : '多'}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatNumber(trade.open_rate, trade.price_precision ?? 6)}</TableCell>
                        <TableCell className="text-right font-mono">{formatNumber(trade.close_rate, trade.price_precision ?? 6)}</TableCell>
                        <TableCell className={`text-right font-mono ${profitTone(trade.profit_ratio ?? trade.profit_pct)}`}>
                          {formatSignedNumber(trade.profit_abs, 4)} {formatPercentPoints(percent)}
                        </TableCell>
                        <TableCell>{trade.exit_reason || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{formatWhen(trade.close_date, trade.close_timestamp)}</TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <TradeDetail trade={trade} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-end gap-2 px-4 py-3">
              <span className="text-sm text-muted-foreground">
                {page + 1} / {pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>
                下一页
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
