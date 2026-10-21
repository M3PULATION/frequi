import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { fetchBalance } from '@/api/bot';
import { fetchHistoricBalance } from '@/api/insights';
import { BalanceLineChart } from '@/components/BalanceLineChart';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/hooks/useBotClient';
import { useTerminal } from '@/hooks/useTerminal';
import { ARCHIVE_STALE_MS, LIVE_POLL_MS, formatNumber, formatPlainRatio, visibleInterval } from '@/lib/format';
import { balancePoints } from '@/lib/wallet';

export function BalancePage() {
  const { client, bot } = useTerminal();
  const balanceQuery = useQuery({
    queryKey: ['bot', bot.id, 'balance'],
    queryFn: () => fetchBalance(client),
    staleTime: LIVE_POLL_MS,
    refetchInterval: visibleInterval(LIVE_POLL_MS),
  });
  const historyQuery = useQuery({
    queryKey: ['bot', bot.id, 'historic-balance'],
    queryFn: () => fetchHistoricBalance(client),
    retry: 0,
    staleTime: ARCHIVE_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const balance = balanceQuery.data;
  const balanceLoading = balanceQuery.isLoading;
  const balanceError = errorMessage(balanceQuery.error);
  const points = useMemo(() => (historyQuery.data ? balancePoints(historyQuery.data) : []), [historyQuery.data]);
  const currencies = (balance?.currencies ?? []).filter((row) => row.is_bot_managed || row.is_position || row.balance !== 0);

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader title="余额" />
      {balanceError ? <p className="text-sm text-destructive">{balanceError}</p> : null}
      {balanceLoading ? <Skeleton className="h-28" /> : null}
      {balance ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">机器人</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-2xl">
              {formatNumber(balance.total_bot ?? balance.total, 4)} {balance.stake}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">账户</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-2xl">
              {formatNumber(balance.total, 4)} {balance.stake}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">相对起始资金</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-2xl">{formatPlainRatio(balance.starting_capital_pct / 100)}</CardContent>
          </Card>
        </div>
      ) : null}
      {currencies.length > 0 ? (
        <Card>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>资产</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">可用</TableHead>
                  <TableHead className="text-right">折合</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currencies.map((row) => (
                  <TableRow key={`${row.currency}-${row.side}-${row.is_position}`}>
                    <TableCell className="font-mono">{row.currency}</TableCell>
                    <TableCell>{row.is_position ? row.side : '余额'}</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(row.is_position ? row.position : row.balance, 4)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(row.free, 4)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(row.est_stake, 4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">余额曲线</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? <Skeleton className="h-72" /> : null}
          {historyQuery.error ? <p className="text-sm text-destructive">{errorMessage(historyQuery.error)}</p> : null}
          {historyQuery.data ? <BalanceLineChart points={points} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}
