/**
 * The premium comparison version of Coaching Career & Historical
 * Performance (mak's brief, 2026-11-05, built to
 * attached_assets/historical reference.png): the navy header with the
 * headset, the career as wide horizontal stop rows on a vertical rail with
 * the current stop in gold, and the points-per-game history as a large
 * chart with team-colored stop segments, the NFL average, era pills, the
 * peak and current callouts, a legend and a methodology strip.
 *
 * Rendered DIRECTLY UNDER the complete original career block, which is
 * untouched. Every number is the original's own model: readStops() and
 * stopColors() for the chart, timelineStepModel() for the rows, the league
 * averages from getLeaguePpg(); nothing is fetched or computed twice. The
 * block shares the premium tokens (`.sct-cp`, `.sct-cpt`) and adds
 * `.sct-cc-*` rules in team.css.
 */

import { escapeHtml } from "../render";
import { getLeaguePpg, type TeamCoaching } from "./coaching";
import { readStops, seasonOf, stepLogo, stopColors, surnameOf, timelineStepModel, type Stop, type TimelineStep } from "./coaching-render";
import { ICON } from "./coaching-premium-tendencies";

const e = escapeHtml;
const f1 = (n: number) => String(Math.round(n * 10) / 10);

const HEADSET = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2z"/><path d="M20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"/><path d="M17 18v1a2 2 0 0 1-2 2h-2"/></g></svg>`;

/* ---------------------------------------------------------------- timeline */

/** The stop the coach is on this season: the step whose span holds it, never just the last row. */
function currentStep(steps: TimelineStep[], season: number): TimelineStep | null {
  return steps.find((s) => s.start <= season && season <= s.end) ?? null;
}

function stopRow(step: TimelineStep, current: boolean): string {
  const club = (code: string) => {
    const logo = stepLogo(code);
    return (
      `<span class="sct-cc-club">` +
      (logo ? `<img class="sct-cc-crest" src="${e(logo)}" alt="" width="30" height="30" loading="lazy" decoding="async">` : "") +
      `<span class="sct-cc-code">${e(code)}</span></span>`
    );
  };
  return (
    `<li class="sct-cc-stop${current ? " is-current" : ""}"${current ? ` aria-current="step"` : ""}${step.full ? ` title="${e(step.full)}"` : ""}>` +
    `<span class="sct-cc-node" aria-hidden="true"></span>` +
    `<span class="sct-cc-years">${e(step.years)}</span>` +
    `<span class="sct-cc-team">${step.codes.map(club).join(`<span class="sct-cc-slash" aria-hidden="true">/</span>`)}</span>` +
    `<span class="sct-cc-sep" aria-hidden="true"></span>` +
    `<span class="sct-cc-role">${e(step.role)}${current ? `<span class="sct-visually-hidden"> (current stop)</span>` : ""}</span>` +
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
  return `<g class="${cls}"><rect x="${f1(r.x)}" y="${f1(r.y)}" width="${f1(r.w)}" height="${f1(r.h)}" rx="9"/>${inner}</g>`;
}

/**
 * The scoring history at one width. Two are rendered (1100 and 800 wide)
 * and the container query shows one, so the type holds its size on a
 * narrow column instead of scaling down with the viewBox.
 */
function chartSvg(stops: Stop[], colors: Map<string, string>, league: Record<string, number>, W: number, H: number, narrow: boolean): string {
  const padL = 46;
  const padR = narrow ? 92 : 104;
  const padT = narrow ? 44 : 50;
  const padB = 40;
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
      `<line class="sct-cc-grid${v === lo ? " is-base" : ""}" x1="${padL}" x2="${W - padR + 40}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>` +
      `<text class="sct-cc-tick" x="${padL - 10}" y="${f1(y(v))}" text-anchor="end" dominant-baseline="middle">${v}</text>`;
  }

  // Year labels: each stop's first season and the last season on the line,
  // longer stints claiming their slot first; the current year reads bold.
  const minGap = narrow ? 36 : 40;
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
    .map((p) => `<text class="sct-cc-year${current && p.yr === current.end ? " is-current" : ""}" x="${f1(p.xx)}" y="${H - 12}" text-anchor="middle">${p.yr}</text>`)
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
    const r = place([{ x: W - padR + 10, y: avgEnd.y - 14, w: 78, h: 28 }], placed, bounds);
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
      if (isLive) pt += `<circle class="sct-cc-ring" cx="${f1(d.px)}" cy="${f1(d.py)}" r="10"/>`;
      pt += s.caller
        ? `<circle class="sct-cc-dot${isLive ? " is-current" : ""}" cx="${f1(d.px)}" cy="${f1(d.py)}" r="${isLive ? 5 : 5.5}" style="--seg:${color}"/>`
        : `<circle class="sct-cc-dot is-hollow" cx="${f1(d.px)}" cy="${f1(d.py)}" r="5.5" style="--seg:${color}"/>`;
      marks += `<g class="sct-cc-pt${isLive ? " is-current" : ""}" tabindex="0" role="img" aria-label="${e(label)}">${pt}</g>`;
    }
  }

  // Callouts first, since they matter most; era pills take what is left.
  let notes = "";
  if (peak) {
    const w = narrow ? 104 : 118;
    const h = 36;
    const r = place(
      [
        { x: peak.px - w / 2, y: peak.py - h - 16, w, h },
        { x: peak.px + 12, y: peak.py - h / 2, w, h },
        { x: peak.px - w - 12, y: peak.py - h / 2, w, h },
        { x: peak.px - w / 2, y: peak.py + 16, w, h },
      ],
      placed,
      bounds,
    );
    placed.push(r);
    const stem = r.y + r.h <= peak.py ? `<line class="sct-cc-stem" x1="${f1(peak.px)}" y1="${f1(r.y + r.h)}" x2="${f1(peak.px)}" y2="${f1(peak.py - 7)}"/>` : "";
    notes +=
      stem +
      box(
        r,
        "sct-cc-callout is-peak",
        `<text x="${f1(r.x + 12)}" y="${f1(r.y + r.h / 2)}" dominant-baseline="middle"><tspan class="v">${peak.ppg.toFixed(1)}</tspan><tspan class="k" dx="6">PEAK</tspan></text>`,
      );
  }
  if (live && live !== peak) {
    const w = narrow ? 134 : 150;
    const h = 36;
    const r = place(
      [
        { x: live.px + 14 - w, y: live.py + 18, w, h },
        { x: live.px + 14 - w, y: live.py - h - 18, w, h },
        { x: live.px - w - 14, y: live.py - h / 2, w, h },
        { x: live.px + 14 - w, y: live.py + 60, w, h },
      ],
      placed,
      bounds,
    );
    placed.push(r);
    notes += box(
      r,
      "sct-cc-callout is-current",
      `<text x="${f1(r.x + 12)}" y="${f1(r.y + r.h / 2)}" dominant-baseline="middle"><tspan class="v">${live.ppg.toFixed(1)}</tspan><tspan class="k" dx="6">CURRENT</tspan></text>`,
    );
  } else if (live && live === peak) {
    // One point is both: the peak box carries it, so say so in its own label.
    notes = notes.replace(">PEAK</tspan>", ">PEAK · CURRENT</tspan>");
  }
  // The club's code once per run of its stops, over the run's middle season.
  const dotRects = segs.flatMap((g) => g.dots.map((d) => ({ x: d.px - 8, y: d.py - 8, w: 16, h: 16 })));
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i]!;
    if (i > 0 && segs[i - 1]!.s.code === g.s.code) continue;
    let run = [g];
    for (let j = i + 1; j < segs.length && segs[j]!.s.code === g.s.code; j++) run.push(segs[j]!);
    const dots = run.flatMap((r) => r.dots);
    const mid = dots[Math.floor((dots.length - 1) / 2)]!;
    const w = 20 + g.s.code.length * 10;
    const h = 26;
    const top = Math.min(...dots.map((d) => d.py));
    const bottom = Math.max(...dots.map((d) => d.py));
    const r = place(
      [
        { x: mid.px - w / 2, y: top - h - 12, w, h },
        { x: mid.px - w / 2, y: bottom + 12, w, h },
        { x: dots[0]!.px - w / 2, y: top - h - 12, w, h },
        { x: dots[dots.length - 1]!.px - w / 2, y: bottom + 12, w, h },
      ],
      [...placed, ...dotRects],
      bounds,
    );
    placed.push(r);
    notes += box(r, "sct-cc-pill is-era", `<text x="${f1(r.x + r.w / 2)}" y="${f1(r.y + r.h / 2)}" text-anchor="middle" dominant-baseline="middle">${e(g.s.code)}</text>`);
  }

  return (
    `<svg class="sct-cc-svg ${narrow ? "is-narrow" : "is-wide"}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Points per game by season, one line per coaching stop">` +
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
  const rows = stops
    .flatMap((s) =>
      s.points.map(
        (p) =>
          `<tr><td>${p.year}${s.window ? ` (${e(s.window)})` : ""}</td><td>${e(s.code)}</td><td>${e(s.role)}</td>` +
          `<td>${p.ppg.toFixed(1)}</td><td>${league[String(p.year)]?.toFixed(1) ?? "-"}</td><td>${e(p.rank)}</td><td>${s.caller ? "Yes" : "No"}</td></tr>`,
      ),
    )
    .join("");
  const possessive = /s$/.test(surnameOf(c)) ? `${surnameOf(c)}'` : `${surnameOf(c)}'s`;
  return (
    `<figure class="sct-cc-chart" aria-label="${e(`${possessive} offenses by stop: points per game, ${x0}-${x1}`)}">` +
    `<div class="sct-cc-scroll" tabindex="0">` +
    chartSvg(stops, colors, league, 1100, 330, false) +
    chartSvg(stops, colors, league, 800, 300, true) +
    `</div>` +
    legend +
    `<figcaption class="sct-cc-note"><span class="sct-cc-note-icon">${ICON["info"]}</span><span>${e(`Points per game by season, ${x0}-${x1}, one line per stop. The step between stops is the move.`)}</span></figcaption>` +
    `<table class="sct-visually-hidden"><caption>Career scoring by stop</caption>` +
    `<thead><tr><th scope="col">Season</th><th scope="col">Club</th><th scope="col">Role</th><th scope="col">PPG</th><th scope="col">NFL avg</th><th scope="col">Rank</th><th scope="col">Called plays</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `</figure>`
  );
}

/* ------------------------------------------------------------------ public */

export function renderCoachingCareerPremium(c: TeamCoaching): string {
  const stops = readStops(c);
  const rows = timeline(c);
  const points = stops.reduce((n, s) => n + s.points.length, 0);
  const chartHtml = points >= 2 ? chart(c, stops) : stops.length ? `<p class="sct-cc-empty">${e("One season on the line so far: the scoring history fills in as he calls more.")}</p>` : "";
  if (!rows && !chartHtml) return "";
  const possessive = /s$/.test(surnameOf(c)) ? `${surnameOf(c)}'` : `${surnameOf(c)}'s`;
  return (
    `<div class="sct-block sct-cp sct-cpt sct-cc" id="coaching-career-premium" data-sct-premium="coaching-career">` +
    `<p class="sct-cp-flag">New design · Comparison</p>` +
    `<section class="sct-cpt-section is-career">` +
    `<header class="sct-cpt-head is-main">` +
    `<span class="sct-cpt-head-icon">${HEADSET}</span>` +
    `<span class="sct-cpt-head-rule"></span>` +
    `<div class="sct-cpt-head-text"><h3 class="sct-cpt-h3">Coaching Career &amp; Historical Performance</h3>` +
    `<p class="sct-cpt-dek">${e(`${possessive} stops, and how the offenses he called have scored and distributed the ball.`)}</p></div>` +
    ICON["art"] +
    `</header>` +
    (rows ? `<div class="sct-cc-body">${rows}</div>` : "") +
    `</section>` +
    (chartHtml ? `<section class="sct-cpt-section is-career-chart"><div class="sct-cc-chartbody">${chartHtml}</div></section>` : "") +
    `</div>`
  );
}
