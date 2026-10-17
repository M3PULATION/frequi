import { useNavigate } from 'react-router';

import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTerminal } from '@/hooks/useTerminal';
import { formatNumber, formatPercentPoints, formatSignedNumber, profitTone } from '@/lib/format';

export function PositionsPage() {
  const terminal = useTerminal();
  const navigate = useNavigate();
  const stake = terminal.config?.stake_currency ?? '';

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader title="持仓" description="当前未平仓位。点一行进入这单的 K 线。">
        <Badge variant="secondary">{terminal.trades.length} 笔</Badge>
      </PageHeader>
      <Card>
        <CardContent className="px-0">
          {terminal.tradesError ? <p className="px-4 py-8 text-sm text-destructive">{terminal.tradesError}</p> : null}
          {terminal.tradesLoading ? (
            <div className="space-y-2 px-4 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : null}
          {!terminal.tradesLoading && !terminal.tradesError && terminal.trades.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">没有持仓</p>
          ) : null}
          {terminal.trades.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>交易对</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">开仓价</TableHead>
                  <TableHead className="text-right">现价</TableHead>
                  <TableHead className="text-right">盈亏 {stake}</TableHead>
                  <TableHead className="text-right">止损</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terminal.trades.map((trade) => {
                  const percent = trade.profit_pct ?? (trade.profit_ratio == null ? null : trade.profit_ratio * 100);
                  const side = trade.is_short ? '空' : '多';
                  const leverage = trade.leverage && trade.leverage > 1 ? ` ${formatNumber(trade.leverage, 2)}x` : '';
                  return (
                    <TableRow
                      key={trade.trade_id}
                      data-testid="position-row"
                      className="cursor-pointer"
                      onClick={() => navigate(`/chart/${trade.trade_id}`)}
                    >
                      <TableCell className="font-mono">{trade.pair}</TableCell>
                      <TableCell>
                        <Badge variant={trade.is_short ? 'destructive' : 'secondary'}>
                          {side}
                          {leverage}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(trade.amount, trade.amount_precision ?? 4)}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(trade.open_rate, trade.price_precision ?? 4)}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(trade.current_rate, trade.price_precision ?? 4)}</TableCell>
                      <TableCell className={`text-right font-mono ${profitTone(trade.profit_ratio ?? trade.profit_pct)}`}>
                        {formatSignedNumber(trade.profit_abs, 4)} {formatPercentPoints(percent)}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(trade.stop_loss_abs, trade.price_precision ?? 4)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
