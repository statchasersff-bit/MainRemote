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
  buildGamelogStory,
  ladderScale,
  ladderSummary,
  layoutLadder,
  type StoryGame,
} from "./gamelog-sections";
import { titleCase } from "./title-case";
import type { PlayerPageData } from "./player-data";
import type { GameLogEntry } from "./types";
import { headArt, headIcon } from "./tab-head";

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

/**
 * The phone's season selector (mak, 2026-11-06): a dropdown on the heading's
 * row in place of the chip strip, which the CSS hides under 560px (this one
 * is hidden above it). The options are .scp-season-opt links with the chips'
 * hrefs, so the client's state swap handles them the same way and the menu
 * works with scripting off. Not in .scp-seasons: the chips stay the one
 * group the swap restores focus to, and no option carries .is-active.
 */
function renderSeasonMenu(data: PlayerPageData, deps: PremiumLogDeps): string {
  if (data.logSeasons.length < 2) return "";
  const years = [...data.logSeasons].sort((x, y) => y - x);
  const options = years
    .map((year) => {
      const on = year === data.logSeason;
      return (
        `<li><a class="scp-season-opt scp-glp-yr-opt"` +
        (year === data.season ? "" : ` rel="nofollow"`) +
        ` data-season="${year}"${on ? ` aria-current="true"` : ""}` +
        ` href="${escapeHtml(deps.seasonHref(year))}">${year}</a></li>`
      );
    })
    .join("");
  return (
    `<details class="scp-glp-yr" data-scp-yr>` +
    `<summary class="scp-glp-yr-btn" aria-label="${escapeHtml(`Season: ${data.logSeason}`)}"><b>${data.logSeason}</b></summary>` +
    `<ul class="scp-glp-yr-list">${options}</ul>` +
    `</details>`
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
      // Weeks he did not play are left out (mak, 2026-11-06); a bye still
      // shows, it is the team's week off rather than his absence.
      if (status !== "active" && status !== "bye") return "";
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
  // The average finish for the summary line. The ladder chart it was laid
  // out for (bands, pins, tier labels) is gone (mak, 2026-11-06).
  const { avg } = layoutLadder(games, scale);

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

  return (
    `<section class="scp-glp-finishes" aria-labelledby="${id}"${ink ? ` style="--scp-glp-team:${escapeHtml(ink)}"` : ""}>` +
    bar(summary) +
    `<div class="scp-glp-finishes-body">` +
    cards +
    `</div></section>`
  );
}

/* ------------------------------------------------------------------ block */

/**
 * The whole block: hero, season chips, KPI cards, the table with its note,
 * the finishes panel, and `tail` (the Game-by-Game Breakdown and Upcoming
 * Matchups, breakdown-premium.ts) INSIDE the same frame, under the finishes
 * panel, at mak's request (2026-11-05).
 */
export function renderGameLogPremium(data: PlayerPageData, deps: PremiumLogDeps, tail = ""): string {
  const archive = data.logSeason !== data.season;
  const titleId = `glp-title-${data.logSeason}`;
  return (
    `<div class="scp-glp-wrap">` +
    `<section class="scp-glp" aria-labelledby="${titleId}">` +
    `<header class="scp-glp-hero scp-up-head">` +
    `<div class="scp-glp-hero-l">` +
    headIcon("gamelog") +
    `<span class="scp-glp-ico">${ICON.calendar}</span>` +
    `<span class="scp-glp-rule" aria-hidden="true"></span>` +
    `<div class="scp-glp-hero-t">` +
    // Phones read "2026 Game Log" (mak, 2026-11-06): the name and trailing
    // year are clipped there, not removed, and the leading year is generated.
    `<h2 class="scp-glp-title scp-up-h2" id="${titleId}"><span class="scp-stp-xs">${escapeHtml(data.player.name)} </span>` +
    `<span class="scp-glp-title-main" data-year="${data.logSeason}">Game Log</span><span class="scp-stp-xs"> ${data.logSeason}</span></h2>` +
    `<p class="scp-glp-sub scp-up-dek">${escapeHtml(
      `Week-by-week performance, usage, and fantasy production for the ${data.logSeason} season.`,
    )}</p>` +
    `</div></div>` +
    renderSeasonMenu(data, deps) +
    headArt("stats") +
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
    tail +
    `</div></section></div>`
  );
}
