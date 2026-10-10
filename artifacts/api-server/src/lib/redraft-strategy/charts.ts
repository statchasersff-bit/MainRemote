/**
 * The Strategy Ranking chart, as an SVG string.
 *
 * The standalone app drew it with recharts (StrategyCharts.tsx): a vertical
 * layout bar chart, 108px category axis, a number axis snapped to 5pp steps,
 * dashed vertical grid lines, a ±2pp band around the baseline, bars colored
 * by their tier with the rate and lift printed inside, and a dashed baseline
 * with a "League Avg" pill. This is the same chart without the library - the
 * same geometry and the same labels at the same bar widths - so the server
 * can put it in the page and the bundle can redraw it at the column's width.
 *
 * Each row carries an invisible hit band (`.scds-hit`, `data-bar`) that the
 * bundle hangs its tooltip on; with scripting off the chart is complete and
 * only the hover read-out is missing.
 */

import { escapeHtml } from "../render";
import { barTier, type BarEntry, type ChartView } from "./model";

const MARGIN = { top: 4, right: 14, bottom: 4, left: 0 };
const Y_AXIS_WIDTH = 108;
const X_AXIS_HEIGHT = 30;
const MAX_BAR = 26;
const TICKS = 5;

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function pct0(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** 24px a bar, as the app: `Math.max(340, rows * 36)`. */
export function chartHeight(bars: number): number {
  return Math.max(340, bars * 36);
}

/** Evenly spaced ticks between the two ends of a fixed domain. */
export function axisTicks(min: number, max: number, count = TICKS): number[] {
  if (count < 2 || max <= min) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round((min + step * i) * 1e6) / 1e6);
}

/** "+4.2pp" for the label inside a bar. */
function liftLabel(value: number, baseline: number): string {
  const lift = value - baseline;
  return `${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(1)}pp`;
}

export function renderRankingChart(view: ChartView, width: number, label: string): string {
  const w = Math.max(280, Math.round(width));
  const n = view.bars.length;
  const h = chartHeight(n);
  const plotX = MARGIN.left + Y_AXIS_WIDTH;
  const plotW = w - plotX - MARGIN.right;
  const plotY = MARGIN.top;
  const plotH = h - MARGIN.top - MARGIN.bottom - X_AXIS_HEIGHT;
  const span = view.domMax - view.domMin;
  const xPos = (v: number) => plotX + (span > 0 ? ((v - view.domMin) / span) * plotW : 0);
  const band = plotH / Math.max(1, n);
  const barH = Math.min(MAX_BAR, band * 0.9);

  const grid = axisTicks(view.domMin, view.domMax)
    .map((t) => {
      const x = fmt(xPos(t));
      return (
        `<line class="scds-grid" x1="${x}" x2="${x}" y1="${plotY}" y2="${plotY + plotH}" />` +
        `<text class="scds-tick" x="${x}" y="${plotY + plotH + 16}" text-anchor="middle">${pct0(t)}</text>`
      );
    })
    .join("");

  const bandRect =
    view.bandHi > view.bandLo
      ? `<rect class="scds-band" x="${fmt(xPos(view.bandLo))}" y="${plotY}" width="${fmt(xPos(view.bandHi) - xPos(view.bandLo))}" height="${plotH}" />`
      : "";

  const rows = view.bars
    .map((b: BarEntry, i) => {
      const cy = plotY + band * (i + 0.5);
      const y = cy - barH / 2;
      const x0 = xPos(view.domMin);
      const bw = Math.max(0, xPos(b.value) - x0);
      const tier = barTier(b.value, view.baseline);
      const neutral = tier.key === "neutral";
      const inkClass = neutral ? " is-neutral" : "";
      let labels = "";
      if (bw > 80) {
        labels =
          `<text class="scds-bar-pct${inkClass}" x="${fmt(x0 + bw - 7)}" y="${fmt(cy - 5)}" text-anchor="end" dominant-baseline="middle">${pct1(b.value)}</text>` +
          `<text class="scds-bar-lift${inkClass}" x="${fmt(x0 + bw - 7)}" y="${fmt(cy + 6)}" text-anchor="end" dominant-baseline="middle">${liftLabel(b.value, view.baseline)}</text>`;
      } else if (bw > 44) {
        labels = `<text class="scds-bar-pct${inkClass}" x="${fmt(x0 + bw - 7)}" y="${fmt(cy)}" text-anchor="end" dominant-baseline="middle">${pct1(b.value)}</text>`;
      }
      return (
        `<text class="scds-cat" x="${plotX - 6}" y="${fmt(cy)}" text-anchor="end" dominant-baseline="middle">${escapeHtml(b.name)}</text>` +
        `<rect class="scds-bar" data-tier="${tier.key}" x="${fmt(x0)}" y="${fmt(y)}" width="${fmt(bw)}" height="${fmt(barH)}" rx="3" ry="3" fill="${tier.color}">` +
        `<title>${escapeHtml(`${b.name}: ${pct1(b.value)} (${liftLabel(b.value, view.baseline)} vs average, n=${b.sample_size.toLocaleString("en-US")})`)}</title></rect>` +
        labels
      );
    })
    .join("");

  const bx = fmt(xPos(view.baseline));
  const avgText = `League Avg ${pct1(view.baseline)}`;
  const pw = avgText.length * 6.2 + 12;
  const baseline =
    `<line class="scds-baseline" x1="${bx}" x2="${bx}" y1="${plotY}" y2="${plotY + plotH}" />` +
    `<rect class="scds-avg-pill" x="${fmt(xPos(view.baseline) + 6)}" y="${plotY + 4}" width="${fmt(pw)}" height="16" rx="4" />` +
    `<text class="scds-avg-text" x="${fmt(xPos(view.baseline) + 12)}" y="${plotY + 15}">${escapeHtml(avgText)}</text>`;

  const hits = view.bars
    .map(
      (_, i) =>
        `<rect class="scds-hit" data-bar="${i}" x="${plotX}" y="${fmt(plotY + band * i)}" width="${fmt(plotW)}" height="${fmt(band)}" />`,
    )
    .join("");

  return (
    `<svg class="scds-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeHtml(label)}">` +
    grid +
    bandRect +
    rows +
    baseline +
    hits +
    `</svg>`
  );
}
