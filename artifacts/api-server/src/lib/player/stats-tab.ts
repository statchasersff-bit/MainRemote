/**
 * The Stats tab, to mak's spec of 2026-09-29 ("Stats Tab Spec"), minus its SEO
 * section.
 *
 * Six sections under the header and tab bar: this season's production cards
 * with a totals / per-game toggle, the two advanced cards, the career chart,
 * the career table, the career read with its rates and highs, and a FAQ. Each
 * is a <section aria-labelledby> with an H2 and a lede, and each is left out
 * whole when its data is not there, never rendered empty.
 *
 * Its own module, like ./overview.ts, so tests/player-stats-tab.test.mjs can
 * render it against hand-built states (preseason, one season, a trade, a
 * player below the threshold) without the database. It wears the Overview's
 * section styles (.scp-ox, player.css "overview, lower") plus its own block,
 * "stats tab".
 *
 * Every career figure is summed from the weekly logs (data.logCareer) and never
 * read from a stored total, so the chart, the table, the header and the Game
 * Log agree: games played is the count of games in the logs, and fantasy
 * points are the site's own scoring of each week.
 *
 * Where it departs from the spec, deliberately:
 *   - it is split around the tab's existing content: production, advanced
 *     and the career chart open the tab (mak, 2026-09-30), the rest sits
 *     under the old content; the panel heading the WordPress page promotes
 *     to its H1 stays first either way;
 *   - the advanced metrics no file here has are replaced (see stats-tab-data);
 *   - its FAQ is the page's "{Name} Stats FAQ" (faq-engine.ts, faq-pools.ts,
 *     mak 2026-09-30), not a section of this file.
 *
 * Analyst copy comes from data/player/stats_copy.json (docs/STATS-COPY.md):
 * each field replaces only its own template text. College seasons come from
 * data/player/college_stats.json (scripts/player/buildCollegeStats.mjs): a
 * rookie's Card B is his final college season, and before his first NFL game
 * the tab is that card and a college table.
 */

import { escapeHtml } from "../render";
import { possessive } from "./title-case";
import { titleCase } from "./title-case";
import type { PlayerRenderOptions } from "../player-render";
import { getTeamByAbbreviation } from "../team/teams";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { passerRating } from "./stats-profile";
import { collegeCard, type AdvCard, type AdvMetric, type CollegeCard, type LogSeason } from "./stats-tab-data";
import type { GameLogEntry } from "./types";
import { lastName, teamInk } from "./header";

const DASH = "-";

/** The scoring as the reference page words it: "full PPR", not the toggle's "PPR". */
const SCORING_WORDS = { ppr: "full PPR", half: "half-PPR", standard: "standard" } as const;
const MINUS = "−";
const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

/* ------------------------------------------------------------------ atoms */

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** A true minus sign, never a hyphen. */
const signed = (s: string): string => s.replace(/^-(?=\d)/, MINUS);
const one = (v: number): string => signed(v.toFixed(1));
const whole = (v: number): string => signed(Math.round(v).toLocaleString("en-US"));
const pct1 = (v: number): string => `${v.toFixed(1)}%`;
/** A label's first word, lowercased mid-sentence unless it is an acronym ("EPA"). */
const LC = /^[A-Z][a-z]/;

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => WORDS[n] ?? String(n);
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
const listWords = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;


function sectionOpen(id: string, heading: string, lede: string, aside = ""): string {
  // The tab's lead heading (its H1 on WordPress) wears the panel-heading style.
  const lead = id === STATS_LEAD_ID ? " is-lead" : "";
  const h = `<h2 class="scp-ox-h2${lead}" id="${id}">${escapeHtml(titleCase(heading))}</h2>`;
  return (
    `<section class="scp-ox-sec" aria-labelledby="${id}">` +
    // `aside` is a control that belongs on the heading's row.
    (aside ? `<div class="scp-st-headrow">${h}${aside}</div>` : h) +
    (lede ? `<p class="scp-ox-lede">${lede}</p>` : "")
  );
}

function a(href: string, text: string, attrs = ""): string {
  return `<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;
}

/* ------------------------------------------------------- analyst copy */

/** An analyst field, trimmed, or null when it is missing or blank. */
function own(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Analyst text as HTML: escaped, with `[text](url)` turned into a link when the
 * URL is http(s) or root-relative. Nothing else is interpreted.
 */
function copyHtml(text: string): string {
  let out = "";
  let at = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g)) {
    out += escapeHtml(text.slice(at, m.index)) + a(m[2]!, m[1]!);
    at = m.index! + m[0].length;
  }
  return out + escapeHtml(text.slice(at));
}

/* ------------------------------------------------------ position rules */

/** Season finish bands: [good up to, mid up to]. RB/WR run twice as deep. */
function finishBands(pos: string): [number, number] {
  return pos === "RB" || pos === "WR" ? [24, 36] : [12, 24];
}

/** "Starter" weeks: top 12 at QB and TE, top 24 at RB and WR. */
const topN = (pos: string): number => finishBands(pos)[0];

/** Weekly swing bands, by the standard deviation of weekly points. */
/** Regular-season games a club played, by season. */
const teamGames = (season: number): number => (season <= 2020 ? 16 : 17);

/* ---------------------------------------------------------------- lines */

interface Line {
  gp: number;
  /** Starts, sacks taken, fumbles lost: 0 for a season logged before the builder kept them. */
  gs: number; sacks: number; fumLost: number;
  att: number; cmp: number; passYd: number; passTd: number; int: number;
  rushAtt: number; rushYd: number; rushTd: number; rushLong: number | null;
  tgt: number; rec: number; recYd: number; recTd: number;
  pts: number;
}

const EMPTY: Line = {
  gp: 0, gs: 0, sacks: 0, fumLost: 0, att: 0, cmp: 0, passYd: 0, passTd: 0, int: 0,
  rushAtt: 0, rushYd: 0, rushTd: 0, rushLong: null,
  tgt: 0, rec: 0, recYd: 0, recTd: 0, pts: 0,
};

function sumLine(entries: GameLogEntry[], pts: (e: GameLogEntry) => number): Line {
  const t: Line = { ...EMPTY };
  const v = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  for (const e of entries) {
    const st = e.stats as unknown as Record<string, unknown>;
    t.gp += 1;
    t.gs += v(st.gs); t.sacks += v(st.pass_sack); t.fumLost += v(st.fum_lost);
    t.att += v(st.pass_att); t.cmp += v(st.pass_cmp); t.passYd += v(st.pass_yd);
    t.passTd += v(st.pass_td); t.int += v(st.pass_int);
    t.rushAtt += v(st.rush_att); t.rushYd += v(st.rush_yd); t.rushTd += v(st.rush_td);
    if (typeof st.rush_lng === "number") t.rushLong = Math.max(t.rushLong ?? 0, st.rush_lng);
    t.tgt += v(st.rec_tgt); t.rec += v(st.rec); t.recYd += v(st.rec_yd); t.recTd += v(st.rec_td);
    t.pts += pts(e);
  }
  return t;
}

function addLines(lines: Line[]): Line {
  const t: Line = { ...EMPTY };
  for (const l of lines) {
    for (const k of Object.keys(t) as Array<keyof Line>) {
      if (k === "rushLong") continue;
      (t[k] as number) += l[k] as number;
    }
    if (l.rushLong !== null) t.rushLong = Math.max(t.rushLong ?? 0, l.rushLong);
  }
  return t;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const fmtRatio = (a: number, b: number, digits = 1): string => {
  const r = ratio(a, b);
  return r === null ? DASH : signed(r.toFixed(digits));
};
const rating = (t: Line): number | null =>
  passerRating({ passAtt: t.att, passCmp: t.cmp, passYd: t.passYd, passTd: t.passTd, passInt: t.int } as never);

/* --------------------------------------------------------------- career */

interface SeasonRow {
  season: number;
  clubs: string[];
  line: Line;
  /** One line per club, in the order he played for them, when he was traded. */
  splits: Array<{ club: string; line: Line }>;
  finish: number | null;
  inProgress: boolean;
  weeks: GameLogEntry[];
}

interface Career {
  pos: string;
  rows: SeasonRow[];
  /** The season the page is about: the current one, or the last he played. */
  focus: SeasonRow | null;
  total: Line;
  leagueSeason: number;
  leagueWeek: number;
  pts: (e: GameLogEntry) => number;
}

function clubCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return getTeamByAbbreviation(raw)?.code ?? raw.toUpperCase();
}

/**
 * Each season's clubs, in the order he played for them ("PHI/IND" for a
 * season split by a trade), read from the same game logs the chart's
 * "17 GP · SEA" captions use. The career table's Team column (2026-11-06).
 */
export function seasonClubs(data: PlayerPageData): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const s of data.logCareer ?? []) {
    const clubs: string[] = [];
    for (const e of s.weeks) {
      const c = clubCode(e.team);
      if (c && !clubs.includes(c)) clubs.push(c);
    }
    if (clubs.length) out.set(s.season, clubs);
  }
  return out;
}

function career(data: PlayerPageData): Career {
  const pos = data.player.position ?? "";
  const leagueSeason = data.leagueSeason ?? data.season;
  const leagueWeek = data.leagueWeek ?? 0;
  const pts = (e: GameLogEntry): number => getEntryPoints(e.stats, data.format);
  const rows: SeasonRow[] = (data.logCareer ?? [])
    .filter((s: LogSeason) => s.weeks.length > 0)
    .map((s: LogSeason) => {
      const clubs: string[] = [];
      for (const e of s.weeks) {
        const c = clubCode(e.team);
        if (c && !clubs.includes(c)) clubs.push(c);
      }
      const splits =
        clubs.length > 1
          ? clubs.map((club) => ({ club, line: sumLine(s.weeks.filter((e) => clubCode(e.team) === club), pts) }))
          : [];
      const inProgress = s.season === leagueSeason && leagueWeek < 18;
      return {
        season: s.season,
        clubs,
        line: sumLine(s.weeks, pts),
        splits,
        // Every season on one basis: the finish by total points. A season in
        // progress used to take the header's rank, which turns to points per
        // game after four games, so the chart mixed two rules (2026-11-06).
        finish: inProgress ? currentTotalRank(data) ?? s.finish : s.finish,
        inProgress,
        weeks: s.weeks,
      };
    })
    .sort((x, y) => y.season - x.season);
  const focus = rows.find((r) => r.season === data.season) ?? rows[0] ?? null;
  // Summed from the season rows, never stored: a traded season counts once.
  return { pos, rows, focus, total: addLines(rows.map((r) => r.line)), leagueSeason, leagueWeek, pts };
}

/** The rank the header prints for the season on the page. */
/** This season's finish at the position by total points, the basis every finished season uses. */
function currentTotalRank(data: PlayerPageData): number | null {
  const row = data.production?.find((r) => r.season === data.season);
  return row?.posFinishTotal ?? data.seasonRankTotal ?? null;
}

/** Ranked metrics, best percentile first; descriptive and unranked ones dropped. */
function byPct(metrics: AdvMetric[]): AdvMetric[] {
  return metrics.filter((m) => m.pct !== null).sort((x, y) => y.pct! - x.pct!);
}

/* --------------------------------------------------- section 1: production */

/** Section 1's heading: the tab's heading, and on WordPress its H1 (player-render's promoteLeadHeading). */
export const STATS_LEAD_ID = "scp-st-prod-h";

export interface Stat {
  label: string;
  total: string;
  /** The per-game figure, for a counting stat; rates and ranks have none. */
  pg?: string;
  /** Printed small after the figure: the "TD" in "25 · 1 TD". */
  unit?: string;
}

/**
 * One cell of the stat rail: a small uppercase label, the figure, and a muted
 * supplementary line. mak (2026-10-03) asked for the floating groups to become
 * one light-gray rail split by faint vertical separators.
 */
export interface Cell {
  label: string;
  main: Stat[];
  sub: Stat[];
}

function counting(label: string, total: number, gp: number, unit?: string): Stat {
  return { label, total: whole(total), pg: gp ? one(total / gp) : DASH, unit };
}

function pair(label: string, a: number, b: number, gp: number): Stat {
  return {
    label,
    total: `${whole(a)}/${whole(b)}`,
    pg: gp ? `${one(a / gp)}/${one(b / gp)}` : DASH,
  };
}

/** A figure, carrying both of its numbers when the toggle can switch it. */
export function figure(s: Stat): string {
  const toggle = s.pg !== undefined ? ` data-total="${escapeHtml(s.total)}" data-pg="${escapeHtml(s.pg)}"` : "";
  return `<span${toggle}>${escapeHtml(s.total)}</span>`;
}

function renderCell(cell: Cell): string {
  const main = cell.main
    .map((s, i) => (i ? `<i class="scp-st-dot"> · </i>` : "") + figure(s) + (s.unit ? ` <small>${escapeHtml(s.unit)}</small>` : ""))
    .join("");
  const sub = cell.sub.map((s) => `${figure(s)} ${escapeHtml(s.label)}`).join(" · ");
  return (
    `<div class="scp-st-cell"><dt>${escapeHtml(cell.label)}</dt><dd class="scp-st-cv">${main}</dd>` +
    (sub ? `<dd class="scp-st-cs">${sub}</dd>` : "") +
    `</div>`
  );
}

/**
 * The first cell of every rail: games played, with starts under it. The
 * standard-stat audit (2026-11-04) put games started first among what the tab
 * was missing - for a quarterback it is what tells a backup's appearances
 * from a starter's season.
 */
function gamesCell(t: Line): Cell {
  // The figure alone (mak, 2026-11-05: "8 8 GS" read as a doubled number);
  // starts stay in the career table's GS column.
  return { label: "Games", main: [{ label: "GP", total: whole(t.gp) }], sub: [] };
}

/** "Fum lost N" as a cell's second line. */
const fumbles = (t: Line): Stat => counting("Fum lost", t.fumLost, t.gp);

function passingCells(t: Line): Cell[] {
  const r = rating(t);
  return [
    { label: "Pass yards", main: [counting("Yards", t.passYd, t.gp)], sub: [{ label: "Y/A", total: fmtRatio(t.passYd, t.att) }] },
    { label: "Comp %", main: [{ label: "Comp %", total: t.att ? pct1((t.cmp / t.att) * 100) : DASH }], sub: [pair("Comp/Att", t.cmp, t.att, t.gp)] },
    { label: "Pass TD", main: [counting("TD", t.passTd, t.gp)], sub: [{ label: "Rating", total: r === null ? DASH : r.toFixed(1) }] },
    { label: "INT", main: [counting("INT", t.int, t.gp)], sub: [] },
    // Sacks taken and fumbles lost: standard columns the tab lacked (2026-11-04).
    { label: "Sacks", main: [counting("Sacks", t.sacks, t.gp)], sub: [fumbles(t)] },
  ];
}

/** A quarterback's or receiver's rushing: one cell, the yards as the figure (mak, 2026-10-22); the TDs ride the second line. */
function rushingCell(t: Line): Cell {
  return {
    label: "Rushing",
    main: [counting("Yards", t.rushYd, t.gp)],
    sub: [counting("Att", t.rushAtt, t.gp), { label: "Y/C", total: fmtRatio(t.rushYd, t.rushAtt) }, counting("TD", t.rushTd, t.gp)],
  };
}

function runnerCells(t: Line): Cell[] {
  return [
    { label: "Rush yards", main: [counting("Yards", t.rushYd, t.gp)], sub: [counting("Carries", t.rushAtt, t.gp)] },
    {
      label: "Yds / carry",
      main: [{ label: "Y/C", total: fmtRatio(t.rushYd, t.rushAtt) }],
      sub: t.rushLong !== null ? [{ label: "Long", total: whole(t.rushLong) }] : [],
    },
    { label: "Rush TD", main: [counting("TD", t.rushTd, t.gp)], sub: [fumbles(t)] },
    {
      label: "Receiving",
      main: [counting("Rec", t.rec, t.gp, "rec"), counting("Yards", t.recYd, t.gp, "yds")],
      sub: [counting("Targets", t.tgt, t.gp), counting("TD", t.recTd, t.gp)],
    },
  ];
}

function receiverCells(t: Line): Cell[] {
  return [
    { label: "Receptions", main: [counting("Rec", t.rec, t.gp)], sub: [counting("Targets", t.tgt, t.gp)] },
    { label: "Rec yards", main: [counting("Yards", t.recYd, t.gp)], sub: [{ label: "Y/R", total: fmtRatio(t.recYd, t.rec) }] },
    { label: "Rec TD", main: [counting("TD", t.recTd, t.gp)], sub: t.fumLost > 0 ? [fumbles(t)] : [] },
    { label: "Catch %", main: [{ label: "Catch %", total: t.tgt ? pct1((t.rec / t.tgt) * 100) : DASH }], sub: [] },
  ];
}

/**
 * The one thing neither the strip nor the table says: how much of his fantasy
 * line leans on touchdowns. mak (2026-09-30) asked for it more prominent and
 * worded as a read. The season-and-club line above it is gone (mak,
 * 2026-10-05), and the read wears the Overview strip's lede style.
 */
function prodLede(row: SeasonRow): string {
  const t = row.line;
  const now = row.inProgress;
  const share = t.pts > 0 ? Math.round((tdPoints(t) / t.pts) * 100) : 0;
  if (t.pts <= 0) return "";
  if (share <= 0) {
    return escapeHtml(
      now
        ? "He hasn't scored a touchdown yet, so all of his fantasy production has come from volume."
        : "He didn't score a touchdown, so all of his fantasy production came from volume.",
    );
  }
  return escapeHtml(
    share >= 40
      ? `Touchdowns ${now ? "account" : "accounted"} for ${share}% of his fantasy production, making his weekly output highly TD-dependent.`
      : `Touchdowns ${now ? "account" : "accounted"} for ${share}% of his fantasy production, so his weekly output ${now ? "leans" : "leaned"} on volume more than scoring.`,
  );
}

/** Fantasy points from touchdowns, on scoring.ts's values: 4 a pass TD, 6 any other. */
function tdPoints(t: Line): number {
  return t.passTd * 4 + (t.rushTd + t.recTd) * 6;
}

/** The rail's cells for a season line, by position. */
function railCells(pos: string, t: Line): Cell[] {
  if (pos === "QB") return [gamesCell(t), ...passingCells(t), rushingCell(t)];
  if (pos === "RB") return [gamesCell(t), ...runnerCells(t)];
  // Rushing is hidden for a receiver without a carry.
  return [gamesCell(t), ...receiverCells(t), ...(t.rushAtt > 0 ? [rushingCell(t)] : [])];
}

function renderProduction(data: PlayerPageData, c: Career, options: PlayerRenderOptions): string {
  const row = c.focus;
  if (!row) return "";
  const t = row.line;
  const cells = railCells(c.pos, t);

  return (
    // The toggle on the heading's row, right of it (mak, 2026-09-30).
    sectionOpen(
      STATS_LEAD_ID,
      `${data.player.name} ${row.season} stats`,
      (own(data.statsCopy?.prod_lede) ? copyHtml(own(data.statsCopy?.prod_lede)!) : prodLede(row)),
      // The "Game log" link that rode this row beside the toggle is gone
      // (mak, 2026-10-23); the tab strip above already reaches the Game Log.
      `<div class="scp-st-headctl">` +
        `<div class="scp-st-seg" role="group" aria-label="Show stats as" data-scp-seg>` +
        `<button type="button" data-mode="total" aria-pressed="true">Season totals</button>` +
        `<button type="button" data-mode="pg" aria-pressed="false">Per game</button>` +
        `</div>` +
        `</div>`,
    ) +
    // The Fantasy (PPR) block that sat beside the rail is gone (mak, 2026-10-22).
    `<div class="scp-st-prodrow"><dl class="scp-st-rail">${cells.map(renderCell).join("")}</dl></div>` +
    `</section>`
  );
}

/* ---------------------------------------------------- section 2: advanced */

export interface AdvColumn {
  title: string;
  /** Under the title: how far in, or where from. */
  sub: string;
  card: AdvCard;
}

/**
 * A percentile's tint (mak, 2026-10-03): 0-24 red, 25-74 navy, 75-100 green,
 * all subdued, and gray for a style reading, which is neither good nor bad.
 */
export function tint(m: AdvMetric): "good" | "mid" | "bad" | "muted" {
  if (m.standing === "muted" || m.pctl == null) return "muted";
  return m.pctl >= 75 ? "good" : m.pctl >= 25 ? "mid" : "bad";
}

/**
 * Which tier a metric reads under (mak, 2026-09-30): what he does with the
 * ball first and set heavier, then how much of it he gets, how he plays, and
 * what surrounds him. A key not listed here reads under Efficiency.
 */
export const TIERS: Array<{ name: string; keys: string[] }> = [
  { name: "Efficiency", keys: ["epa", "success", "cmp", "ypa", "tdr", "yaco", "ybc", "expl", "bt", "ppo", "yprr", "ypt", "ppt", "catch", "yac"] },
  { name: "Usage", keys: ["apg", "snap", "tgts", "tpg", "route", "ays", "rzo", "rzt"] },
  { name: "Style", keys: ["ttt", "aya", "deep", "adot"] },
  { name: "Context", keys: ["cpoe", "press"] },
];
/** A metric's key from its label, for a card built without keys. */
const LABEL_KEY: Record<string, string> = {
  "EPA per play": "epa", "Success rate": "success", "Completion rate": "cmp", "Yards per attempt": "ypa",
  "TD rate": "tdr", "Pass attempts per game": "apg", "Time to throw": "ttt", "Air yards per attempt": "aya",
  "Deep-attempt rate": "deep", "Completion % over expected": "cpoe", "Pressure rate": "press",
  "Yards after contact per carry": "yaco", "Yards before contact per carry": "ybc", "Broken tackles": "bt",
  "Explosive run rate": "expl", "Snap share": "snap", "Target share": "tgts", "Targets per game": "tpg",
  "Red-zone opportunities": "rzo", "Fantasy points per opportunity": "ppo", "Average depth of target": "adot",
  "Yards per route run": "yprr", "Route participation": "route", "YAC per reception": "yac", "Catch rate": "catch",
  "Yards per target": "ypt", "Air-yards share": "ays", "Red-zone targets": "rzt", "Fantasy points per target": "ppt",
};
export const keyOf = (m: { key?: string; label: string }): string => {
  const k = m.key ?? m.label;
  return LABEL_KEY[k] ?? k;
};
export const tierOf = (key: string): number => {
  const i = TIERS.findIndex((t) => t.keys.includes(key));
  return i < 0 ? 0 : i;
};

/**
 * The advanced cards as one table, the seasons side by side (mak, 2026-09-30):
 * Metric | this season | last season, the percentile under each value (mak,
 * 2026-10-03), one row per metric either card
 * carries, grouped into tiers with the first (Efficiency) set heavier. A
 * metric neither season has a figure for is dropped. The college column's
 * metrics have no tier and print as one untitled group.
 */
/**
 * What each metric is, with its denominator, as the label's tooltip
 * (2026-11-04: "provide a tooltip defining the metric, its denominator, and
 * the qualification threshold"; the threshold is in the footnote, once).
 */
export const DEFS: Record<string, string> = {
  epa: "Expected points added per play: the change in his team's expected points on each of his dropbacks or touches, averaged.",
  success: "Success rate: share of his plays that gained enough to stay on schedule (40% of the yards needed on 1st down, 60% on 2nd, 100% on 3rd and 4th).",
  cmp: "Completion rate: completions divided by pass attempts.",
  ypa: "Yards per attempt: passing yards divided by pass attempts.",
  tdr: "TD rate: touchdown passes as a share of pass attempts.",
  apg: "Pass attempts per game: pass attempts divided by games played.",
  ttt: "Time to throw: average seconds from snap to release.",
  aya: "Air yards per attempt: average distance the ball traveled past the line of scrimmage, per pass attempt.",
  deep: "Deep-attempt rate: share of pass attempts thrown 20 or more yards downfield.",
  cpoe: "Completion percentage over expected, in percentage points: his completion rate minus the rate expected from the difficulty of his throws.",
  press: "Pressure rate: share of dropbacks on which he was pressured (sacks included, counted beside it).",
  yaco: "Yards after contact per carry: rushing yards gained after first contact, divided by carries.",
  ybc: "Yards before contact per carry: rushing yards gained before first contact, divided by carries.",
  bt: "Broken tackles: tackles he broke or evaded on his touches.",
  expl: "Explosive run rate: share of carries that gained 10 or more yards.",
  snap: "Snap share: his offensive snaps as a share of his team's.",
  tgts: "Target share: his targets as a share of his team's pass attempts.",
  tpg: "Targets per game: targets divided by games played.",
  rzo: "Red-zone opportunities: carries plus targets inside the opponent's 20.",
  rzt: "Red-zone targets: targets inside the opponent's 20.",
  ppo: "Fantasy points per opportunity: PPR points divided by carries plus targets.",
  ppt: "Fantasy points per target: PPR points divided by targets.",
  adot: "Average depth of target: average air yards on his targets.",
  yprr: "Yards per route run: receiving yards divided by routes run.",
  route: "Route participation: routes run as a share of his team's dropbacks.",
  yac: "YAC per reception: yards after the catch divided by receptions.",
  catch: "Catch rate: receptions divided by targets.",
  ypt: "Yards per target: receiving yards divided by targets.",
  ays: "Air-yards share: his targets' air yards as a share of his team's.",
};

/**
 * One ladder row, in the team pages' anatomy (mak, 2026-10-22): the label,
 * a rank bar, the value, the rank as bare tinted text ("20th of 36"; ranks,
 * not percentiles, since later the same day). The bar is aria-hidden because
 * the rank says the same thing in words; the full sentence rides along for
 * screen readers. A metric with a percentile but no rank (older data) still
 * prints its percentile.
 */
function ladderRow(m: AdvMetric): string {
  const t = tint(m);
  const tier = t === "bad" ? "poor" : t === "muted" ? "none" : t;
  const ranked = m.rank != null && m.of != null && m.of > 0;
  // Better rank, longer bar: 1st of 36 fills it, 36th of 36 is the stub.
  const fill = ranked ? ((m.of! - m.rank! + 1) / m.of!) * 100 : m.pctl ?? null;
  const bar =
    fill == null
      ? `<span class="scp-st-stat-bar is-empty" aria-hidden="true"></span>`
      : `<span class="scp-st-stat-bar" data-tier="${tier}" aria-hidden="true">` +
        `<span class="scp-st-stat-fill" style="width:${Math.max(3, Math.min(100, fill)).toFixed(1)}%"></span></span>`;
  const rank = ranked
    ? `<span class="scp-st-stat-rank" data-tier="${tier}" title="${escapeHtml(m.read)}">${escapeHtml(`${ordinal(m.rank!)} of ${m.of}`)}</span>`
    : m.pctl == null
      ? `<span class="scp-st-stat-rank" data-tier="none">${DASH}</span>`
      : `<span class="scp-st-stat-rank" data-tier="${tier}" title="${escapeHtml(m.read)}">${escapeHtml(ordinal(m.pctl))}` +
        `<span class="scp-sr"> percentile</span></span>`;
  const def = DEFS[keyOf(m)];
  // The full read rides along for screen readers only where there is a
  // rank; an unranked row's reason is in the footnote, once, not on every
  // row ("consolidate into a single qualification note", 2026-11-04).
  const sr = ranked || m.pctl != null ? `<span class="scp-sr"> - ${escapeHtml(m.read)}</span>` : "";
  return (
    `<li class="scp-st-stat">` +
    `<span class="scp-st-stat-label"${def ? ` title="${escapeHtml(def)}"` : ""}>${escapeHtml(m.label)}${sr}</span>` +
    bar +
    `<span class="scp-st-stat-value">${escapeHtml(signed(m.value))}</span>` +
    rank +
    `</li>`
  );
}

/**
 * The metrics as tier cards in the team pages' ladder style (mak,
 * 2026-10-22, replacing the Metric | season table). Two columns since later
 * that day: Efficiency on the left, and Usage, Style and Context stacked as
 * one card on the right, each a titled group inside it; the captions under
 * the titles are gone. Each column of the old table - this season, or
 * College for a rookie - becomes its own set of cards, headed only when
 * there is more than one.
 */
function renderAdvLadders(cols: AdvColumn[]): string {
  const groups = cols
    .map((col) => {
      const ms = (col.card.all ?? col.card.metrics).filter((m) => m.value !== DASH);
      if (ms.length === 0) return "";
      const known = ms.some((m) => TIERS.some((t) => t.keys.includes(keyOf(m))));
      let cards: string;
      if (known) {
        const tiers = TIERS.map((tier, i) => ({ tier, rows: ms.filter((m) => tierOf(keyOf(m)) === i) })).filter((t) => t.rows.length);
        const [lead, ...rest] = tiers;
        const group = (t: { tier: { name: string }; rows: AdvMetric[] }): string =>
          `<div class="scp-st-ladgrp" data-tier="${t.tier.name.toLowerCase()}">` +
          `<h3 class="scp-st-ladder-title">${t.tier.name}</h3>` +
          `<ul class="scp-st-ladder-list">${t.rows.map(ladderRow).join("")}</ul>` +
          `</div>`;
        cards =
          (lead ? `<div class="scp-st-ladder" data-tier="${lead.tier.name.toLowerCase()}">${group(lead)}</div>` : "") +
          (rest.length ? `<div class="scp-st-ladder is-stack" data-tier="${rest.map((t) => t.tier.name.toLowerCase()).join(" ")}">${rest.map(group).join("")}</div>` : "");
      } else {
        cards =
          `<div class="scp-st-ladder is-wide" data-tier="metrics"><div class="scp-st-ladgrp"><h3 class="scp-st-ladder-title">Metrics</h3>` +
          `<ul class="scp-st-ladder-list">${ms.map(ladderRow).join("")}</ul></div></div>`;
      }
      const head =
        cols.length > 1
          ? `<h3 class="scp-st-ladgroup">${escapeHtml(col.title)}${col.sub ? ` <small>${escapeHtml(col.sub)}</small>` : ""}</h3>`
          : "";
      return `<div class="scp-st-ladgroup-wrap">${head}<div class="scp-st-ladders">${cards}</div></div>`;
    })
    .join("");
  return groups ? `<div class="scp-st-advwrap">${groups}</div>` : "";
}

/** The card the profile reads: this season once it qualifies, else last season. */
function profileCard(cards: AdvCard[]): AdvCard | null {
  return cards.find((card) => card.qualified) ?? null;
}

/**
 * The one-line summary under the section title: his style, how much of the
 * ball he gets, and how well he uses it ("Short/intermediate distributor ·
 * High volume · Average efficiency"), each read off the card's percentiles.
 */
function profileLine(pos: string, card: AdvCard): string {
  const ms = card.all ?? card.metrics;
  const p = (key: string): number | null => ms.find((m) => keyOf(m) === key)?.pctl ?? null;
  const mean = (tier: number): number | null => {
    const xs = ms.filter((m) => m.pctl != null && m.standing !== "muted" && tierOf(keyOf(m)) === tier && TIERS[tier]!.keys.includes(keyOf(m))).map((m) => m.pctl!);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const parts: string[] = [];
  const deep = p("deep") ?? p("aya");
  const adot = p("adot");
  const snap = p("snap");
  if (pos === "QB" && deep !== null) parts.push(deep >= 65 ? "Downfield attacker" : deep <= 35 ? "Short/intermediate distributor" : "Balanced passer");
  else if (pos === "RB" && snap !== null) parts.push(snap >= 65 ? "Lead back" : snap <= 35 ? "Committee back" : "Rotational back");
  else if ((pos === "WR" || pos === "TE") && adot !== null) parts.push(adot >= 65 ? "Downfield target" : adot <= 35 ? "Short-area target" : "Intermediate target");
  const use = mean(1);
  if (use !== null) parts.push(use >= 67 ? "High volume" : use <= 33 ? "Low volume" : "Moderate volume");
  const eff = mean(0);
  if (eff !== null) parts.push(eff >= 60 ? "Above-average efficiency" : eff <= 40 ? "Below-average efficiency" : "Average efficiency");
  return parts.join(" · ");
}

/**
 * What a metric says about him, as a verb phrase for the profile sentence:
 * [when it ranks well, when it ranks poorly]. The percentile is already on
 * the metric's own direction, so pressure rate's "well" is low pressure.
 */
const PROFILE: Record<string, [string, string]> = {
  epa: ["adds value per play", "adds little per play"],
  success: ["stays on schedule", "falls off schedule"],
  cmp: ["completes a high share of his throws", "completes a low share of his throws"],
  ypa: ["gains a lot per attempt", "gains little per attempt"],
  tdr: ["finishes drives with touchdowns", "rarely throws touchdowns"],
  apg: ["throws a lot", "throws little"],
  cpoe: ["beats his expected completion rate", "trails his expected completion rate"],
  press: ["is rarely pressured", "is often under pressure"],
  yaco: ["gains yards after contact", "gains little after contact"],
  ybc: ["gets room before contact", "meets defenders early"],
  expl: ["breaks explosive runs", "rarely breaks a big run"],
  bt: ["breaks tackles", "rarely breaks tackles"],
  ppo: ["scores efficiently per touch", "scores little per touch"],
  snap: ["plays most snaps", "plays a part-time share of snaps"],
  tgts: ["draws a big target share", "draws few targets"],
  tpg: ["draws targets", "draws few targets"],
  rzo: ["gets red-zone work", "gets little red-zone work"],
  yprr: ["produces per route", "produces little per route"],
  ypt: ["gains a lot per target", "gains little per target"],
  ppt: ["scores efficiently per target", "scores little per target"],
  catch: ["catches what comes his way", "catches a low share of his targets"],
  yac: ["adds yards after the catch", "adds little after the catch"],
  route: ["runs a route on most dropbacks", "runs a part-time share of routes"],
  ays: ["commands air yards", "sees few air yards"],
  rzt: ["gets red-zone targets", "gets few red-zone targets"],
};

/**
 * The read under the table: one profile sentence (his two best marks, then his
 * two worst), and the fantasy line. mak (2026-09-30) asked for less copy with
 * more air than the "What works / What limits him" pair it replaces, and
 * (2026-10-03) for the two to be one "SC Analysis" module, a component every
 * player page carries.
 */
function fantasyParts(data: PlayerPageData, c: Career, cards: AdvCard[]): AnalysisPart[] {
  const last = lastName(data.player.name);
  const pos = c.pos;
  const ranked = byPct(cards.flatMap((x) => (x.qualified ? x.metrics : [])));
  const phrase = (m: AdvMetric, i: 0 | 1): string =>
    PROFILE[keyOf(m)]?.[i] ?? `ranks ${i === 0 ? "high" : "low"} in ${m.label.replace(LC, (w) => w.toLowerCase())}`;
  // Target share and targets per game say the same thing ("draws a big target
  // share and draws targets"), as do red-zone opportunities and targets: the
  // sentence takes one of each pair.
  const SAME: Record<string, string> = { tpg: "tgts", rzt: "rzo" };
  const pick = (list: AdvMetric[], i: 0 | 1): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of list) {
      const key = keyOf(m);
      const p = phrase(m, i);
      if (seen.has(SAME[key] ?? key) || out.includes(p)) continue;
      seen.add(SAME[key] ?? key);
      out.push(p);
      if (out.length === 2) break;
    }
    return out;
  };
  const good = pick(ranked.filter((m) => m.standing === "good"), 0);
  const bad = pick(ranked.filter((m) => m.standing === "bad").reverse(), 1);
  const row = c.focus;
  // A small sample has no trends to read, so no analysis at all (mak,
  // 2026-11-05): the panel is not printed rather than saying "not yet
  // established" over one game.
  if (row && row.line.gp && sampleOf(pos, row.line) === "small") return [];
  const parts: AnalysisPart[] = [];
  if (good.length || bad.length) {
    const sentence = good.length
      ? `${last} ${listWords(good)}${bad.length ? `, but ${listWords(bad)}` : ""}.`
      : `${last} ${listWords(bad)}.`;
    const kind = pos === "QB" ? "Passing" : pos === "RB" ? "Rushing" : "Receiving";
    parts.push({ title: `${kind} profile`, html: escapeHtml(sentence), note: "" });
  }
  if (row && row.line.gp) parts.push(fantasyImpact(last, pos, row, c));
  return parts;
}

/** One titled paragraph of the analysis: the title, the paragraph's HTML, an optional qualifier under it. */
export interface AnalysisPart {
  title: string;
  html: string;
  note: string;
}

/**
 * How much of a season there is to read: a handful of games or touches is a
 * small sample, a starter's volume is a starter's season, and the rest is a
 * reserve's. The analysis is conditional on this (2026-11-04): one
 * appearance does not establish a floor.
 */
type Sample = "small" | "starter" | "reserve";

function sampleOf(pos: string, t: Line): Sample {
  const touches = pos === "QB" ? t.att : pos === "RB" ? t.rushAtt + t.tgt : t.tgt;
  const floor = pos === "QB" ? 60 : pos === "RB" ? 40 : 20;
  if (t.gp < 4 || touches < floor) return "small";
  return isStarterSeason(pos, t) ? "starter" : "reserve";
}

/**
 * The "Fantasy impact" paragraph, by sample size.
 *
 *   small    no analysis at all (2026-11-05): nothing printed, see the caller;
 *   starter  the old read: his volume is his floor, efficiency the rest;
 *   reserve  appearances against starts, and that playing time, not
 *            efficiency, decides his value.
 *
 * A player who has not played this season reads his latest season, and says
 * so, rather than an empty analysis.
 */
function fantasyImpact(last: string, pos: string, row: SeasonRow, c: Career): AnalysisPart {
  const t = row.line;
  const now = row.inProgress;
  const when = now ? "this season" : `in ${row.season}`;
  const stale = c.leagueWeek > 0 && row.season < c.leagueSeason;
  const lead = stale ? `${last} has not played in ${c.leagueSeason}; these are his ${row.season} numbers. ` : "";
  const volume =
    pos === "QB" ? `${one(t.att / t.gp)} pass attempts and ${one(t.rushAtt / t.gp)} carries a game`
      : pos === "RB" ? `${one(t.rushAtt / t.gp)} carries and ${one(t.tgt / t.gp)} targets a game`
        : `${one(t.tgt / t.gp)} targets a game`;
  const band = sampleOf(pos, t);

  if (band === "starter") {
    return scaPart(
      "Fantasy impact",
      escapeHtml(`${lead}His floor is his volume: ${volume} across ${plural(t.gp, "game")} ${when}. Efficiency decides how much of it becomes points.`),
    );
  }
  const starts = t.gs > 0 ? ` (${plural(t.gs, "start")})` : "";
  return scaPart(
    "Fantasy impact",
    escapeHtml(
      `${lead}${last} has ${now ? "made" : "had"} ${plural(t.gp, "appearance")}${starts} ${when} at ${volume}: a reserve's workload, so his fantasy value turns on playing time before efficiency.`,
    ),
    `Reserve role · ${plural(t.gp, "game")} · ${plural(t.gs, "start")}`,
  );
}

/** One titled paragraph of the SC Analysis module, with an optional small qualifier under it. */
function scaPart(title: string, html: string, note = ""): AnalysisPart {
  return { title, html, note };
}

function scaPartHtml(p: AnalysisPart): string {
  return (
    `<div class="scp-st-sca-part"><h3 class="scp-st-sca-h">${escapeHtml(p.title)}</h3><p>${p.html}</p>` +
    (p.note ? `<p class="scp-st-sca-note">${escapeHtml(p.note)}</p>` : "") +
    `</div>`
  );
}

/** The tag, then the parts side by side as equal columns (mak, 2026-10-22). */
function scaModule(parts: AnalysisPart[]): string {
  if (parts.length === 0) return "";
  return (
    `<div class="scp-st-read scp-st-sca"><span class="scp-st-sca-tag">StatChasers Analysis</span>` +
    `<div class="scp-st-sca-cols">${parts.map(scaPartHtml).join("")}</div></div>`
  );
}

/**
 * A rookie: no NFL season before this one. His Card B is his final college
 * season (spec, section 2 rules) when college_stats.json has him.
 */
function isRookie(data: PlayerPageData, c: Career): boolean {
  return c.rows.every((r) => r.season >= c.leagueSeason);
}

/** The college card's lede: where he came from. The table has his marks. */
function collegeLede(data: PlayerPageData, card: CollegeCard): string {
  const last = lastName(data.player.name);
  return escapeHtml(`${last} arrives from ${card.school}.`);
}

/**
 * The StatChasers Analysis module (the profile sentence and the fantasy
 * impact), as its own section UNDER the career-by-season table (mak,
 * 2026-11-05); it used to close the advanced section.
 */
/** The analysis module's parts: the authored note when there is one, else the generated profile and impact. */
function analysisParts(data: PlayerPageData, c: Career): AnalysisPart[] {
  const adv = data.statsAdvanced;
  const college = isRookie(data, c) ? collegeCard(data.college, c.pos) : null;
  if ((!adv || (!adv.current && !adv.last)) && !college) return [];
  const used: AdvCard[] = [];
  if (adv?.current) used.push(adv.current);
  if (college) used.push(college);
  else if (adv?.last && !adv.current) used.push(adv.last);
  const copy = data.statsCopy;
  return own(copy?.adv_fantasy_note)
    ? [scaPart("Fantasy impact", copyHtml(own(copy?.adv_fantasy_note)!))]
    : fantasyParts(data, c, used);
}

function renderAnalysis(data: PlayerPageData, c: Career): string {
  const note = scaModule(analysisParts(data, c));
  return note ? `<section class="scp-ox-sec scp-st-scasec" aria-label="StatChasers analysis">${note}</section>` : "";
}

/** The advanced section's inputs: its columns, the footnote's lines and the one-line summary. */
export interface AdvancedModel {
  /** "passing" / "rushing" / "receiving". */
  cats: string;
  cols: AdvColumn[];
  notes: string[];
  /** The summary under the title, as HTML. */
  summary: string;
}

function advancedModel(data: PlayerPageData, c: Career): AdvancedModel | null {
  const adv = data.statsAdvanced;
  const college = isRookie(data, c) ? collegeCard(data.college, c.pos) : null;
  if ((!adv || (!adv.current && !adv.last)) && !college) return null;
  const pos = c.pos;
  const cats = pos === "QB" ? "passing" : pos === "RB" ? "rushing" : "receiving";
  const cols: AdvColumn[] = [];
  const used: AdvCard[] = [];
  // The methodology lines, gathered into one footnote under the table.
  const notes: string[] = [];

  if (adv?.current) {
    const cur = adv.current;
    cols.push({ title: String(cur.season), sub: cur.throughWeek ? `Current · thru Wk ${cur.throughWeek}` : "Current", card: cur });
    used.push(cur);
    notes.push(
      cur.qualified
        ? `${cur.season}${cur.throughWeek ? ` through Week ${cur.throughWeek}` : ""} among ${cur.qualifiedCount} qualified ${pos}s${cur.qualifyNote ? ` (${cur.qualifyNote})` : ""}`
        : `${cur.season}: below the qualifying line so far${cur.qualifyNote ? ` (${cur.qualifyNote})` : ""}, so no ranks`,
    );
  }
  if (college) {
    cols.push({ title: "College", sub: `${college.school} ${college.season}`, card: college });
    used.push(college);
    notes.push(
      college.qualified
        ? `College: ranked among ${college.qualifiedCount} ${college.pool}`
        : `College: below the ${college.pool.replace(/^college \w+ with /, "")} line, so no ranks`,
    );
  } else if (adv?.last && !adv.current) {
    // Last season stands in only until this season has a line (mak,
    // 2026-10-22: the side-by-side previous-season column is gone).
    const prev = adv.last;
    cols.push({ title: String(prev.season), sub: plural(prev.games, "game"), card: prev });
    used.push(prev);
    notes.push(
      prev.qualified
        ? `${prev.season} (${plural(prev.games, "game")}, weeks 1–17) among ${prev.qualifiedCount}`
        : `${prev.season} (${plural(prev.games, "game")}, weeks 1–17): below the qualifying line, so no ranks`,
    );
  }
  // One short line (mak, 2026-09-30): the seasons joined. The "gray bars"
  // clause went with the table (2026-10-22): the Style card's caption now
  // says its rows have no better end.

  const copy = data.statsCopy;
  // The section header: "<Name> Passing Stats" as the H2 (mak, 2026-10-05;
  // the eyebrow, the "how he's creating" line and the profile tags are gone),
  // then a one-line read.
  const card = college && !adv?.current ? null : profileCard(used);
  const summary = own(copy?.adv_lede)
    ? copyHtml(own(copy?.adv_lede)!)
    : college && !adv?.current ? collegeLede(data, college) : card ? escapeHtml(profileLine(pos, card)) : "";
  return { cats, cols, notes, summary };
}

function renderAdvanced(data: PlayerPageData, c: Career): string {
  const m = advancedModel(data, c);
  if (!m) return "";
  const id = "scp-st-adv-h";
  return (
    `<section class="scp-ox-sec scp-st-advsec" aria-labelledby="${id}">` +
    `<h2 class="scp-st-kick-h" id="${id}">${escapeHtml(`${data.player.name} ${titleCase(m.cats)} Stats`)}</h2>` +
    (m.summary ? `<p class="scp-ox-lede scp-st-sum">${m.summary}</p>` : "") +
    renderAdvLadders(m.cols) +
    `<p class="scp-st-foot-note">${escapeHtml(`Ranks: ${m.notes.join(" · ")}.`)}</p>` +
    `</section>`
  );
}

/* --------------------------------------- the premium career comparison */

/** One season of the chart. */
export interface CareerSeasonBar {
  season: number;
  clubs: string[];
  /** The club is his current one. */
  current: boolean;
  gp: number;
  pts: number;
  ppg: number;
  /** His season finish at the position (1 = best), as the table ranks it; null when unranked. */
  finish: number | null;
  inProgress: boolean;
}

/**
 * Everything the premium Fantasy Football Career Stats block
 * (career-premium.ts) prints, from the same code paths the current section
 * prints it from: the chart's seasons and career average, the rate tiles,
 * the read's paragraphs, the Redraft Command card and the career highs.
 * Null when the tab has no NFL season.
 */
export interface CareerPremiumModel {
  name: string;
  last: string;
  pos: string;
  scoring: string;
  seasons: CareerSeasonBar[];
  careerPpg: number;
  careerGames: number;
  rates: RateTile[];
  paragraphs: string[];
  redraft: RedraftCard;
  highs: HighItem[];
}

export function careerPremiumModel(data: PlayerPageData, options: PlayerRenderOptions = {}): CareerPremiumModel | null {
  const c = career(data);
  if (!["QB", "RB", "WR", "TE"].includes(c.pos) || c.rows.length === 0 || c.total.gp === 0) return null;
  const current = data.team?.code ?? "";
  const seasons: CareerSeasonBar[] = [...c.rows]
    .sort((x, y) => x.season - y.season)
    .map((r) => ({
      season: r.season,
      clubs: r.clubs,
      current: Boolean(current) && r.clubs.includes(current),
      gp: r.line.gp,
      pts: r.line.pts,
      ppg: r.line.gp ? r.line.pts / r.line.gp : 0,
      finish: r.finish ?? null,
      inProgress: r.inProgress,
    }));
  return {
    name: data.player.name,
    last: lastName(data.player.name),
    pos: c.pos,
    scoring: SCORING_SHORT[data.format] ?? "PPR",
    seasons,
    careerPpg: c.total.pts / c.total.gp,
    careerGames: c.total.gp,
    rates: careerRateTiles(data, c),
    paragraphs: readParagraphs(data, c, options),
    redraft: redraftCard(data),
    highs: careerHighItems(c),
  };
}

/* ------------------------------------------------ the premium comparison */

/**
 * Everything the premium comparison version (stats-premium.ts) prints,
 * from the same code paths the sections above print it from: the season
 * line's rail cells, the lede, the advanced columns with their notes, the
 * analysis parts, and the career table the caller inserts. Null when the
 * tab itself would have no season to show.
 */
export interface StatsPremiumModel {
  name: string;
  pos: string;
  season: number;
  inProgress: boolean;
  /** The production lede, as HTML. */
  lede: string;
  cells: Cell[];
  advanced: AdvancedModel | null;
  analysis: AnalysisPart[];
  careerTable: string;
  scoring: string;
}

export function statsPremiumModel(data: PlayerPageData, inserts: { careerTable?: string } = {}): StatsPremiumModel | null {
  const c = career(data);
  if (!["QB", "RB", "WR", "TE"].includes(c.pos) || !c.focus) return null;
  const row = c.focus;
  return {
    name: data.player.name,
    pos: c.pos,
    season: row.season,
    inProgress: row.inProgress,
    lede: own(data.statsCopy?.prod_lede) ? copyHtml(own(data.statsCopy?.prod_lede)!) : prodLede(row),
    cells: railCells(c.pos, row.line),
    advanced: advancedModel(data, c),
    analysis: analysisParts(data, c),
    careerTable: inserts.careerTable ?? "",
    scoring: SCORING_SHORT[data.format] ?? "PPR",
  };
}

/* ------------------------------------------------------- section 3: chart */

function renderChart(data: PlayerPageData, c: Career): string {
  const rows = [...c.rows].sort((x, y) => x.season - y.season);
  if (rows.length === 0) return "";
  const pos = c.pos;
  const ppg = (r: SeasonRow): number => (r.line.gp ? r.line.pts / r.line.gp : 0);
  const max = Math.max(...rows.map(ppg));
  const scale = Math.max(3, Math.ceil(max / 3) * 3);
  const careerPpg = c.total.gp ? c.total.pts / c.total.gp : 0;
  // Past seasons neutral, the latest finished season in the accent, the one in
  // progress in the accent with a hatch (mak, 2026-09-30); no career-best mark.
  const done = rows.filter((r) => !r.inProgress);
  const latest = done.length ? done[done.length - 1]! : null;
  const current = data.team?.code ?? "";
  const n = rows.length;

  const cols = rows
    .map((r) => {
      const v = ppg(r);
      const h = v <= 0 ? 1 : Math.max(1, (v / scale) * 100);
      const cls = r.inProgress ? " is-now" : latest && r.season === latest.season && n > 1 ? " is-last" : "";
      return `<div class="scp-st-col${cls}"><b>${one(v)}</b><i style="height:${h.toFixed(1)}%"></i></div>`;
    })
    .join("");
  // Under each bar: the year, the games, and the club (every bar, mak
  // 2026-10-22; it used to print only where the club changed, on its own row).
  const years = rows
    .map((r) => {
      const label = r.clubs.join("/") || DASH;
      const cur = current && r.clubs.includes(current) ? ` class="is-cur"` : "";
      return `<div><strong>${r.season}</strong><small>${r.line.gp} GP</small><em${cur}>${escapeHtml(label)}</em></div>`;
    })
    .join("");

  const showAvg = n > 1;
  const aria =
    `${pos} fantasy points per game by season: ` +
    rows.map((r) => `${r.season} ${one(ppg(r))}${r.inProgress ? " (in progress)" : ""}`).join(", ") +
    (showAvg ? `. Career average ${one(careerPpg)}.` : ".");

  const avgPos = Math.min(1, careerPpg / scale);
  // The H2 is the SEO ladder's "{Name} Fantasy Football Stats" (mak,
  // 2026-11-04): the fantasy layer under the NFL sections, named as such.
  // The chart keeps its old title as its caption.
  return (
    sectionOpen("scp-st-arc-h", `${data.player.name} fantasy football stats`, "") +
    `<figure class="scp-st-arc${showAvg ? " has-avg" : ""}" style="--scp-n:${n};--scp-avg:${avgPos.toFixed(4)}">` +
    `<figcaption class="scp-st-arc-cap">Fantasy points per game, every season</figcaption>` +
    // The scroller is the chart alone; client/player.ts opens it on the
    // newest season. No legend under it (removed 2026-10-21).
    `<div class="scp-st-arc-scroll" data-scp-arc>` +
    `<div class="scp-st-plot${showAvg ? " has-avg" : ""}" role="img" aria-label="${escapeHtml(aria)}">` +
    cols +
    (showAvg ? `<span class="scp-st-avg" aria-hidden="true">Career avg<b>${one(careerPpg)}</b></span>` : "") +
    `</div>` +
    `<div class="scp-st-x" aria-hidden="true">${years}</div>` +
    `</div>` +
    `</figure></section>`
  );
}

/* ------------------------------------------- section 5: read, rates, highs */

/** A "starter" season by volume: the line a regular would clear. */
function isStarterSeason(pos: string, t: Line): boolean {
  if (!t.gp) return false;
  if (pos === "QB") return t.att / t.gp >= 20;
  if (pos === "RB") return (t.rushAtt + t.tgt) / t.gp >= 12;
  return t.tgt / t.gp >= (pos === "TE" ? 4 : 5);
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** The read's paragraphs, as HTML (links and escaped text), in order. Empty when there is nothing to read. */
function readParagraphs(data: PlayerPageData, c: Career, options: PlayerRenderOptions): string[] {
  const { pos, rows, total } = c;
  if (rows.length === 0 || total.gp === 0) return [];
  const name = data.player.name;
  const last = lastName(name);
  const redraft = `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`;
  const ppg = (t: Line): number => (t.gp ? t.pts / t.gp : 0);
  const done = rows.filter((r) => !r.inProgress);
  const n = rows.length;
  const paragraphs: string[] = [];

  // 1. Career-level context.
  // Top-12 seasons at every position, as the spec words it; the table's
  // colors run deeper at RB and WR.
  const good = 12;
  const topSeasons = done.filter((r) => r.finish && r.finish <= good).sort((x, y) => x.season - y.season);
  const starter = rows.filter((r) => isStarterSeason(pos, r.line));
  const backup = rows.filter((r) => !isStarterSeason(pos, r.line));
  // "Season finish" in so many words: the tile above counts top-12 WEEKS,
  // and the two read as a contradiction when both just say "top-12".
  let p1 =
    `${last} has averaged ${one(ppg(total))} fantasy points per game over ${plural(total.gp, "game")} and ${plural(n, "season")}` +
    (topSeasons.length
      ? `, with ${word(topSeasons.length)} top-${good} season finish${topSeasons.length > 1 ? "es" : ""} (${topSeasons.map((r) => r.season).join(", ")}).`
      : done.length ? `, without a top-${good} season finish.` : ".");
  if (starter.length && backup.length) {
    p1 += ` The average hides two careers: ${one(ppg(addLines(starter.map((r) => r.line))))} a game in his ${word(starter.length)} ${starter.length === 1 ? "season" : "seasons"} with a starter's volume, ` +
      `${one(ppg(addLines(backup.map((r) => r.line))))} in the ${word(backup.length)} without it.`;
  }
  paragraphs.push(escapeHtml(p1));

  // 2. The recent trend, and who it runs through.
  const recent = rows.slice(0, 3);
  if (recent.length >= 2) {
    const [now, prev] = recent as [SeasonRow, SeasonRow];
    const diff = ppg(now.line) - ppg(prev.line);
    const vol = (t: Line): number =>
      t.gp ? (pos === "QB" ? t.att / t.gp : pos === "RB" ? (t.rushAtt + t.tgt) / t.gp : t.tgt / t.gp) : 0;
    const unit = pos === "QB" ? "pass attempts" : pos === "RB" ? "carries plus targets" : "targets";
    const dv = vol(now.line) - vol(prev.line);
    const volNow = vol(now.line);
    const volThen = vol(prev.line);
    const change = Math.abs(diff) < 0.5 ? "level with" : diff > 0 ? `up ${one(diff)} from` : `down ${one(-diff)} from`;
    // Fewer than four games on either side is not a trend (2026-11-04): one
    // appearance against four does not say he is "up 19.3".
    const thin = (r: SeasonRow): boolean => r.line.gp < 4;
    let why: string;
    if (thin(now) || thin(prev)) {
      why = "";
    } else if (Math.abs(dv) < 1) {
      why = `His volume has held at about ${one(volNow)} ${unit} a game, so ${Math.abs(diff) < 0.5 ? "the output has too" : "the change is efficiency and scoring"}.`;
    } else if (Math.abs(diff) < 0.5) {
      why = `His volume is ${dv > 0 ? "up" : "down"} (${one(volNow)} ${unit} a game against ${one(volThen)}) but ${dv > 0 ? "less of it is turning into points" : "he is doing more with it"}.`;
    } else if (Math.sign(dv) === Math.sign(diff)) {
      why = `Volume is the driver: ${one(volNow)} ${unit} a game against ${one(volThen)}.`;
    } else {
      why = `That is despite ${dv > 0 ? "more" : "less"} volume (${one(volNow)} ${unit} a game against ${one(volThen)}), so efficiency and scoring are doing it.`;
    }
    const p2 = thin(now) || thin(prev)
      ? `${now.inProgress ? `So far in ${now.season} he has` : `In ${now.season} he had`} ${plural(now.line.gp, "game")} (${one(ppg(now.line))} a game) against ${plural(prev.line.gp, "appearance")} in ${prev.season}: too little on ${thin(now) && thin(prev) ? "either" : "one"} side to call a trend.`
      : (now.inProgress ? `So far in ${now.season} he is at ` : `In ${now.season} he averaged `) + `${one(ppg(now.line))} per game, ` +
        `${change} ${prev.season}. ${why}`;
    const mates = data.teammates ?? [];
    let mateHtml = "";
    const when = now.inProgress ? "this season" : `in ${now.season}`;
    if (mates.length) {
      const link = (m: { slug: string | null; name: string }): string =>
        m.slug ? a(`${options.playerPathPrefix ?? "/player/"}${m.slug}/${options.linkQuery ?? ""}`, m.name) : escapeHtml(m.name);
      mateHtml =
        pos === "QB"
          ? ` His most-targeted receiver${mates.length > 1 ? "s" : ""} ${when} ${now.inProgress ? (mates.length > 1 ? "have been" : "has been") : mates.length > 1 ? "were" : "was"} ${mates.map(link).join(" and ")}.`
          : ` His quarterback ${when} ${now.inProgress ? "has been" : "was"} ${mates.map(link).join(" and ")}.`;
    }
    paragraphs.push(escapeHtml(p2) + mateHtml);
  }

  // An analyst's paragraphs (up to three) replace the two generated ones; the
  // Redraft Command paragraph stays last either way, since it carries the
  // tracked link.
  const written = (data.statsCopy?.career_paragraphs ?? []).map(own).filter((p): p is string => p !== null).slice(0, 3);
  if (written.length) paragraphs.splice(0, paragraphs.length, ...written.map(copyHtml));

  // 3. The forward call.
  paragraphs.push(
    escapeHtml("Career numbers describe the past; for what he is worth from here, ") +
      a(redraft, `see ${possessive(last)} rest-of-season rank and trade value in Redraft Command`, ` data-cta="redraft-command-stats-prose"`) +
      ".",
  );
  return paragraphs;
}

/** The Redraft Command card beside the read: its words and the player's own link. */
export interface RedraftCard {
  heading: string;
  body: string;
  href: string;
  cta: string;
}

function redraftCard(data: PlayerPageData): RedraftCard {
  const last = lastName(data.player.name);
  return {
    heading: "Redraft Command",
    body: `Career stats tell you who he's been. Redraft Command projects what he's worth from here: rest-of-season rank, trade value and waiver priority for your league settings.`,
    href: `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`,
    cta: `Open ${last} in Redraft Command`,
  };
}

function renderRead(data: PlayerPageData, c: Career, options: PlayerRenderOptions): string {
  const paragraphs = readParagraphs(data, c, options);
  if (paragraphs.length === 0) return "";
  const last = lastName(data.player.name);
  const card = redraftCard(data);
  const rc =
    `<div class="scp-ox-panel is-rc"><h3>${escapeHtml(card.heading)}</h3>` +
    `<p>${escapeHtml(card.body)}</p>` +
    `<a class="scp-ox-btn" href="${escapeHtml(card.href)}" data-cta="redraft-command-stats-sidebar">${escapeHtml(card.cta)}</a>` +
    `</div>`;

  /* ---- career highs ---- */
  const bests = careerHighs(c);

  // The career-rate tiles that opened this section moved up to where the
  // season snapshot strip was, and the byline is gone (mak, 2026-10-22).
  return (
    sectionOpen("scp-st-read-h", "What his career numbers say", "") +
    `<div class="scp-ox-read">` +
    `<div><div class="scp-ox-prose">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</div></div>` +
    `<aside class="scp-ox-aside" aria-label="${escapeHtml(`${last} in Redraft Command`)}">${rc}</aside>` +
    `</div>` +
    bests +
    `</section>`
  );
}

/**
 * The career-rate tiles: career PPG, availability, top-12 weeks, weekly
 * swing. They opened "What his career numbers say" until 2026-10-22, when
 * mak had them take the place of the season snapshot strip (Fantasy PPG /
 * finish / two per-game rates) under the career chart.
 */
/** One career-rate tile: the figure, its title, the caption under it, and what the figure is, for a tooltip. */
export interface RateTile {
  value: string;
  title: string;
  caption: string;
  tip: string;
}

function careerRateTiles(data: PlayerPageData, c: Career): RateTile[] {
  const { pos, rows, total } = c;
  if (rows.length === 0 || total.gp === 0) return [];
  const ppg = (t: Line): number => (t.gp ? t.pts / t.gp : 0);
  const n = rows.length;
  const first = Math.min(...rows.map((r) => r.season));
  const lastSeason = c.leagueWeek > 0 ? c.leagueSeason : Math.max(...rows.map((r) => r.season));
  let games = 0;
  for (let s = first; s <= lastSeason; s++) {
    if (s === c.leagueSeason && c.leagueWeek > 0 && c.leagueWeek < 18) {
      const finals = (data.schedule ?? []).filter((g) => g.status === "final").length;
      games += finals || Math.max(...(rows.find((r) => r.season === s)?.weeks.map((e) => e.week) ?? [c.leagueWeek]));
    } else games += teamGames(s);
  }
  const allWeeks = rows.flatMap((r) => r.weeks);
  const ranked = allWeeks.filter((e) => typeof e.pos_rank === "number");
  const n12 = topN(pos);
  const top = ranked.filter((e) => e.pos_rank! <= n12).length;
  const sd = stdev(allWeeks.map(c.pts));
  const tiles: RateTile[] = [
    // Short captions (mak, 2026-10-22): the strip is a footer to the chart.
    // The scoring is named (2026-11-04: "identify the scoring system used").
    {
      value: one(ppg(total)),
      title: "Career PPG",
      caption: `${plural(total.gp, "game")}, ${plural(n, "season")} · ${SCORING_SHORT[data.format]}`,
      tip: `Fantasy points per game across his career, in ${SCORING_WORDS[data.format]} scoring: total points divided by games played.`,
    },
  ];
  // "Games appeared in", not availability (2026-11-04, renamed 2026-11-06):
  // a healthy backup who did not get into a game was still available for
  // it, so the share must not read as an injury or availability rate.
  if (games > 0) {
    const through = c.leagueWeek > 0 && c.leagueWeek < 18 && lastSeason === c.leagueSeason ? `${lastSeason} Week ${c.leagueWeek}` : String(lastSeason);
    tiles.push({
      value: `${Math.min(100, Math.round((total.gp / games) * 100))}%`,
      title: "Games appeared in",
      caption: `${total.gp} of ${games} team games`,
      tip:
        `Games he played in (${total.gp}) out of his teams' regular-season games from ${first} through ${through} (${games}), ` +
        `counting every season since his first game. It measures playing time, not health: games he was available for but did not play still count against it.`,
    });
  }
  // Weekly finishes, with the count beside the share, so "22% top-12 weeks"
  // cannot be read against "no top-12 season finish" below.
  // Ranked weeks, not games (2026-11-06): a weekly rank needs an offensive
  // snap or a touch, while a game played counts every game he was active
  // for, so the two counts can differ and the tip says by how many.
  if (ranked.length) {
    const unranked = total.gp - ranked.length;
    tiles.push({
      value: `${Math.round((top / ranked.length) * 100)}%`,
      title: `Top-${n12} weeks`,
      caption: `${top} of ${plural(ranked.length, "ranked week")}`,
      tip:
        `Weeks he finished inside the top ${n12} at ${pos}, as a share of his ranked weeks: a weekly finish, not a season finish.` +
        (unranked > 0
          ? ` ${unranked} of his ${total.gp} games ${unranked === 1 ? "has" : "have"} no weekly rank: he was active but recorded no offensive snap or touch.`
          : ""),
    });
  }
  // No "Moderate week-to-week" word (2026-11-06): its bands were fixed
  // cut-offs, not a comparison with other players, so the caption says what
  // the number is instead.
  if (n > 1 && allWeeks.length > 1) {
    tiles.push({
      value: one(sd),
      title: "Weekly swing",
      caption: "Std. dev. of weekly points",
      tip: "The standard deviation of his weekly fantasy points across his career, in points: how far a typical week lands from his average.",
    });
  }
  return tiles;
}

function renderCareerRates(data: PlayerPageData, c: Career): string {
  const tiles = careerRateTiles(data, c);
  if (tiles.length === 0) return "";
  return `<section class="scp-ox-sec scp-st-sec-rates" aria-label="Career rates"><div class="scp-st-rates">${tiles.map((t) => rate(t.value, t.title, t.caption)).join("")}</div></section>`;
}

function rate(value: string, title: string, caption: string): string {
  return `<div class="scp-st-rate"><p class="scp-st-v">${escapeHtml(value)}</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(caption)}</p></div>`;
}

/**
 * Career highs as one strip (mak, 2026-09-30): the figure, a short label, and
 * the season it came in under it.
 */
/** One career high: the figure, its label, the season (or span) under it. */
export interface HighItem {
  v: string;
  label: string;
  sub: string;
}

function careerHighItems(c: Career): HighItem[] {
  const { pos, rows, total } = c;
  const done = rows.filter((r) => r.line.gp > 0);
  if (done.length === 0) return [];
  const top = (of: (t: Line) => number): SeasonRow =>
    done.reduce((x, y) => (of(y.line) > of(x.line) ? y : x));
  const items: HighItem[] = [];
  const push = (of: (t: Line) => number, label: string): void => {
    const r = top(of);
    if (of(r.line) > 0) items.push({ v: whole(of(r.line)), label, sub: String(r.season) });
  };
  if (pos === "QB") {
    push((t) => t.passYd, "Pass yards");
    push((t) => t.passTd, "Pass TD");
  } else if (pos === "RB") {
    push((t) => t.rushYd, "Rush yards");
    push((t) => t.rushTd + t.recTd, "Total TD");
  } else {
    push((t) => t.recYd, "Rec yards");
    push((t) => t.recTd, "Rec TD");
  }
  const bestFan = top((t) => t.pts);
  items.push({
    v: one(bestFan.line.pts),
    label: "Fantasy pts",
    sub: `${bestFan.season}${bestFan.finish && !bestFan.inProgress ? ` · ${pos}${bestFan.finish}` : ""}`,
  });
  const seasons = rows.map((r) => r.season);
  const span = `${Math.min(...seasons)}–${Math.max(...seasons)}`;
  if (pos === "QB") items.push({ v: whole(total.passYd), label: "Career pass yds", sub: span });
  else if (pos === "RB") items.push({ v: whole(total.rushYd + total.recYd), label: "Career scrimmage yds", sub: span });
  else items.push({ v: whole(total.recYd), label: "Career rec yds", sub: span });
  return items;
}

function careerHighs(c: Career): string {
  const items = careerHighItems(c);
  if (items.length === 0) return "";
  return (
    `<h3 class="scp-st-bests-h">Career highs</h3>` +
    `<ul class="scp-st-bests">` +
    items
      .map(
        (i) =>
          `<li><span class="scp-st-v">${escapeHtml(i.v)}</span>` +
          `<span class="scp-st-bl">${escapeHtml(i.label)}</span>` +
          `<span class="scp-st-bs">${escapeHtml(i.sub)}</span></li>`,
      )
      .join("") +
    `</ul>`
  );
}

/** The scoring rules, in the words the career table's caption points down to. */
function renderFooter(data: PlayerPageData): string {
  const rec =
    data.format === "ppr" ? "1 point per reception, " : data.format === "half" ? "half a point per reception, " : "no points for receptions, ";
  return (
    `<footer class="scp-st-foot"><p>${escapeHtml(
      `Stats are official NFL regular-season data processed by StatChasers. Fantasy points use ${SCORING_WORDS[data.format]} scoring: ` +
        `${rec}1 per 25 passing yards, 4 per passing TD, ${MINUS}1 per interception, 1 per 10 rushing or receiving yards and 6 per rushing or receiving TD.` +
        // PPR and half-PPR are Sleeper's stored points (scoring.ts), which also
        // count what the formula above leaves out.
        (data.format === "standard" ? "" : " Two-point conversions and lost fumbles are counted too."),
    )}</p></footer>`
  );
}

/* ------------------------------------------------------------ the tab */

/**
 * A rookie before his first NFL game: his college seasons, under the caption
 * the spec gives them ("College stats"). No fantasy columns: fantasy points are
 * an NFL scoring and his college games were not scored.
 */
function renderCollegeTable(data: PlayerPageData, pos: string): string {
  const profile = data.college;
  if (!profile?.seasons?.length) return "";
  type S = (typeof profile.seasons)[number];
  const v = (x: number | undefined | null): string => (typeof x === "number" ? whole(x) : DASH);
  const r = (a: number | undefined, b: number | undefined): string => (a !== undefined && b ? one(a / b) : DASH);
  const groups: Array<{ label: string; cols: Array<[string, (s: S) => string]> }> = [];
  const pass: Array<[string, (s: S) => string]> = [
    ["Cmp", (s) => v(s.pass?.cmp)], ["Att", (s) => v(s.pass?.att)], ["Yds", (s) => v(s.pass?.yds)],
    ["TD", (s) => v(s.pass?.td)], ["INT", (s) => v(s.pass?.int)], ["Y/A", (s) => r(s.pass?.yds, s.pass?.att)],
  ];
  const rush: Array<[string, (s: S) => string]> = [
    ["Car", (s) => v(s.rush?.att)], ["Yds", (s) => v(s.rush?.yds)], ["Y/C", (s) => r(s.rush?.yds, s.rush?.att)], ["TD", (s) => v(s.rush?.td)],
  ];
  const rec: Array<[string, (s: S) => string]> = [
    ["Rec", (s) => v(s.rec?.rec)], ["Yds", (s) => v(s.rec?.yds)], ["Y/R", (s) => r(s.rec?.yds, s.rec?.rec)], ["TD", (s) => v(s.rec?.td)],
  ];
  if (pos === "QB") groups.push({ label: "Passing", cols: pass }, { label: "Rushing", cols: rush });
  else if (pos === "RB") groups.push({ label: "Rushing", cols: rush }, { label: "Receiving", cols: rec });
  else groups.push({ label: "Receiving", cols: rec }, { label: "Rushing", cols: rush });
  // A group he never touched is dropped rather than shown as dashes.
  const used = groups.filter((g) => profile.seasons.some((s) => g.cols.some(([, of]) => of(s) !== DASH && of(s) !== "0")));
  if (used.length === 0) return "";
  const rows = [...profile.seasons].sort((x, y) => y.season - x.season);
  const body = rows
    .map((s) => `<tr><th scope="row">${s.season}</th><td>${escapeHtml(s.school)}</td>` +
      used.map((g) => g.cols.map(([, of]) => `<td>${escapeHtml(of(s))}</td>`).join("")).join("") + `</tr>`)
    .join("");
  const schools = [...new Set(rows.map((s) => s.school))];
  const lede = `${plural(rows.length, "college season")} at ${schools.join(" and ")}. He has not played an NFL game yet.`;
  return (
    sectionOpen("scp-st-table-h", `${data.player.name} college stats by season`, escapeHtml(lede)) +
    `<div class="scp-ox-tbl"><table class="scp-ox-table scp-st-table">` +
    `<caption>College stats, from CollegeFootballData.com.</caption>` +
    `<thead><tr class="scp-st-grp"><td colspan="2"></td>` +
    used.map((g) => `<th colspan="${g.cols.length}" scope="colgroup"><span>${escapeHtml(g.label)}</span></th>`).join("") +
    `</tr><tr><th scope="col">Season</th><th scope="col">School</th>` +
    used.map((g) => g.cols.map(([label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")).join("") +
    `</tr></thead><tbody>${body}</tbody></table></div></section>`
  );
}

/**
 * The whole Stats tab, in the spec's order. A rookie before his first NFL game
 * gets only his college card and college table (spec, edge states); a player
 * with neither NFL games nor college data gets nothing.
 */
export function renderStatsTab(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const { top, rest, foot } = renderStatsTabParts(data, options);
  return top + rest + foot;
}

/**
 * The tab in two pieces, each in its own .scp-st wrapper. mak (2026-09-30)
 * wanted the first three sections, production, advanced and the career chart,
 * at the very top of the tab, ABOVE the original Stats content; the career
 * table, the read and the footer stay under it. A rookie's college
 * card and table are all `top`.
 */
export function renderStatsTabParts(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
  /**
   * Blocks the caller owns that take a slot in the spec's order. `careerTable`
   * is player-render's season-by-season table (renderCareerStats, printed
   * bare), which mak moved here from the Game Log's All view on 2026-10-29: it
   * sits between the advanced table and the chart, so the eleven rows of
   * totals are directly above the eleven bars that draw them.
   */
  inserts: { careerTable?: string } = {},
): { top: string; rest: string; foot: string } {
  const none = { top: "", rest: "", foot: "" };
  const c = career(data);
  if (!["QB", "RB", "WR", "TE"].includes(c.pos)) return none;
  const ink = teamInk(data.team);
  const open = `<div class="scp-ox scp-st"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>`;
  const wrap = (html: string): string => (html ? `${open}${html}</div>` : "");
  if (!c.focus) {
    // No NFL games: only his college seasons can say anything here.
    if (!collegeCard(data.college, c.pos)) return none;
    return { top: wrap(renderAdvanced(data, c) + renderCollegeTable(data, c.pos) + renderAnalysis(data, c)), rest: "", foot: "" };
  }
  // The production rail, the advanced ladders, the career-table section and
  // the StatChasers Analysis module left this tab on 2026-11-05 (mak:
  // "remove the older version"): the premium block (stats-premium.ts), which
  // player-render mounts above these parts, carries all four from the same
  // model (statsPremiumModel below). Later the same day the per-season
  // chart, the career-rate tiles, the read with its Redraft Command panel
  // and the career-highs strip went the same way (mak: "remove the old
  // version"): the premium career block (career-premium.ts), which
  // player-render mounts after these parts, carries them from
  // careerPremiumModel() below. renderChart, renderCareerRates and
  // renderRead stay in this file unmounted; the model reads their builders.
  // Only the footer is still this function's.
  return {
    top: "",
    rest: "",
    // Apart so the page can stand it under the peers rail, directly above the
    // tab's FAQ (mak, 2026-09-30).
    foot: wrap(renderFooter(data)),
  };
}
