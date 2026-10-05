/**
 * The rookie hit rate charts, as SVG strings.
 *
 * The standalone app drew three charts with recharts: the Pick Lens bars, the
 * Hit Rate Trends lines and the Time to Breakout lines. These are the same
 * charts without the library - the same axes, domains, reference lines, dash
 * patterns and `type="monotone"` curve (d3's monotoneX, which is what recharts
 * draws for it) - so the server can put them in the page and the bundle can
 * redraw them at the column's real width.
 *
 * Every column of a line chart carries an invisible hit band (`.schr-hit`,
 * `data-x`) that the bundle hangs its tooltip on; with scripting off the chart
 * is still complete, only the hover read-out is missing.
 */

import { escapeHtml } from "../render";

export interface LinePoint {
  x: number;
  y: number;
}

export interface LineSeries {
  key: string;
  name: string;
  color: string;
  dash?: string;
  width?: number;
  /** Ringed dots, as the survival chart's (white stroke); plain otherwise. */
  ringed?: boolean;
  dotRadius?: number;
  points: LinePoint[];
}

export interface LineChartOptions {
  width: number;
  height: number;
  xs: number[];
  yMax: number;
  yTicks: number[];
  series: LineSeries[];
  /** A dashed horizontal line (the trends chart's average). */
  refY?: number | null;
  /** A dashed vertical line with a label (the survival chart's Year 3). */
  refX?: { x: number; label: string } | null;
  xLabel?: string;
  /** Accessible name for the whole chart. */
  label: string;
}

const MARGIN = { top: 14, right: 14, bottom: 26, left: 44 };

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function pctTick(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

/**
 * d3-shape's curveMonotoneX: a cubic through every point whose tangents never
 * overshoot, so a hit rate never draws below 0% between two classes.
 */
export function monotonePath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${fmt(points[0]!.x)},${fmt(points[0]!.y)}`;
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const slope3 = (i: number): number => {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const h0 = p1.x - p0.x;
    const h1 = p2.x - p1.x;
    const s0 = (p1.y - p0.y) / (h0 || (h1 < 0 ? -0 : 0));
    const s1 = (p2.y - p1.y) / (h1 || (h0 < 0 ? -0 : 0));
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  };
  const slope2 = (i0: number, i1: number, t: number): number => {
    const h = points[i1]!.x - points[i0]!.x;
    return h ? ((3 * (points[i1]!.y - points[i0]!.y)) / h - t) / 2 : t;
  };
  const tangents: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) tangents[i] = slope3(i);
  if (n === 2) {
    const m = (points[1]!.y - points[0]!.y) / (points[1]!.x - points[0]!.x || 1);
    tangents[0] = m;
    tangents[1] = m;
  } else {
    tangents[0] = slope2(0, 1, tangents[1]!);
    tangents[n - 1] = slope2(n - 2, n - 1, tangents[n - 2]!);
  }
  let d = `M${fmt(points[0]!.x)},${fmt(points[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = (b.x - a.x) / 3;
    d +=
      `C${fmt(a.x + dx)},${fmt(a.y + dx * tangents[i]!)},` +
      `${fmt(b.x - dx)},${fmt(b.y - dx * tangents[i + 1]!)},${fmt(b.x)},${fmt(b.y)}`;
  }
  return d;
}

/** Ticks for a 0-based percentage axis whose top is "auto", as recharts picks it. */
export function niceTicks(max: number): { max: number; ticks: number[] } {
  const top = Math.max(max, 0.0001);
  const steps = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25];
  const step = steps.find((s) => top / s <= 5) ?? 0.25;
  const niceMax = Math.round(Math.ceil(top / step - 1e-9) * step * 10000) / 10000;
  const ticks: number[] = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(Math.round(v * 10000) / 10000);
  return { max: niceMax, ticks };
}

export function renderLineChart(o: LineChartOptions): string {
  const w = Math.max(240, Math.round(o.width));
  const h = Math.round(o.height);
  const iw = w - MARGIN.left - MARGIN.right;
  const ih = h - MARGIN.top - MARGIN.bottom - (o.xLabel ? 12 : 0);
  const xs = o.xs;
  // recharts' category axis: each x gets an equal band and sits in its middle.
  const band = iw / Math.max(1, xs.length);
  const xPos = (x: number) => MARGIN.left + band * (xs.indexOf(x) + 0.5);
  const yPos = (y: number) => MARGIN.top + ih - (o.yMax > 0 ? (y / o.yMax) * ih : 0);

  const grid = o.yTicks
    .map((t) => {
      const y = fmt(yPos(t));
      return (
        `<line class="schr-grid" x1="${MARGIN.left}" x2="${MARGIN.left + iw}" y1="${y}" y2="${y}" />` +
        `<text class="schr-tick" x="${MARGIN.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${pctTick(t)}</text>`
      );
    })
    .join("");

  const xTicks = xs
    .map(
      (x) =>
        `<text class="schr-tick" x="${fmt(xPos(x))}" y="${MARGIN.top + ih + 16}" text-anchor="middle">${x}</text>`,
    )
    .join("");

  const xLabel = o.xLabel
    ? `<text class="schr-axis-label" x="${fmt(MARGIN.left + iw / 2)}" y="${h - 4}" text-anchor="middle">${escapeHtml(o.xLabel)}</text>`
    : "";

  const refY =
    o.refY !== undefined && o.refY !== null
      ? `<line class="schr-ref is-avg" x1="${MARGIN.left}" x2="${MARGIN.left + iw}" y1="${fmt(yPos(o.refY))}" y2="${fmt(yPos(o.refY))}" />`
      : "";

  const refX =
    o.refX && xs.includes(o.refX.x)
      ? `<line class="schr-ref is-year" x1="${fmt(xPos(o.refX.x))}" x2="${fmt(xPos(o.refX.x))}" y1="${MARGIN.top}" y2="${MARGIN.top + ih}" />` +
        `<text class="schr-ref-label" x="${fmt(xPos(o.refX.x))}" y="${MARGIN.top - 3}" text-anchor="middle">${escapeHtml(o.refX.label)}</text>`
      : "";

  const lines = o.series
    .map((s) => {
      const pts = s.points.filter((p) => xs.includes(p.x)).map((p) => ({ x: xPos(p.x), y: yPos(p.y) }));
      if (!pts.length) return "";
      const r = s.dotRadius ?? 2.5;
      const dots = pts
        .map(
          (p) =>
            `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${r}" fill="${s.color}"` +
            (s.ringed ? ` stroke="#fff" stroke-width="1.5"` : "") +
            ` />`,
        )
        .join("");
      return (
        `<g class="schr-series" data-series="${escapeHtml(s.key)}">` +
        `<path d="${monotonePath(pts)}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2}"` +
        (s.dash ? ` stroke-dasharray="${s.dash}"` : "") +
        ` stroke-linejoin="round" stroke-linecap="round" />` +
        dots +
        `</g>`
      );
    })
    .join("");

  const hits = xs
    .map(
      (x) =>
        `<rect class="schr-hit" data-x="${x}" x="${fmt(xPos(x) - band / 2)}" y="${MARGIN.top}" width="${fmt(band)}" height="${ih}" />`,
    )
    .join("");

  return (
    `<svg class="schr-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeHtml(o.label)}">` +
    grid +
    xTicks +
    xLabel +
    refY +
    refX +
    lines +
    `<line class="schr-cursor" x1="0" x2="0" y1="${MARGIN.top}" y2="${MARGIN.top + ih}" visibility="hidden" />` +
    hits +
    `</svg>`
  );
}

export interface Bar {
  name: string;
  value: number;
  color: string;
}

/** The Pick Lens "Hit by Year" bars: 0-100%, a label over each bar. */
export function renderBarChart(bars: Bar[], width: number, height: number, label: string): string {
  const w = Math.max(160, Math.round(width));
  const h = Math.round(height);
  const m = { top: 14, right: 4, bottom: 18, left: 34 };
  const iw = w - m.left - m.right;
  const ih = h - m.top - m.bottom;
  const band = iw / Math.max(1, bars.length);
  const barW = Math.min(28, band * 0.85);
  const yPos = (v: number) => m.top + ih - v * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (t) =>
        `<text class="schr-tick" x="${m.left - 6}" y="${fmt(yPos(t))}" text-anchor="end" dominant-baseline="middle">${pctTick(t)}</text>`,
    )
    .join("");
  const body = bars
    .map((b, i) => {
      const cx = m.left + band * (i + 0.5);
      const top = yPos(b.value);
      const bh = Math.max(0, m.top + ih - top);
      const r = Math.min(4, bh / 2, barW / 2);
      const x = cx - barW / 2;
      // Rounded top corners only, as recharts' radius={[4,4,0,0]}.
      const path =
        bh > 0
          ? `M${fmt(x)},${fmt(top + bh)}V${fmt(top + r)}Q${fmt(x)},${fmt(top)} ${fmt(x + r)},${fmt(top)}` +
            `H${fmt(x + barW - r)}Q${fmt(x + barW)},${fmt(top)} ${fmt(x + barW)},${fmt(top + r)}V${fmt(top + bh)}Z`
          : "";
      return (
        (path ? `<path d="${path}" fill="${b.color}"><title>${escapeHtml(`${b.name}: ${(b.value * 100).toFixed(1)}%`)}</title></path>` : "") +
        `<text class="schr-bar-label" x="${fmt(cx)}" y="${fmt(top - 4)}" text-anchor="middle">${pctTick(b.value)}</text>` +
        `<text class="schr-tick" x="${fmt(cx)}" y="${h - 4}" text-anchor="middle">${escapeHtml(b.name)}</text>`
      );
    })
    .join("");
  return (
    `<svg class="schr-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeHtml(label)}">` +
    ticks +
    body +
    `</svg>`
  );
}
