import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRatio, formatSignedNumber } from '@/lib/format';
import type { TimeSummaryRecord } from '@/types';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function heatStyle(value: number, maxAbs: number): { backgroundColor: string } {
  if (!value || !maxAbs) return { backgroundColor: 'oklch(0.3 0 0)' };
  const strength = 0.35 + 0.65 * Math.min(1, Math.abs(value) / maxAbs);
  const color = value > 0 ? `oklch(0.72 0.17 155 / ${strength})` : `oklch(0.64 0.2 25 / ${strength})`;
  return { backgroundColor: color };
}

function cellLabel(row: TimeSummaryRecord): string {
  return `${row.date}\n${formatSignedNumber(row.abs_profit, 4)}  ${formatRatio(row.rel_profit)}\n${row.trade_count} 笔`;
}

function HeatCell({
  row,
  maxAbs,
  className,
  children,
}: {
  row: TimeSummaryRecord | null;
  maxAbs: number;
  className: string;
  children?: string;
}) {
  if (!row) return <div className={className} />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`${className} whitespace-pre-line text-[10px] font-mono leading-tight text-foreground/90`}
          style={heatStyle(row.abs_profit, maxAbs)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="whitespace-pre font-mono">{cellLabel(row)}</TooltipContent>
    </Tooltip>
  );
}

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function DailyCalendar({ rows, maxAbs }: { rows: TimeSummaryRecord[]; maxAbs: number }) {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(ordered.map((row) => [row.date, row]));
  const first = ordered[0] ? new Date(`${ordered[0].date}T00:00:00`) : null;
  const last = ordered.at(-1) ? new Date(`${ordered.at(-1)!.date}T00:00:00`) : null;
  if (!first || !last) return null;
  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  const cells: Array<TimeSummaryRecord | null> = [];
  while (cursor <= last) {
    cells.push(byDate.get(dateKey(cursor)) ?? null);
    cursor.setDate(cursor.getDate() + 1);
  }
  return (
    <div className="px-4 pb-4">
      <div className="mb-1 grid w-fit grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="grid w-fit grid-cols-7 gap-1">
        {cells.map((row, index) => (
          <HeatCell key={row?.date ?? `empty-${index}`} row={row} maxAbs={maxAbs} className="size-9 rounded-sm bg-muted/40">
            {row ? String(Number(row.date.slice(8))) : undefined}
          </HeatCell>
        ))}
      </div>
    </div>
  );
}

function TileGrid({ rows, maxAbs }: { rows: TimeSummaryRecord[]; maxAbs: number }) {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-4">
      {ordered.map((row) => (
        <HeatCell key={row.date} row={row} maxAbs={maxAbs} className="flex h-16 w-24 flex-col items-center justify-center rounded-md">
          {`${row.date.slice(5)}\n${formatSignedNumber(row.abs_profit, 2)}`}
        </HeatCell>
      ))}
    </div>
  );
}

export function ProfitHeatmap({ rows, daily }: { rows: TimeSummaryRecord[]; daily: boolean }) {
  const maxAbs = rows.reduce((max, row) => Math.max(max, Math.abs(row.abs_profit)), 0);
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (daily) return <DailyCalendar rows={ordered} maxAbs={maxAbs} />;
  return <TileGrid rows={ordered} maxAbs={maxAbs} />;
}
