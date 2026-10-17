import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';

import type { CandleBar, TradeMarker, VolumeBar } from '@/lib/candles';
import { formatChinaChartTime } from '@/lib/format';

export type ChartPriceLine = {
  price: number;
  title: string;
  color: string;
  style?: 'dashed' | 'dotted';
};

type CandleChartProps = {
  pair: string;
  timeframe: string;
  bars: CandleBar[];
  volume: VolumeBar[];
  markers: TradeMarker[];
  priceLines: ChartPriceLine[];
  loading: boolean;
  error: string | null;
};

type ChartHandles = {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  markers: ISeriesMarkersPluginApi<Time>;
  priceLines: IPriceLine[];
  bars: CandleBar[];
  volumeBars: VolumeBar[];
};

function asTime(time: number): UTCTimestamp {
  return time as UTCTimestamp;
}

function syncBars<T extends { time: number }>(
  series: { setData: (data: T[]) => void; update: (bar: T) => void },
  next: T[],
  previous: T[],
): void {
  const sameStart = previous.length > 0 && next.length > 0 && previous[0]?.time === next[0]?.time;
  if (!sameStart || next.length < previous.length) {
    series.setData(next);
    return;
  }
  if (next.length === previous.length) {
    const last = next[next.length - 1];
    if (last) series.update(last);
    return;
  }
  const closed = next[previous.length - 1];
  if (closed) series.update(closed);
  for (let index = previous.length; index < next.length; index += 1) {
    const bar = next[index];
    if (bar) series.update(bar);
  }
}

export function CandleChart({ pair, timeframe, bars, volume, markers, priceLines, loading, error }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<ChartHandles | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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
      localization: {
        timeFormatter: (time: Time) => (typeof time === 'number' ? formatChinaChartTime(time) : ''),
      },
      timeScale: {
        borderColor: '#333333',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => (typeof time === 'number' ? formatChinaChartTime(time) : ''),
      },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#3ddc97',
      downColor: '#ff5d73',
      borderVisible: false,
      wickUpColor: '#3ddc97',
      wickDownColor: '#ff5d73',
    });
    const volumeSeries = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' } },
      1,
    );
    chart.panes()[1]?.setHeight(72);
    handlesRef.current = {
      chart,
      candles,
      volume: volumeSeries,
      markers: createSeriesMarkers(candles, []),
      priceLines: [],
      bars: [],
      volumeBars: [],
    };
    return () => {
      chart.remove();
      handlesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    const candleData = bars.map((bar) => ({ ...bar, time: asTime(bar.time) }));
    const volumeData = volume.map((bar) => ({ ...bar, time: asTime(bar.time) }));
    const hadBars = handles.bars.length > 0;
    syncBars(handles.candles, candleData, handles.bars.map((bar) => ({ ...bar, time: asTime(bar.time) })));
    syncBars(handles.volume, volumeData, handles.volumeBars.map((bar) => ({ ...bar, time: asTime(bar.time) })));
    if (!hadBars && candleData.length > 0) {
      const last = candleData.length - 1;
      handles.chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, last - 140),
        to: last + 2,
      });
    }
    handles.chart.panes()[1]?.setHeight(72);
    handles.bars = bars;
    handles.volumeBars = volume;
    const seriesMarkers: SeriesMarker<Time>[] = [];
    for (const marker of markers) {
      const time = asTime(marker.time);
      if (marker.position === 'atPriceMiddle' && marker.price != null) {
        seriesMarkers.push({
          time,
          position: 'atPriceMiddle',
          price: marker.price,
          color: marker.color,
          shape: marker.shape,
          text: marker.text,
          size: marker.size,
        });
      } else if (marker.position === 'aboveBar' || marker.position === 'belowBar') {
        seriesMarkers.push({
          time,
          position: marker.position,
          color: marker.color,
          shape: marker.shape,
          text: marker.text,
          size: marker.size,
        });
      }
    }
    handles.markers.setMarkers(seriesMarkers);
    for (const line of handles.priceLines) handles.candles.removePriceLine(line);
    handles.priceLines = priceLines
      .filter((line) => Number.isFinite(line.price) && line.price > 0)
      .map((line) =>
        handles.candles.createPriceLine({
          price: line.price,
          color: line.color,
          lineWidth: 1,
          lineStyle: line.style === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed,
          axisLabelVisible: true,
          title: line.title,
        }),
      );
  }, [bars, markers, priceLines, volume]);

  return (
    <section className="flex h-full min-h-[520px] flex-col bg-card" data-testid="candle-chart">
      <header className="flex items-baseline justify-between border-b px-3 py-2">
        <h2 className="font-mono text-sm">
          {pair} <span className="text-muted-foreground">{timeframe}</span>
        </h2>
        <p className="text-xs text-muted-foreground">{error ?? (loading ? '正在加载 K 线…' : '北京时间 UTC+8')}</p>
      </header>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </section>
  );
}
