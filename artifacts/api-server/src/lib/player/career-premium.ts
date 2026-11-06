/**
 * The Stats tab's Fantasy Football Career Stats section (mak's briefs of
 * 2026-11-05, approved the same day: "remove the old version"): a navy title
 * bar that is the tab's "{Name} Fantasy Football Stats" H2, the
 * season-by-season fantasy points-per-game chart with a career-average line
 * and each season's finish, four career KPI cards, the career read ("What His
 * Career Numbers Say", the tab's other H2 here) with the Redraft Command
 * card beside it, and the career highs.
 *
 * It replaced the 09-29 section's chart, rate tiles, read, Redraft Command
 * panel and career-highs strip, which stats-tab.ts no longer mounts.
 * Everything here is read from careerPremiumModel() in stats-tab.ts, which
 * builds it from the code paths that section printed from: the same per-game
 * points, the same career average (career points over career games, not an
 * average of season averages), the same rate tiles with the same
 * definitions, the same paragraphs, the same highs. The two H2s keep the
 * ids the SEO ladder and the tests know (scp-st-arc-h, scp-st-read-h).
 *
 * No charting library: the bars are CSS heights on a linear scale that
 * starts at zero, the average line is a positioned rule, and every bar
 * carries its own tooltip (season, club, games, PPG, points, finish) and is
 * focusable for the keyboard.
 */

import { escapeHtml } from "../render";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { careerPremiumModel, type CareerSeasonBar } from "./stats-tab";

/** One decimal, a true minus sign for a negative (the house rule). */
const one = (v: number): string => v.toFixed(1).replace(/^-/, "\u2212");

/* ------------------------------------------------------------------ icons */

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICON = {
  chart: svg(`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`),
  gauge: svg(`<path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-5"/><circle cx="12" cy="15" r="1.5"/>`),
  calendar: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5M16 4v5"/>`),
  medal: svg(`<circle cx="12" cy="14" r="5"/><path d="M8 3l2 6M16 3l-2 6M12 12v4"/>`),
  wave: svg(`<path d="M3 15c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>`),
  trend: svg(`<path d="M3 17l5-6 4 4 5-7 4 3"/><path d="M17 8h4v4"/>`),
  // The header's faint football, drawn once at the right of the band.
  football: svg(`<path d="M4.6 19.4c-2.3-2.3-1.3-8.4 3-12.8s10.5-5.3 12.8-3 1.3 8.4-3 12.8-10.5 5.3-12.8 3z"/><path d="M8 16l8-8"/><path d="M9.5 11.5l1.6 1.6M11.7 9.3l1.6 1.6M10.6 14.6l1.6 1.6M13.9 7.1l1.6 1.6"/>`),
  bolt: svg(`<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`),
  layers: svg(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4v4"/>`),
  bars: svg(`<path d="M5 20V10M12 20V4M19 20v-7"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
};

/** The icon a KPI tile wears, by its title. */
function rateIcon(title: string): string {
  const k = title.toLowerCase();
  if (k.includes("ppg")) return ICON.gauge;
  if (k.includes("appear")) return ICON.calendar;
  if (k.startsWith("top-")) return ICON.trophy;
  return ICON.trend;
}

/** The icon a career high wears, by its label. */
function highIcon(label: string, i: number): string {
  const k = label.toLowerCase();
  if (k.includes("td")) return ICON.trophy;
  if (k.includes("fantasy")) return ICON.gauge;
  if (k.startsWith("career")) return ICON.bars;
  return i === 0 ? ICON.layers : ICON.bars;
}

/* ------------------------------------------------------------------ chart */

/** The y-axis top: the smallest multiple of 4 above the tallest bar (or the average), never under 8, so the four ticks are whole numbers. */
function axisTop(max: number): number {
  return Math.max(8, Math.ceil(max / 4) * 4);
}

function chart(m: ReturnType<typeof careerPremiumModel> & object): string {
  const seasons = m.seasons;
  const max = Math.max(...seasons.map((s) => s.ppg), m.careerPpg, 0);
  const top = axisTop(max);
  const pct = (v: number): number => Math.max(0, Math.min(100, (v / top) * 100));
  const done = seasons.filter((s) => !s.inProgress);
  const latest = done.length ? done[done.length - 1]! : null;
  const n = seasons.length;
  const showAvg = n > 1;
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);

  const bar = (s: CareerSeasonBar): string => {
    const kind = s.inProgress ? "is-now" : latest && s.season === latest.season && n > 1 ? "is-last" : "";
    const tip = [
      `${s.season}${s.inProgress ? " (in progress)" : ""}`,
      s.clubs.length ? s.clubs.join("/") : null,
      `${s.gp} GP`,
      `${one(s.ppg)} ${m.scoring} PPG`,
      `${one(s.pts)} points`,
      s.finish ? `${m.pos}${s.finish} in total points${s.inProgress ? " so far" : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      `<div class="scp-cp-col${kind ? ` ${kind}` : ""}" tabindex="0" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}" data-scp-cp-tip="${escapeHtml(tip)}">` +
      `<b class="scp-cp-val">${escapeHtml(one(s.ppg))}</b>` +
      `<i class="scp-cp-fill" style="height:${pct(s.ppg).toFixed(1)}%"></i>` +
      `</div>`
    );
  };

  const label = (s: CareerSeasonBar): string =>
    `<div class="scp-cp-x${s.current ? " is-cur" : ""}">` +
    `<strong>${s.season}</strong>` +
    (s.finish ? `<span class="scp-cp-fin">${escapeHtml(`${m.pos}${s.finish}`)}</span>` : `<span class="scp-cp-fin is-none">${s.inProgress ? "in progress" : "unranked"}</span>`) +
    `<small>${escapeHtml(`${s.gp} GP${s.clubs.length ? ` · ${s.clubs.join("/")}` : ""}`)}</small>` +
    `</div>`;

  // What the rank under each bar means (2026-11-06): every season is ranked
  // by total points at the position, the season in progress included.
  const rankNote = `${m.pos} rank = season finish by total ${m.scoring} points`;

  const aria =
    `${m.pos} fantasy points per game by season: ` +
    seasons.map((s) => `${s.season} ${one(s.ppg)}${s.finish ? ` (${m.pos}${s.finish})` : ""}${s.inProgress ? ", in progress" : ""}`).join(", ") +
    (showAvg ? `. Career average ${one(m.careerPpg)}.` : ".");

  return (
    `<figure class="scp-cp-chart${showAvg ? " has-avg" : ""}" style="--scp-cp-n:${n}">` +
    `<figcaption class="scp-sr">${escapeHtml(aria)}</figcaption>` +
    `<div class="scp-cp-y" aria-hidden="true">${ticks
      .slice()
      .reverse()
      .map((t) => `<span>${escapeHtml(Number.isInteger(t) ? String(t) : one(t))}</span>`)
      .join("")}</div>` +
    `<div class="scp-cp-scroll" data-scp-arc>` +
    `<div class="scp-cp-plot" role="img" aria-label="${escapeHtml(aria)}">` +
    `<div class="scp-cp-grid" aria-hidden="true">${ticks.map(() => `<i></i>`).join("")}</div>` +
    (showAvg
      ? `<div class="scp-cp-avg" style="bottom:${pct(m.careerPpg).toFixed(2)}%" aria-hidden="true"><span>Career avg <b>${escapeHtml(one(m.careerPpg))}</b></span></div>`
      : "") +
    `<div class="scp-cp-cols">${seasons.map(bar).join("")}</div>` +
    `</div>` +
    `<div class="scp-cp-xs" aria-hidden="true">${seasons.map(label).join("")}</div>` +
    `</div>` +
    // The legend also names the average, so the plot's own label can leave
    // a narrow chart where it would sit on a bar. Each entry is one span, so
    // a swatch never wraps away from its words.
    (seasons.some((s) => s.inProgress)
      ? `<p class="scp-cp-legend"><span><i class="is-now"></i>Current season, in progress</span><span><i class="is-last"></i>Latest full season</span><span><i></i>Earlier seasons</span>${showAvg ? `<span><i class="is-avg"></i>Career avg ${escapeHtml(one(m.careerPpg))}</span>` : ""}<span class="scp-cp-basis">${escapeHtml(rankNote)}</span></p>`
      : n > 1
        ? `<p class="scp-cp-legend"><span><i class="is-last"></i>Latest season</span><span><i></i>Earlier seasons</span><span><i class="is-avg"></i>Career avg ${escapeHtml(one(m.careerPpg))}</span><span class="scp-cp-basis">${escapeHtml(rankNote)}</span></p>`
        : "") +
    `</figure>`
  );
}

/* ------------------------------------------------------------------ block */

export function renderPremiumCareer(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const m = careerPremiumModel(data, options);
  if (!m) return "";

  const head =
    `<header class="scp-cp-bar">` +
    `<span class="scp-cp-bar-rule" aria-hidden="true"></span>` +
    `<span class="scp-cp-bar-icon" aria-hidden="true">${ICON.chart}</span>` +
    `<span class="scp-cp-bar-divider" aria-hidden="true"></span>` +
    `<div class="scp-cp-bar-text">` +
    // The tab's H2 for this section, with the id the SEO ladder keys on.
    // Same text for crawlers; phones read "Career Fantasy PPG" (mak,
    // 2026-11-06): the name and "Football Stats" are .scp-stp-xs (hidden
    // <=560px), and "Career " / " PPG" are CSS ::before / ::after there,
    // never part of the heading text.
    `<h2 class="scp-ox-h2 scp-cp-bar-title" id="scp-st-arc-h"><span class="scp-stp-xs">${escapeHtml(m.name)} </span><span class="scp-cp-title-main">Fantasy<span class="scp-stp-xs"> Football Stats</span></span></h2>` +
    `<p class="scp-cp-bar-sub">Fantasy points per game, every season.</p>` +
    `</div>` +
    `<span class="scp-cp-bar-art" aria-hidden="true">${ICON.football}</span>` +
    `<span class="scp-cp-bar-stripes" aria-hidden="true"></span>` +
    `</header>`;

  const kpis = m.rates.length
    ? `<ul class="scp-cp-kpis">` +
      m.rates
        .map(
          (t, i) =>
            `<li class="scp-cp-kpi" title="${escapeHtml(t.tip)}">` +
            `<span class="scp-cp-kpi-icon" aria-hidden="true">${rateIcon(t.title)}</span>` +
            `<span class="scp-cp-kpi-value">${escapeHtml(t.value)}</span>` +
            // The definition behind an info button (2026-11-06): a title
            // attribute never shows on a touch screen, so a tap opens it.
            `<span class="scp-cp-kpi-label">${escapeHtml(t.title)}` +
            `<button type="button" class="scp-info" data-scp-info aria-expanded="false" aria-controls="scp-cp-def-${i}" aria-label="${escapeHtml(`About ${t.title}`)}"></button></span>` +
            `<span class="scp-cp-kpi-sub">${escapeHtml(t.caption)}</span>` +
            `<span class="scp-cp-kpi-def" id="scp-cp-def-${i}" hidden>${escapeHtml(t.tip)}</span>` +
            `</li>`,
        )
        .join("") +
      `</ul>`
    : "";

  const read = m.paragraphs.length
    ? `<div class="scp-cp-read">` +
      `<div class="scp-cp-prose">` +
      // Phones read "Fantasy Analysis" (mak, 2026-11-06): the words are
      // .scp-stp-xs there and the new title is a CSS ::before, so the
      // heading's text is unchanged.
      `<h2 class="scp-ox-h2 scp-cp-h" id="scp-st-read-h"><span class="scp-stp-card-icon scp-cp-h-icon" aria-hidden="true">${ICON.chart}</span><span class="scp-stp-xs">What His Career Numbers Say</span></h2>` +
      m.paragraphs.map((p) => `<p>${p}</p>`).join("") +
      `</div>` +
      `<aside class="scp-cp-rc" aria-label="${escapeHtml(`${m.last} in Redraft Command`)}">` +
      `<span class="scp-cp-rc-icon" aria-hidden="true">${ICON.bolt}</span>` +
      `<h3 class="scp-cp-rc-h">${escapeHtml(m.redraft.heading)}</h3>` +
      `<p>${escapeHtml(m.redraft.body)}</p>` +
      `<a class="scp-cp-rc-btn" href="${escapeHtml(m.redraft.href)}" data-cta="redraft-command-stats-sidebar">${escapeHtml(m.redraft.cta)}<span class="scp-cp-rc-arrow" aria-hidden="true">${ICON.arrow}</span></a>` +
      `</aside>` +
      `</div>`
    : "";

  const highs = m.highs.length
    ? `<div class="scp-cp-highs">` +
      `<h3 class="scp-cp-h is-highs">Career Highs</h3>` +
      `<ul class="scp-cp-high-list">` +
      m.highs
        .map(
          (h, i) =>
            `<li class="scp-cp-high">` +
            `<span class="scp-cp-high-icon" aria-hidden="true">${highIcon(h.label, i)}</span>` +
            `<span class="scp-cp-high-v">${escapeHtml(h.v)}</span>` +
            `<span class="scp-cp-high-l">${escapeHtml(h.label)}</span>` +
            `<span class="scp-cp-high-s">${escapeHtml(h.sub)}</span>` +
            `</li>`,
        )
        .join("") +
      `</ul></div>`
    : "";

  return (
    `<section class="scp-ox-sec scp-cp" aria-labelledby="scp-st-arc-h">` +
    head +
    `<div class="scp-cp-body">` +
    chart(m) +
    kpis +
    read +
    highs +
    `</div>` +
    `</section>`
  );
}
