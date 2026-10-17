import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { fetchAllTrades, fetchEntryStats, fetchExitStats, fetchHistoricBalance, fetchMixTagStats, fetchPerformance, fetchProfitAll, fetchTimeSummary } from '@/api/insights';
import { MetricList, type MetricItem } from '@/components/MetricList';
import { PageHeader } from '@/components/PageHeader';
import { ProfitHeatmap } from '@/components/ProfitHeatmap';
import { StatsTable } from '@/components/StatsTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/hooks/useBotClient';
import { useTerminal } from '@/hooks/useTerminal';
import { formatChinaTime, formatDurationSeconds, formatHold, formatNumber, formatPlainRatio, formatRatio, formatSignedNumber, profitTone, visibleInterval } from '@/lib/format';
import { dailyRisk, equityRisk, recoveryFactor, tradeRisk } from '@/lib/risk';
import { balancePoints } from '@/lib/wallet';
import type { ProfitStats } from '@/types';

const periods = [
  { id: 'daily', label: '按日', timescale: 30 },
  { id: 'weekly', label: '按周', timescale: 12 },
  { id: 'monthly', label: '按月', timescale: 12 },
] as const;

function money(value: number | null | undefined, stake: string, digits = 4): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${formatSignedNumber(value, digits)} ${stake}`.trim();
}

function plain(value: number | null | undefined, digits = 2): string {
  return formatNumber(value, digits);
}

function span(start?: string, end?: string): string {
  if (!start && !end) return '—';
  return `${formatChinaTime(start, true)} → ${formatChinaTime(end, true)}`;
}

function sideRow(label: string, item: ProfitStats | undefined, stake: string) {
  if (!item) return null;
  return { label, item, stake };
}

export function ProfitPage() {
  const { profit, profitLoading, profitError, config, client, bot } = useTerminal();
  const [period, setPeriod] = useState<(typeof periods)[number]['id']>('daily');
  const selected = periods.find((item) => item.id === period) ?? periods[0];
  const profitAllQuery = useQuery({
    queryKey: ['bot', bot.id, 'profit-all'],
    queryFn: () => fetchProfitAll(client),
    retry: 0,
    refetchInterval: visibleInterval(30_000),
  });
  const summaryQuery = useQuery({
    queryKey: ['bot', bot.id, 'summary', period],
    queryFn: () => fetchTimeSummary(client, period, selected.timescale),
    refetchInterval: visibleInterval(30_000),
  });
  const performanceQuery = useQuery({
    queryKey: ['bot', bot.id, 'performance'],
    queryFn: () => fetchPerformance(client),
    refetchInterval: visibleInterval(30_000),
  });
  const entriesQuery = useQuery({
    queryKey: ['bot', bot.id, 'entries'],
    queryFn: () => fetchEntryStats(client),
    retry: 0,
    refetchInterval: visibleInterval(30_000),
  });
  const exitsQuery = useQuery({
    queryKey: ['bot', bot.id, 'exits'],
    queryFn: () => fetchExitStats(client),
    retry: 0,
    refetchInterval: visibleInterval(30_000),
  });
  const mixQuery = useQuery({
    queryKey: ['bot', bot.id, 'mix-tags'],
    queryFn: () => fetchMixTagStats(client),
    retry: 0,
    refetchInterval: visibleInterval(30_000),
  });
  const dailyQuery = useQuery({
    queryKey: ['bot', bot.id, 'summary', 'daily', 365],
    queryFn: () => fetchTimeSummary(client, 'daily', 365),
    refetchInterval: visibleInterval(30_000),
  });
  const historyQuery = useQuery({
    queryKey: ['bot', bot.id, 'all-trades'],
    queryFn: () => fetchAllTrades(client),
    refetchInterval: visibleInterval(30_000),
  });
  const walletQuery = useQuery({
    queryKey: ['bot', bot.id, 'historic-balance'],
    queryFn: () => fetchHistoricBalance(client),
    refetchInterval: visibleInterval(30_000),
  });
  const stake = config?.stake_currency ?? '';
  const derived = useMemo(() => {
    const daily = dailyQuery.data ? dailyRisk(dailyQuery.data.data, profit?.bot_start_date) : null;
    const trades = historyQuery.data ? tradeRisk(historyQuery.data) : null;
    const equity = walletQuery.data ? equityRisk(balancePoints(walletQuery.data).map((point) => point.value)) : null;
    return { daily, trades, equity };
  }, [dailyQuery.data, historyQuery.data, profit?.bot_start_date, walletQuery.data]);
  const profitItems: MetricItem[] = profit
    ? [
        { label: '全部盈亏', value: money(profit.profit_all_coin, stake), hint: formatRatio(profit.profit_all_ratio), tone: profitTone(profit.profit_all_ratio) },
        { label: '已平仓', value: money(profit.profit_closed_coin, stake), hint: formatRatio(profit.profit_closed_ratio), tone: profitTone(profit.profit_closed_ratio) },
        { label: '未平仓', value: money(profit.profit_all_coin - profit.profit_closed_coin, stake), tone: profitTone(profit.profit_all_coin - profit.profit_closed_coin) },
        { label: '单笔平均', value: formatRatio(profit.profit_closed_ratio_mean), hint: `含未平 ${formatRatio(profit.profit_all_ratio_mean)}` },
        { label: '胜率', value: formatPlainRatio(profit.winrate), hint: `${profit.winning_trades} 胜 / ${profit.losing_trades} 负` },
        { label: '笔数', value: String(profit.closed_trade_count), hint: `含未平 ${profit.trade_count}` },
        { label: '成交额', value: profit.trading_volume == null ? '—' : `${formatNumber(profit.trading_volume, 2)} ${stake}`.trim() },
        { label: '最佳交易对', value: profit.best_pair || '—', hint: `${formatRatio(profit.best_pair_profit_ratio)} · ${money(profit.best_pair_profit_abs, stake)}` },
        { label: '平均持仓', value: derived.trades ? formatDurationSeconds(derived.trades.avgDurationSeconds) : formatHold(profit.avg_duration) },
        { label: '启动', value: formatChinaTime(profit.bot_start_date, true) },
        { label: '首笔', value: formatChinaTime(profit.first_trade_date, true) },
        { label: '最近一笔', value: formatChinaTime(profit.latest_trade_date, true) },
      ]
    : [];
  const riskItems: MetricItem[] = profit
    ? [
        { label: '夏普', value: plain(profit.sharpe), tone: profitTone(profit.sharpe) },
        { label: '索提诺', value: plain(profit.sortino), tone: profitTone(profit.sortino) },
        { label: '卡玛', value: plain(profit.calmar), tone: profitTone(profit.calmar) },
        { label: '年化', value: formatRatio(profit.cagr), tone: profitTone(profit.cagr) },
        { label: '系统质量数', value: plain(profit.sqn), tone: profitTone(profit.sqn) },
        { label: '盈利因子', value: plain(profit.profit_factor), tone: profitTone((profit.profit_factor ?? 0) - 1) },
        { label: '期望值', value: money(profit.expectancy, stake), tone: profitTone(profit.expectancy) },
        { label: '期望比率', value: plain(profit.expectancy_ratio) },
        { label: '恢复因子', value: plain(recoveryFactor(profit.profit_closed_coin, profit.max_drawdown_abs)), tone: profitTone(recoveryFactor(profit.profit_closed_coin, profit.max_drawdown_abs)) },
      ]
    : [];
  const drawdownItems: MetricItem[] = profit
    ? [
        { label: '最大回撤', value: formatPlainRatio(profit.max_drawdown), hint: money(profit.max_drawdown_abs == null ? null : -profit.max_drawdown_abs, stake), tone: profitTone(profit.max_drawdown == null ? null : -profit.max_drawdown) },
        { label: '最大回撤区间', value: span(profit.max_drawdown_start, profit.max_drawdown_end) },
        { label: '当前回撤', value: formatPlainRatio(profit.current_drawdown), hint: money(profit.current_drawdown_abs == null ? null : -profit.current_drawdown_abs, stake), tone: profitTone(profit.current_drawdown == null ? null : -profit.current_drawdown) },
        { label: '回撤前高点', value: money(profit.current_drawdown_high, stake) },
        { label: '当前回撤开始', value: formatChinaTime(profit.current_drawdown_start, true) },
      ]
    : [];
  const curveItems: MetricItem[] = derived.daily
    ? [
        { label: '统计天数', value: String(derived.daily.days), hint: `${derived.daily.upDays} 盈 / ${derived.daily.downDays} 亏 / ${derived.daily.flatDays} 平` },
        { label: '日均收益', value: formatRatio(derived.daily.meanDaily), tone: profitTone(derived.daily.meanDaily) },
        { label: '最好一天', value: formatRatio(derived.daily.bestDay), tone: profitTone(derived.daily.bestDay) },
        { label: '最差一天', value: formatRatio(derived.daily.worstDay), tone: profitTone(derived.daily.worstDay) },
        { label: '日波动', value: formatPlainRatio(derived.daily.dailyVol) },
        { label: '年化波动', value: formatPlainRatio(derived.daily.annualVol) },
        { label: '下行偏差', value: formatPlainRatio(derived.daily.downsideDev) },
        { label: '年化下行偏差', value: formatPlainRatio(derived.daily.annualDownside) },
        { label: '净值最大回撤', value: formatPlainRatio(derived.equity?.maxDrawdown), tone: profitTone(derived.equity?.maxDrawdown == null ? null : -derived.equity.maxDrawdown) },
        { label: '溃疡指数', value: formatPlainRatio(derived.equity?.ulcer) },
        { label: '净值恢复因子', value: plain(derived.equity?.recovery), tone: profitTone(derived.equity?.recovery) },
      ]
    : [];
  const tradeItems: MetricItem[] = derived.trades
    ? [
        { label: '计入笔数', value: String(derived.trades.closedCount) },
        { label: '中位收益率', value: formatRatio(derived.trades.medianProfitRatio), tone: profitTone(derived.trades.medianProfitRatio) },
        { label: '平均盈利', value: formatRatio(derived.trades.avgWinRatio), tone: 'text-up' },
        { label: '平均亏损', value: formatRatio(derived.trades.avgLossRatio), tone: 'text-down' },
        { label: '最好一笔', value: formatRatio(derived.trades.bestRatio), tone: profitTone(derived.trades.bestRatio) },
        { label: '最差一笔', value: formatRatio(derived.trades.worstRatio), tone: profitTone(derived.trades.worstRatio) },
        { label: '最长连胜', value: String(derived.trades.maxWinStreak) },
        { label: '最长连亏', value: String(derived.trades.maxLossStreak) },
        { label: '毛利', value: money(derived.trades.grossProfit, stake), tone: 'text-up' },
        { label: '毛亏', value: money(-derived.trades.grossLoss, stake), tone: 'text-down' },
        { label: '手续费', value: money(-derived.trades.fees, stake) },
        { label: '资金费', value: money(derived.trades.funding, stake), tone: profitTone(derived.trades.funding) },
        { label: '入场滑点', value: formatRatio(derived.trades.avgEntrySlippage), tone: profitTone(derived.trades.avgEntrySlippage == null ? null : -derived.trades.avgEntrySlippage) },
        { label: '出场滑点', value: formatRatio(derived.trades.avgExitSlippage), tone: profitTone(derived.trades.avgExitSlippage == null ? null : -derived.trades.avgExitSlippage) },
        { label: '不利偏移', value: formatPlainRatio(derived.trades.avgAdverse) },
        { label: '有利偏移', value: formatPlainRatio(derived.trades.avgFavorable) },
      ]
    : [];
  const sides = [
    sideRow('全部', profitAllQuery.data?.all, stake),
    sideRow('多单', profitAllQuery.data?.long, stake),
    sideRow('空单', profitAllQuery.data?.short, stake),
  ].filter((row): row is NonNullable<typeof row> => row != null);

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader title="盈亏" />
      {profitError ? <p className="text-sm text-destructive">{profitError}</p> : null}
      {profitLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : null}
      {profitItems.length > 0 ? <MetricList title="收益" items={profitItems} /> : null}
      {riskItems.length > 0 ? (
        <MetricList title="风险" items={riskItems} />
      ) : null}
      {drawdownItems.length > 0 ? <MetricList title="回撤" items={drawdownItems} /> : null}
      {profitAllQuery.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">多空</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>方向</TableHead>
                  <TableHead className="text-right">盈亏</TableHead>
                  <TableHead className="text-right">胜率</TableHead>
                  <TableHead className="text-right">夏普</TableHead>
                  <TableHead className="text-right">索提诺</TableHead>
                  <TableHead className="text-right">卡玛</TableHead>
                  <TableHead className="text-right">年化</TableHead>
                  <TableHead className="text-right">盈利因子</TableHead>
                  <TableHead className="text-right">期望</TableHead>
                  <TableHead className="text-right">质量数</TableHead>
                  <TableHead className="text-right">最大回撤</TableHead>
                  <TableHead className="text-right">笔数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sides.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className={`text-right font-mono ${profitTone(row.item.profit_all_ratio)}`}>
                      {money(row.item.profit_all_coin, stake)}
                      <span className="ml-2 text-xs text-muted-foreground">{formatRatio(row.item.profit_all_ratio)}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatPlainRatio(row.item.winrate)}</TableCell>
                    <TableCell className={`text-right font-mono ${profitTone(row.item.sharpe)}`}>{plain(row.item.sharpe)}</TableCell>
                    <TableCell className={`text-right font-mono ${profitTone(row.item.sortino)}`}>{plain(row.item.sortino)}</TableCell>
                    <TableCell className={`text-right font-mono ${profitTone(row.item.calmar)}`}>{plain(row.item.calmar)}</TableCell>
                    <TableCell className={`text-right font-mono ${profitTone(row.item.cagr)}`}>{formatRatio(row.item.cagr)}</TableCell>
                    <TableCell className="text-right font-mono">{plain(row.item.profit_factor)}</TableCell>
                    <TableCell className={`text-right font-mono ${profitTone(row.item.expectancy)}`}>{plain(row.item.expectancy, 4)}</TableCell>
                    <TableCell className={`text-right font-mono ${profitTone(row.item.sqn)}`}>{plain(row.item.sqn)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPlainRatio(row.item.max_drawdown)}</TableCell>
                    <TableCell className="text-right font-mono">{row.item.closed_trade_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
      {dailyQuery.isLoading || historyQuery.isLoading || walletQuery.isLoading ? <Skeleton className="h-40" /> : null}
      {dailyQuery.error || historyQuery.error || walletQuery.error ? (
        <p className="text-sm text-destructive">{errorMessage(dailyQuery.error ?? historyQuery.error ?? walletQuery.error)}</p>
      ) : null}
      {curveItems.length > 0 ? (
        <MetricList title="日收益与净值" items={curveItems} />
      ) : null}
      {tradeItems.length > 0 ? (
        <MetricList title="已平仓成交" items={tradeItems} />
      ) : null}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">分期盈亏</CardTitle>
          <div className="flex gap-2">
            {periods.map((item) => (
              <Button key={item.id} size="sm" variant={period === item.id ? 'default' : 'outline'} onClick={() => setPeriod(item.id)}>
                {item.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {summaryQuery.isLoading ? <Skeleton className="mx-4 h-24" /> : null}
          {summaryQuery.error ? <p className="px-4 text-sm text-destructive">{errorMessage(summaryQuery.error)}</p> : null}
          {summaryQuery.data ? <ProfitHeatmap rows={summaryQuery.data.data} daily={period === 'daily'} /> : null}
        </CardContent>
      </Card>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">按交易对</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {performanceQuery.isLoading ? <Skeleton className="mx-4 h-16" /> : null}
            {performanceQuery.error ? <p className="px-4 text-sm text-destructive">{errorMessage(performanceQuery.error)}</p> : null}
            {performanceQuery.data ? <StatsTable rows={performanceQuery.data.map((row) => ({ ...row, name: row.pair }))} label="交易对" /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">入场标签</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {entriesQuery.isLoading ? <Skeleton className="mx-4 h-16" /> : null}
            {entriesQuery.error ? <p className="px-4 text-sm text-destructive">{errorMessage(entriesQuery.error)}</p> : null}
            {entriesQuery.data ? <StatsTable rows={entriesQuery.data.map((row) => ({ ...row, name: row.enter_tag }))} label="标签" /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">出场原因</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {exitsQuery.isLoading ? <Skeleton className="mx-4 h-16" /> : null}
            {exitsQuery.error ? <p className="px-4 text-sm text-destructive">{errorMessage(exitsQuery.error)}</p> : null}
            {exitsQuery.data ? <StatsTable rows={exitsQuery.data.map((row) => ({ ...row, name: row.exit_reason }))} label="原因" /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">组合标签</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {mixQuery.isLoading ? <Skeleton className="mx-4 h-16" /> : null}
            {mixQuery.error ? <p className="px-4 text-sm text-destructive">{errorMessage(mixQuery.error)}</p> : null}
            {mixQuery.data ? <StatsTable rows={mixQuery.data.map((row) => ({ ...row, name: row.mix_tag }))} label="组合" /> : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
