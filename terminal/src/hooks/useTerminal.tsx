import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';

import { fetchConfig } from '@/api/bot';
import type { ApiClient } from '@/api/client';
import { fetchOpenTrades } from '@/api/trades';
import { errorMessage, useBotClient } from '@/hooks/useBotClient';
import { useListedBots, type ListedBot } from '@/hooks/useListedBots';
import { CONFIG_POLL_MS, FAST_POLL_MS, visibleInterval } from '@/lib/format';
import { useSession } from '@/stores/session';
import type { BotState, Trade } from '@/types';

type TerminalContextValue = {
  bot: ListedBot;
  client: ApiClient;
  config: BotState | undefined;
  configError: string | null;
  online: 'online' | 'offline' | 'checking';
  trades: Trade[];
  tradesLoading: boolean;
  tradesError: string | null;
  dataUpdatedAt: number | null;
};

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const selectedId = useSession((state) => state.selectedId);
  const catalog = useListedBots();
  const bot = catalog.data?.find((item) => item.id === selectedId) ?? null;
  const client = useBotClient(bot?.id ?? '');
  const botId = bot?.id ?? 'none';
  const enabled = Boolean(bot);

  const configQuery = useQuery({
    queryKey: ['bot', botId, 'config'],
    queryFn: () => fetchConfig(client),
    enabled,
    staleTime: CONFIG_POLL_MS,
    refetchInterval: visibleInterval(CONFIG_POLL_MS),
  });
  const tradesQuery = useQuery({
    queryKey: ['bot', botId, 'status'],
    queryFn: () => fetchOpenTrades(client),
    enabled,
    staleTime: FAST_POLL_MS,
    refetchInterval: visibleInterval(FAST_POLL_MS),
  });

  if (!bot) return null;

  const dataUpdatedAt = [tradesQuery, configQuery].reduce<number | null>(
    (latest, query) => (query.dataUpdatedAt > 0 && (latest == null || query.dataUpdatedAt > latest) ? query.dataUpdatedAt : latest),
    null,
  );
  const reached = configQuery.isSuccess || tradesQuery.isSuccess;
  const waiting = configQuery.isPending || tradesQuery.isPending;
  const online = reached ? 'online' : waiting ? 'checking' : 'offline';

  const value: TerminalContextValue = {
    bot,
    client,
    config: configQuery.data,
    configError: errorMessage(configQuery.error),
    online,
    trades: tradesQuery.data ?? [],
    tradesLoading: tradesQuery.isLoading,
    tradesError: errorMessage(tradesQuery.error),
    dataUpdatedAt,
  };

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

export function useTerminal(): TerminalContextValue {
  const value = useContext(TerminalContext);
  if (!value) throw new Error('useTerminal 必须在操作台布局内使用');
  return value;
}
