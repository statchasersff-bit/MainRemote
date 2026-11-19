/**
 * The player pages' rounding policy (audit WEB-035), in one place:
 *
 *   fantasy points       1 decimal ("183.4"); a per-game average 1 decimal
 *   per-target / touch   2 decimals ("2.02")
 *   shares, rates        1 decimal with "%" ("22.3%")
 *   roster %             whole number; "<1%" below 0.5, and 100% only at 100
 *                        (rosteredPct below - the header's rule, which the FAQ
 *                        used to round past: 99.6 read 99% in the header and
 *                        100% in the FAQ)
 *   ranks, percentiles   whole numbers, ordinal where a sentence uses them
 */

export function rosteredPct(value: number): string {
  if (value < 0.5) return "<1%";
  return `${Math.min(Math.round(value), value >= 100 ? 100 : 99)}%`;
}
