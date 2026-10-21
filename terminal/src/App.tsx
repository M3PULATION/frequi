import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';

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

function useHydratedSession() {
  const [hydrated, setHydrated] = useState(() => useSession.persist.hasHydrated());
  useEffect(() => {
    if (useSession.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useSession.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}

function useSelectedListedBot() {
  const hydrated = useHydratedSession();
  const selectedId = useSession((state) => state.selectedId);
  const selectBot = useSession((state) => state.selectBot);
  const catalog = useListedBots();
  const bot = catalog.data?.find((item) => item.id === selectedId) ?? null;
  const fallback = catalog.data?.find((item) => item.online) ?? catalog.data?.[0] ?? null;
  useEffect(() => {
    if (!hydrated || bot || !fallback) return;
    selectBot(fallback.id);
  }, [hydrated, bot, fallback, selectBot]);
  return { catalog, hydrated, bot: hydrated ? (bot ?? fallback) : null };
}

function AppLayout() {
  const { catalog, hydrated, bot } = useSelectedListedBot();
  const location = useLocation();
  useEffect(() => {
    if (!bot) document.title = documentTitle('/bots');
  }, [bot]);
  if (!hydrated || catalog.isLoading) return <p className="p-6 text-sm text-muted-foreground">正在读取实盘列表…</p>;
  if (!bot) {
    if (location.pathname !== '/bots') return <Navigate to="/bots" replace />;
    return <BotsPage />;
  }
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
            staleTime: 15_000,
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
            <Route element={<AppLayout />}>
              <Route path="bots" element={<BotsPage />} />
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
