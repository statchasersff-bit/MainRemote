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
import { titleCase } from "./title-case";
import type { PlayerRenderOptions } from "../player-render";
import { getTeamByAbbreviation } from "../team/teams";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { passerRating } from "./stats-profile";
import { collegeCard, type AdvCard, type AdvMetric, type CollegeCard, type LogSeason } from "./stats-tab-data";
import type { GameLogEntry } from "./types";
import { lastName, teamInk } from "./header";

const DASH = "—";

/** The scoring as the reference page words it: "full PPR", not the toggle's "PPR". */
const SCORING_WORDS = { ppr: "full PPR", half: "half-PPR", standard: "standard" } as const;
const MINUS = "−";
const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

/* ------------------------------------------------------------------ atoms */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** A true minus sign, never a hyphen. */
const signed = (s: string): string => s.replace(/^-/, MINUS);
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
function swingWord(pos: string, sd: number): "low" | "moderate" | "high" {
  const [lo, hi] = pos === "TE" ? [5, 8] : pos === "QB" ? [6, 9] : [7, 10];
  return sd < lo ? "low" : sd <= hi ? "moderate" : "high";
}

/** Regular-season games a club played, by season. */
const teamGames = (season: number): number => (season <= 2020 ? 16 : 17);

/* ---------------------------------------------------------------- lines */

interface Line {
  gp: number;
  att: number; cmp: number; passYd: number; passTd: number; int: number;
  rushAtt: number; rushYd: number; rushTd: number; rushLong: number | null;
  tgt: number; rec: number; recYd: number; recTd: number;
  pts: number;
}

const EMPTY: Line = {
  gp: 0, att: 0, cmp: 0, passYd: 0, passTd: 0, int: 0,
  rushAtt: 0, rushYd: 0, rushTd: 0, rushLong: null,
  tgt: 0, rec: 0, recYd: 0, recTd: 0, pts: 0,
};

function sumLine(entries: GameLogEntry[], pts: (e: GameLogEntry) => number): Line {
  const t: Line = { ...EMPTY };
  const v = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  for (const e of entries) {
    const st = e.stats as unknown as Record<string, unknown>;
    t.gp += 1;
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
        // A season in progress is ranked as the header ranks it.
        finish: inProgress ? currentRank(data) ?? s.finish : s.finish,
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
function currentRank(data: PlayerPageData): number | null {
  const row = data.production?.find((r) => r.season === data.season);
  return row?.posFinishPpg ?? data.seasonRank ?? row?.posFinishTotal ?? data.seasonRankTotal ?? null;
}

/** Ranked metrics, best percentile first; descriptive and unranked ones dropped. */
function byPct(metrics: AdvMetric[]): AdvMetric[] {
  return metrics.filter((m) => m.pct !== null).sort((x, y) => y.pct! - x.pct!);
}

/* --------------------------------------------------- section 1: production */

/** Section 1's heading: the tab's heading, and on WordPress its H1 (player-render's promoteLeadHeading). */
export const STATS_LEAD_ID = "scp-st-prod-h";

interface Stat {
  label: string;
  total: string;
  /** The per-game figure, for a counting stat; rates and ranks have none. */
  pg?: string;
  small?: string;
  /** On the group's small second line rather than among its headline figures. */
  minor?: boolean;
}

function counting(label: string, total: number, gp: number): Stat {
  return { label, total: whole(total), pg: gp ? one(total / gp) : DASH };
}

function pair(label: string, a: number, b: number, gp: number): Stat {
  return {
    label,
    total: `${whole(a)}/${whole(b)}`,
    pg: gp ? `${one(a / gp)}/${one(b / gp)}` : DASH,
  };
}

/**
 * One group of the stat strip: a small eyebrow, then each figure over its
 * label. mak asked (2026-09-30) for the three production cards to become one
 * horizontal band, figures first and labels small underneath, to take the
 * section to half its height. The label stays a <dt> ahead of its <dd> in the
 * markup; the CSS puts it under the figure.
 */
function renderGroup(title: string, stats: Stat[], fan = false): string {
  if (stats.length === 0) return "";
  const value = (s: Stat): string => {
    const toggle = s.pg !== undefined ? ` data-total="${escapeHtml(s.total)}" data-pg="${escapeHtml(s.pg)}"` : "";
    return `<span${toggle}>${escapeHtml(s.total)}</span>`;
  };
  const major = stats.filter((s) => !s.minor);
  const minor = stats.filter((s) => s.minor);
  // The headline figures large, the rest on one small line under them (mak,
  // 2026-09-30: "821 YDS · 66.2 CMP% · 4 TD · 1 INT", then sacks, YPA etc.).
  return (
    `<div class="scp-st-sgroup${fan ? " is-fan" : ""}"><h3 class="scp-st-eyebrow">${escapeHtml(title)}</h3><dl>` +
    major
      .map(
        (s) =>
          `<div><dt>${escapeHtml(s.label)}` +
          (s.small ? ` <small>${escapeHtml(s.small)}</small>` : "") +
          `</dt><dd>${value(s)}</dd></div>`,
      )
      .join("") +
    `</dl>` +
    (minor.length
      ? `<p class="scp-st-minor">` +
        minor
          .map((s) => `<span><b>${value(s)}</b> ${escapeHtml(s.label)}${s.small ? ` <small>${escapeHtml(s.small)}</small>` : ""}</span>`)
          .join("") +
        `</p>`
      : "") +
    `</div>`
  );
}

function passingStats(t: Line): Stat[] {
  const r = rating(t);
  return [
    counting("Yards", t.passYd, t.gp),
    { label: "Comp %", total: t.att ? pct1((t.cmp / t.att) * 100) : DASH },
    counting("TD", t.passTd, t.gp),
    counting("INT", t.int, t.gp),
    { ...pair("Comp/Att", t.cmp, t.att, t.gp), minor: true },
    { label: "Y/A", total: fmtRatio(t.passYd, t.att), minor: true },
    { label: "Rating", total: r === null ? DASH : r.toFixed(1), minor: true },
  ];
}

function rushingStats(t: Line, full: boolean): Stat[] {
  // A runner's carries are a headline; a quarterback's or receiver's are not.
  const out: Stat[] = [
    counting("Yards", t.rushYd, t.gp),
    counting("TD", t.rushTd, t.gp),
    { ...counting(full ? "Carries" : "Att", t.rushAtt, t.gp), minor: !full },
    { label: "Y/C", total: fmtRatio(t.rushYd, t.rushAtt), minor: true },
  ];
  if (full && t.rushLong !== null) out.push({ label: "Long", total: whole(t.rushLong), minor: true });
  return out;
}

function receivingStats(t: Line, full: boolean): Stat[] {
  const out: Stat[] = [counting("Rec", t.rec, t.gp), counting("Yards", t.recYd, t.gp), counting("TD", t.recTd, t.gp)];
  out.push({ ...counting("Targets", t.tgt, t.gp), minor: !full });
  if (full) out.push({ label: "Y/R", total: fmtRatio(t.recYd, t.rec), minor: true });
  if (full) out.push({ label: "Catch %", total: t.tgt ? pct1((t.rec / t.tgt) * 100) : DASH, minor: true });
  return out;
}

interface WeekPick {
  entry: GameLogEntry;
  pts: number;
  caption: string;
}

function weekCaption(data: PlayerPageData, row: SeasonRow, e: GameLogEntry): string {
  // "@" or "vs" from the schedule feed, which is this season's only.
  const game = row.season === (data.leagueSeason ?? data.season)
    ? (data.schedule ?? []).find((g) => g.week === e.week)
    : undefined;
  const opp = clubCode(e.opp) || e.opp;
  const mark = game?.homeAway === "away" ? "@ " : game?.homeAway === "home" ? "vs " : "";
  return `Week ${e.week} ${mark}${opp}`.trim();
}

function bestWorst(data: PlayerPageData, c: Career, row: SeasonRow): { best: WeekPick; worst: WeekPick } | null {
  if (row.weeks.length === 0) return null;
  const picks = row.weeks.map((e) => ({ entry: e, pts: c.pts(e), caption: weekCaption(data, row, e) }));
  const sorted = [...picks].sort((x, y) => y.pts - x.pts || x.entry.week - y.entry.week);
  return { best: sorted[0]!, worst: sorted[sorted.length - 1]! };
}

/** "2026 through Week 3 · Arizona Cardinals": the lede's small first line. */
function prodKicker(data: PlayerPageData, c: Career, row: SeasonRow): string {
  const lastWeek = Math.max(...row.weeks.map((e) => e.week));
  const club = data.team && row.clubs[row.clubs.length - 1] === data.team.code ? [data.team.city, data.team.nickname].filter(Boolean).join(" ") : null;
  const when = row.inProgress ? `${row.season} through Week ${Math.max(lastWeek, c.leagueWeek)}` : `${row.season} final`;
  return `<span class="scp-st-kicker">${escapeHtml(club ? `${when} · ${club}` : when)}</span>`;
}

/**
 * The one thing neither the strip nor the table says: how much of his fantasy
 * line leans on touchdowns. mak (2026-09-30) asked for it more prominent and
 * worded as a read, with the season and club moved to a line above it.
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

function renderProduction(data: PlayerPageData, c: Career, options: PlayerRenderOptions): string {
  const row = c.focus;
  if (!row) return "";
  const t = row.line;
  const pos = c.pos;
  const groups: string[] = [];

  if (pos === "QB") {
    groups.push(renderGroup("Passing", passingStats(t)));
    groups.push(renderGroup("Rushing", rushingStats(t, false)));
  } else if (pos === "RB") {
    groups.push(renderGroup("Rushing", rushingStats(t, true)));
    groups.push(renderGroup("Receiving", receivingStats(t, false)));
  } else {
    groups.push(renderGroup("Receiving", receivingStats(t, true)));
    // Hidden for a receiver without a carry.
    if (t.rushAtt > 0) groups.push(renderGroup("Rushing", rushingStats(t, false)));
  }

  const bw = bestWorst(data, c, row);
  const rank = row.finish;
  const fan: Stat[] = [
    { label: "Points", total: one(t.pts), pg: t.gp ? one(t.pts / t.gp) : DASH },
    { label: "Pos rank", total: rank ? `${pos}${rank}` : DASH },
  ];
  if (bw) {
    fan.push({ label: "Best", total: one(bw.best.pts), small: bw.best.caption, minor: true });
    if (row.weeks.length > 1) fan.push({ label: "Worst", total: one(bw.worst.pts), small: bw.worst.caption, minor: true });
  }
  groups.push(renderGroup(`Fantasy (${SCORING_SHORT[data.format]})`, fan, true));

  const href = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/game-log/${options.linkQuery ?? ""}`;
  return (
    // The toggle on the heading's row, right of it (mak, 2026-09-30).
    sectionOpen(
      STATS_LEAD_ID,
      `${data.player.name} ${row.season} stats`,
      prodKicker(data, c, row) +
        (own(data.statsCopy?.prod_lede) ? copyHtml(own(data.statsCopy?.prod_lede)!) : prodLede(row)),
      `<div class="scp-st-seg" role="group" aria-label="Show stats as" data-scp-seg>` +
        `<button type="button" data-mode="total" aria-pressed="true">Season totals</button>` +
        `<button type="button" data-mode="pg" aria-pressed="false">Per game</button>` +
        `</div>`,
    ) +
    `<div class="scp-st-strip">${groups.join("")}</div>` +
    `<a class="scp-ox-more" href="${escapeHtml(href)}">See these stats game by game</a>` +
    `</section>`
  );
}

/* ---------------------------------------------------- section 2: advanced */

interface AdvColumn {
  title: string;
  /** Under the title: how far in, or where from. */
  sub: string;
  card: AdvCard;
}

/**
 * The percentile: the ordinal over a small bar filled to it, tinted by
 * standing (grey for a style reading); the old sentence rides along as its
 * title. mak (2026-09-30) asked for the bar, Next Gen Stats style.
 */
function badge(m: AdvMetric | undefined): string {
  if (!m || m.pctl == null) return `<td class="scp-st-pc"><span class="scp-st-pb is-muted">${DASH}</span></td>`;
  const w = Math.max(3, Math.min(100, m.pctl));
  return (
    `<td class="scp-st-pc"><span class="scp-st-pb is-${m.standing}" title="${escapeHtml(m.read)}">` +
    `${escapeHtml(ordinal(m.pctl))}</span>` +
    `<span class="scp-st-bar is-${m.standing}" aria-hidden="true"><i style="width:${w}%"></i></span></td>`
  );
}

/**
 * Which tier a metric reads under (mak, 2026-09-30): what he does with the
 * ball first and set heavier, then how much of it he gets, how he plays, and
 * what surrounds him. A key not listed here reads under Efficiency.
 */
const TIERS: Array<{ name: string; keys: string[] }> = [
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
const keyOf = (m: { key?: string; label: string }): string => {
  const k = m.key ?? m.label;
  return LABEL_KEY[k] ?? k;
};
const tierOf = (key: string): number => {
  const i = TIERS.findIndex((t) => t.keys.includes(key));
  return i < 0 ? 0 : i;
};

/**
 * The advanced cards as one table, the seasons side by side (mak, 2026-09-30):
 * Stat | value | percentile, once per season, one row per metric either card
 * carries, grouped into tiers with the first (Efficiency) set heavier. A
 * metric neither season has a figure for is dropped. The college column's
 * metrics have no tier and print as one untitled group.
 */
function renderAdvTable(cols: AdvColumn[]): string {
  const keys: Array<{ key: string; label: string }> = [];
  for (const col of cols) {
    for (const m of col.card.all ?? col.card.metrics) {
      const key = m.key ?? m.label;
      if (!keys.some((k) => k.key === key)) keys.push({ key, label: m.label });
    }
  }
  const find = (col: AdvColumn, key: string): AdvMetric | undefined =>
    (col.card.all ?? col.card.metrics).find((m) => (m.key ?? m.label) === key);
  const kept = keys.filter(({ key }) => cols.some((col) => { const v = find(col, key)?.value; return v !== undefined && v !== DASH; }));
  if (kept.length === 0) return "";
  const known = kept.some(({ key, label }) => TIERS.some((t) => t.keys.includes(keyOf({ key, label }))));
  const span = 1 + cols.length * 2;
  const row = ({ key, label }: { key: string; label: string }, lead: boolean): string =>
    `<tr${lead ? ` class="is-key"` : ""}><th scope="row">${escapeHtml(label)}</th>` +
    cols.map((col) => {
      const m = find(col, key);
      return `<td class="scp-st-v">${escapeHtml(signed(m?.value ?? DASH))}</td>` + badge(m);
    }).join("") +
    `</tr>`;
  let rows: string;
  if (!known) {
    rows = kept.map((k) => row(k, false)).join("");
  } else {
    rows = TIERS.map((tier, i) => {
      const inTier = kept.filter(({ key, label }) => tierOf(keyOf({ key, label })) === i);
      if (inTier.length === 0) return "";
      return (
        `<tr class="scp-st-tier"><th scope="rowgroup" colspan="${span}">${tier.name}</th></tr>` +
        inTier.map((k) => row(k, i === 0)).join("")
      );
    }).join("");
  }
  return (
    `<div class="scp-st-advwrap"><table class="scp-st-advt">` +
    `<thead><tr><th scope="col">Stat</th>` +
    cols.map((col) =>
      `<th scope="colgroup" colspan="2">${escapeHtml(col.title)}` +
      (col.sub ? ` <small>${escapeHtml(col.sub)}</small>` : "") +
      `</th>`,
    ).join("") +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

const byKey = (card: AdvCard | null | undefined, label: string): AdvMetric | undefined =>
  card?.metrics.find((m) => m.label === label);

function advLede(data: PlayerPageData, pos: string, cards: AdvCard[]): string {
  const last = lastName(data.player.name);
  // The style sentence reads the full season when there is one.
  const lastCard = data.statsAdvanced?.last ?? null;
  let style = "";
  if (pos === "QB") {
    const deep = lastCard?.pct["deep"] ?? null;
    const ttt = lastCard?.pct["ttt"] ?? null;
    if (deep !== null) {
      style = deep >= 60
        ? `${last} pushes the ball downfield more than most ${pos}s`
        : deep <= 40 ? `${last} works the short and intermediate areas more than most ${pos}s`
          : `${last} throws downfield at about a league-average rate`;
      if (ttt !== null && ttt >= 60) style += " and holds the ball longer than most";
      else if (ttt !== null && ttt <= 40) style += " and gets the ball out quickly";
    }
  } else if (pos === "RB") {
    const snap = byKey(cards[0], "Snap share");
    const tgt = byKey(cards[0], "Target share");
    if (snap && tgt && snap.value !== DASH) style = `${last} is on the field for ${snap.value} of snaps and draws ${tgt.value} of his team's targets`;
  } else {
    const adot = lastCard ? byKey(lastCard, "Average depth of target") : undefined;
    const share = byKey(cards[0], "Target share");
    if (adot && adot.value !== DASH) {
      const p = lastCard?.pct["adot"] ?? 50;
      style = `${last} is ${p >= 60 ? "a downfield target" : p <= 40 ? "a short-area target" : "an intermediate target"} (${adot.value} yards per target last season)`;
    }
    if (share && share.value !== DASH) style += `${style ? ", with" : `${last} has`} a ${share.value} target share this season`;
  }

  // Style only: the percentiles are in the table and the strengths and limits
  // in the fantasy note under it (mak, 2026-09-30, one line).
  return style ? escapeHtml(`${style}.`) : "";
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
 * more air than the "What works / What limits him" pair it replaces.
 */
function fantasyNote(data: PlayerPageData, c: Career, cards: AdvCard[]): string {
  const last = lastName(data.player.name);
  const pos = c.pos;
  const ranked = byPct(cards.flatMap((x) => (x.qualified ? x.metrics : [])));
  const phrase = (m: AdvMetric, i: 0 | 1): string =>
    PROFILE[keyOf(m)]?.[i] ?? `ranks ${i === 0 ? "high" : "low"} in ${m.label.replace(LC, (w) => w.toLowerCase())}`;
  const pick = (list: AdvMetric[], i: 0 | 1): string[] => {
    const out: string[] = [];
    for (const m of list) {
      const p = phrase(m, i);
      if (!out.includes(p)) out.push(p);
      if (out.length === 2) break;
    }
    return out;
  };
  const good = pick(ranked.filter((m) => m.standing === "good"), 0);
  const bad = pick(ranked.filter((m) => m.standing === "bad").reverse(), 1);
  const row = c.focus;
  const parts: string[] = [];
  if (good.length || bad.length) {
    const sentence = good.length
      ? `${last} ${listWords(good)}${bad.length ? `, but ${listWords(bad)}` : ""}.`
      : `${last} ${listWords(bad)}.`;
    parts.push(`<p><strong>Profile:</strong> ${escapeHtml(sentence)}</p>`);
  }
  if (row && row.line.gp) {
    const t = row.line;
    const volume =
      pos === "QB" ? `${one(t.att / t.gp)} pass attempts and ${one(t.rushAtt / t.gp)} carries a game`
        : pos === "RB" ? `${one(t.rushAtt / t.gp)} carries and ${one(t.tgt / t.gp)} targets a game`
          : `${one(t.tgt / t.gp)} targets a game`;
    parts.push(
      `<p><strong>For fantasy:</strong> ${escapeHtml(`his floor is his volume, ${volume}${row.inProgress ? " this season" : ` in ${row.season}`}; efficiency decides how much of it becomes points.`)}</p>`,
    );
  }
  if (parts.length === 0) return "";
  return `<div class="scp-st-read">${parts.join("")}</div>`;
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

function renderAdvanced(data: PlayerPageData, c: Career): string {
  const adv = data.statsAdvanced;
  const college = isRookie(data, c) ? collegeCard(data.college, c.pos) : null;
  if ((!adv || (!adv.current && !adv.last)) && !college) return "";
  const pos = c.pos;
  const cats = pos === "QB" ? "passing" : pos === "RB" ? "rushing" : "receiving";
  const cols: AdvColumn[] = [];
  const used: AdvCard[] = [];
  // The methodology lines, gathered into one footnote under the table.
  const notes: string[] = [];

  if (adv?.current) {
    const cur = adv.current;
    cols.push({ title: String(cur.season), sub: cur.throughWeek ? `Thru Wk ${cur.throughWeek}` : "Season", card: cur });
    used.push(cur);
    notes.push(
      cur.qualified
        ? `${cur.season}${cur.throughWeek ? ` through Week ${cur.throughWeek}` : ""} among ${cur.qualifiedCount} qualified ${pos}s`
        : `${cur.season}: below the qualifying line so far, so no percentiles`,
    );
  }
  if (college) {
    cols.push({ title: "College", sub: `${college.school} ${college.season}`, card: college });
    used.push(college);
    notes.push(
      college.qualified
        ? `College: ranked among ${college.qualifiedCount} ${college.pool}`
        : `College: below the ${college.pool.replace(/^college \w+ with /, "")} line, so no percentiles`,
    );
  } else if (adv?.last) {
    const prev = adv.last;
    cols.push({ title: String(prev.season), sub: plural(prev.games, "game"), card: prev });
    used.push(prev);
    notes.push(
      prev.qualified
        ? `${prev.season} (${plural(prev.games, "game")}, weeks 1–17) among ${prev.qualifiedCount}`
        : `${prev.season} (${plural(prev.games, "game")}, weeks 1–17): below the qualifying line, so no percentiles`,
    );
  }
  // One short line (mak, 2026-09-30): the seasons joined, then the grey rule.
  const grey = cols.some((col) => (col.card.all ?? col.card.metrics).some((m) => m.pctl != null && m.standing === "muted"))
    ? " Grey bars describe style, not quality."
    : "";

  const copy = data.statsCopy;
  const note = own(copy?.adv_fantasy_note)
    ? `<div class="scp-st-read"><strong>What it means for fantasy:</strong> ${copyHtml(own(copy?.adv_fantasy_note)!)}</div>`
    : fantasyNote(data, c, used);
  const lede = own(copy?.adv_lede)
    ? copyHtml(own(copy?.adv_lede)!)
    : college && !adv?.current ? collegeLede(data, college) : advLede(data, pos, used);
  return (
    sectionOpen("scp-st-adv-h", `Advanced ${cats} stats`, lede) +
    renderAdvTable(cols) +
    `<p class="scp-st-foot-note">${escapeHtml(`Percentiles: ${notes.join(" · ")}.${grey}`)}</p>` +
    note +
    `</section>`
  );
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
  const years = rows.map((r) => `<div><strong>${r.season}</strong><small>${r.line.gp} GP</small></div>`).join("");
  // The club only where it changes, so the row reads as a career's moves
  // rather than eleven equal labels.
  const teams = rows
    .map((r, i) => {
      const label = r.clubs.join("/") || DASH;
      const prev = i > 0 ? rows[i - 1]!.clubs.join("/") || DASH : null;
      const cur = current && r.clubs.includes(current) ? ` class="is-cur"` : "";
      return label === prev ? `<span class="is-same"></span>` : `<span${cur}>${escapeHtml(label)}</span>`;
    })
    .join("");

  const showAvg = n > 1;
  const aria =
    `${pos} fantasy points per game by season: ` +
    rows.map((r) => `${r.season} ${one(ppg(r))}${r.inProgress ? " (in progress)" : ""}`).join(", ") +
    (showAvg ? `. Career average ${one(careerPpg)}.` : ".");

  const now = rows.find((r) => r.inProgress);

  const legend =
    (latest && n > 1 ? `<span class="is-last">${latest.season}</span>` : "") +
    (now ? `<span class="is-now">${now.season}, in progress</span>` : "") +
    (showAvg ? `<span class="is-avg">Dashed line: career average</span>` : "");

  const avgPos = Math.min(1, careerPpg / scale);
  return (
    sectionOpen("scp-st-arc-h", "Fantasy points per game, every season", "") +
    `<figure class="scp-st-arc${showAvg ? " has-avg" : ""}" style="--scp-n:${n};--scp-avg:${avgPos.toFixed(4)}">` +
    // The scroller is the chart alone, so the legend stays put while a long
    // career scrolls; client/player.ts opens it on the newest season.
    `<div class="scp-st-arc-scroll" data-scp-arc>` +
    `<div class="scp-st-plot${showAvg ? " has-avg" : ""}" role="img" aria-label="${escapeHtml(aria)}">` +
    cols +
    (showAvg ? `<span class="scp-st-avg" aria-hidden="true">Career avg<b>${one(careerPpg)}</b></span>` : "") +
    `</div>` +
    `<div class="scp-st-x" aria-hidden="true">${years}</div>` +
    `<div class="scp-st-teams" aria-hidden="true">${teams}</div>` +
    `</div>` +
    (legend ? `<figcaption class="scp-st-legend">${legend}</figcaption>` : "") +
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

function renderRead(data: PlayerPageData, c: Career, options: PlayerRenderOptions): string {
  const { pos, rows, total } = c;
  if (rows.length === 0 || total.gp === 0) return "";
  const name = data.player.name;
  const last = lastName(name);
  const redraft = `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`;
  const ppg = (t: Line): number => (t.gp ? t.pts / t.gp : 0);
  const done = rows.filter((r) => !r.inProgress);
  const n = rows.length;
  const paragraphs: string[] = [];

  // 1. Career-level context.
  // Top-12 seasons at every position, as the spec words it; the table's
  // colours run deeper at RB and WR.
  const good = 12;
  const topSeasons = done.filter((r) => r.finish && r.finish <= good).sort((x, y) => x.season - y.season);
  const starter = rows.filter((r) => isStarterSeason(pos, r.line));
  const backup = rows.filter((r) => !isStarterSeason(pos, r.line));
  let p1 =
    `${last} has averaged ${one(ppg(total))} fantasy points per game over ${plural(total.gp, "game")} and ${plural(n, "season")}` +
    (topSeasons.length
      ? `, with ${word(topSeasons.length)} top-${good} finish${topSeasons.length > 1 ? "es" : ""} (${topSeasons.map((r) => r.season).join(", ")}).`
      : done.length ? `, without a top-${good} finish.` : ".");
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
    let why: string;
    if (Math.abs(dv) < 1) {
      why = `His volume has held at about ${one(volNow)} ${unit} a game, so ${Math.abs(diff) < 0.5 ? "the output has too" : "the change is efficiency and scoring"}.`;
    } else if (Math.abs(diff) < 0.5) {
      why = `His volume is ${dv > 0 ? "up" : "down"} (${one(volNow)} ${unit} a game against ${one(volThen)}) but ${dv > 0 ? "less of it is turning into points" : "he is doing more with it"}.`;
    } else if (Math.sign(dv) === Math.sign(diff)) {
      why = `Volume is the driver: ${one(volNow)} ${unit} a game against ${one(volThen)}.`;
    } else {
      why = `That is despite ${dv > 0 ? "more" : "less"} volume (${one(volNow)} ${unit} a game against ${one(volThen)}), so efficiency and scoring are doing it.`;
    }
    const p2 =
      (now.inProgress ? `So far in ${now.season} he is at ` : `In ${now.season} he averaged `) + `${one(ppg(now.line))} per game, ` +
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
      a(redraft, `see ${last}'s rest-of-season rank and trade value in Redraft Command`, ` data-cta="redraft-command-stats-prose"`) +
      ".",
  );

  const rc =
    `<div class="scp-ox-panel is-rc"><h3>Redraft Command</h3>` +
    `<p>${escapeHtml(`Career stats tell you who he's been. Redraft Command projects what he's worth from here: rest-of-season rank, trade value and waiver priority for your league settings.`)}</p>` +
    `<a class="scp-ox-btn" href="${escapeHtml(redraft)}" data-cta="redraft-command-stats-sidebar">${escapeHtml(`Open ${last} in Redraft Command`)}</a>` +
    `</div>`;

  /* ---- career rates ---- */
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
  const tiles: string[] = [
    rate(one(ppg(total)), "Career PPG", `${plural(total.gp, "game")} over ${plural(n, "season")}`),
  ];
  if (games > 0) tiles.push(rate(`${Math.min(100, Math.round((total.gp / games) * 100))}%`, "Availability", "Share of team games he played"));
  if (ranked.length) tiles.push(rate(`${Math.round((top / ranked.length) * 100)}%`, `Top-${n12} weeks`, n12 === 12 ? `Share of his games as a ${pos}1` : `Share of his games as a top-${n12} ${pos}`));
  if (n > 1 && allWeeks.length > 1) tiles.push(rate(one(sd), "Weekly swing", `Standard deviation, ${swingWord(pos, sd)}`));

  /* ---- career highs ---- */
  const bests = careerHighs(c);

  return (
    sectionOpen("scp-st-read-h", "What his career numbers say", "") +
    // The takeaway first, then the explanation (mak, 2026-09-30).
    `<div class="scp-st-rates">${tiles.join("")}</div>` +
    byline(data) +
    `<div class="scp-ox-read">` +
    `<div><div class="scp-ox-prose">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</div></div>` +
    `<aside class="scp-ox-aside" aria-label="${escapeHtml(`${last} in Redraft Command`)}">${rc}</aside>` +
    `</div>` +
    bests +
    `</section>`
  );
}

function rate(value: string, title: string, caption: string): string {
  return `<div class="scp-st-rate"><p class="scp-st-v">${escapeHtml(value)}</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(caption)}</p></div>`;
}

/**
 * Career highs as one strip (mak, 2026-09-30): the figure, a short label, and
 * the season it came in under it.
 */
function careerHighs(c: Career): string {
  const { pos, rows, total } = c;
  const done = rows.filter((r) => r.line.gp > 0);
  if (done.length === 0) return "";
  const top = (of: (t: Line) => number): SeasonRow =>
    done.reduce((x, y) => (of(y.line) > of(x.line) ? y : x));
  const items: Array<{ v: string; label: string; sub: string }> = [];
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

/**
 * "By the StatChasers staff. Updated September 29, 2026."
 *
 * The analyst's name and date when stats_copy.json gives them; otherwise the
 * staff, dated by when the game logs were last written.
 */
function byline(data: PlayerPageData): string {
  const copy = data.statsCopy;
  const author = own(copy?.author) ?? "the StatChasers staff";
  const written = own(copy?.updated_date);
  let d: Date | null = null;
  if (written && /^\d{4}-\d{2}-\d{2}$/.test(written)) d = new Date(`${written}T12:00:00Z`);
  else if (data.statsUpdatedMs) d = new Date(data.statsUpdatedMs);
  if (!d || Number.isNaN(d.getTime())) return "";
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const human = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" }).format(d);
  return `<p class="scp-st-byline">${escapeHtml(`By ${author}. Updated `)}<time datetime="${iso}">${escapeHtml(human)}</time>.</p>`;
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
        (data.format === "standard" ? "" : " Two-point conversions and lost fumbles count as Sleeper scores them."),
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
    return { top: wrap(renderAdvanced(data, c) + renderCollegeTable(data, c.pos)), rest: "", foot: "" };
  }
  return {
    top: wrap(renderProduction(data, c, options) + renderAdvanced(data, c) + renderChart(data, c)),
    // No season-by-season table here: the original Stats content above already
    // has one (renamed "<name> career stats by season"), and mak had this
    // second copy removed on 2026-09-30.
    rest: wrap(renderRead(data, c, options)),
    // Apart so the page can stand it under the peers rail, directly above the
    // tab's FAQ (mak, 2026-09-30).
    foot: wrap(renderFooter(data)),
  };
}
