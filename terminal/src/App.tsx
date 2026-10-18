import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TerminalProvider } from '@/hooks/useTerminal';
import { BalancePage } from '@/pages/BalancePage';
import { BotsPage } from '@/pages/BotsPage';
import { ChartPage } from '@/pages/ChartPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { LogsPage } from '@/pages/LogsPage';
import { PairsPage } from '@/pages/PairsPage';
import { PositionsPage } from '@/pages/PositionsPage';
import { ProfitPage } from '@/pages/ProfitPage';
import { SystemPage } from '@/pages/SystemPage';
import { useListedBots } from '@/hooks/useListedBots';
import { documentTitle } from '@/lib/title';
import { useSession } from '@/stores/session';

function useSelectedListedBot() {
  const selectedId = useSession((state) => state.selectedId);
  const selectBot = useSession((state) => state.selectBot);
  const catalog = useListedBots();
  const bot = catalog.data?.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    if (bot || !catalog.data?.length) return;
    const next = catalog.data.find((item) => item.online) ?? catalog.data[0];
    if (next) selectBot(next.id);
  }, [bot, catalog.data, selectBot]);
  return { catalog, bot };
}

function SessionShell() {
  const { catalog, bot } = useSelectedListedBot();
  useEffect(() => {
    if (!bot) document.title = documentTitle('/bots');
  }, [bot]);
  if (catalog.isLoading) return <p className="p-6 text-sm text-muted-foreground">正在读取实盘列表…</p>;
  if (!bot) return <BotsPage />;
  return (
    <TerminalProvider>
      <AppShell />
    </TerminalProvider>
  );
}

function RequireSession() {
  const { catalog, bot } = useSelectedListedBot();
  if (catalog.isLoading) return <p className="p-6 text-sm text-muted-foreground">正在读取实盘列表…</p>;
  if (!bot) return <Navigate to="/bots" replace />;
  return (
    <TerminalProvider>
      <AppShell />
    </TerminalProvider>
  );
}

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Navigate to="/bots" replace />} />
            <Route element={<SessionShell />}>
              <Route path="bots" element={<BotsPage />} />
            </Route>
            <Route element={<RequireSession />}>
              <Route index element={<Navigate to="/positions" replace />} />
              <Route path="positions" element={<PositionsPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="chart" element={<ChartPage />} />
              <Route path="chart/:tradeId" element={<ChartPage />} />
              <Route path="profit" element={<ProfitPage />} />
              <Route path="balance" element={<BalancePage />} />
              <Route path="pairs" element={<PairsPage />} />
              <Route path="logs" element={<LogsPage />} />
              <Route path="system" element={<SystemPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/positions" replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
