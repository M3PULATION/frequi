import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPercentPoints, formatSignedNumber, profitTone } from '@/lib/format';
import type { StatRow } from '@/types';

export function StatsTable({
  rows,
  label,
}: {
  rows: Array<StatRow & { name: string }>;
  label: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">没有{label}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          <TableHead className="text-right">笔数</TableHead>
          <TableHead className="text-right">盈亏</TableHead>
          <TableHead className="text-right">比例</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell className="font-mono">{row.name || '—'}</TableCell>
            <TableCell className="text-right font-mono">{row.count}</TableCell>
            <TableCell className={`text-right font-mono ${profitTone(row.profit_abs)}`}>
              {formatSignedNumber(row.profit_abs, 4)}
            </TableCell>
            <TableCell className={`text-right font-mono ${profitTone(row.profit_pct)}`}>
              {formatPercentPoints(row.profit_pct)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
