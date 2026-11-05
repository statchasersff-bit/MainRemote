/**
 * The Stats tab (mak's brief, 2026-11-05, built to attached_assets/teamstats.png
 * and approved the same day: "remove the old version"): the navy title banner
 * carrying the tab's heading, Offense and Defense as two navy-headed panels,
 * then Efficiency, Pass Protection & Pass Rush, Possession & Discipline and
 * Pace & Play Style as navy section bands over light inner panels of label /
 * rank bar / value / rank-pill rows, the two play-mix bars, and the
 * five-season history as a tinted table.
 *
 * Every row is the tab's own StatRow (lib/team/stats.ts and
 * lib/team/efficiency.ts), chosen by renderTeamStats() in team-render.ts:
 * same value strings, same ranks and tie labels, same directions. The bar is
 * the tab's rank bar (1st fills the track, 32nd leaves a stub) and the tint
 * is the tab's tier, both handed in by the caller so nothing is computed
 * twice; volume rows (pace, blitz rate, time to throw) are ranked but never
 * tinted. The history cells tint by the tab's history tier (top ten green,
 * bottom ten red, the middle plain).
 *
 * Headings: the banner holds the tab's H2 (handed in; a section address
 * promotes it to the H1), the bands and the Offense / Defense panels are H2s,
 * the inner panels and the play-mix cards H3s. `data-kind` on the panels
 * (efficiency / passrush / possession / pace) is what the week-consistency
 * test reads. Markup `sct-sp-*`; every rule in team.css is under `.sct .sct-sp`.
 */

import { escapeHtml as e } from "../render";
import { premiumTabHead } from "./premium-head";
import type { NflTeam } from "./teams";
import type { HistorySeason, PlayBalance, StatRow } from "./stats";

export type Tier = "good" | "mid" | "poor" | "none";
export type HistoryTier = "elite" | "good" | "mid" | "poor" | "none";

export interface StatsPremiumInput {
  team: NflTeam;
  season: number;
  /** The tab's heading, already marked up (h2() with "sct-sp-title"); the banner carries it. */
  heading: string;
  /** The prior-season fallback warning, "" in season. */
  note: string;
  /** The production ladders' week ("through Week N"), null when unknown. */
  liveWeek: number | null;
  /** The play-by-play ladders' week, null when unknown. */
  effWeek: number | null;
  production: { offense: StatRow[]; defense: StatRow[] };
  efficiency: { offense: StatRow[]; defense: StatRow[] };
  passRush: { offense: StatRow[]; defense: StatRow[] };
  possession: StatRow[];
  pace: StatRow[];
  balance: PlayBalance | null;
  balanceFaced: PlayBalance | null;
  history: HistorySeason[];
  /** The tab's tier for a row: the tint behind its bar and pill. */
  tier: (row: StatRow) => Tier;
  /** The tab's rank-bar fill, a CSS width. */
  fill: (rank: number) => string;
  /** The tab's history tier for a cell. */
  historyTier: (row: StatRow) => HistoryTier;
}

const TIER_WORD: Record<Tier, string> = { good: "top tier", mid: "middle tier", poor: "bottom tier", none: "" };

const svg = (body: string, size = 20): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ICON = {
  football: svg(`<path d="M4.5 19.5c-1.5-1.5-1.5-6 2-9.5s8-3.5 9.5-2 1.5 6-2 9.5-8 3.5-9.5 2z"/><path d="M9 15l6-6"/><path d="M10.5 12.5l1 1M12.5 10.5l1 1"/><path d="M4.5 19.5l2-2M17.5 6.5l2-2"/>`),
  shield: svg(`<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/>`),
  chart: svg(`<path d="M4 20h16"/><path d="M7 16v-5M12 16V8M17 16v-3"/>`),
  target: svg(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>`),
  lines: svg(`<path d="M4 7h16M4 12h16M4 17h16"/>`),
  helmet: svg(`<path d="M5 13a7 7 0 0 1 14 0v3h-3l-1 3H9l-1-3H5z"/><path d="M12 13h7"/>`),
  rush: svg(`<path d="M4 14l5-5 4 4 7-7"/><path d="M15 6h5v5"/>`),
  hourglass: svg(`<path d="M7 3h10M7 21h10M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4"/>`),
  warning: svg(`<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>`),
  play: svg(`<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z"/>`),
  layers: svg(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>`),
  calendar: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
};

const through = (week: number | null): string => (week ? `Through Week ${week}` : "");

/** One row: label, rank bar, value, rank pill. The bar is decorative; the pill and hidden text carry the rank. */
function row(r: StatRow, tier: Tier, fillOf: (rank: number) => string): string {
  const t = r.rank === null ? "none" : tier;
  const bar =
    r.rank !== null
      ? `<span class="sct-sp-bar" data-tier="${t}" aria-hidden="true"><span class="sct-sp-fill" style="${e(`width:${fillOf(r.rank)}`)}"></span></span>`
      : `<span class="sct-sp-bar is-empty" aria-hidden="true"></span>`;
  const rank = r.rankLabel
    ? `<span class="sct-sp-rank" data-tier="${t}">${e(r.rankLabel)}<span class="sct-visually-hidden"> of 32${t !== "none" ? `, ${e(TIER_WORD[t])}` : ""}</span></span>`
    : `<span class="sct-sp-rank is-none">-<span class="sct-visually-hidden">unranked</span></span>`;
  return (
    `<li class="sct-sp-row">` +
    `<span class="sct-sp-label">${e(r.label)}<span class="sct-visually-hidden">: ${e(r.description)}</span></span>` +
    bar +
    `<span class="sct-sp-value">${e(r.value)}</span>` +
    rank +
    `</li>`
  );
}

function rows(list: StatRow[], input: StatsPremiumInput): string {
  return `<ul class="sct-sp-rows">${list.map((r) => row(r, input.tier(r), input.fill)).join("")}</ul>`;
}

/** The column heads over a row list: statistic / value / rank. */
const heads = (first = "Statistic"): string =>
  `<p class="sct-sp-heads" aria-hidden="true"><span>${e(first)}</span><span></span><span>Value</span><span>Rank</span></p>`;

/** A navy-headed unit panel (Offense / Defense). */
function unitPanel(unit: "offense" | "defense", title: string, week: string, list: StatRow[], input: StatsPremiumInput): string {
  if (!list.length) return "";
  return (
    `<section class="sct-sp-unit" data-unit="${unit}" data-kind="">` +
    `<div class="sct-sp-unit-head"><span class="sct-sp-ico">${unit === "offense" ? ICON.football : ICON.shield}</span>` +
    `<h2 class="sct-sp-unit-title">${e(title)}</h2>${week ? `<span class="sct-sp-week">${e(week)}</span>` : ""}</div>` +
    `<div class="sct-sp-unit-body">${heads()}${rows(list, input)}</div>` +
    `</section>`
  );
}

/** A light inner panel with a tinted heading band (Offense Efficiency, Pass Rush, ...). */
function innerPanel(kind: string, icon: string, title: string, sub: string, list: StatRow[], input: StatsPremiumInput, wide = false): string {
  if (!list.length) return "";
  return (
    `<section class="sct-sp-panel${wide ? " is-wide" : ""}" data-kind="${e(kind)}">` +
    `<div class="sct-sp-panel-head"><span class="sct-sp-ico">${icon}</span>` +
    `<div class="sct-sp-panel-text"><h3 class="sct-sp-panel-title">${e(title)}</h3><p class="sct-sp-panel-sub">${e(sub)}</p></div>` +
    `<span class="sct-sp-panel-heads" aria-hidden="true"><span>Value</span><span>Rank</span></span></div>` +
    rows(list, input) +
    `</section>`
  );
}

/** A navy section band: icon, title, one-line subtitle, gold corner. */
function band(icon: string, title: string, sub: string): string {
  return (
    `<div class="sct-sp-band"><span class="sct-sp-ico">${icon}</span>` +
    `<h2 class="sct-sp-band-title">${e(title)}</h2><p class="sct-sp-band-sub">${e(sub)}</p>` +
    `<span class="sct-sp-band-gold" aria-hidden="true"></span></div>`
  );
}

/** The pass/run split as one bar: the two shares sum to 100 (lib/team/stats.ts), so the bar is the whole. */
function mix(title: string, caption: string, b: PlayBalance): string {
  const pass = b.passPct.toFixed(1);
  const run = b.rushPct.toFixed(1);
  return (
    `<section class="sct-sp-mix">` +
    `<div class="sct-sp-mix-head"><span class="sct-sp-ico">${ICON.play}</span><h3 class="sct-sp-mix-title">${e(title)}</h3></div>` +
    `<span class="sct-sp-mix-bar" aria-hidden="true"><span class="sct-sp-mix-pass" style="${e(`width:${pass}%`)}"></span><span class="sct-sp-mix-run" style="${e(`width:${run}%`)}"></span></span>` +
    `<p class="sct-sp-mix-legend"><span class="sct-sp-mix-key" data-kind="pass">Pass ${e(pass)}%</span><span class="sct-sp-mix-key" data-kind="run">Run ${e(run)}%</span>` +
    `<span class="sct-sp-mix-caption">${e(caption)}</span></p>` +
    `</section>`
  );
}

function history(input: StatsPremiumInput): string {
  const { history: seasons } = input;
  if (seasons.length < 2) return "";
  const columns = seasons[0]?.cells ?? [];
  if (!columns.length) return "";
  const head =
    `<tr><th scope="col" class="sct-sp-h-season">Season</th>` +
    columns.map((c) => `<th scope="col">${e(c.label)}<span class="sct-visually-hidden">: ${e(c.description)}</span></th>`).join("") +
    `</tr>`;
  const body = seasons
    .map((s, i) => {
      const cells = new Map(s.cells.map((c) => [c.key, c]));
      const tds = columns
        .map((col) => {
          const c = cells.get(col.key);
          if (!c) return `<td class="sct-sp-h-cell is-empty"></td>`;
          const tier = input.historyTier(c);
          const wash = tier === "elite" || tier === "good" ? "good" : tier === "poor" ? "poor" : "mid";
          return (
            `<td class="sct-sp-h-cell" data-tier="${c.rank === null ? "none" : wash}">` +
            `<span class="sct-sp-h-value">${e(c.value)}</span>` +
            (c.rankLabel ? `<span class="sct-sp-h-rank">${e(c.rankLabel)}<span class="sct-visually-hidden"> of 32</span></span>` : "") +
            `</td>`
          );
        })
        .join("");
      const games = s.gamesPlayed ? `<span class="sct-sp-h-games">${e(`${s.gamesPlayed} ${s.gamesPlayed === 1 ? "game" : "games"}`)}</span>` : "";
      return (
        `<tr${i === 0 ? ` class="is-current"` : ""}>` +
        `<th scope="row" class="sct-sp-h-season"><span class="sct-sp-h-year">${e(String(s.season))}</span>` +
        (i === 0 ? `<span class="sct-sp-h-now">Current</span>` : "") +
        games +
        `</th>` +
        tds +
        `</tr>`
      );
    })
    .join("");
  const span = seasons[seasons.length - 1]?.season;
  return (
    band(ICON.calendar, "Season History", `Key team statistics over the last ${seasons.length} seasons, each ranked against the 32 teams of its own year.`) +
    `<div class="sct-sp-h-scroll"><table class="sct-sp-h">` +
    `<caption class="sct-visually-hidden">${e(`Team production by season${span ? ` back to ${span}` : ""}, with each figure's NFL rank for that season. Green cells rank in the top ten, red cells in the bottom ten.`)}</caption>` +
    `<thead>${head}</thead><tbody>${body}</tbody></table></div>`
  );
}

export function renderStatsPremium(input: StatsPremiumInput): string {
  const { team, season, liveWeek, effWeek, heading, note } = input;
  const live = through(liveWeek);
  const eff = through(effWeek);
  const dash = (w: string): string => (w ? ` - ${w}` : "");

  const overview =
    unitPanel("offense", "Offense", live, input.production.offense, input) +
    unitPanel("defense", "Defense", live, input.production.defense, input);

  const efficiency =
    innerPanel("efficiency", ICON.target, "Offense Efficiency", `Per play, what they did${dash(eff)}`, input.efficiency.offense, input) +
    innerPanel("efficiency", ICON.shield, "Defense Efficiency", `Per play, what they allowed${dash(eff)}`, input.efficiency.defense, input);

  const passRush =
    innerPanel("passrush", ICON.helmet, "Pass Protection", `What the offense faced${dash(eff)}`, input.passRush.offense, input) +
    innerPanel("passrush", ICON.rush, "Pass Rush", `What the defense sent${dash(eff)}`, input.passRush.defense, input);

  const possession = innerPanel(
    "possession",
    ICON.warning,
    "Turnovers, Downs & Penalties",
    `Turnover margin first; takeaways and giveaways are its two halves${dash(live)}`,
    input.possession,
    input,
    true,
  );

  const pace = innerPanel("pace", ICON.layers, "Snaps, Attempts & Scores", `Run/pass mix and scoring, ranked most to least${dash(live)}`, input.pace, input);
  const mixes =
    (input.balance ? mix("Play Mix (Offense)", `${team.fullName}'s offensive play distribution.`, input.balance) : "") +
    (input.balanceFaced ? mix("Play Mix (Defense)", "Play distribution faced on defense.", input.balanceFaced) : "");

  const sections: string[] = [];
  if (overview) sections.push(`<div class="sct-sp-grid">${overview}</div>`);
  if (efficiency)
    sections.push(
      band(ICON.chart, "Efficiency", "Per play, how well each side performs: expected points, success and explosive rates, and yards per play, attempt and carry. 1st is best on either side.") +
        `<div class="sct-sp-grid">${efficiency}</div>`,
    );
  if (passRush)
    sections.push(
      band(ICON.lines, "Pass Protection & Pass Rush", "Blitzes faced and sent, what each cost, time to throw, and the sacks at both ends. Blitz rate and time to throw rank most to least.") +
        `<div class="sct-sp-grid">${passRush}</div>`,
    );
  if (possession) sections.push(band(ICON.hourglass, "Possession & Discipline", "What each side does with the football: turnover margin, takeaways and giveaways, fourth downs and penalties.") + possession);
  if (pace || mixes)
    sections.push(
      band(ICON.play, "Pace & Play Style", `How often the ${team.nickname} run and pass, and how many snaps there are to go round. Ranks are most to least, with no better end.`) +
        `<div class="sct-sp-pace">${pace}${mixes ? `<div class="sct-sp-mixes">${mixes}</div>` : ""}</div>`,
    );
  const hist = history(input);
  if (hist) sections.push(hist);
  if (!sections.length) return "";

  return (
    `<div class="sct-sp">` +
    premiumTabHead({
      hook: "sct-sp-hero",
      icon: "stats",
      heading,
      dek: `Complete offensive, defensive and situational team statistics for the ${season} season, with efficiency metrics, play style, discipline and a multi-year performance history.`,
    }) +
    (note ? `<p class="sct-note sct-sp-note">${e(note)}</p>` : "") +
    sections.join("") +
    `</div>`
  );
}
