import { useQuery } from '@tanstack/react-query';

import { fetchBlacklist, fetchLocks, fetchWhitelist } from '@/api/insights';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/hooks/useBotClient';
import { useTerminal } from '@/hooks/useTerminal';
import { formatChinaTime, visibleInterval } from '@/lib/format';

function PairBadges({ title, pairs, method }: { title: string; pairs: string[]; method?: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{pairs.length}</span>
        </CardTitle>
        {method && method.length > 0 ? <p className="text-xs text-muted-foreground">{method.join(' · ')}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {pairs.length === 0 ? <p className="text-sm text-muted-foreground">空</p> : null}
        {pairs.map((pair) => (
          <Badge key={pair} variant="secondary" className="font-mono">
            {pair}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}

export function PairsPage() {
  const { client, bot } = useTerminal();
  const whitelistQuery = useQuery({
    queryKey: ['bot', bot.id, 'whitelist'],
    queryFn: () => fetchWhitelist(client),
    refetchInterval: visibleInterval(30_000),
  });
  const blacklistQuery = useQuery({
    queryKey: ['bot', bot.id, 'blacklist'],
    queryFn: () => fetchBlacklist(client),
    refetchInterval: visibleInterval(30_000),
  });
  const locksQuery = useQuery({
    queryKey: ['bot', bot.id, 'locks'],
    queryFn: () => fetchLocks(client),
    refetchInterval: visibleInterval(30_000),
  });

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader title="交易对" description="白名单、黑名单，以及暂时禁止开仓的锁。" />
      {whitelistQuery.isLoading ? <Skeleton className="h-24" /> : null}
      {whitelistQuery.error ? <p className="text-sm text-destructive">{errorMessage(whitelistQuery.error)}</p> : null}
      {whitelistQuery.data ? (
        <PairBadges title="白名单" pairs={whitelistQuery.data.whitelist ?? []} method={whitelistQuery.data.method} />
      ) : null}
      {blacklistQuery.error ? <p className="text-sm text-destructive">{errorMessage(blacklistQuery.error)}</p> : null}
      {blacklistQuery.data ? (
        <PairBadges title="黑名单" pairs={blacklistQuery.data.blacklist ?? []} method={blacklistQuery.data.method} />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">锁仓</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {locksQuery.isLoading ? <Skeleton className="mx-4 h-16" /> : null}
          {locksQuery.error ? <p className="px-4 text-sm text-destructive">{errorMessage(locksQuery.error)}</p> : null}
          {locksQuery.data && locksQuery.data.locks.length === 0 ? <p className="px-4 text-sm text-muted-foreground">没有锁仓</p> : null}
          {locksQuery.data && locksQuery.data.locks.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>交易对</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>开始</TableHead>
                  <TableHead>结束</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locksQuery.data.locks.map((lock) => (
                  <TableRow key={lock.id}>
                    <TableCell className="font-mono">{lock.pair}</TableCell>
                    <TableCell>{lock.side || '—'}</TableCell>
                    <TableCell>{lock.reason}</TableCell>
                    <TableCell className="font-mono text-xs">{formatChinaTime(lock.lock_time, true)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatChinaTime(lock.lock_end_time, true)}</TableCell>
                    <TableCell>{lock.active ? '生效' : '已过期'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
