export const CHINA_TIME_ZONE = 'Asia/Shanghai';

/** Unix seconds or milliseconds. Values above 1e10 are treated as milliseconds. */
export function toEpochMs(value: number): number {
  return value > 10_000_000_000 ? value : value * 1000;
}

/** API date strings have no zone and are UTC, for example "2026-10-17 03:53:00". */
export function parseUtcDate(text: string): number | null {
  const normalized = text.trim().replace(' ', 'T');
  if (!normalized) return null;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatChinaTime(input: number | string | null | undefined, withSeconds = false): string {
  let ms: number | null = null;
  if (typeof input === 'number' && Number.isFinite(input)) ms = toEpochMs(input);
  else if (typeof input === 'string') ms = parseUtcDate(input);
  if (ms == null) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  }).format(new Date(ms));
}

export function formatChinaChartTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(unixSeconds * 1000));
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Decimal places from either a digit count (4) or a tick size (0.000001). */
export function fractionDigits(precision: number | undefined, fallback = 4): number {
  if (precision == null || !Number.isFinite(precision) || precision <= 0) return fallback;
  if (precision >= 1) return Math.min(Math.floor(precision), 10);
  const raw = -Math.log10(precision);
  const digits = Math.abs(raw - Math.round(raw)) < 1e-6 ? Math.round(raw) : Math.ceil(raw);
  return Math.min(Math.max(digits, 0), 10);
}

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = Math.abs(value).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Digits needed to tell these prices apart. Sub-dollar prices keep at least four places. */
export function pricePrecision(values: number[], minimum?: number): number {
  let digits = minimum ?? 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value === 0) continue;
    const places = decimalPlaces(value);
    const floor = Math.abs(value) < 1 ? Math.max(places, 4) : places;
    digits = Math.max(digits, floor);
  }
  if (digits === 0) digits = 2;
  return Math.min(digits, 8);
}

export function formatPrice(value: number, precision: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    useGrouping: Math.abs(value) >= 1000,
  });
}

export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return '—';
  const precision = fractionDigits(digits, 4);
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: precision,
  });
}

export function formatSignedNumber(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return '—';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatNumber(value, digits)}`;
}

/** `value` is already a percent, not a ratio. */
export function formatPercentPoints(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/** `value` is a ratio: 0.01 renders as +1.00%. */
export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return formatPercentPoints(value * 100, digits);
}

/** Ratio without a leading plus, for win rate and drawdown. */
export function formatPlainRatio(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/** Freqtrade durations look like "1 day, 11:28:36". */
export function formatHold(text?: string | null): string {
  if (!text) return '—';
  const dayMatch = text.match(/(\d+)\s+day/);
  const clock = text.match(/(\d+):(\d+):(\d+)/);
  if (!dayMatch && !clock) return text;
  const days = dayMatch ? Number(dayMatch[1]) : 0;
  const hours = clock ? Number(clock[1]) : 0;
  const minutes = clock ? Number(clock[2]) : 0;
  if (days > 0) return `${days}天 ${hours}小时 ${minutes}分`;
  if (hours > 0) return `${hours}小时 ${minutes}分`;
  return `${minutes}分`;
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}天 ${hours}小时 ${minutes}分`;
  if (hours > 0) return `${hours}小时 ${minutes}分`;
  return `${minutes}分`;
}

export function profitTone(value: number | null | undefined): string {
  if (value == null || value === 0) return 'text-foreground';
  return value > 0 ? 'text-up' : 'text-down';
}

export function visibleInterval(ms: number): () => number | false {
  return () => (typeof document === 'undefined' || document.visibilityState === 'visible' ? ms : false);
}

export const FAST_POLL_MS = 3_000;
export const SLOW_POLL_MS = 15_000;
export const CANDLE_POLL_MS = 10_000;
