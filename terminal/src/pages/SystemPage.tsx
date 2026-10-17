import { useQuery } from '@tanstack/react-query';

import { fetchPlotConfig, fetchSysInfo } from '@/api/insights';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/hooks/useBotClient';
import { useTerminal } from '@/hooks/useTerminal';
import { formatNumber, formatRatio, visibleInterval } from '@/lib/format';

export function SystemPage() {
  const { client, bot, config } = useTerminal();
  const sysQuery = useQuery({
    queryKey: ['bot', bot.id, 'sysinfo'],
    queryFn: () => fetchSysInfo(client),
    refetchInterval: visibleInterval(15_000),
  });
  const plotQuery = useQuery({
    queryKey: ['bot', bot.id, 'plot-config'],
    queryFn: () => fetchPlotConfig(client),
    retry: 0,
  });
  const rows = config
    ? [
        ['版本', config.version],
        ['API', String(config.api_version)],
        ['模式', `${config.runmode} / ${config.dry_run ? '模拟' : '实盘'}`],
        ['交易', [config.trading_mode, config.margin_mode].filter(Boolean).join(' · ')],
        ['交易所', config.exchange],
        ['策略', config.strategy],
        ['周期', config.timeframe],
        ['计价', config.stake_currency],
        ['止损', formatRatio(config.stoploss)],
        ['最大持仓', String(config.max_open_trades)],
        ['允许做空', config.short_allowed ? '是' : '否'],
        ['允许强开', config.force_entry_enable ? '是' : '否'],
      ]
    : [];
  const mainIndicators = Object.keys(plotQuery.data?.main_plot ?? {});
  const subplots = Object.keys(plotQuery.data?.subplots ?? {});

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader title="系统" />
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">配置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-mono text-sm">{value || '—'}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">资源</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {sysQuery.isLoading ? <Skeleton className="h-16" /> : null}
            {sysQuery.error ? <p className="text-sm text-destructive">{errorMessage(sysQuery.error)}</p> : null}
            {sysQuery.data ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">内存</p>
                  <p className="font-mono text-2xl">{formatNumber(sysQuery.data.ram_pct, 1)}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">CPU</p>
                  <p className="font-mono text-sm">{sysQuery.data.cpu_pct.map((value) => `${formatNumber(value, 1)}%`).join('  ')}</p>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">指标配置</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {plotQuery.isLoading ? <Skeleton className="h-16" /> : null}
          {plotQuery.error ? <p className="text-sm text-destructive">{errorMessage(plotQuery.error)}</p> : null}
          {plotQuery.data ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground">主图</p>
                <p className="font-mono text-sm">{mainIndicators.join('、') || '无'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">副图</p>
                <p className="font-mono text-sm">{subplots.join('、') || '无'}</p>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
