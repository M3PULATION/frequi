import { useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useTerminal } from '@/hooks/useTerminal';
import { formatChinaTime } from '@/lib/format';

const LEVEL_ORDER = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

function levelVariant(level: string): 'destructive' | 'outline' | 'secondary' {
  const normalized = level.toUpperCase();
  if (normalized === 'ERROR' || normalized === 'CRITICAL') return 'destructive';
  if (normalized === 'WARNING') return 'outline';
  return 'secondary';
}

export function LogsPage() {
  const { logs, logsLoading, logsError } = useTerminal();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(['INFO']));
  const recent = logs.slice(-200).reverse();
  const levels = [...new Set(recent.map((line) => line[3].toUpperCase()))].sort(
    (a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b),
  );
  const visible = recent.filter((line) => !hidden.has(line[3].toUpperCase()));

  return (
    <section className="flex min-h-[calc(100svh-3.5rem)] flex-col gap-4 p-4 md:p-6">
      <PageHeader title="日志">
        <div className="flex flex-wrap gap-2">
          {levels.map((level) => {
            const off = hidden.has(level);
            return (
              <button
                key={level}
                type="button"
                aria-pressed={!off}
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(level)) next.delete(level);
                    else next.add(level);
                    return next;
                  })
                }
                className={off ? 'opacity-40' : undefined}
              >
                <Badge variant={levelVariant(level)}>{level}</Badge>
              </button>
            );
          })}
        </div>
      </PageHeader>
      {logsError ? <p className="text-sm text-destructive">{logsError}</p> : null}
      <Card className="min-h-0 flex-1 py-0">
        <CardContent className="h-full px-0">
          {logsLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-4/5" />
            </div>
          ) : (
            <ScrollArea className="h-[calc(100svh-10rem)]">
              {visible.length === 0 ? <p className="px-4 py-8 text-sm text-muted-foreground">当前筛选下没有日志</p> : null}
              <ul className="divide-y">
                {visible.map((line, index) => {
                  const [, , moduleName, level, message] = line;
                  return (
                    <li key={`${line[1]}-${index}`} className="grid gap-1 px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{formatChinaTime(line[1], true)}</span>
                        <Badge variant={levelVariant(level)}>{level}</Badge>
                        <span>{moduleName}</span>
                      </div>
                      <p className="text-sm break-all">{message}</p>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
