/**
 * The premium comparison version of Coaching Career & Historical
 * Performance (mak's brief, 2026-11-05, built to
 * attached_assets/historical reference.png): the navy header with the
 * headset, the career as wide horizontal stop rows on a vertical rail with
 * the current stop in gold, and the points-per-game history as a large
 * chart with team-colored stop segments, the NFL average, era pills, the
 * peak and current callouts, a legend and a methodology strip.
 *
 * Since 2026-11-05 ("remove the older version") this IS the section: the
 * original heading, timeline and chart were deleted on 2026-11-10
 * and only its season-by-season table follows. Every number is the
 * original's own model: readStops() and
 * stopColors() for the chart, timelineStepModel() for the rows, the league
 * averages from getLeaguePpg(); nothing is fetched or computed twice. The
 * block shares the premium tokens (`.sct-cp`, `.sct-cpt`) and adds
 * `.sct-cc-*` rules in team.css.
 */

import { escapeHtml } from "../render";
import { getLeaguePpg, type TeamCoaching } from "./coaching";
import { readStops, seasonOf, stepLogo, stopColors, surnameOf, timelineStepModel, type Stop, type TimelineStep } from "./coaching-render";
import { usageStyleHead } from "./coaching-premium-tendencies";

const e = escapeHtml;
const f1 = (n: number) => String(Math.round(n * 10) / 10);

const HEADSET = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2z"/><path d="M20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"/><path d="M17 18v1a2 2 0 0 1-2 2h-2"/></g></svg>`;

/* ---------------------------------------------------------------- timeline */

/** The stop the coach is on this season: the step whose span holds it, never just the last row. */
function currentStep(steps: TimelineStep[], season: number): TimelineStep | null {
  return steps.find((s) => s.start <= season && season <= s.end) ?? null;
}

/**
 * The role as one short line (mak's compact pass, 2026-11-08): clauses
 * joined by a dot, "Assistant" shortened, a leading award year moved to the
 * end ("2025 AP Assistant Coach of the Year" -> "AP Asst. Coach of the
 * Year (2025)"). The stored wording stays in the row's title.
 */
export function compactRole(role: string): string {
  return role
    .split(/\s*;\s*/)
    .map((part) => part.replace(/\bAssistant Coach of the Year\b/, "Asst. Coach of the Year").replace(/^(\d{4})\s+(.+)$/, "$2 ($1)"))
    .join(" · ");
}

function stopRow(step: TimelineStep, current: boolean): string {
  const club = (code: string) => {
    const logo = stepLogo(code);
    return (
      `<span class="sct-cc-club">` +
      (logo ? `<img class="sct-cc-crest" src="${e(logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : "") +
      `<span class="sct-cc-code">${e(code)}</span></span>`
    );
  };
  const role = compactRole(step.role);
  const full = step.full ?? (role !== step.role ? step.role : null);
  return (
    `<li class="sct-cc-stop${current ? " is-current" : ""}"${current ? ` aria-current="step"` : ""}${full ? ` title="${e(full)}"` : ""}>` +
    `<span class="sct-cc-node" aria-hidden="true"></span>` +
    `<span class="sct-cc-years">${e(step.years)}</span>` +
    `<span class="sct-cc-team">${step.codes.map(club).join(`<span class="sct-cc-slash" aria-hidden="true">/</span>`)}</span>` +
    `<span class="sct-cc-role">${e(role)}${current ? `<span class="sct-visually-hidden"> (current stop)</span>` : ""}</span>` +
    (current ? `<span class="sct-cc-now" aria-hidden="true">Current</span>` : "") +
    `</li>`
  );
}

function timeline(c: TeamCoaching): string {
  const steps = c.playCaller.careerPath.map(timelineStepModel);
  if (!steps.length) return "";
  const now = currentStep(steps, seasonOf(c));
  return `<ol class="sct-cc-stops" aria-label="${e(`${c.playCaller.name}'s coaching stops`)}">${steps.map((s) => stopRow(s, s === now)).join("")}</ol>`;
}

/* ------------------------------------------------------------------- chart */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The first candidate box inside the bounds that touches nothing placed; the last candidate if all do. */
function place(cands: Rect[], placed: Rect[], bounds: Rect): Rect {
  const inside = (r: Rect) => r.x >= bounds.x && r.y >= bounds.y && r.x + r.w <= bounds.x + bounds.w && r.y + r.h <= bounds.y + bounds.h;
  return cands.find((r) => inside(r) && !placed.some((p) => hits(r, p))) ?? cands.find(inside) ?? cands[cands.length - 1]!;
}

/** A rounded label: a pill (one word) or a callout (a figure and a word). */
function box(r: Rect, cls: string, inner: string): string {
  return `<g class="${cls}"><rect x="${f1(r.x)}" y="${f1(r.y)}" width="${f1(r.w)}" height="${f1(r.h)}" rx="6"/>${inner}</g>`;
}

/**
 * The scoring history at one width. Two are rendered (1100 and 720 wide)
 * and the container query shows one, so the type holds its size on a
 * narrow column instead of scaling down with the viewBox.
 */
function chartSvg(stops: Stop[], colors: Map<string, string>, league: Record<string, number>, W: number, H: number, narrow: boolean, phone: "" | "s" | "m" = ""): string {
  // Phones (mak, 2026-11-15): drawn to the screen's width, so nothing
  // scrolls or clips; the NFL AVG end pill gives way to the legend.
  const padL = phone ? 26 : 38;
  const padR = phone ? 10 : narrow ? 64 : 70;
  const padT = phone ? 22 : 30;
  const padB = phone ? 22 : 30;
  const x0 = Math.min(...stops.map((s) => s.start));
  const x1 = Math.max(...stops.map((s) => s.end)) + 1;
  const leagueIn = Object.entries(league)
    .filter(([y]) => Number(y) >= x0 && Number(y) < x1)
    .map(([, v]) => v);
  const vals = [...stops.flatMap((s) => s.points.map((p) => p.ppg)), ...leagueIn];
  // Bounds from the data with a little air, on fives; ticks every ten past a 20-point range.
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 2) / 5) * 5);
  const hi = Math.ceil((Math.max(...vals) + 2) / 5) * 5;
  const step = hi - lo > 20 ? 10 : 5;
  const x = (yr: number) => padL + ((yr - x0) / (x1 - x0)) * (W - padL - padR);
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const bounds: Rect = { x: 2, y: 2, w: W - 4, h: H - padB - 2 };
  const placed: Rect[] = [];

  let grid = "";
  for (let v = lo; v <= hi; v += step) {
    grid +=
      `<line class="sct-cc-grid${v === lo ? " is-base" : ""}" x1="${padL}" x2="${phone ? W - padR : W - padR + 28}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>` +
      `<text class="sct-cc-tick" x="${padL - (phone ? 5 : 8)}" y="${f1(y(v))}" text-anchor="end" dominant-baseline="middle">${v}</text>`;
  }
  // Phones name the axis once, over the ticks.
  if (phone) grid += `<text class="sct-cc-unit" x="${padL - 5}" y="${padT - 12}" text-anchor="end">PPG</text>`;

  // Year labels: each stop's first season and the last season on the line,
  // longer stints claiming their slot first; the current year reads bold.
  const minGap = phone ? 44 : narrow ? 40 : 48;
  // The last season on the line always gets its label (it is the current year); then the stops' first seasons, longer stints first.
  const wanted = stops.filter((s) => s.start !== x1 - 1).map((s) => ({ yr: s.start, span: s.end - s.start + 1 }));
  wanted.push({ yr: x1 - 1, span: Infinity });
  const slots: Array<{ yr: number; xx: number }> = [];
  for (const w of [...wanted].sort((a, b) => b.span - a.span)) {
    const xx = x(w.yr + 0.5);
    if (slots.some((p) => Math.abs(p.xx - xx) < minGap)) continue;
    slots.push({ yr: w.yr, xx });
  }
  const current = stops.find((s) => s.current);
  const years = slots
    .sort((a, b) => a.xx - b.xx)
    .map((p) => `<text class="sct-cc-year${current && p.yr === current.end ? " is-current" : ""}" x="${f1(Math.min(p.xx, W - padR - 12))}" y="${H - (phone ? 5 : 8)}" text-anchor="middle">${p.yr}</text>`)
    .join("");

  // The league average, one point per season at the season's midpoint, labeled at its end.
  const pts: string[] = [];
  let avgEnd: { x: number; y: number } | null = null;
  for (let yr = x0; yr < x1; yr++) {
    const v = league[String(yr)];
    if (v == null) continue;
    avgEnd = { x: x(yr + 0.5), y: y(v) };
    pts.push(`${f1(avgEnd.x)},${f1(avgEnd.y)}`);
  }
  let avg = "";
  if (pts.length >= 2 && avgEnd) {
    avg = `<polyline class="sct-cc-avg" points="${pts.join(" ")}"/>`;
  }
  if (!phone && pts.length >= 2 && avgEnd) {
    const r = place([{ x: W - padR + 8, y: avgEnd.y - 9, w: 54, h: 18 }], placed, bounds);
    placed.push(r);
    avg += box(r, "sct-cc-pill is-avg", `<text x="${f1(r.x + r.w / 2)}" y="${f1(r.y + r.h / 2)}" text-anchor="middle" dominant-baseline="middle">NFL AVG</text>`);
  }

  type Dot = { year: number; ppg: number; rank: string; px: number; py: number };
  const segs = stops.map((s) => {
    const dots: Dot[] = s.points.map((p) => ({ ...p, px: x(p.year + 0.5), py: y(p.ppg) }));
    return { s, xa: x(s.start) + 2, xb: x(s.end + 1) - 2, dots, yFirst: dots[0]!.py, yLast: dots[dots.length - 1]!.py, color: colors.get(s.code) as string };
  });

  // The step between stops he called: a thin neutral riser, never a club color.
  let links = "";
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1]!;
    const b = segs[i]!;
    if (!a.s.caller || !b.s.caller) continue;
    // Phones never join stops across a season he did not call (mak, 2026-11-15): the gap shows.
    if (phone && b.s.start > a.s.end + 1) continue;
    links += `<line class="sct-cc-link" x1="${f1(a.xb)}" y1="${f1(a.yLast)}" x2="${f1(b.xa)}" y2="${f1(b.yFirst)}"/>`;
  }

  // The peak is the best single season he called; current is this season's point.
  let peak: Dot | null = null;
  let live: Dot | null = null;
  for (const g of segs) {
    for (const d of g.dots) {
      if (g.s.caller && (!peak || d.ppg > peak.ppg)) peak = d;
      if (g.s.current && d.year === g.s.end) live = d;
    }
  }

  let lines = "";
  let marks = "";
  for (const g of segs) {
    const { s, dots, color } = g;
    if (s.caller) {
      const pts2 = [`${f1(g.xa)},${f1(g.yFirst)}`, ...dots.map((d) => `${f1(d.px)},${f1(d.py)}`), `${f1(g.xb)},${f1(g.yLast)}`];
      lines += `<polyline class="sct-cc-seg${s.hc ? " is-hc" : ""}" points="${pts2.join(" ")}" style="--seg:${color}"/>`;
    }
    for (const d of dots) {
      const isLive = d === live;
      const label =
        `${d.year}${s.window ? ` (${s.window})` : ""} · ${s.code} · ${s.role}${s.caller ? "" : " · not the caller"} · ${d.ppg.toFixed(1)} PPG` +
        (d.rank ? ` · ${d.rank}` : "") +
        (league[String(d.year)] != null ? ` · NFL avg ${league[String(d.year)]!.toFixed(1)} (${d.ppg - league[String(d.year)]! >= 0 ? "+" : "−"}${Math.abs(d.ppg - league[String(d.year)]!).toFixed(1)})` : "");
      let pt = `<title>${e(label)}</title>`;
      const rr = phone ? 3.2 : 4.5;
      if (isLive) pt += `<circle class="sct-cc-ring" cx="${f1(d.px)}" cy="${f1(d.py)}" r="${phone ? 6.5 : 8}"/>`;
      // Phones: an invisible 10px disc under each point, a finger-sized target.
      if (phone) pt += `<circle class="sct-cc-hit" cx="${f1(d.px)}" cy="${f1(d.py)}" r="10"/>`;
      pt += s.caller
        ? `<circle class="sct-cc-dot${isLive ? " is-current" : ""}" cx="${f1(d.px)}" cy="${f1(d.py)}" r="${isLive ? rr - 0.5 : rr}" style="--seg:${color}"/>`
        : `<circle class="sct-cc-dot is-hollow" cx="${f1(d.px)}" cy="${f1(d.py)}" r="${rr}" style="--seg:${color}"/>`;
      marks += `<g class="sct-cc-pt${isLive ? " is-current" : ""}" tabindex="0" role="img" aria-label="${e(label)}">${pt}</g>`;
    }
  }

  // Callouts first, since they matter most; era pills take what is left.
  let notes = "";
  if (peak) {
    const w = phone ? (live === peak ? 96 : 66) : 84;
    const h = phone ? 20 : 24;
    const r = place(
      [
        { x: Math.max(2, Math.min(W - padR - w, peak.px - w / 2)), y: peak.py - h - (phone ? 9 : 12), w, h },
        { x: peak.px + 10, y: peak.py - h / 2, w, h },
        { x: peak.px - w - 10, y: peak.py - h / 2, w, h },
        { x: peak.px - w / 2, y: peak.py + 12, w, h },
      ],
      placed,
      bounds,
    );
    placed.push(r);
    const stem = r.y + r.h <= peak.py ? `<line class="sct-cc-stem" x1="${f1(peak.px)}" y1="${f1(r.y + r.h)}" x2="${f1(peak.px)}" y2="${f1(peak.py - 6)}"/>` : "";
    notes +=
      stem +
      box(
        r,
        "sct-cc-callout is-peak",
        `<text x="${f1(r.x + (phone ? 6 : 8))}" y="${f1(r.y + r.h / 2)}" dominant-baseline="middle"><tspan class="v">${peak.ppg.toFixed(1)}</tspan><tspan class="k" dx="${phone ? 4 : 5}">PEAK</tspan></text>`,
      );
  }
  if (live && live !== peak) {
    const w = phone ? 84 : 104;
    const h = phone ? 20 : 24;
    const r = place(
      [
        { x: live.px + 12 - w, y: live.py + 14, w, h },
        { x: live.px + 12 - w, y: live.py - h - 14, w, h },
        { x: live.px - w - 12, y: live.py - h / 2, w, h },
        { x: live.px + 12 - w, y: live.py + 44, w, h },
      ],
      placed,
      bounds,
    );
    placed.push(r);
    notes += box(
      r,
      "sct-cc-callout is-current",
      `<text x="${f1(r.x + (phone ? 6 : 8))}" y="${f1(r.y + r.h / 2)}" dominant-baseline="middle"><tspan class="v">${live.ppg.toFixed(1)}</tspan><tspan class="k" dx="${phone ? 4 : 5}">CURRENT</tspan></text>`,
    );
  } else if (live && live === peak) {
    // One point is both: the peak box carries it, so say so in its own label.
    notes = notes.replace(">PEAK</tspan>", ">PEAK · CURRENT</tspan>");
  }
  // The club's code once per run of its stops, over the run's middle season.
  const dotRects = segs.flatMap((g) => g.dots.map((d) => ({ x: d.px - 6, y: d.py - 6, w: 12, h: 12 })));
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i]!;
    if (i > 0 && segs[i - 1]!.s.code === g.s.code) continue;
    let run = [g];
    for (let j = i + 1; j < segs.length && segs[j]!.s.code === g.s.code; j++) run.push(segs[j]!);
    const dots = run.flatMap((r) => r.dots);
    const mid = dots[Math.floor((dots.length - 1) / 2)]!;
    const w = phone ? 8 + g.s.code.length * 7 : 12 + g.s.code.length * 8;
    const h = phone ? 15 : 18;
    const top = Math.min(...dots.map((d) => d.py));
    const bottom = Math.max(...dots.map((d) => d.py));
    const r = place(
      [
        { x: mid.px - w / 2, y: top - h - 9, w, h },
        { x: dots[0]!.px - w / 2, y: dots[0]!.py - h - 10, w, h },
        { x: mid.px - w / 2, y: bottom + 9, w, h },
        { x: dots[dots.length - 1]!.px - w / 2, y: dots[dots.length - 1]!.py + 10, w, h },
      ],
      [...placed, ...dotRects],
      bounds,
    );
    placed.push(r);
    notes += box(r, "sct-cc-pill is-era", `<text x="${f1(r.x + r.w / 2)}" y="${f1(r.y + r.h / 2)}" text-anchor="middle" dominant-baseline="middle">${e(g.s.code)}</text>`);
  }

  return (
    `<svg class="sct-cc-svg ${phone ? `is-phone is-phone-${phone}` : narrow ? "is-narrow" : "is-wide"}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Points per game by season, one line per coaching stop">` +
    grid +
    years +
    avg +
    links +
    lines +
    marks +
    notes +
    `</svg>`
  );
}

interface SumData {
  peak: { ppg: number; year: number; code: string; rank: string } | null;
  live: { ppg: number; year: number; rank: string; window: string | null } | null;
  called: number;
  now: TimelineStep | null;
}

/** The career figures, once, for the stat stack and the phones' KPI row. */
function sumData(c: TeamCoaching, stops: Stop[]): SumData {
  let peak: SumData["peak"] = null;
  let live: SumData["live"] = null;
  let called = 0;
  for (const s of stops) {
    for (const p of s.points) {
      if (s.caller) {
        called++;
        if (!peak || p.ppg > peak.ppg) peak = { ppg: p.ppg, year: p.year, code: s.code, rank: p.rank };
      }
      if (s.current && p.year === s.end) live = { ppg: p.ppg, year: p.year, rank: p.rank, window: s.window ?? null };
    }
  }
  const steps = c.playCaller.careerPath.map(timelineStepModel);
  return { peak, live, called, now: currentStep(steps, seasonOf(c)) };
}

// The live rank text can carry its window ("16th · 2026 thru Wk 8"): the ordinal is the figure, the window its note.
const ordOf = (t: string) => t.match(/^\d+(?:st|nd|rd|th)/)?.[0] ?? "";

/** The figures the chart used to carry in big callouts, as a short stat stack beside it. */
function summary(c: TeamCoaching, stops: Stop[]): string {
  const { peak, live, called, now } = sumData(c, stops);
  const item = (k: string, v: string, sub: string, cls = "") =>
    `<div class="sct-cc-kv${cls ? ` ${cls}` : ""}"><dt>${e(k)}</dt><dd><b>${e(v)}</b>${sub ? `<span>${e(sub)}</span>` : ""}</dd></div>`;
  const thru = live?.rank.match(/thru Wk \d+/i)?.[0] ?? "";
  const items = [
    peak ? item("Peak PPG", peak.ppg.toFixed(1), [`${peak.year} ${peak.code}`, ordOf(peak.rank)].filter(Boolean).join(" · "), "is-peak") : "",
    live ? item("Current PPG", live.ppg.toFixed(1), `${live.year} · ${live.window || thru || "in-season"}`, "is-current") : "",
    live && ordOf(live.rank) ? item(`${live.year} NFL rank`, ordOf(live.rank), /in window/.test(live.rank) ? "in his window" : "of 32") : "",
    called ? item("Seasons calling", String(called), "plays, all stops") : "",
    now ? item("Current stop", now.codes.join(" / "), now.years) : "",
  ].join("");
  return items ? `<dl class="sct-cc-sum" aria-label="Scoring summary">${items}</dl>` : "";
}

/**
 * Phones' figures (mak, 2026-11-15): Peak PPG, Current PPG and the NFL rank
 * in one row, seasons calling and the current stop as one line under them.
 * Same numbers as the stat stack, which phones hide.
 */
function phoneKpis(c: TeamCoaching, stops: Stop[]): string {
  const { peak, live, called, now } = sumData(c, stops);
  const thru = live?.rank.match(/thru Wk \d+/i)?.[0] ?? "";
  const tile = (k: string, v: string, sub: string, cls: string) =>
    `<div class="sct-cc-kpi ${cls}"><dt>${e(k)}</dt><dd><b>${e(v)}</b>${sub ? `<span>${e(sub)}</span>` : ""}</dd></div>`;
  const tiles = [
    peak ? tile("Peak PPG", peak.ppg.toFixed(1), `${peak.year} ${peak.code}`, "is-peak") : "",
    live ? tile("Current PPG", live.ppg.toFixed(1), live.window || thru.replace(/^thru/i, "Thru") || `${live.year}`, "is-current") : "",
    live && ordOf(live.rank) ? tile("NFL rank", ordOf(live.rank), /in window/.test(live.rank) ? "in his window" : `${live.year}, of 32`, "is-rank") : "",
  ].join("");
  if (!tiles) return "";
  const meta = [called ? `${called} season${called === 1 ? "" : "s"} calling plays` : "", now ? `Current stop ${now.codes.join(" / ")} (${now.years})` : ""].filter(Boolean).join(" · ");
  return `<div class="sct-cc-kpis"><dl class="sct-cc-kpi-row" aria-label="Scoring summary">${tiles}</dl>${meta ? `<p class="sct-cc-meta">${e(meta)}</p>` : ""}</div>`;
}

function chart(c: TeamCoaching, stops: Stop[]): string {
  const colors = stopColors(stops);
  const league = getLeaguePpg();
  const x0 = Math.min(...stops.map((s) => s.start));
  const x1 = Math.max(...stops.map((s) => s.end));
  const clubs = [...new Set(stops.map((s) => s.code))].map((code) => [code, colors.get(code) as string] as const);
  const hasHc = stops.some((s) => s.hc && s.caller);
  const hasOther = stops.some((s) => !s.hc && s.caller);
  const hasHollow = stops.some((s) => !s.caller);
  const legend =
    `<ul class="sct-cc-legend" aria-label="Chart key">` +
    clubs.map(([code, color]) => `<li><i class="sct-cc-sw" style="--seg:${color}"></i>${e(code)}</li>`).join("") +
    (hasHc && hasOther ? `<li><i class="sct-cc-sw is-hc"></i>Head coach</li>` : "") +
    (hasHollow ? `<li><i class="sct-cc-sw is-hollow"></i>Not the caller</li>` : "") +
    (Object.keys(league).length ? `<li><i class="sct-cc-sw is-avg"></i>NFL avg</li>` : "") +
    `</ul>`;
  const possessive = /s$/.test(surnameOf(c)) ? `${surnameOf(c)}'` : `${surnameOf(c)}'s`;
  // One caption line under the chart: the key, then the note in small type
  // (mak's compact pass, 2026-11-08; the boxed info strip is gone).
  return (
    `<figure class="sct-cc-chart" aria-label="${e(`${possessive} offenses by stop: points per game, ${x0}-${x1}`)}">` +
    `<div class="sct-cc-scroll" tabindex="0">` +
    // One desktop/tablet drawing (Team Pages Phase 2B, 2026-11-19): the
    // 720-wide layout, which the narrow tier needed so its labels never
    // shrink, serves every width above 560px (at 1280 it renders at about
    // 1.05x). It keeps the is-wide hook. The two phone drawings stay: SVG
    // text scales with the drawing, and one phone drawing cannot keep 12px
    // labels legible from a 320px screen to a 560px one.
    chartSvg(stops, colors, league, 720, 240, true).replace('class="sct-cc-svg is-narrow"', 'class="sct-cc-svg is-wide"') +
    chartSvg(stops, colors, league, 320, 168, true, "s") +
    chartSvg(stops, colors, league, 440, 190, true, "m") +
    `</div>` +
    // Touchscreens never show an SVG <title>: a tapped or focused point's
    // season reads here instead (client team.ts wireCareerChart; phones).
    `<p class="sct-cc-readout" aria-live="polite">Tap a point for its season.</p>` +
    `<figcaption class="sct-cc-cap">` +
    legend +
    // The "Points per game, ... one line per stop" caption came off 2026-11-21 (mak).
    `</figcaption>` +
    `</figure>`
  );
}

/* ------------------------------------------------------------------ public */

/**
 * One card since mak's compact pass (2026-11-08): the header, then the
 * stops, the chart with its stat stack, and the season table, divided by
 * rules instead of each sitting in its own box.
 */
export function renderCoachingCareerPremium(c: TeamCoaching, seasonsHtml = ""): string {
  const stops = readStops(c);
  const rows = timeline(c);
  const points = stops.reduce((n, s) => n + s.points.length, 0);
  const chartHtml = points >= 2 ? chart(c, stops) : stops.length ? `<p class="sct-cc-empty">${e("One season on the line so far: the scoring history fills in as he calls more.")}</p>` : "";
  if (!rows && !chartHtml) return "";
  const possessive = /s$/.test(surnameOf(c)) ? `${surnameOf(c)}'` : `${surnameOf(c)}'s`;
  const sum = points >= 2 ? summary(c, stops) : "";
  const kpis = points >= 2 ? phoneKpis(c, stops) : "";
  return (
    `<div class="sct-block sct-cp sct-cpt sct-cc" id="coaching-career-premium" data-sct-premium="coaching-career">` +
    `<section class="sct-cpt-section is-career">` +
    usageStyleHead("Coaching Career & Historical Performance", HEADSET, `${possessive} stops and how his offenses scored.`) +
    `<div class="sct-cc-body">` +
    // Phones lead with the KPI row; team.css orders the body there as KPIs,
    // chart, Career History, season table (mak, 2026-11-15).
    kpis +
    // The stops sit one click down (the review of 2026-11-15): the chart
    // already names every stop and its years.
    (rows ? `<details class="sct-cc-more"><summary class="sct-cc-more-q">Career History<span class="sct-cc-more-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span></summary>${rows}</details>` : "") +
    (chartHtml ? `<div class="sct-cc-hist${sum ? " has-sum" : ""}">${chartHtml}${sum}</div>` : "") +
    seasonsHtml +
    `</div>` +
    `</section>` +
    `</div>`
  );
}
