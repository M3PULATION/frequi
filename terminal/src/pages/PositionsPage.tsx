import { useNavigate } from 'react-router';

import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTerminal } from '@/hooks/useTerminal';
import { formatChinaTime, formatNumber, formatPercentPoints, formatPrice, formatSignedNumber, fractionDigits, pricePrecision, profitTone } from '@/lib/format';
import type { Trade } from '@/types';

function PositionCard({ trade, stake, moneyDigits, onOpen }: { trade: Trade; stake: string; moneyDigits: number; onOpen: () => void }) {
  const percent = trade.profit_pct ?? (trade.profit_ratio == null ? null : trade.profit_ratio * 100);
  const mark = trade.current_rate ?? trade.open_rate;
  const places = pricePrecision([trade.open_rate, mark, trade.stop_loss_abs, trade.liquidation_price ?? 0], fractionDigits(trade.price_precision, 4));
  const positionValue = trade.amount * mark;
  const margin = trade.stake_amount;
  const side = trade.is_short ? '空' : '多';
  const leverage = trade.leverage && trade.leverage > 1 ? ` ${formatNumber(trade.leverage, 2)}x` : '';
  const fields: Array<{ label: string; value: string; wide?: boolean }> = [
    { label: '开仓时间', value: formatChinaTime(trade.open_timestamp, true), wide: true },
    { label: '开仓价', value: formatPrice(trade.open_rate, places) },
    { label: '现价', value: formatPrice(mark, places) },
    { label: '数量', value: formatNumber(trade.amount, trade.amount_precision ?? 4) },
    { label: '止损', value: formatPrice(trade.stop_loss_abs, places) },
    { label: '仓位价值', value: `${formatNumber(positionValue, moneyDigits)} ${stake}`.trim() },
    { label: '保证金', value: `${formatNumber(margin, moneyDigits)} ${stake}`.trim() },
    ...(trade.liquidation_price ? [{ label: '清算价', value: formatPrice(trade.liquidation_price, places) }] : []),
  ];

  return (
    <Card
      role="link"
      tabIndex={0}
      data-testid="position-row"
      className="cursor-pointer transition-colors hover:bg-muted/30"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">{trade.pair}</p>
            <Badge variant={trade.is_short ? 'destructive' : 'secondary'} className="mt-1">
              {side}
              {leverage}
            </Badge>
          </div>
          <p className={`text-right font-mono text-sm ${profitTone(trade.profit_ratio ?? trade.profit_pct)}`}>
            {formatSignedNumber(trade.profit_abs, moneyDigits)} {stake}
            <span className="mt-0.5 block">{formatPercentPoints(percent)}</span>
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {fields.map((field) => (
            <div key={field.label} className={field.wide ? 'col-span-2 min-w-0 sm:col-span-3' : 'min-w-0'}>
              <dt className="text-xs text-muted-foreground">{field.label}</dt>
              <dd className="truncate font-mono text-sm">{field.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function PositionsPage() {
  const terminal = useTerminal();
  const navigate = useNavigate();
  const stake = terminal.config?.stake_currency ?? '';
  const moneyDigits = terminal.config?.stake_currency_decimals ?? 4;

  return (
    <section className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader title="持仓">
        <Badge variant="secondary">{terminal.trades.length} 笔</Badge>
      </PageHeader>
      {terminal.tradesError ? <p className="text-sm text-destructive">{terminal.tradesError}</p> : null}
      {terminal.tradesLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : null}
      {!terminal.tradesLoading && !terminal.tradesError && terminal.trades.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">没有持仓</p>
      ) : null}
      {terminal.trades.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {terminal.trades.map((trade) => (
            <PositionCard
              key={trade.trade_id}
              trade={trade}
              stake={stake}
              moneyDigits={moneyDigits}
              onOpen={() => navigate(`/chart/${trade.trade_id}`)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
