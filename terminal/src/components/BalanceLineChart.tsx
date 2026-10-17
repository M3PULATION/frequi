import { ColorType, createChart, LineSeries, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

import { formatChinaChartTime } from '@/lib/format';

export function BalanceLineChart({ points }: { points: Array<{ time: number; value: number }> }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || points.length === 0) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#d4d4d4',
        fontFamily: "'Inter Variable', 'PingFang SC', 'Noto Sans SC', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#2a2a2a' },
        horzLines: { color: '#2a2a2a' },
      },
      rightPriceScale: { borderColor: '#333333' },
      timeScale: {
        borderColor: '#333333',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => (typeof time === 'number' ? formatChinaChartTime(time) : ''),
      },
      localization: {
        timeFormatter: (time: Time) => (typeof time === 'number' ? formatChinaChartTime(time) : ''),
      },
    });
    const series = chart.addSeries(LineSeries, { color: '#e8e8e8', lineWidth: 2 });
    series.setData(points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);

  if (points.length === 0) return <p className="text-sm text-muted-foreground">没有可绘制的余额曲线</p>;
  return <div ref={containerRef} className="h-72" />;
}
