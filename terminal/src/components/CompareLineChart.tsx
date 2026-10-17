import { ColorType, createChart, LineSeries, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

import { formatChinaChartTime } from '@/lib/format';

export type CompareSeries = {
  id: string;
  name: string;
  color: string;
  points: Array<{ time: number; value: number }>;
};

export function CompareLineChart({ series }: { series: CompareSeries[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const signature = series.map((item) => `${item.id}:${item.points.length}:${item.points.at(-1)?.value ?? ''}`).join('|');

  useEffect(() => {
    const container = containerRef.current;
    const drawable = series.filter((item) => item.points.length > 0);
    if (!container || drawable.length === 0) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#070a12' },
        textColor: 'rgba(255,255,255,0.72)',
        fontFamily: "'Inter Variable', 'PingFang SC', 'Noto Sans SC', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => (typeof time === 'number' ? formatChinaChartTime(time) : ''),
      },
      localization: {
        priceFormatter: (price: number) => `${price > 0 ? '+' : ''}${price.toFixed(1)}%`,
        timeFormatter: (time: Time) => (typeof time === 'number' ? formatChinaChartTime(time) : ''),
      },
    });
    for (const item of drawable) {
      const line = chart.addSeries(LineSeries, { color: item.color, lineWidth: 2 });
      line.setData(item.points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [series, signature]);

  if (series.every((item) => item.points.length === 0)) {
    return <p className="text-sm text-muted-foreground">还没有可比较的资金曲线</p>;
  }
  return <div ref={containerRef} className="h-96" />;
}
