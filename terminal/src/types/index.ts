export type OrderSide = 'long' | 'short';

export type ForceEnterPayload = {
  pair: string;
  side?: OrderSide;
  price?: number;
  ordertype?: string;
  stakeamount?: number;
  entry_tag?: string;
  leverage?: number;
};

export type ForceExitPayload = {
  tradeid: string | number;
  ordertype?: string;
  amount?: number;
  price?: number;
};

export type Order = {
  pair: string;
  order_id: string;
  status: string;
  remaining: number | null;
  cost: number;
  filled: number | null;
  order_type: string;
  is_open: boolean;
  order_timestamp?: number;
  order_filled_timestamp?: number;
  ft_order_side: string;
  ft_order_tag?: string;
  safe_price: number;
  amount: number;
};

export type ClosedTrade = Trade & {
  close_date?: string;
  close_timestamp?: number;
  close_rate?: number;
  close_rate_requested?: number | null;
  open_rate_requested?: number | null;
  exit_reason?: string;
  min_rate?: number;
  max_rate?: number;
  fee_open_cost?: number | null;
  fee_close_cost?: number | null;
  funding_fees?: number | null;
  trade_duration_s?: number | null;
};

export type TradeHistory = {
  trades: ClosedTrade[];
  offset: number;
  trades_count: number;
  total_trades: number;
};

export type TradeCustomEntry = {
  key: string;
  type: string;
  value: unknown;
  created_at: string;
  updated_at: string | null;
};

export type TradeCustomData = {
  trade_id: number;
  custom_data: TradeCustomEntry[];
};

export type StatRow = {
  profit_ratio: number;
  profit_pct: number;
  profit_abs: number;
  count: number;
};

export type PerformanceEntry = StatRow & { pair: string; profit: number };
export type EntryStats = StatRow & { enter_tag: string };
export type ExitStats = StatRow & { exit_reason: string };
export type MixTagStats = StatRow & { mix_tag: string };

export type AllProfitStats = {
  all: ProfitStats;
  short?: ProfitStats;
  long?: ProfitStats;
};

export type TimeSummaryRecord = {
  date: string;
  abs_profit: number;
  rel_profit: number;
  starting_balance: number;
  fiat_value: number;
  trade_count: number;
};

export type TimeSummary = {
  data: TimeSummaryRecord[];
  fiat_display_currency: string;
  stake_currency: string;
};

export type WalletHistory = {
  columns: string[];
  length: number;
  data: (number | string)[][];
};

export type PairListResponse = {
  method: string[];
  length: number;
  whitelist?: string[];
  blacklist?: string[];
};

export type PairLock = {
  id: string;
  pair: string;
  lock_time: string;
  lock_end_time: string;
  reason: string;
  side?: string;
  active: boolean;
};

export type LockResponse = {
  lock_count: number;
  locks: PairLock[];
};

export type SysInfo = {
  cpu_pct: number[];
  ram_pct: number;
};

export type PlotConfig = {
  main_plot?: Record<string, { color?: string; type?: string }>;
  subplots?: Record<string, Record<string, { color?: string; type?: string }>>;
};

export type Trade = {
  trade_id: number;
  pair: string;
  is_open: boolean;
  is_short?: boolean;
  amount: number;
  stake_amount: number;
  open_rate: number;
  current_rate?: number;
  profit_ratio: number | null;
  profit_pct: number | null;
  profit_abs?: number;
  stop_loss_abs: number;
  stop_loss_pct: number;
  liquidation_price?: number | null;
  leverage?: number;
  trading_mode?: string;
  timeframe?: number | string;
  open_timestamp: number;
  enter_tag?: string;
  amount_precision?: number;
  price_precision?: number;
  orders?: Order[];
};

export type BotState = {
  version: string;
  api_version: number;
  dry_run: boolean;
  trading_mode?: string;
  margin_mode?: string;
  short_allowed?: boolean;
  state: string;
  runmode: string;
  exchange: string;
  force_entry_enable?: boolean;
  max_open_trades: number;
  stake_currency: string;
  stake_currency_decimals?: number;
  strategy: string;
  timeframe: string;
  bot_name: string;
  stoploss: number;
  minimal_roi?: Record<string, number>;
};

export type ProfitStats = {
  profit_closed_coin: number;
  profit_closed_ratio: number;
  profit_closed_ratio_mean?: number;
  profit_closed_fiat?: number;
  profit_all_coin: number;
  profit_all_ratio: number;
  profit_all_percent?: number;
  profit_all_ratio_mean?: number;
  profit_all_fiat?: number;
  trade_count: number;
  closed_trade_count: number;
  winning_trades: number;
  losing_trades: number;
  winrate?: number;
  profit_factor?: number;
  expectancy?: number;
  expectancy_ratio?: number;
  sharpe?: number;
  sortino?: number;
  calmar?: number;
  cagr?: number;
  sqn?: number;
  avg_duration?: string;
  best_pair?: string;
  best_pair_profit_ratio?: number;
  best_pair_profit_abs?: number;
  trading_volume?: number;
  first_trade_date?: string;
  latest_trade_date?: string;
  bot_start_date?: string;
  current_drawdown?: number;
  current_drawdown_abs?: number;
  current_drawdown_high?: number;
  current_drawdown_start?: string;
  max_drawdown?: number;
  max_drawdown_abs?: number;
  max_drawdown_start?: string;
  max_drawdown_end?: string;
};

export type BalanceRecord = {
  balance: number;
  currency: string;
  est_stake: number;
  free: number;
  used: number;
  bot_owned?: number;
  side: string;
  is_position: boolean;
  position: number;
  is_bot_managed?: boolean;
};

export type Balance = {
  currencies: BalanceRecord[];
  stake: string;
  symbol: string;
  total: number;
  total_bot?: number;
  value: number;
  starting_capital: number;
  starting_capital_pct: number;
};

/** [formatted datetime, timestamp, module, level, message] */
export type LogLine = [string, number, string, string, string];

export type Logs = {
  logs: LogLine[];
  log_count: number;
};
