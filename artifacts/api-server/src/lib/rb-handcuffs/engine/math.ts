/**
 * The numeric helpers the engine shares. MIRRORS clamp(), scale() and
 * weightedAverage() in the standalone server/scoring.ts.
 */

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear 0–100 between `min` and `max`, clamped. A non-number is neutral. */
export function scale(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 50;
  if (value <= min) return 0;
  if (value >= max) return 100;
  return ((value - min) / (max - min)) * 100;
}

/** Weighted mean over the components that have a value; `fallback` when none do. */
export function weightedAverage(
  components: { value: number | null; weight: number }[],
  fallback = 50,
): number {
  const available = components.filter((c) => c.value != null && Number.isFinite(c.value));
  const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
  if (!available.length || totalWeight <= 0) return fallback;
  return clamp(
    available.reduce((sum, c) => sum + (c.value as number) * c.weight, 0) / totalWeight,
  );
}
