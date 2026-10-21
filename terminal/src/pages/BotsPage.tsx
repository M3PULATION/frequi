import { useQueries } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { fetchBalance, fetchConfig, fetchProfit } from '@/api/bot';
import { createApiClient } from '@/api/client';
import { fetchHistoricBalance } from '@/api/insights';
import { fetchOpenTrades } from '@/api/trades';
import { CompareLineChart } from '@/components/CompareLineChart';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useListedBots, type ListedBot } from '@/hooks/useListedBots';
import { ARCHIVE_STALE_MS, OVERVIEW_POLL_MS, formatNumber, formatPercentPoints, formatPlainRatio, formatSignedNumber, profitTone, visibleInterval } from '@/lib/format';
import { overviewFromSnapshot, type BotOverview } from '@/lib/overview';
import { cn } from '@/lib/utils';
import { balancePoints, indexedReturn } from '@/lib/wallet';

const COLORS = ['#97fce4', '#3fd68b', '#ffd25f', '#ff5470', '#7eb6ff', '#50d2c1'];

function clientFor(botId: string) {
  return createApiClient({ getBotId: () => botId });
}

function polled<T>(bots: ListedBot[], name: string, load: (botId: string) => Promise<T>) {
  return bots.map((bot) => ({
    queryKey: ['bot', bot.id, name] as const,
    queryFn: () => load(bot.id),
    enabled: bot.online,
    staleTime: OVERVIEW_POLL_MS,
    refetchInterval: visibleInterval(OVERVIEW_POLL_MS),
  }));
}

function money(value: number | null, stake: string | null, digits = 2): string {
  if (value == null) return '—';
  return `${formatSignedNumber(value, digits)} ${stake ?? ''}`.trim();
}

function equity(value: number | null, stake: string | null): string {
  if (value == null) return '—';
  return `${formatNumber(value, 2)} ${stake ?? ''}`.trim();
}

function stateLabel(bot: BotOverview): string {
  if (!bot.online) return '离线';
  if (bot.state === 'running') return '运行中';
  if (bot.state === 'stopped') return '已停止';
  if (bot.state === 'paused') return '已暂停';
  return bot.state || '在线';
}

function modeLabel(mode: string | null): string | null {
  if (mode === 'futures') return '合约';
  if (mode === 'spot') return '现货';
  if (mode === 'margin') return '杠杆';
  return mode;
}

function identity(bot: BotOverview): string {
  return [bot.strategy, bot.timeframe, modeLabel(bot.tradingMode)].filter(Boolean).join(' · ');
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate font-mono text-sm', tone)}>{value}</dd>
    </div>
  );
}

function BotCard({ bot, loading }: { bot: BotOverview; loading: boolean }) {
  const positions = bot.openCount == null ? '—' : bot.maxOpen == null ? String(bot.openCount) : `${bot.openCount} / ${bot.maxOpen}`;
  return (
    <Card data-testid="bot-overview" size="sm">
      <CardHeader>
        <CardTitle>{bot.name}</CardTitle>
        <CardDescription>{identity(bot) || '还没有读到策略'}</CardDescription>
        <CardAction>
          <Badge variant={bot.online && bot.state !== 'stopped' ? 'secondary' : 'outline'}>{stateLabel(bot)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-16" /> : null}
        {!loading && !bot.online ? <p className="text-sm text-muted-foreground">离线，没有账户数据</p> : null}
        {!loading && bot.online ? (
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
            <Fact label="权益" value={equity(bot.equity, bot.stake)} />
            <Fact label="已平仓" value={money(bot.closedProfit, bot.stake)} tone={profitTone(bot.closedProfit)} />
            <Fact label="未平仓" value={money(bot.openProfit, bot.stake)} tone={profitTone(bot.openProfit)} />
            <Fact label="持仓" value={positions} />
            <Fact
              label="胜率"
              value={bot.wins == null || bot.losses == null || bot.wins + bot.losses === 0 ? '—' : formatPlainRatio(bot.wins / (bot.wins + bot.losses))}
            />
            <Fact label="回撤" value={formatPlainRatio(bot.drawdown)} tone={bot.drawdown ? 'text-down' : undefined} />
          </dl>
        ) : null}
        {bot.dryRun ? <p className="mt-2 text-xs text-muted-foreground">模拟盘</p> : null}
      </CardContent>
    </Card>
  );
}

export function BotsPage() {
  const catalog = useListedBots();
  const bots = catalog.data ?? [];
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const histories = useQueries({
    queries: bots.map((bot) => ({
      queryKey: ['bot', bot.id, 'historic-balance'] as const,
      queryFn: () => fetchHistoricBalance(clientFor(bot.id)),
      enabled: bot.online,
      staleTime: ARCHIVE_STALE_MS,
      refetchOnWindowFocus: false,
    })),
  });
  const configs = useQueries({ queries: polled(bots, 'config', (id) => fetchConfig(clientFor(id))) });
  const profits = useQueries({ queries: polled(bots, 'profit', (id) => fetchProfit(clientFor(id))) });
  const balances = useQueries({ queries: polled(bots, 'balance', (id) => fetchBalance(clientFor(id))) });
  const openTrades = useQueries({ queries: polled(bots, 'status', (id) => fetchOpenTrades(clientFor(id))) });

  const updated = [
    histories.map((query) => query.dataUpdatedAt).join(','),
    configs.map((query) => query.dataUpdatedAt).join(','),
    profits.map((query) => query.dataUpdatedAt).join(','),
    balances.map((query) => query.dataUpdatedAt).join(','),
    openTrades.map((query) => query.dataUpdatedAt).join(','),
  ].join(':');
  const overviews = useMemo(
    () =>
      bots.map((bot, index) =>
        overviewFromSnapshot(bot, {
          config: configs[index]?.data ?? null,
          profit: profits[index]?.data ?? null,
          balance: balances[index]?.data ?? null,
          trades: openTrades[index]?.data ?? null,
        }),
      ),
    [bots, updated],
  );
  const onlineCount = bots.filter((bot) => bot.online).length;
  const series = useMemo(
    () =>
      bots.map((bot, index) => {
        const history = histories[index]?.data;
        const points = history ? indexedReturn(balancePoints(history)) : [];
        return {
          id: bot.id,
          name: bot.name,
          color: COLORS[index % COLORS.length] ?? '#d4d4d4',
          online: bot.online,
          points,
          latest: points.at(-1)?.value ?? null,
        };
      }),
    [bots, updated],
  );

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader title="实盘">
        {bots.length > 0 ? <Badge variant="secondary">{onlineCount} / {bots.length} 在线</Badge> : null}
      </PageHeader>
      {catalog.isLoading ? <Skeleton className="h-96" /> : null}
      {catalog.error ? <p className="text-sm text-destructive">无法读取实盘列表</p> : null}
      {catalog.data && catalog.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有配置实盘。请在 terminal/bots.local.json 里添加。</p>
      ) : null}
      {overviews.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {overviews.map((bot, index) => (
            <BotCard
              key={bot.id}
              bot={bot}
              loading={Boolean(
                bots[index]?.online &&
                  (configs[index]?.isLoading || profits[index]?.isLoading || balances[index]?.isLoading || openTrades[index]?.isLoading),
              )}
            />
          ))}
        </div>
      ) : null}
      {bots.length > 0 ? (
        <Card>
          <CardContent className="pt-4">
            <div className="mb-3 grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-4">
              {series.map((item) => {
                const isHidden = hidden.has(item.id);
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={!isHidden}
                    disabled={!item.online}
                    onClick={() =>
                      setHidden((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })
                    }
                    className={cn('h-8 w-full justify-start px-2 font-normal', isHidden ? 'opacity-40' : 'bg-muted/40')}
                  >
                    <span
                      className="h-0.5 w-3.5 shrink-0 rounded-full"
                      style={
                        isHidden
                          ? { boxShadow: `inset 0 0 0 1.5px ${item.color}` }
                          : { backgroundColor: item.color }
                      }
                    />
                    <span className={cn('min-w-0 flex-1 truncate text-left', isHidden && 'line-through')}>{item.name}</span>
                    <span className={cn('font-mono text-xs', item.latest == null ? 'text-muted-foreground' : profitTone(item.latest))}>
                      {item.online ? formatPercentPoints(item.latest) : '离线'}
                    </span>
                  </Button>
                );
              })}
            </div>
            {histories.some((query) => query.isLoading) ? <Skeleton className="mb-3 h-4 w-32" /> : null}
            {series.some((item) => !hidden.has(item.id)) ? (
              <CompareLineChart series={series.filter((item) => !hidden.has(item.id))} />
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">曲线都已隐藏，点上面的名字可以重新显示</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
