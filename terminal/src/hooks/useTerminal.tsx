import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';

import { fetchBalance, fetchConfig, fetchLogs, fetchPing, fetchProfit } from '@/api/bot';
import type { ApiClient } from '@/api/client';
import { fetchOpenTrades } from '@/api/trades';
import { errorMessage, useBotClient } from '@/hooks/useBotClient';
import { useListedBots, type ListedBot } from '@/hooks/useListedBots';
import { FAST_POLL_MS, SLOW_POLL_MS, visibleInterval } from '@/lib/format';
import { useSession } from '@/stores/session';
import type { Balance, BotState, LogLine, ProfitStats, Trade } from '@/types';

type TerminalContextValue = {
  bot: ListedBot;
  client: ApiClient;
  config: BotState | undefined;
  configError: string | null;
  online: 'online' | 'offline' | 'checking';
  trades: Trade[];
  tradesLoading: boolean;
  tradesError: string | null;
  profit: ProfitStats | undefined;
  profitLoading: boolean;
  profitError: string | null;
  balance: Balance | undefined;
  balanceLoading: boolean;
  balanceError: string | null;
  logs: LogLine[];
  logsLoading: boolean;
  logsError: string | null;
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
    refetchInterval: visibleInterval(SLOW_POLL_MS),
  });
  const pingQuery = useQuery({
    queryKey: ['bot', botId, 'ping'],
    queryFn: () => fetchPing(client),
    enabled,
    retry: 0,
    refetchInterval: visibleInterval(SLOW_POLL_MS),
  });
  const tradesQuery = useQuery({
    queryKey: ['bot', botId, 'status'],
    queryFn: () => fetchOpenTrades(client),
    enabled,
    refetchInterval: visibleInterval(FAST_POLL_MS),
  });
  const profitQuery = useQuery({
    queryKey: ['bot', botId, 'profit'],
    queryFn: () => fetchProfit(client),
    enabled,
    refetchInterval: visibleInterval(FAST_POLL_MS),
  });
  const balanceQuery = useQuery({
    queryKey: ['bot', botId, 'balance'],
    queryFn: () => fetchBalance(client),
    enabled,
    refetchInterval: visibleInterval(SLOW_POLL_MS),
  });
  const logsQuery = useQuery({
    queryKey: ['bot', botId, 'logs'],
    queryFn: () => fetchLogs(client),
    enabled,
    refetchInterval: visibleInterval(SLOW_POLL_MS),
  });

  if (!bot) return null;

  const value: TerminalContextValue = {
    bot,
    client,
    config: configQuery.data,
    configError: errorMessage(configQuery.error),
    online: pingQuery.isPending ? 'checking' : pingQuery.data?.status === 'pong' ? 'online' : 'offline',
    trades: tradesQuery.data ?? [],
    tradesLoading: tradesQuery.isLoading,
    tradesError: errorMessage(tradesQuery.error),
    profit: profitQuery.data,
    profitLoading: profitQuery.isLoading,
    profitError: errorMessage(profitQuery.error),
    balance: balanceQuery.data,
    balanceLoading: balanceQuery.isLoading,
    balanceError: errorMessage(balanceQuery.error),
    logs: logsQuery.data?.logs ?? [],
    logsLoading: logsQuery.isLoading,
    logsError: errorMessage(logsQuery.error),
  };

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

export function useTerminal(): TerminalContextValue {
  const value = useContext(TerminalContext);
  if (!value) throw new Error('useTerminal 必须在操作台布局内使用');
  return value;
}
