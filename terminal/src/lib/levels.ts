/** ROI steps are minutes-since-open to stake profit ratio, the same unit as Freqtrade minimal_roi. */
export function currentRoiRatio(
  minimalRoi: Record<string, number> | undefined,
  openTimestamp: number,
  now = Date.now(),
): number | null {
  if (!minimalRoi) return null;
  const openMs = openTimestamp > 10_000_000_000 ? openTimestamp : openTimestamp * 1000;
  const minutes = Math.max(0, Math.floor((now - openMs) / 60_000));
  const steps = Object.entries(minimalRoi)
    .map(([minute, ratio]) => ({ minute: Number(minute), ratio }))
    .filter((step) => Number.isFinite(step.minute) && Number.isFinite(step.ratio))
    .sort((a, b) => a.minute - b.minute);
  let ratio: number | null = null;
  for (const step of steps) {
    if (step.minute <= minutes) ratio = step.ratio;
  }
  return ratio;
}

/**
 * Price where stake profit reaches the ROI ratio.
 * Long moves up, short moves down, and leverage shrinks the price distance.
 */
export function takeProfitPrice(input: {
  openRate: number;
  isShort: boolean;
  leverage?: number;
  roiRatio: number;
}): number | null {
  if (!(input.openRate > 0) || !(input.roiRatio > 0)) return null;
  const leverage = input.leverage != null && input.leverage > 0 ? input.leverage : 1;
  const move = input.roiRatio / leverage;
  const price = input.isShort ? input.openRate * (1 - move) : input.openRate * (1 + move);
  return price > 0 ? price : null;
}

export function timeframeToMs(timeframe: string): number {
  const match = /^(\d+)([mhd])$/.exec(timeframe);
  if (!match) return 300_000;
  const amount = Number(match[1]);
  if (match[2] === 'h') return amount * 3_600_000;
  if (match[2] === 'd') return amount * 86_400_000;
  return amount * 60_000;
}

export function candleLimitForTrades(timeframe: string, openTimestamps: number[], now = Date.now()): number {
  const oldest = openTimestamps.reduce((min, value) => Math.min(min, value > 10_000_000_000 ? value : value * 1000), now);
  const bars = Math.ceil((now - oldest) / timeframeToMs(timeframe)) + 20;
  return Math.min(2500, Math.max(400, bars));
}
