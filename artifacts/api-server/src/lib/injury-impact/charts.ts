/**
 * The dashboard's charts as SVG strings.
 *
 * The standalone app drew them with recharts (Dashboard.tsx, DraftStrategySection.tsx,
 * InjuryTagImpact.tsx): line charts with a confidence band and rule-change
 * markers, Kaplan-Meier survival curves, grouped and stacked bars, bubble
 * scatters with labels, and a horizontal bar chart. These are the same charts
 * without the library, so the server can put them in the page and the bundle
 * can redraw them at the column's width or with a series hidden.
 *
 * Every hover target carries its read-out as `data-tip` (HTML) on a
 * `.scin-hit` element; the bundle positions one tooltip element over it. With
 * scripting off the chart is complete and only the hover is missing. A
 * legend item is a button with `data-legend` and `data-series`, so a click can
 * hide one series and redraw, as the app's clickable legend did.
 */

import { escapeHtml } from "../render";

const FONT = 11;
const TICK_INK = "#71717a";
const GRID = "#e5e5e5";

const f1 = (n: number): string => (Math.round(n * 100) / 100).toString();

/** d3-style nice ticks over [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max === min) return [min];
  const span = max - min;
  const step0 = span / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.round(v * 1e9) / 1e9);
  return out.length ? out : [min];
}

/** A nice domain around the data: recharts' `[0, 'auto']` unless a floor is given. */
export function niceDomain(values: number[], floor: number | "auto" = 0, pad = 0): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return [0, 1];
  let lo = floor === "auto" ? Math.min(...finite) - pad : Math.min(floor, Math.min(...finite));
  let hi = Math.max(...finite) + pad;
  if (hi <= lo) hi = lo + 1;
  const ticks = niceTicks(lo, hi, 5);
  const step = ticks.length > 1 ? (ticks[1] as number) - (ticks[0] as number) : (hi - lo) / 4;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (floor !== "auto" && lo > floor) lo = floor;
  return [lo, hi];
}

export interface Series {
  key: string;
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  dots?: boolean;
  width?: number;
  hidden?: boolean;
}

export interface Legend {
  /** The chart id the legend toggles belong to; omitted = a static legend. */
  id?: string;
  items: { key: string; name: string; color: string; hidden: boolean }[];
}

export function renderLegend(legend: Legend): string {
  const items = legend.items
    .map((it) => {
      const tag = legend.id ? "button" : "span";
      const attrs = legend.id ? ` type="button" data-legend="${escapeHtml(legend.id)}" data-series="${escapeHtml(it.key)}" aria-pressed="${!it.hidden}"` : "";
      return `<${tag} class="scin-legend-item${it.hidden ? " is-off" : ""}"${attrs}><span class="scin-swatch" style="background:${it.color}"></span>${escapeHtml(it.name)}</${tag}>`;
    })
    .join("");
  return `<div class="scin-legend">${items}</div>`;
}

/** A tooltip body: a title row and one line per series. */
export function tipHtml(title: string, lines: { color?: string; name: string; value: string }[]): string {
  return (
    `<div class="scin-tip-title">${escapeHtml(title)}</div>` +
    lines
      .map((l) => `<div class="scin-tip-row">${l.color ? `<span class="scin-swatch" style="background:${l.color}"></span>` : ""}<span class="scin-tip-name">${escapeHtml(l.name)}</span><span class="scin-tip-val">${escapeHtml(l.value)}</span></div>`)
      .join("")
  );
}

const tipAttr = (html: string): string => ` data-tip="${escapeHtml(html)}"`;

/* ------------------------------------------------------------- line chart */

export interface LineChartSpec {
  id: string;
  categories: string[];
  series: Series[];
  width: number;
  height: number;
  yDomain?: [number, number];
  yFormat: (v: number) => string;
  /** The read-out's value format; defaults to yFormat. */
  tipFormat?: (v: number) => string;
  tipTitle?: (category: string) => string;
  xLabel?: string;
  yLabel?: string;
  /** Vertical markers at categories, with an optional label on top. */
  refX?: { category: string; label?: string }[];
  refY?: { value: number; label?: string }[];
  /** A confidence band drawn behind the lines. */
  band?: { lo: (number | null)[]; hi: (number | null)[]; color: string; name: string; format?: (lo: number, hi: number) => string };
  /** Numeric x: categories are numbers placed proportionally (the CDF). */
  xNumeric?: boolean;
  xFormat?: (v: number) => string;
  xDomain?: [number, number];
  legend?: boolean;
  /** Hide the vertical grid lines (the app's bar charts). */
  noVerticalGrid?: boolean;
  ariaLabel: string;
}

export function renderLineChart(spec: LineChartSpec): string {
  const w = Math.max(260, Math.round(spec.width));
  const h = spec.height;
  const yAxisW = 52;
  const m = { top: spec.refX?.some((r) => r.label) ? 22 : 10, right: 16, bottom: spec.xLabel ? 44 : 28, left: yAxisW + (spec.yLabel ? 18 : 0) };
  const pw = w - m.left - m.right;
  const ph = h - m.top - m.bottom;
  const shown = spec.series.filter((s) => !s.hidden);
  const all = shown.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (spec.band) all.push(...spec.band.lo.filter((v): v is number => v != null), ...spec.band.hi.filter((v): v is number => v != null));
  const [y0, y1] = spec.yDomain ?? niceDomain(all);
  const yTicks = niceTicks(y0, y1, 5);
  const ys = (v: number) => m.top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;

  const n = spec.categories.length;
  let xs: (i: number) => number;
  let xNums: number[] = [];
  if (spec.xNumeric) {
    xNums = spec.categories.map(Number);
    const [x0, x1] = spec.xDomain ?? [Math.min(...xNums), Math.max(...xNums)];
    xs = (i: number) => m.left + (((xNums[i] as number) - x0) / (x1 - x0 || 1)) * pw;
  } else {
    xs = (i: number) => m.left + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  }

  let out = "";
  // Grid and axes.
  for (const t of yTicks) {
    const y = f1(ys(t));
    out += `<line class="scin-grid" x1="${m.left}" x2="${m.left + pw}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-dasharray="3 3" />`;
    out += `<text x="${m.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="${FONT}" fill="${TICK_INK}">${escapeHtml(spec.yFormat(t))}</text>`;
  }
  const xTickIdx: number[] = [];
  if (spec.xNumeric) {
    const [x0, x1] = spec.xDomain ?? [Math.min(...xNums), Math.max(...xNums)];
    for (const t of niceTicks(x0, x1, 6)) {
      const x = f1(m.left + ((t - x0) / (x1 - x0 || 1)) * pw);
      out += `<text x="${x}" y="${m.top + ph + 16}" text-anchor="middle" font-size="${FONT}" fill="${TICK_INK}">${escapeHtml((spec.xFormat ?? ((v) => String(v)))(t))}</text>`;
    }
  } else {
    const every = Math.max(1, Math.ceil((n * 34) / Math.max(1, pw)));
    for (let i = 0; i < n; i += 1) {
      if (i % every !== 0 && i !== n - 1) continue;
      xTickIdx.push(i);
      const x = f1(xs(i));
      if (!spec.noVerticalGrid) out += `<line class="scin-grid" x1="${x}" x2="${x}" y1="${m.top}" y2="${m.top + ph}" stroke="${GRID}" stroke-dasharray="3 3" />`;
      out += `<text x="${x}" y="${m.top + ph + 16}" text-anchor="middle" font-size="${FONT}" fill="${TICK_INK}">${escapeHtml(spec.categories[i] as string)}</text>`;
    }
  }
  out += `<line x1="${m.left}" x2="${m.left + pw}" y1="${f1(m.top + ph)}" y2="${f1(m.top + ph)}" stroke="${TICK_INK}" />`;
  out += `<line x1="${m.left}" x2="${m.left}" y1="${m.top}" y2="${f1(m.top + ph)}" stroke="${TICK_INK}" />`;
  if (spec.xLabel) out += `<text x="${f1(m.left + pw / 2)}" y="${h - 6}" text-anchor="middle" font-size="${FONT + 1}" fill="${TICK_INK}">${escapeHtml(spec.xLabel)}</text>`;
  if (spec.yLabel) out += `<text transform="translate(12 ${f1(m.top + ph / 2)}) rotate(-90)" text-anchor="middle" font-size="${FONT + 1}" fill="${TICK_INK}">${escapeHtml(spec.yLabel)}</text>`;

  // Reference lines.
  for (const r of spec.refX ?? []) {
    const i = spec.categories.indexOf(r.category);
    if (i < 0) continue;
    const x = f1(xs(i));
    out += `<line x1="${x}" x2="${x}" y1="${m.top}" y2="${f1(m.top + ph)}" stroke="#64748b" stroke-dasharray="4 4" />`;
    if (r.label) out += `<text x="${x}" y="${m.top - 8}" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(r.label)}</text>`;
  }
  for (const r of spec.refY ?? []) {
    const y = f1(ys(r.value));
    out += `<line x1="${m.left}" x2="${m.left + pw}" y1="${y}" y2="${y}" stroke="#94a3b8" stroke-dasharray="4 4" />`;
    if (r.label) out += `<text x="${m.left + pw - 2}" y="${f1(ys(r.value) - 4)}" text-anchor="end" font-size="10" fill="#94a3b8">${escapeHtml(r.label)}</text>`;
  }

  // The confidence band.
  if (spec.band) {
    const b = spec.band;
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const lo = b.lo[i];
      const hi = b.hi[i];
      if (lo == null || hi == null) continue;
      top.push(`${f1(xs(i))},${f1(ys(hi))}`);
      bottom.unshift(`${f1(xs(i))},${f1(ys(lo))}`);
    }
    if (top.length > 1) out += `<polygon points="${[...top, ...bottom].join(" ")}" fill="${b.color}" fill-opacity="0.12" />`;
  }

  // Lines and dots.
  for (const s of shown) {
    const pts: string[] = [];
    let seg: string[] = [];
    const flush = () => {
      if (seg.length) pts.push(seg.join(" "));
      seg = [];
    };
    s.values.forEach((v, i) => {
      if (v == null) return flush();
      seg.push(`${f1(xs(i))},${f1(ys(v))}`);
    });
    flush();
    for (const p of pts) {
      out += `<polyline points="${p}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2.5}"${s.dashed ? ' stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round" />`;
    }
    if (s.dots) {
      s.values.forEach((v, i) => {
        if (v == null) return;
        out += `<circle cx="${f1(xs(i))}" cy="${f1(ys(v))}" r="3.5" fill="${s.color}" />`;
      });
    }
  }

  // Hit bands with the read-out per category.
  const tipFormat = spec.tipFormat ?? spec.yFormat;
  for (let i = 0; i < n; i += 1) {
    const lines: { color?: string; name: string; value: string }[] = [];
    if (spec.band) {
      const lo = spec.band.lo[i];
      const hi = spec.band.hi[i];
      if (lo != null && hi != null) lines.push({ color: spec.band.color, name: spec.band.name, value: spec.band.format ? spec.band.format(lo, hi) : `${tipFormat(lo)} to ${tipFormat(hi)}` });
    }
    for (const s of shown) {
      const v = s.values[i];
      lines.push({ color: s.color, name: s.name, value: v == null ? "-" : tipFormat(v) });
    }
    if (!lines.length) continue;
    const title = spec.tipTitle ? spec.tipTitle(spec.categories[i] as string) : (spec.categories[i] as string);
    const x = xs(i);
    const left = i === 0 ? m.left : (xs(i - 1) + x) / 2;
    const right = i === n - 1 ? m.left + pw : (x + xs(i + 1)) / 2;
    out += `<rect class="scin-hit" x="${f1(left)}" y="${m.top}" width="${f1(Math.max(1, right - left))}" height="${f1(ph)}" fill="transparent"${tipAttr(tipHtml(title, lines))} />`;
  }

  const svg = `<svg class="scin-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeHtml(spec.ariaLabel)}">${out}</svg>`;
  const legend = spec.legend === false ? "" : renderLegend({ id: spec.id, items: spec.series.map((s) => ({ key: s.key, name: s.name, color: s.color, hidden: !!s.hidden })) });
  return `<figure class="scin-chart" data-chart="${escapeHtml(spec.id)}">${svg}${legend}</figure>`;
}

/* -------------------------------------------------------------- bar chart */

export interface BarChartSpec {
  id: string;
  categories: string[];
  series: Series[];
  width: number;
  height: number;
  stacked?: boolean;
  yFormat: (v: number) => string;
  tipFormat?: (v: number) => string;
  maxBarSize?: number;
  legend?: boolean;
  ariaLabel: string;
  /** Rotate the category labels (long strategy names). */
  tiltLabels?: boolean;
}

export function renderBarChart(spec: BarChartSpec): string {
  const w = Math.max(260, Math.round(spec.width));
  const h = spec.height;
  const m = { top: 10, right: 16, bottom: spec.tiltLabels ? 64 : 28, left: 52 };
  const pw = w - m.left - m.right;
  const ph = h - m.top - m.bottom;
  const shown = spec.series.filter((s) => !s.hidden);
  const n = spec.categories.length;
  const totals = spec.categories.map((_, i) => (spec.stacked ? shown.reduce((s, ser) => s + (ser.values[i] ?? 0), 0) : Math.max(0, ...shown.map((ser) => ser.values[i] ?? 0))));
  const [y0, y1] = niceDomain(totals);
  const yTicks = niceTicks(y0, y1, 5);
  const ys = (v: number) => m.top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const band = pw / Math.max(1, n);
  const groupW = band * 0.8;
  const maxBar = spec.maxBarSize ?? 40;

  let out = "";
  for (const t of yTicks) {
    const y = f1(ys(t));
    out += `<line class="scin-grid" x1="${m.left}" x2="${m.left + pw}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-dasharray="3 3" />`;
    out += `<text x="${m.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="${FONT}" fill="${TICK_INK}">${escapeHtml(spec.yFormat(t))}</text>`;
  }
  out += `<line x1="${m.left}" x2="${m.left + pw}" y1="${f1(m.top + ph)}" y2="${f1(m.top + ph)}" stroke="${TICK_INK}" />`;
  const tipFormat = spec.tipFormat ?? spec.yFormat;
  for (let i = 0; i < n; i += 1) {
    const cx = m.left + band * (i + 0.5);
    if (spec.tiltLabels) {
      out += `<text transform="translate(${f1(cx)} ${m.top + ph + 10}) rotate(-35)" text-anchor="end" font-size="10" fill="${TICK_INK}">${escapeHtml(spec.categories[i] as string)}</text>`;
    } else {
      out += `<text x="${f1(cx)}" y="${m.top + ph + 16}" text-anchor="middle" font-size="${FONT}" fill="${TICK_INK}">${escapeHtml(spec.categories[i] as string)}</text>`;
    }
    if (spec.stacked) {
      let acc = 0;
      const bw = Math.min(maxBar, groupW);
      for (const s of shown) {
        const v = s.values[i] ?? 0;
        if (v <= 0) continue;
        const yTop = ys(acc + v);
        const yBot = ys(acc);
        out += `<rect x="${f1(cx - bw / 2)}" y="${f1(yTop)}" width="${f1(bw)}" height="${f1(Math.max(0, yBot - yTop))}" fill="${s.color}" />`;
        acc += v;
      }
    } else {
      const k = Math.max(1, shown.length);
      const bw = Math.min(maxBar, groupW / k);
      const start = cx - (bw * k) / 2;
      shown.forEach((s, j) => {
        const v = s.values[i] ?? 0;
        const yTop = ys(Math.max(0, v));
        const yBot = ys(0);
        out += `<rect x="${f1(start + j * bw)}" y="${f1(yTop)}" width="${f1(Math.max(0, bw - 1))}" height="${f1(Math.max(0, yBot - yTop))}" fill="${s.color}" rx="2" />`;
      });
    }
    const lines = shown.map((s) => ({ color: s.color, name: s.name, value: tipFormat(s.values[i] ?? 0) }));
    out += `<rect class="scin-hit" x="${f1(m.left + band * i)}" y="${m.top}" width="${f1(band)}" height="${f1(ph)}" fill="transparent"${tipAttr(tipHtml(spec.categories[i] as string, lines))} />`;
  }
  const svg = `<svg class="scin-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeHtml(spec.ariaLabel)}">${out}</svg>`;
  const legend = spec.legend === false ? "" : renderLegend({ id: spec.id, items: spec.series.map((s) => ({ key: s.key, name: s.name, color: s.color, hidden: !!s.hidden })) });
  return `<figure class="scin-chart" data-chart="${escapeHtml(spec.id)}">${svg}${legend}</figure>`;
}

/* ----------------------------------------------------------- scatter plot */

export interface ScatterPointSpec {
  x: number;
  y: number;
  /** Bubble size weight; scaled to the spec's radius range. */
  z?: number;
  label?: string;
  color: string;
  /** The series (legend group) the point belongs to. */
  series: string;
  tip: string;
}

export interface ScatterSpec {
  id: string;
  points: ScatterPointSpec[];
  groups: { key: string; name: string; color: string; hidden: boolean }[];
  width: number;
  height: number;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Radius range for z; a fixed radius when z is absent. */
  radius?: [number, number];
  legend?: boolean;
  ariaLabel: string;
}

export function renderScatter(spec: ScatterSpec): string {
  const w = Math.max(260, Math.round(spec.width));
  const h = spec.height;
  const m = { top: 20, right: 30, bottom: spec.xLabel ? 46 : 30, left: spec.yLabel ? 70 : 56 };
  const pw = w - m.left - m.right;
  const ph = h - m.top - m.bottom;
  const hidden = new Set(spec.groups.filter((g) => g.hidden).map((g) => g.key));
  const pts = spec.points.filter((p) => !hidden.has(p.series));
  const [x0, x1] = spec.xDomain ?? niceDomain(pts.map((p) => p.x), "auto", 0);
  const [y0, y1] = spec.yDomain ?? niceDomain(pts.map((p) => p.y), "auto", 0);
  const xs = (v: number) => m.left + ((v - x0) / (x1 - x0 || 1)) * pw;
  const ys = (v: number) => m.top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const [r0, r1] = spec.radius ?? [5, 5];
  const zs = pts.map((p) => p.z ?? 0);
  const zMin = Math.min(...zs, 0);
  const zMax = Math.max(...zs, 1);
  const rOf = (z: number | undefined) => (z == null ? r0 : r0 + ((z - zMin) / (zMax - zMin || 1)) * (r1 - r0));

  let out = "";
  for (const t of niceTicks(y0, y1, 5)) {
    const y = f1(ys(t));
    out += `<line x1="${m.left}" x2="${m.left + pw}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-dasharray="3 3" />`;
    out += `<text x="${m.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="${FONT}" fill="${TICK_INK}">${escapeHtml(spec.yFormat(t))}</text>`;
  }
  for (const t of niceTicks(x0, x1, 6)) {
    const x = f1(xs(t));
    out += `<line x1="${x}" x2="${x}" y1="${m.top}" y2="${f1(m.top + ph)}" stroke="${GRID}" stroke-dasharray="3 3" />`;
    out += `<text x="${x}" y="${m.top + ph + 16}" text-anchor="middle" font-size="${FONT}" fill="${TICK_INK}">${escapeHtml(spec.xFormat(t))}</text>`;
  }
  out += `<line x1="${m.left}" x2="${m.left + pw}" y1="${f1(m.top + ph)}" y2="${f1(m.top + ph)}" stroke="${TICK_INK}" />`;
  out += `<line x1="${m.left}" x2="${m.left}" y1="${m.top}" y2="${f1(m.top + ph)}" stroke="${TICK_INK}" />`;
  if (spec.xLabel) out += `<text x="${f1(m.left + pw / 2)}" y="${h - 8}" text-anchor="middle" font-size="${FONT + 1}" fill="${TICK_INK}">${escapeHtml(spec.xLabel)}</text>`;
  if (spec.yLabel) out += `<text transform="translate(14 ${f1(m.top + ph / 2)}) rotate(-90)" text-anchor="middle" font-size="${FONT + 1}" fill="${TICK_INK}">${escapeHtml(spec.yLabel)}</text>`;

  for (const p of pts) {
    const cx = f1(xs(p.x));
    const cy = f1(ys(p.y));
    const r = rOf(p.z);
    out += `<circle class="scin-hit" cx="${cx}" cy="${cy}" r="${f1(r)}" fill="${p.color}" fill-opacity="0.65" stroke="${p.color}" stroke-width="1"${tipAttr(p.tip)} />`;
    if (p.label) out += `<text x="${cx}" y="${f1(ys(p.y) - r - 4)}" text-anchor="middle" font-size="10" font-weight="600" fill="${TICK_INK}">${escapeHtml(p.label)}</text>`;
  }
  const svg = `<svg class="scin-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeHtml(spec.ariaLabel)}">${out}</svg>`;
  const legend = spec.legend === false ? "" : renderLegend({ id: spec.id, items: spec.groups });
  return `<figure class="scin-chart" data-chart="${escapeHtml(spec.id)}">${svg}${legend}</figure>`;
}

/* -------------------------------------------------------- horizontal bars */

export interface HBarSpec {
  id: string;
  rows: { name: string; value: number; text: string; tip: string }[];
  width: number;
  max: number;
  ticks: number[];
  tickFormat: (v: number) => string;
  refX?: number;
  color: string;
  ariaLabel: string;
}

export function renderHBars(spec: HBarSpec): string {
  const w = Math.max(260, Math.round(spec.width));
  const labelW = Math.min(190, Math.max(90, Math.round(w * 0.3)));
  const m = { top: 6, right: 54, bottom: 24, left: labelW };
  const rowH = 30;
  const h = m.top + m.bottom + rowH * spec.rows.length;
  const pw = w - m.left - m.right;
  const xs = (v: number) => m.left + (Math.min(v, spec.max) / spec.max) * pw;
  let out = "";
  for (const t of spec.ticks) {
    const x = f1(xs(t));
    out += `<line x1="${x}" x2="${x}" y1="${m.top}" y2="${f1(h - m.bottom)}" stroke="#eef0f3" />`;
    out += `<text x="${x}" y="${h - 8}" text-anchor="middle" font-size="${FONT}" fill="#6b7280">${escapeHtml(spec.tickFormat(t))}</text>`;
  }
  if (spec.refX != null) out += `<line x1="${f1(xs(spec.refX))}" x2="${f1(xs(spec.refX))}" y1="${m.top}" y2="${f1(h - m.bottom)}" stroke="#9ca3af" stroke-dasharray="3 3" />`;
  spec.rows.forEach((r, i) => {
    const y = m.top + rowH * i;
    const bh = 22;
    out += `<text x="${m.left - 10}" y="${f1(y + rowH / 2)}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="#374151">${escapeHtml(r.name)}</text>`;
    out += `<rect class="scin-hit" x="${m.left}" y="${f1(y + (rowH - bh) / 2)}" width="${f1(Math.max(0, xs(r.value) - m.left))}" height="${bh}" rx="4" fill="${spec.color}"${tipAttr(r.tip)} />`;
    out += `<text x="${f1(xs(r.value) + 6)}" y="${f1(y + rowH / 2)}" dominant-baseline="middle" font-size="12" font-weight="600" fill="#111827">${escapeHtml(r.text)}</text>`;
  });
  return `<figure class="scin-chart" data-chart="${escapeHtml(spec.id)}"><svg class="scin-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeHtml(spec.ariaLabel)}">${out}</svg></figure>`;
}
