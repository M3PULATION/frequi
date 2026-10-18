import type { Balance, BotState, ProfitStats, Trade } from '@/types';

export type BotSnapshot = {
  config: BotState | null;
  profit: ProfitStats | null;
  balance: Balance | null;
  trades: Trade[] | null;
};

export type BotOverview = {
  id: string;
  name: string;
  online: boolean;
  state: string | null;
  dryRun: boolean | null;
  strategy: string | null;
  timeframe: string | null;
  tradingMode: string | null;
  stake: string | null;
  equity: number | null;
  closedProfit: number | null;
  openProfit: number | null;
  openCount: number | null;
  maxOpen: number | null;
  wins: number | null;
  losses: number | null;
  drawdown: number | null;
};

export function openProfitOf(profit: ProfitStats | null, trades: Trade[] | null): number | null {
  if (trades) {
    if (trades.length === 0) return 0;
    if (trades.every((trade) => typeof trade.profit_abs === 'number')) {
      return trades.reduce((sum, trade) => sum + (trade.profit_abs ?? 0), 0);
    }
  }
  if (!profit) return null;
  return profit.profit_all_coin - profit.profit_closed_coin;
}

export function overviewFromSnapshot(
  bot: { id: string; name: string; online: boolean; strategy: string },
  snapshot: BotSnapshot | undefined,
): BotOverview {
  const config = snapshot?.config ?? null;
  const profit = snapshot?.profit ?? null;
  const balance = snapshot?.balance ?? null;
  const trades = snapshot?.trades ?? null;
  return {
    id: bot.id,
    name: bot.name,
    online: bot.online,
    state: config?.state ?? null,
    dryRun: config?.dry_run ?? null,
    strategy: config?.strategy || bot.strategy || null,
    timeframe: config?.timeframe ?? null,
    tradingMode: config?.trading_mode ?? null,
    stake: balance?.stake || config?.stake_currency || null,
    equity: balance?.total ?? null,
    closedProfit: profit?.profit_closed_coin ?? null,
    openProfit: openProfitOf(profit, trades),
    openCount: trades ? trades.length : null,
    maxOpen: config?.max_open_trades ?? null,
    wins: profit?.winning_trades ?? null,
    losses: profit?.losing_trades ?? null,
    drawdown: profit?.current_drawdown ?? null,
  };
}
