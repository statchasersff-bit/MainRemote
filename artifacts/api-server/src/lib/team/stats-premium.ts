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
import { premiumTabHead, premiumTabFrame } from "./premium-head";
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

/**
 * The Offense / Defense unit panel. Since 2026-11-08 (mak: "match that of"
 * Offense Efficiency) it wears the inner panels' light tinted head with the
 * Value / Rank labels in it, in place of the navy band and its Statistic /
 * Value / Rank row. The title stays an H2; data-unit and data-kind="" stay.
 */
function unitPanel(unit: "offense" | "defense", title: string, week: string, list: StatRow[], input: StatsPremiumInput): string {
  if (!list.length) return "";
  return (
    `<section class="sct-sp-panel is-unit" data-unit="${unit}" data-kind="">` +
    `<div class="sct-sp-panel-head"><span class="sct-sp-ico">${unit === "offense" ? ICON.football : ICON.shield}</span>` +
    `<div class="sct-sp-panel-text"><h2 class="sct-sp-panel-title">${e(title)}</h2>${week ? `<p class="sct-sp-panel-sub">${e(week)}</p>` : ""}</div>` +
    `<span class="sct-sp-panel-heads" aria-hidden="true"><span>Value</span><span>Rank</span></span></div>` +
    rows(list, input) +
    `</section>`
  );
}

/** A light inner panel with a tinted heading band (Offense Efficiency, Pass Rush, ...). */
function innerPanel(kind: string, icon: string, title: string, sub: string, list: StatRow[], input: StatsPremiumInput, wide = false): string {
  if (!list.length) return "";
  return (
    `<section class="sct-sp-panel${wide ? " is-wide" : ""}" data-kind="${e(kind)}">` +
    `<div class="sct-sp-panel-head"><span class="sct-sp-ico">${icon}</span>` +
    `<div class="sct-sp-panel-text"><h3 class="sct-sp-panel-title">${e(title)}</h3>${sub ? `<p class="sct-sp-panel-sub">${e(sub)}</p>` : ""}</div>` +
    `<span class="sct-sp-panel-heads" aria-hidden="true"><span>Value</span><span>Rank</span></span></div>` +
    rows(list, input) +
    `</section>`
  );
}

/**
 * A navy section band: icon, title, one-line subtitle, gold corner.
 * `phoneOff`: the whole band is hidden at 560px and under (mak, 2026-11-12:
 * Efficiency, Pass Protection & Pass Rush, Possession & Discipline).
 */
function band(icon: string, title: string, sub: string, phoneOff = false): string {
  return (
    `<div class="sct-sp-band${phoneOff ? " is-phone-off" : ""}"><span class="sct-sp-ico">${icon}</span>` +
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
    // The caption again, in the head row: shown at 560px and under only, where
    // the legend's copy is kept for screen readers alone (mak, 2026-11-12).
    `<div class="sct-sp-mix-head"><span class="sct-sp-ico">${ICON.play}</span><h3 class="sct-sp-mix-title">${e(title)}</h3>` +
    `<span class="sct-sp-mix-head-cap" aria-hidden="true">${e(caption)}</span></div>` +
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
        // No "Current" pill on the live season (mak, 2026-11-06); the row keeps its .is-current tint.
        games +
        `</th>` +
        tds +
        `</tr>`
      );
    })
    .join("");
  const span = seasons[seasons.length - 1]?.season;
  // The wrapper is the phone card (the recap card design, mak 2026-11-14); unstyled above 560px.
  return (
    `<div class="sct-sp-history">` +
    band(ICON.calendar, "Season History", `Key team statistics over the last ${seasons.length} seasons, each ranked against the 32 teams of its own year.`) +
    `<div class="sct-sp-h-scroll"><table class="sct-sp-h">` +
    `<caption class="sct-visually-hidden">${e(`Team production by season${span ? ` back to ${span}` : ""}, with each figure's NFL rank for that season. Green cells rank in the top ten, red cells in the bottom ten.`)}</caption>` +
    `<thead>${head}</thead><tbody>${body}</tbody></table></div>` +
    `</div>`
  );
}

export function renderStatsPremium(input: StatsPremiumInput): string {
  const { team, season, heading, note } = input;

  const overview =
    // No "Through Week N" under Offense / Defense (mak, 2026-11-06); the
    // inner panels below still name their week.
    unitPanel("offense", "Offense", "", input.production.offense, input) +
    unitPanel("defense", "Defense", "", input.production.defense, input);

  const efficiency =
    // No panel names its week any more (mak, 2026-11-06: Offense / Defense,
    // then Efficiency, then the rest); the ladders still read their sources'
    // weeks for the numbers themselves.
    innerPanel("efficiency", ICON.target, "Offense Efficiency", "Per play, what they did", input.efficiency.offense, input) +
    innerPanel("efficiency", ICON.shield, "Defense Efficiency", "Per play, what they allowed", input.efficiency.defense, input);

  const passRush =
    innerPanel("passrush", ICON.helmet, "Pass Protection", "What the offense faced", input.passRush.offense, input) +
    innerPanel("passrush", ICON.rush, "Pass Rush", "What the defense sent", input.passRush.defense, input);

  const possession = innerPanel(
    "possession",
    ICON.warning,
    "Turnovers, Downs & Penalties",
    // No subtitle on this panel (mak, 2026-11-06).
    "",
    input.possession,
    input,
    true,
  );

  const pace = innerPanel("pace", ICON.layers, "Snaps, Attempts & Scores", "Run/pass mix and scoring, ranked most to least", input.pace, input);
  const mixes =
    // A box-score split, not the Usage and Coaching pass rate (Team Pages
    // Phase 2B, 2026-11-19): attempts + sacks against rushing attempts, so a
    // scramble or a kneel is a run here and a pass (or nothing) there.
    (input.balance ? mix("Play Mix (Offense)", "Box-score split: pass attempts and sacks vs. rushing attempts (scrambles and kneels count as runs).", input.balance) : "") +
    (input.balanceFaced ? mix("Play Mix (Defense)", "Box-score split faced on defense: pass attempts and sacks vs. rushing attempts.", input.balanceFaced) : "");

  const sections: string[] = [];
  if (overview) sections.push(`<div class="sct-sp-grid">${overview}</div>`);
  if (efficiency)
    sections.push(
      band(ICON.chart, "Efficiency", "Per play, how well each side performs: expected points, success and explosive rates, and yards per play, attempt and carry. 1st is best on either side.", true) +
        `<div class="sct-sp-grid">${efficiency}</div>`,
    );
  if (passRush)
    sections.push(
      band(ICON.lines, "Pass Protection & Pass Rush", "Blitzes faced and sent, what each cost, time to throw, and the sacks at both ends. Blitz rate and time to throw rank most to least.", true) +
        `<div class="sct-sp-grid">${passRush}</div>`,
    );
  if (possession) sections.push(band(ICON.hourglass, "Possession & Discipline", "What each side does with the football: turnover margin, takeaways and giveaways, fourth downs and penalties.", true) + possession);
  if (pace || mixes)
    sections.push(
      band(ICON.play, "Pace & Play Style", `How often the ${team.nickname} run and pass, and how many snaps there are to go round. Ranks are most to least, with no better end.`) +
        `<div class="sct-sp-pace">${pace}${mixes ? `<div class="sct-sp-mixes">${mixes}</div>` : ""}</div>`,
    );
  const hist = history(input);
  if (hist) sections.push(hist);
  if (!sections.length) return "";

  const head = premiumTabHead({
    hook: "sct-sp-hero",
    icon: "stats",
    art: "stats",
    heading,
    phoneTitle: `${season} Team Stats`,
    dek: `Complete offensive, defensive and situational team statistics for the ${season} season, with efficiency metrics, play style, discipline and a multi-year performance history.`,
  });
  return (
    `<div class="sct-sp">` +
    // Offense / Defense sit on the page like every section under them, not
    // inside the header's white frame (mak, 2026-11-08); only a note, when
    // there is one, stays in the frame under the header.
    (note ? premiumTabFrame(head, `<p class="sct-note sct-sp-note">${e(note)}</p>`) : head) +
    sections.join("") +
    `</div>`
  );
}
