import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';

import type { TradeMarker } from '@/lib/candles';

const OUTLINE = 'rgba(8, 10, 14, 0.95)';
const LABEL = '#101114';

type BitmapScope = {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  bitmapSize: { width: number; height: number };
};

/**
 * Open positions get a filled tag with a pointer. Historical fills stay as outlined arrows
 * so a busy chart does not turn into a stack of labels.
 */
export class TradeMarksPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<'Candlestick', Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private marks: TradeMarker[] = [];
  private readonly views: readonly IPrimitivePaneView[];

  constructor() {
    this.views = [new TradeMarkPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time, 'Candlestick'>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setMarks(marks: TradeMarker[]): void {
    this.marks = marks;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  updateAllViews(): void {}

  chartApi(): IChartApiBase<Time> | null {
    return this.chart;
  }

  seriesApi(): ISeriesApi<'Candlestick', Time> | null {
    return this.series;
  }

  currentMarks(): readonly TradeMarker[] {
    return this.marks;
  }
}

class TradeMarkPaneView implements IPrimitivePaneView {
  private readonly rendererImpl: TradeMarkRenderer;

  constructor(primitive: TradeMarksPrimitive) {
    this.rendererImpl = new TradeMarkRenderer(primitive);
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return this.rendererImpl;
  }
}

class TradeMarkRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly primitive: TradeMarksPrimitive) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    const chart = this.primitive.chartApi();
    const series = this.primitive.seriesApi();
    if (!chart || !series) return;
    const marks = this.primitive.currentMarks();
    if (marks.length === 0) return;

    target.useBitmapCoordinateSpace((scope) => {
      const bitmap = scope as BitmapScope;
      const ctx = bitmap.context;
      const hr = bitmap.horizontalPixelRatio;
      const vr = bitmap.verticalPixelRatio;
      const stack = new Map<string, number>();

      for (const mark of marks) {
        if (mark.price == null || (mark.kind !== 'entry' && mark.kind !== 'exit')) continue;
        const mediaX = chart.timeScale().timeToCoordinate(mark.time as UTCTimestamp);
        const mediaY = series.priceToCoordinate(mark.price);
        if (mediaX == null || mediaY == null) continue;
        const above = mark.position !== 'belowBar';
        const key = `${mark.time}:${above ? 'a' : 'b'}`;
        const index = stack.get(key) ?? 0;
        stack.set(key, index + 1);
        const x = Math.round(mediaX * hr);
        const step = (mark.text ? 30 : 16) * vr;
        const wickY = Math.round(mediaY * vr + (above ? -1 : 1) * index * step);
        ctx.save();
        if (mark.kind === 'entry' && mark.text) {
          drawTag(ctx, x, wickY, above, mark.text, mark.color, hr, vr, bitmap.bitmapSize);
        } else if (mark.shape === 'circle') {
          drawDot(ctx, x, wickY, above, mark.color, hr, vr);
        } else {
          drawArrow(ctx, x, wickY, above, mark.color, hr, vr);
        }
        ctx.restore();
      }
    });
  }
}

function drawTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  wickY: number,
  above: boolean,
  label: string,
  color: string,
  hr: number,
  vr: number,
  size: { width: number; height: number },
): void {
  if (x < -8 * hr || x > size.width + 8 * hr) return;
  const fontSize = 11 * vr;
  ctx.font = `600 ${fontSize}px 'Inter Variable', 'PingFang SC', 'Noto Sans SC', sans-serif`;
  const textWidth = ctx.measureText(label).width;
  const arrowH = 15 * vr;
  const arrowW = 8 * hr;
  const gap = 2 * vr;
  const pillH = 18 * vr;
  const pillW = textWidth + 14 * hr;
  const needed = arrowH + gap + 4 * vr;
  let placeAbove = above;
  if (placeAbove && wickY < needed) placeAbove = false;
  if (!placeAbove && wickY > size.height - needed) placeAbove = true;

  const tipY = placeAbove ? wickY - gap : wickY + gap;
  const baseY = placeAbove ? tipY - arrowH : tipY + arrowH;
  const notchY = placeAbove ? baseY + arrowH * 0.42 : baseY - arrowH * 0.42;
  const midY = (tipY + baseY) / 2;
  const margin = 4 * hr;
  let pillLeft = x + arrowW + 5 * hr;
  if (pillLeft + pillW > size.width - margin) pillLeft = x - arrowW - 5 * hr - pillW;
  pillLeft = Math.max(margin, Math.min(pillLeft, size.width - pillW - margin));
  const pillTop = midY - pillH / 2;

  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.lineTo(x - arrowW, baseY);
  ctx.lineTo(x, notchY);
  ctx.lineTo(x + arrowW, baseY);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3 * Math.min(hr, vr);
  ctx.stroke();
  ctx.fill();

  const radius = Math.min(4 * vr, pillH / 2);
  ctx.beginPath();
  ctx.roundRect(pillLeft, pillTop, pillW, pillH, radius);
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5 * Math.min(hr, vr);
  ctx.stroke();
  ctx.fill();

  ctx.fillStyle = LABEL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pillLeft + pillW / 2, pillTop + pillH / 2 + 0.5 * vr);
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  wickY: number,
  above: boolean,
  color: string,
  hr: number,
  vr: number,
): void {
  const gap = 8 * vr;
  const height = 13 * vr;
  const width = 7 * hr;
  const tipY = above ? wickY - gap : wickY + gap;
  const baseY = above ? tipY - height : tipY + height;
  const notch = above ? baseY + 5 * vr : baseY - 5 * vr;
  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.lineTo(x - width, baseY);
  ctx.lineTo(x, notch);
  ctx.lineTo(x + width, baseY);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5 * Math.min(hr, vr);
  ctx.stroke();
  ctx.fill();
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  wickY: number,
  above: boolean,
  color: string,
  hr: number,
  vr: number,
): void {
  const gap = 8 * vr;
  const radius = 4.5 * Math.min(hr, vr);
  const cy = above ? wickY - gap - radius : wickY + gap + radius;
  ctx.beginPath();
  ctx.arc(x, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2 * Math.min(hr, vr);
  ctx.stroke();
  ctx.fill();
}
