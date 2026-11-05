/**
 * The premium Game Log (mak's brief, 2026-11-05; the tab itself since the
 * same day, when mak approved it and the old chips, summary strip, table
 * and ladder were removed). Everything this block prints comes through
 * `deps` from the tab's own helpers in player-render.ts -
 * the season chips' hrefs, the box-score columns, the summary strip's four
 * numbers, the Avg row's values, each row's cells and detail - so the two
 * versions can never disagree, and the ladder reads the same StoryGame list
 * (buildGamelogStory) the "Where His Weeks Finished" section draws.
 *
 * Markup is `scp-glp-` prefixed throughout and every rule in player.css
 * starts `.scp .scp-glp`, so nothing here reaches the table above it. The
 * three hooks the client needs are kept by name: `.scp-seasons` /
 * `.scp-season-opt` for the in-place season swap, `data-scp-expandable` +
 * `tr[data-detail]` for the fold-away week detail, and `data-scp-sortable`
 * for the header sort.
 */

import { escapeHtml } from "../render";
import { getTeamByAbbreviation } from "../team/teams";
import { matchupBand, type MatchupBand } from "./header";
import { weeklyTier, type LogColumn, type WeeklyTier } from "./metrics";
import { SCORING_LABELS } from "./scoring";
import {
  bandEdges,
  buildGamelogStory,
  ladderScale,
  ladderSummary,
  layoutLadder,
  type StoryGame,
} from "./gamelog-sections";
import { titleCase } from "./title-case";
import type { PlayerPageData } from "./player-data";
import type { GameLogEntry } from "./types";

/** What the tab hands this block, so the two versions share one computation. */
export interface PremiumLogDeps {
  /** The season chip's href, from pageUrl() - the same link the tab's chips carry. */
  seasonHref: (year: number) => string;
  /** The columns the tab's table draws this season (logLayout). */
  layout: { columns: LogColumn[]; scored: boolean; span: number };
  /** The summary strip's figures (logSummaryValues); null with no played week. */
  summary: { played: GameLogEntry[]; ppg: number; avgRank: number | null; best: number } | null;
  /** The Avg row's figures (logAverageValues); null under two played games. */
  averages: {
    n: number;
    cell: (column: LogColumn) => string;
    ppg: number;
    record: string;
    meanRank: number | null;
    tier: WeeklyTier | null;
    avgBand: MatchupBand | null;
  } | null;
  /** One box-score cell, as the tab prints it (logCell). */
  cell: (entry: GameLogEntry, column: LogColumn) => string;
  /** "W 24-17" (scoreLabel); "" when the season has no result attached. */
  score: (entry: GameLogEntry) => string;
  /** The week's points in the page's format (fpts). */
  points: (entry: GameLogEntry) => number;
  /** A bye or absence row's label, linked to the Injury tab when it has one. */
  dnp: (entry: GameLogEntry) => { label: string; href: string | null };
  /** The fold-away detail row under one week (renderWeekDetail), or "". */
  detail: (entry: GameLogEntry, id: string, span: number) => string;
  /** "Favorable" / "Neutral" / "Tough", the tab's own words. */
  difficultyWord: Record<MatchupBand, string>;
  /** "7th" */
  ordinal: (n: number) => string;
  /** "14.2" */
  num: (value: number | null | undefined, digits?: number) => string;
}

const DASH = "-";

const pctTrim = (v: number): string => {
  const s = v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

/* ------------------------------------------------------------------- icons */

const svg = (body: string, cls = ""): string =>
  `<svg class="scp-glp-svg${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ICON = {
  calendar: svg(
    `<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3M13 14h3M8 18h3"/>`,
  ),
  bars: svg(`<path d="M4 20V11M10 20V5M16 20v-7M22 20H2"/>`),
  medal: svg(
    `<circle cx="12" cy="14" r="5.5"/><path d="M9.5 9 6 3h4l2 3.5L14 3h4l-3.5 6"/><path d="m12 11.5 1 2h2l-1.6 1.2.6 2.1-2-1.3-2 1.3.6-2.1L9 13.5h2z" fill="currentColor" stroke="none"/>`,
  ),
  trophy: svg(
    `<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4M8.5 21h7M9.5 18h5"/>`,
  ),
  info: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`),
  chart: svg(`<path d="M3 20h18"/><path d="M6 17V9M11 17V5M16 17v-6M21 17V3"/>`),
  layers: svg(
    `<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>`,
  ),
  alert: svg(
    `<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2h.01"/>`,
  ),
};

/** The gold diagonal stripes at a navy bar's right edge, the reference's accent. */
const STRIPES = `<span class="scp-glp-stripes" aria-hidden="true"></span>`;

/** A faint football outline, the hero's right-hand decoration. */
const BALL =
  `<svg class="scp-glp-ball" viewBox="0 0 160 100" width="160" height="100" aria-hidden="true" focusable="false">` +
  `<ellipse cx="80" cy="50" rx="72" ry="38" fill="none" stroke="currentColor" stroke-width="2"/>` +
  `<path d="M22 50h116" stroke="currentColor" stroke-width="1" opacity=".6"/>` +
  `<path d="M60 40v20M70 38v24M80 37v26M90 38v24M100 40v20M56 50h48" stroke="currentColor" stroke-width="2"/>` +
  `</svg>`;

/* ----------------------------------------------------------------- pieces */

function finishPill(pos: string, rank: number | null | undefined): string {
  const tier = weeklyTier(rank);
  if (!tier || !rank) return DASH;
  return `<span class="scp-glp-pill" data-tier="${tier}">${escapeHtml(`${pos}${rank}`)}</span>`;
}

function difficultyCell(entry: GameLogEntry, deps: PremiumLogDeps, pos: string): string {
  const rank = entry.opp_rank_vs_pos;
  if (!rank) return `<td class="scp-glp-diff-cell">${DASH}</td>`;
  const band = matchupBand(rank);
  return (
    `<td class="scp-glp-diff-cell">` +
    `<span class="scp-glp-diff" data-band="${band}" title="${escapeHtml(
      `${entry.opp} ranked ${deps.ordinal(rank)} in points allowed to ${pos || "this position"} that season - 1st allows the most`,
    )}"><b>${escapeHtml(deps.ordinal(rank))}</b><span>${escapeHtml(deps.difficultyWord[band])}</span></span>` +
    `</td>`
  );
}

function renderSeasons(data: PlayerPageData, deps: PremiumLogDeps): string {
  if (data.logSeasons.length < 2) return "";
  const years = [...data.logSeasons].sort((x, y) => y - x);
  const chips = years
    .map((year) => {
      const on = year === data.logSeason;
      return (
        `<a class="scp-season-opt scp-glp-chip${on ? " is-active" : ""}"` +
        (year === data.season ? "" : ` rel="nofollow"`) +
        ` data-season="${year}"${on ? ` aria-current="true"` : ""}` +
        ` href="${escapeHtml(deps.seasonHref(year))}">${year}</a>`
      );
    })
    .join("");
  return (
    `<nav class="scp-seasonnav scp-glp-seasons" aria-label="Game log seasons (new design)">` +
    `<div class="scp-seasons">${chips}</div></nav>`
  );
}

function renderKpis(data: PlayerPageData, deps: PremiumLogDeps): string {
  const s = deps.summary;
  if (!s) return "";
  const pos = data.player.position ?? "";
  // Icon left; the value and its label on one line, the caption under them
  // (the reference's "8 GAMES / Regular season · PPR").
  const card = (icon: string, value: string, label: string, caption: string): string =>
    `<div class="scp-glp-kpi">` +
    `<span class="scp-glp-kpi-ico">${icon}</span>` +
    `<span class="scp-glp-kpi-t">` +
    `<span class="scp-glp-kpi-top"><b class="scp-glp-kpi-v">${escapeHtml(value)}</b>` +
    `<span class="scp-glp-kpi-l">${escapeHtml(label)}</span></span>` +
    `<small class="scp-glp-kpi-c">${escapeHtml(caption)}</small>` +
    `</span>` +
    `</div>`;
  const scope = `Regular season · ${SCORING_LABELS[data.format]}`;
  return (
    `<div class="scp-glp-kpis">` +
    card(ICON.calendar, String(s.played.length), s.played.length === 1 ? "Game" : "Games", scope) +
    card(ICON.bars, deps.num(s.ppg), "FPTS/G", "Fantasy points a game") +
    (s.avgRank !== null
      ? card(ICON.medal, `${pos}${s.avgRank}`, pos ? `Avg ${pos} Rank` : "Avg Rank", "Average weekly finish")
      : "") +
    card(ICON.trophy, deps.num(s.best), "Best FPTS", "Best week") +
    `</div>`
  );
}

function renderTable(data: PlayerPageData, deps: PremiumLogDeps): string {
  const { seasonLog, player } = data;
  const pos = player.position ?? "";
  const { columns, scored, span } = deps.layout;

  if (seasonLog.length === 0) {
    return `<div class="scp-glp-panel"><p class="scp-glp-empty">${escapeHtml(
      `No games logged for ${data.logSeason}.`,
    )}</p></div>`;
  }

  const head =
    `<tr>` +
    `<th scope="col" class="scp-glp-th-wk">Wk</th>` +
    `<th scope="col" class="scp-glp-th-opp">Opp</th>` +
    `<th scope="col" class="scp-glp-th-diff">Difficulty</th>` +
    (scored ? `<th scope="col" class="scp-glp-th-res">Result</th>` : "") +
    columns
      .map(
        (column) =>
          `<th scope="col" class="scp-glp-th-box${column.secondary ? " is-2" : ""}">${escapeHtml(column.label)}</th>`,
      )
      .join("") +
    `<th scope="col" class="scp-glp-th-pts">FPTS</th>` +
    `<th scope="col" class="scp-glp-th-fin">Finish</th>` +
    `</tr>`;

  const rows = seasonLog
    .map((entry) => {
      const status = entry.game_status ?? "out";
      if (status !== "active") {
        const { label, href } = deps.dnp(entry);
        return (
          `<tr class="scp-glp-row" data-status="${escapeHtml(status)}">` +
          `<th scope="row">${entry.week}</th>` +
          `<td colspan="${span - 1}" class="scp-glp-row-empty">` +
          (href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : escapeHtml(label)) +
          `</td></tr>`
        );
      }
      const logo = getTeamByAbbreviation(entry.opp)?.logo ?? null;
      // `gl-<season>-w<week>`: the suite checks every detail row on a pinned
      // season for the `gl-<season>-` prefix.
      const detailId = `gl-${data.logSeason}-w${entry.week}`;
      const detail = deps.detail(entry, detailId, span);
      return (
        `<tr class="scp-glp-row" data-status="active" data-week="${entry.week}"` +
        (detail ? ` data-detail="${escapeHtml(detailId)}"` : "") +
        `>` +
        `<th scope="row">${entry.week}</th>` +
        `<td class="scp-glp-opp">` +
        (logo
          ? `<img class="scp-glp-opp-logo" src="${escapeHtml(logo)}" alt="" aria-hidden="true" width="26" height="26" loading="lazy" decoding="async" />`
          : "") +
        `<span>${escapeHtml(entry.opp)}</span></td>` +
        difficultyCell(entry, deps, pos) +
        (scored ? `<td class="scp-glp-res">${escapeHtml(deps.score(entry))}</td>` : "") +
        columns
          .map(
            (column) =>
              `<td class="scp-glp-box${column.secondary ? " is-2" : ""}">${escapeHtml(deps.cell(entry, column))}</td>`,
          )
          .join("") +
        `<td class="scp-glp-pts">${escapeHtml(deps.num(deps.points(entry)))}</td>` +
        `<td class="scp-glp-fin">${finishPill(pos, entry.pos_rank)}</td>` +
        `</tr>` +
        detail
      );
    })
    .join("");

  const a = deps.averages;
  const foot = a
    ? `<tfoot><tr class="scp-glp-avg">` +
      `<th scope="row">Avg</th>` +
      `<td class="scp-glp-opp"><span class="scp-glp-avg-games">${escapeHtml(`${a.n} games`)}</span></td>` +
      `<td class="scp-glp-diff-cell">` +
      (a.avgBand
        ? `<span class="scp-glp-diff" data-band="${a.avgBand}"><span>${escapeHtml(deps.difficultyWord[a.avgBand])}</span></span>`
        : DASH) +
      `</td>` +
      (scored ? `<td class="scp-glp-res">${escapeHtml(a.record)}</td>` : "") +
      columns
        .map(
          (column) =>
            `<td class="scp-glp-box${column.secondary ? " is-2" : ""}">${escapeHtml(a.cell(column))}</td>`,
        )
        .join("") +
      `<td class="scp-glp-pts">${escapeHtml(deps.num(a.ppg))}</td>` +
      `<td class="scp-glp-fin">${finishPill(pos, a.meanRank)}</td>` +
      `</tr></tfoot>`
    : "";

  const note = seasonLog.some((entry) => entry.opp_rank_vs_pos)
    ? `<p class="scp-glp-note">${ICON.info}<span>${escapeHtml(
        `Opponent rank is fantasy points allowed to ${pos ? `${pos}s` : "the position"} across ${data.logSeason}: 1st allows the most, 32nd the fewest.`,
      )}</span></p>`
    : "";

  return (
    `<div class="scp-glp-panel">` +
    `<div class="scp-glp-scroll">` +
    `<table class="scp-glp-table" data-scp-sortable data-scp-expandable>` +
    `<thead>${head}</thead><tbody>${rows}</tbody>${foot}</table>` +
    `</div>${note}</div>`
  );
}

/* ----------------------------------------------------------------- ladder */

function renderFinishes(data: PlayerPageData, archive: boolean): string {
  const pos = data.player.position ?? "";
  const scale = ladderScale(pos);
  const built = buildGamelogStory(data, { archive });
  const id = `glp-fin-${data.logSeason}`;
  const bar = (summary: string): string =>
    `<header class="scp-glp-bar">` +
    `<span class="scp-glp-ico is-sm">${ICON.chart}</span>` +
    `<h3 class="scp-glp-bar-t" id="${id}">${escapeHtml(titleCase("Where his weeks finished"))}</h3>` +
    (summary ? `<p class="scp-glp-bar-sum">${summary}</p>` : "") +
    STRIPES +
    `</header>`;

  if (!scale || !built) {
    return (
      `<section class="scp-glp-finishes" aria-labelledby="${id}">${bar("")}` +
      `<p class="scp-glp-empty">${escapeHtml(`No weekly finishes to chart for ${data.logSeason}.`)}</p></section>`
    );
  }

  const { games, story, ink } = built;
  const n = games.length;
  // The axis runs to the position's usual floor (WR60, QB32), or further
  // when a week finished past it: the reference puts a WR70 at the band's
  // end rather than clamping it onto WR60 the way the tab's ladder does.
  const worstRank = Math.max(...games.map((g) => g.rank));
  const chart = worstRank > scale.max ? { ...scale, max: worstRank } : scale;
  const { band1, band2end } = bandEdges(chart);
  const { pins, avg } = layoutLadder(games, chart);

  const t1 = games.filter((g) => g.rank <= scale.t1).length;
  const t2 = games.filter((g) => g.rank > scale.t1 && g.rank <= scale.t2).length;
  const bust = n - t1 - t2;
  const share = (k: number): string => `${Math.round((k / n) * 100)}% of weeks`;

  const summary =
    ladderSummary(games, story, scale)
      .map((t) => `<span>${escapeHtml(t)}</span>`)
      .join(`<i aria-hidden="true">·</i>`) +
    (avg ? `<i aria-hidden="true">·</i><b>${escapeHtml(`Avg ${pos}${avg.rank}`)}</b>` : "");

  const card = (count: number, label: string, tone: string, icon: string): string =>
    `<div class="scp-glp-fcard" data-tone="${tone}">` +
    `<b class="scp-glp-fcard-v">${count}</b>` +
    `<span class="scp-glp-fcard-l">${escapeHtml(label)}</span>` +
    `<small class="scp-glp-fcard-c">${escapeHtml(share(count))}</small>` +
    `<span class="scp-glp-fcard-ico">${icon}</span>` +
    `</div>`;
  const cards =
    `<div class="scp-glp-fcards">` +
    card(t1, `${pos}1 Weeks`, "top", ICON.trophy) +
    card(t2, `${pos}2 Weeks`, "mid", ICON.layers) +
    card(bust, `${pos}${scale.t2 + 1}+ Weeks`, "low", ICON.alert) +
    `</div>`;

  const labelCls = (label: "above" | "below" | "none"): string =>
    label === "below" ? " is-below" : label === "none" ? " is-nolabel" : "";
  // A label at either end of the band aligns inward, so "Wk 3 @ DET" under a
  // rank-1 dot is not clipped by the figure's edge.
  const edgeCls = (x: number): string => (x < 7 ? " is-edge-lo" : x > 93 ? " is-edge-hi" : "");
  const weekLabel = (g: StoryGame): string =>
    `<span class="scp-glp-wk">${escapeHtml(`Wk ${g.week}`)}<small>${escapeHtml(
      ` ${g.homeAway === "away" ? "@" : "vs"} ${g.opp.abbr}`,
    )}</small></span>`;

  const pinHtml = pins
    .map(
      (pin) =>
        `<div class="scp-glp-pin${pin.best ? " is-best" : ""}${pin.games.length > 1 ? " is-multi" : ""}${labelCls(
          pin.label,
        )}${edgeCls(pin.x)}" style="left:${pctTrim(pin.x)}%"><i></i>` +
        `<span><strong>${escapeHtml(`${pos}${pin.rank}`)}` +
        (pin.games.length > 1 ? `<b>${escapeHtml(` ×${pin.games.length}`)}</b>` : "") +
        `</strong>${pin.games.map(weekLabel).join("")}` +
        (pin.best ? `<em>Best week</em>` : "") +
        `</span></div>`,
    )
    .join("");

  const avgHtml = avg
    ? `<div class="scp-glp-avgmark${labelCls(avg.label)}${edgeCls(avg.x)}" style="left:${pctTrim(avg.x)}%" title="${escapeHtml(
        `Season average finish: ${pos}${avg.rank}`,
      )}"><i></i><span><strong>${escapeHtml(`${pos}${avg.rank}`)}</strong><span class="scp-glp-wk">Season avg</span></span></div>`
    : "";

  const hasBelow = pins.some((p) => p.label === "below") || avg?.label === "below";
  // On a phone only the best week's label and the average's stay under the
  // band, so the average needs the second row only when the best week is
  // close to it; the CSS lifts it to the first row otherwise.
  const bestPin = pins.find((p) => p.best) ?? null;
  const phoneBelow = Boolean(avg && avg.label === "below" && bestPin && Math.abs(avg.x - bestPin.x) < 14);
  // The best week's label is a line taller (its badge), so a second-row
  // label within reach of it starts lower: the CSS drops the row by one
  // line only when this is set, so most charts keep the shorter figure.
  const deepBelow =
    bestPin !== null &&
    bestPin.label === "above" &&
    (pins.some((p) => p.label === "below" && Math.abs(p.x - bestPin.x) < 16) ||
      Boolean(avg && avg.label === "below" && Math.abs(avg.x - bestPin.x) < 16));
  const sparse = n >= 10;
  const hidden = pins.filter((p) => p.label === "none").flatMap((p) => p.games);
  const also =
    !sparse && hidden.length
      ? `<p class="scp-glp-also">${escapeHtml(
          `Also: ${hidden.map((g) => `Wk ${g.week} (${pos}${g.rank})`).join(", ")}`,
        )}</p>`
      : "";
  // Every week in order: the legend the 10-plus-game ladder always prints,
  // and on a phone (where only the best week and the average keep their
  // labels under the band) the list the hidden labels fold into.
  const weekList = escapeHtml(
    [...games]
      .sort((a, b) => a.week - b.week)
      .map((g) => `Wk ${g.week} ${pos}${g.rank}`)
      .join(" · "),
  );
  const legend = `<p class="scp-glp-also${sparse ? "" : " is-phone"}">${weekList}</p>`;

  // The tier names, each titled with the ranks its segment spans: the chart's
  // "WR1 range" runs to WR24 (ladderScale), while the finish pills call only
  // WR1-WR12 a WR1 (weeklyTier). Both are the page's existing rules; the
  // title says which one the band uses.
  const span = (lo: number, hi: number): string => `${pos}${lo} to ${pos}${hi}`;
  const cuts =
    `<div class="scp-glp-cuts">` +
    // "range" is dropped under 820px, where a QB's bust segment is too
    // narrow for two words.
    `<span class="scp-glp-tier is-k1" style="left:0;width:${pctTrim(band1)}%" title="${escapeHtml(
      `${pos}1 range on this chart: ${span(1, scale.t1)}`,
    )}">${escapeHtml(`${pos}1`)}<small> range</small></span>` +
    `<span class="scp-glp-tier is-k2" style="left:${pctTrim(band1)}%;width:${pctTrim(band2end - band1)}%" title="${escapeHtml(
      `${pos}2 range on this chart: ${span(scale.t1 + 1, scale.t2)}`,
    )}">${escapeHtml(`${pos}2`)}<small> range</small></span>` +
    `<span class="scp-glp-tier is-k3" style="left:${pctTrim(band2end)}%;width:${pctTrim(100 - band2end)}%" title="${escapeHtml(
      `Bust range on this chart: ${pos}${scale.t2 + 1} and worse`,
    )}">Bust<small> range</small></span>` +
    `<b class="is-lo" style="left:0" aria-hidden="true">${escapeHtml(`${pos}1`)}</b>` +
    `<b style="left:${pctTrim(band1)}%" aria-hidden="true">${escapeHtml(`${pos}${scale.t1}`)}</b>` +
    `<b style="left:${pctTrim(band2end)}%" aria-hidden="true">${escapeHtml(`${pos}${scale.t2}`)}</b>` +
    `</div>`;

  const ordered = [...games].sort((a, b) => a.rank - b.rank || a.week - b.week);
  const aria =
    `Weekly finishes on a scale from ${pos}1 to ${pos}${chart.max}: ` +
    ordered.map((g) => `Week ${g.week} ${pos}${g.rank}`).join(", ") +
    `.` +
    (avg ? ` Season average ${pos}${avg.rank}.` : "");

  const track =
    `<div class="scp-glp-track${hasBelow ? " has-below" : ""}${deepBelow ? " has-deep-below" : ""}${phoneBelow ? " has-phone-below" : ""}" role="img" aria-label="${escapeHtml(aria)}">` +
    `<div class="scp-glp-band is-b1" style="width:${pctTrim(band1)}%"></div>` +
    `<div class="scp-glp-band is-b2" style="left:${pctTrim(band1)}%;width:${pctTrim(band2end - band1)}%"></div>` +
    `<div class="scp-glp-band is-b3" style="left:${pctTrim(band2end)}%;width:${pctTrim(100 - band2end)}%"></div>` +
    `<i class="scp-glp-mark" style="left:${pctTrim(band1)}%"></i>` +
    `<i class="scp-glp-mark" style="left:${pctTrim(band2end)}%"></i>` +
    avgHtml +
    pinHtml +
    `</div>`;

  return (
    `<section class="scp-glp-finishes" aria-labelledby="${id}"${ink ? ` style="--scp-glp-team:${escapeHtml(ink)}"` : ""}>` +
    bar(summary) +
    `<div class="scp-glp-finishes-body">` +
    cards +
    `<figure class="scp-glp-ladder">${cuts}${track}${also}${legend}</figure>` +
    `</div></section>`
  );
}

/* ------------------------------------------------------------------ block */

/**
 * The whole block: hero, season chips, KPI cards, the table with its note,
 * and the finishes panel.
 */
export function renderGameLogPremium(data: PlayerPageData, deps: PremiumLogDeps): string {
  const archive = data.logSeason !== data.season;
  const titleId = `glp-title-${data.logSeason}`;
  return (
    `<div class="scp-glp-wrap">` +
    `<section class="scp-glp" aria-labelledby="${titleId}">` +
    `<header class="scp-glp-hero">` +
    `<div class="scp-glp-hero-l">` +
    `<span class="scp-glp-ico">${ICON.calendar}</span>` +
    `<span class="scp-glp-rule" aria-hidden="true"></span>` +
    `<div class="scp-glp-hero-t">` +
    `<h2 class="scp-glp-title" id="${titleId}">${escapeHtml(`${data.player.name} Game Log ${data.logSeason}`)}</h2>` +
    `<p class="scp-glp-sub">${escapeHtml(
      `Week-by-week performance, usage, and fantasy production for the ${data.logSeason} season.`,
    )}</p>` +
    `</div></div>` +
    BALL +
    STRIPES +
    `</header>` +
    `<div class="scp-glp-body">` +
    `<div class="scp-glp-main">` +
    renderSeasons(data, deps) +
    renderKpis(data, deps) +
    renderTable(data, deps) +
    `</div>` +
    renderFinishes(data, archive) +
    `</div></section></div>`
  );
}
