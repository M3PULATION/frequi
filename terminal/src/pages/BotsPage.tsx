import { useQueries } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { createApiClient } from '@/api/client';
import { fetchHistoricBalance } from '@/api/insights';
import { CompareLineChart } from '@/components/CompareLineChart';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useListedBots } from '@/hooks/useListedBots';
import { formatPercentPoints, profitTone } from '@/lib/format';
import { balancePoints, indexedReturn } from '@/lib/wallet';

const COLORS = ['#5b8def', '#3ddc97', '#e8b15a', '#ff5d73', '#c084fc', '#22d3ee'];

export function BotsPage() {
  const catalog = useListedBots();
  const bots = catalog.data ?? [];
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const histories = useQueries({
    queries: bots.map((bot) => ({
      queryKey: ['overview-balance', bot.id],
      queryFn: () => fetchHistoricBalance(createApiClient({ getBotId: () => bot.id })),
      enabled: bot.online,
      staleTime: 60_000,
    })),
  });

  const updated = histories.map((query) => query.dataUpdatedAt).join(',');
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
      <PageHeader title="实盘" description="各策略自有记录以来的资金变化，起点都记为 0%。切换实盘在顶栏。" />
      {catalog.isLoading ? <Skeleton className="h-96" /> : null}
      {catalog.error ? <p className="text-sm text-destructive">无法读取实盘列表</p> : null}
      {catalog.data && catalog.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有配置实盘。请在 terminal/bots.local.json 里添加。</p>
      ) : null}
      {bots.length > 0 ? (
        <Card>
          <CardContent className="pt-4">
            <div className="mb-4 flex flex-wrap gap-2">
              {series.map((item) => {
                const isHidden = hidden.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
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
                    className={
                      isHidden
                        ? 'inline-flex items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground'
                        : 'inline-flex items-center gap-2 rounded-md border bg-muted/50 px-2.5 py-1.5 text-sm'
                    }
                  >
                    <span
                      className="size-2.5 rounded-sm"
                      style={
                        isHidden
                          ? { boxShadow: `inset 0 0 0 1.5px ${item.color}` }
                          : { backgroundColor: item.color }
                      }
                    />
                    <span className={isHidden ? 'line-through' : undefined}>{item.name}</span>
                    <span className={item.latest == null ? 'text-muted-foreground' : profitTone(item.latest)}>
                      {item.online ? formatPercentPoints(item.latest) : '离线'}
                    </span>
                  </button>
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
