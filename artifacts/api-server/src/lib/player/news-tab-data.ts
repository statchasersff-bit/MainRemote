/**
 * The News tab's model: mak's News spec of 2026-09-30.
 *
 * Every item answers what happened and what it means for fantasy. Two kinds:
 *
 *   - game recaps, generated here from the game log and the stored box score
 *     after every game he was active for (spec 4.6);
 *   - the archive's wire and club items about him, each given a type from its
 *     category and a RULE-BASED fantasy take and impact label (mak chose rules
 *     over generated text on 2026-09-30; nothing here writes prose it cannot
 *     back with the page's own data).
 *
 * Items are grouped by the NFL calendar (spec 4.8): a game week, a bye, the
 * preseason or the offseason. Everything is computed at render; nothing here
 * is stored.
 *
 * Deferred by mak (2026-09-30): the per-item report pages and the SEO items.
 * "Read the full report" is the item's own article, or the Game Log tab for a
 * recap.
 */

import type { NewsItem } from "../render";
import { itemTimestamp, searchKey } from "../render";
import type { ScheduleGame } from "../team/schedule";
import { TEAMS } from "../team/teams";
import { storedSeason } from "../matchup/boxscore";
import { loadGameLogs, loadIndexedSlugs } from "./data";
import { teamCode } from "./ranks";
import type { GameLogEntry, Player } from "./types";

export type NewsType = "game" | "status" | "prac" | "transaction" | "contract" | "depth" | "analysis";
export type Impact = "up" | "flat" | "down";

export const TYPE_LABEL: Record<NewsType, string> = {
  game: "Game recap",
  status: "Status",
  prac: "Practice",
  transaction: "Transaction",
  contract: "Contract",
  depth: "Depth chart",
  analysis: "Analysis",
};

/** The Moves filter's types (spec 4.2). */
export const MOVES: NewsType[] = ["transaction", "contract", "depth"];

/* ------------------------------------------------------------- teammates */

export interface NewsMate {
  name: string;
  slug: string | null;
  position: string;
  /** Season totals on his current club, for the context line. */
  targets: number;
  carries: number;
  attempts: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The teammates tied to his value, from usage (spec 4.3), never by name:
 * a QB's top three by targets; an RB's backfield partners with 20%+ of the
 * carries and his starting QB; a WR/TE's starting QB and the two other
 * pass-catchers with the most targets. Only games on his current club count.
 */
export function newsTeammates(player: Player, season: number, allPlayers: Player[]): NewsMate[] {
  const logs = loadGameLogs(season);
  const mine = logs[player.id] ?? [];
  const club = [...mine].reverse().find((e) => e.team)?.team;
  if (!club) return [];
  const code = teamCode(club);
  const byId = new Map(allPlayers.map((p) => [p.id, p]));
  const indexed = new Set(loadIndexedSlugs());

  const totals = new Map<string, NewsMate>();
  let teamCarries = 0;
  for (const [id, entries] of Object.entries(logs)) {
    const p = byId.get(id);
    if (!p?.position) continue;
    for (const e of entries) {
      if (!e.team || teamCode(e.team) !== code) continue;
      teamCarries += num(e.stats?.rush_att);
      if (id === player.id) continue;
      const t = totals.get(id) ?? {
        name: p.name,
        slug: indexed.has(p.slug) ? p.slug : null,
        position: p.position,
        targets: 0,
        carries: 0,
        attempts: 0,
      };
      t.targets += num(e.stats?.rec_tgt);
      t.carries += num(e.stats?.rush_att);
      t.attempts += num(e.stats?.pass_att);
      totals.set(id, t);
    }
  }
  const all = [...totals.values()];
  const catchers = all
    .filter((m) => ["WR", "TE", "RB"].includes(m.position) && m.targets > 0)
    .sort((a, b) => b.targets - a.targets);
  const qb = all.filter((m) => m.position === "QB" && m.attempts > 0).sort((a, b) => b.attempts - a.attempts)[0];

  if (player.position === "QB") return catchers.slice(0, 3);
  if (player.position === "RB") {
    const backs = all
      .filter((m) => m.position === "RB" && teamCarries > 0 && m.carries / teamCarries >= 0.2)
      .sort((a, b) => b.carries - a.carries);
    return [...backs, ...(qb ? [qb] : [])];
  }
  return [...(qb ? [qb] : []), ...catchers.slice(0, 2)];
}

/** The team's most-targeted player in each week of `season`, from the stored box scores. */
export function weekTopTargets(season: number, teamCode: string): Record<number, { name: string; targets: number }> {
  const out: Record<number, { name: string; targets: number }> = {};
  let games;
  try {
    games = storedSeason(season);
  } catch {
    return out;
  }
  for (const g of games) {
    if (g.seasonType !== "regular") continue;
    const mine = g.box.players.filter((p) => p.team.toUpperCase() === teamCode.toUpperCase());
    const top = mine.reduce<(typeof mine)[number] | null>(
      (best, p) => ((p.stats.recTgt ?? 0) > (best?.stats.recTgt ?? 0) ? p : best),
      null,
    );
    if (top && (top.stats.recTgt ?? 0) > 0) out[g.week] = { name: top.name, targets: top.stats.recTgt ?? 0 };
  }
  return out;
}

/* ------------------------------------------------------------ the calendar */

const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-09-27": the Eastern calendar day of an instant. */
export const etDay = (ms: number): string => ET_DAY.format(new Date(ms));
const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = MONTH_LONG.map((m) => m.slice(0, 3));

/** "Sep 27" for an Eastern day. */
export const shortDay = (day: string): string => `${MONTH_SHORT[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

export interface WeekGroup {
  key: string;
  /** Newest first sorts on this. */
  order: number;
  label: string;
  /** Under the label: the game day, or a month for the off-weeks. */
  date: string;
  /** "L 30–36 @ SF", once the game is final. */
  result: string | null;
  week: number | null;
  bye: boolean;
}

/** Training camp opens in late July; before it is the offseason (spec 4.8). */
const campOpens = (season: number): string => `${season}-07-20`;
/** The season's news starts with free agency. */
export const seasonOpens = (season: number): string => `${season}-03-01`;

const POST_LABEL: Record<number, string> = { 19: "Wild Card", 20: "Divisional", 21: "Conference", 22: "Super Bowl" };

function resultChip(g: ScheduleGame): string | null {
  if (g.status !== "final" || !g.result) return null;
  const opp = g.opponent?.code ?? g.opponentName;
  return `${g.result.outcome} ${g.result.teamScore}–${g.result.opponentScore} ${g.homeAway === "away" ? "@" : "vs"} ${opp}`;
}

function gameGroup(g: ScheduleGame): WeekGroup {
  return {
    key: `w${g.week}`,
    order: 200 + g.week,
    label: POST_LABEL[g.week] ?? `Week ${g.week}`,
    date: g.kickoffMs ? shortDay(etDay(g.kickoffMs)) : "",
    result: resultChip(g),
    week: g.week,
    bye: false,
  };
}

/**
 * Which group an item belongs to (spec 4.8). A game recap is its game's week.
 * Anything else belongs to the next game on or after its day: from the day
 * after game N through the day of game N+1 is Week N+1, which puts practice
 * and status items in the week they are about. The seven days after the last
 * game before a bye are that bye week.
 */
export function groupFor(ms: number, games: ScheduleGame[], season: number): WeekGroup {
  const day = etDay(ms);
  const dated = games.filter((g) => g.kickoffMs !== null).sort((a, b) => a.week - b.week);
  const first = dated[0];
  const month = MONTH_LONG[Number(day.slice(5, 7)) - 1]!;
  if (!first || day < etDay(first.kickoffMs!)) {
    if (day >= campOpens(season) && first) {
      return { key: "pre", order: 100, label: "Preseason", date: month, result: null, week: null, bye: false };
    }
    return { key: "off", order: 0, label: "Offseason", date: month, result: null, week: null, bye: false };
  }
  for (let i = 0; i < dated.length; i++) {
    const g = dated[i]!;
    const gameDay = etDay(g.kickoffMs!);
    if (day > gameDay) continue;
    const prev = dated[i - 1];
    if (prev && g.week - prev.week > 1 && day <= addDays(etDay(prev.kickoffMs!), 7)) {
      const w = prev.week + 1;
      return { key: `w${w}`, order: 200 + w, label: `Week ${w} (bye)`, date: "", result: null, week: w, bye: true };
    }
    return gameGroup(g);
  }
  return { key: "after", order: 900, label: "Offseason", date: month, result: null, week: null, bye: false };
}

/** A recap's group: the week of the most recent game on or before its day. */
function gameOf(ms: number, games: ScheduleGame[]): ScheduleGame | null {
  const day = etDay(ms);
  return (
    games
      .filter((g) => g.kickoffMs !== null && etDay(g.kickoffMs) <= day)
      .sort((a, b) => b.week - a.week)[0] ?? null
  );
}

/* ----------------------------------------------------------------- items */

export interface LeadPanel {
  caption: string;
  big: string;
  suffix: string;
  lines: string[];
  /** Status panels link on to the Injury tab. */
  injuryLink: boolean;
}

export interface FeedItem {
  id: string;
  type: NewsType;
  ms: number;
  /** False when only the day is known: the time is not printed. */
  hasTime: boolean;
  headline: string;
  summary: string;
  take: string;
  impact: Impact;
  source: { name: string; url: string | null };
  also: Array<{ name: string; url: string | null }>;
  url: string | null;
  external: boolean;
  group: WeekGroup;
  panel: LeadPanel | null;
  /** A recap's result line: "25.6 fantasy points · QB4". */
  pointsLine: string | null;
  /** A recap's comparison: "9.0 below his 16.5 average". */
  avgNote: string | null;
}

export interface NewsContext {
  name: string;
  last: string;
  pos: string;
  season: number;
  scoring: string;
  games: ScheduleGame[];
  /** This season's weeks, as the Game Log tab has them. */
  log: GameLogEntry[];
  points: (e: GameLogEntry) => number;
  topTargets: Record<number, { name: string; targets: number }>;
  /** Current designation word ("Questionable"), or null for none. */
  designation: string | null;
  practice: string | null;
  gameLogHref: string;
  now: number;
}

const WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const count = (n: number, noun: string): string => `${n < 10 ? WORD[n] : n} ${noun}${n === 1 ? "" : "s"}`;
const one = (v: number): string => v.toFixed(1).replace(/^-/, "−");

/** Top finish for the position: QB/TE 12, RB/WR 24 (spec 4.5). */
const topLine = (pos: string): number => (pos === "RB" || pos === "WR" ? 24 : 12);
/** A bust week: QB/TE 25+, RB/WR 37+. */
const bustLine = (pos: string): number => (pos === "RB" || pos === "WR" ? 37 : 25);

function played(ctx: NewsContext): GameLogEntry[] {
  return ctx.log.filter((e) => (e.game_status ?? "active") === "active" && e.stats);
}

function seasonAvg(ctx: NewsContext): number | null {
  const p = played(ctx);
  return p.length ? p.reduce((s, e) => s + ctx.points(e), 0) / p.length : null;
}

/** Game recap impact (spec 4.5): top line or 25% over his average is up; a bust week is down. */
export function recapImpact(pos: string, finish: number | null | undefined, pts: number, avg: number | null): Impact {
  if ((finish && finish <= topLine(pos)) || (avg !== null && avg > 0 && pts >= avg * 1.25)) return "up";
  if (finish && finish >= bustLine(pos)) return "down";
  return "flat";
}

function statLines(pos: string, e: GameLogEntry): string[] {
  const s = e.stats;
  const pass = `${num(s.pass_cmp)}-of-${num(s.pass_att)}, ${num(s.pass_yd)} YDS, ${num(s.pass_td)} TD, ${num(s.pass_int)} INT`;
  const rush = `${num(s.rush_att)} CAR, ${num(s.rush_yd)} YDS${num(s.rush_td) ? `, ${num(s.rush_td)} TD` : ""}`;
  const rec = `${num(s.rec)} REC, ${num(s.rec_yd)} YDS${num(s.rec_td) ? `, ${num(s.rec_td)} TD` : ""} (${num(s.rec_tgt)} TGT)`;
  if (pos === "QB") return num(s.rush_att) ? [pass, rush] : [pass];
  if (pos === "RB") return num(s.rec_tgt) ? [rush, rec] : [rush];
  return num(s.rush_att) ? [rec, rush] : [rec];
}

/** "at San Francisco" / "vs. Seattle", from the schedule feed. */
function where(g: ScheduleGame): string {
  const place = g.opponent?.city ?? g.opponentName;
  return `${g.homeAway === "away" ? "at" : "vs."} ${place}`;
}

/** The recap for one game he was active in (spec 4.6). */
export function gameRecap(ctx: NewsContext, e: GameLogEntry, g: ScheduleGame): FeedItem {
  const s = e.stats;
  const pts = ctx.points(e);
  const fin = e.pos_rank ?? null;
  const avg = seasonAvg(ctx);
  const best = Math.max(...played(ctx).map(ctx.points));
  const r = g.result?.outcome ?? e.score?.r ?? null;
  const word = r === "W" ? "win" : r === "L" ? "loss" : r === "T" ? "tie" : "game";
  const tm = g.result?.teamScore ?? e.score?.tm ?? null;
  const op = g.result?.opponentScore ?? e.score?.opp ?? null;
  const score = tm !== null && op !== null ? `${Math.max(tm, op)}–${Math.min(tm, op)} ` : "";

  let headline: string;
  if (fin && fin <= 5 && pts >= best) headline = `${ctx.last} posts season high in ${word} ${where(g)}`;
  else if (fin && fin <= 12) headline = `${ctx.last} delivers ${ctx.pos}1 week ${where(g)}`;
  else if (fin && fin >= bustLine(ctx.pos)) headline = `${ctx.last} struggles ${where(g)}`;
  else headline = `${ctx.last} ${avg !== null && pts >= avg - 0.5 ? "solid" : "quiet"} in ${word} ${where(g)}`;

  let line: string;
  if (ctx.pos === "QB") {
    line = `${ctx.last} completed ${num(s.pass_cmp)} of ${num(s.pass_att)} passes for ${num(s.pass_yd)} yards`;
    const td = num(s.pass_td), int = num(s.pass_int);
    line += td || int ? ` with ${[td ? count(td, "touchdown") : "", int ? count(int, "interception") : ""].filter(Boolean).join(" and ")}` : "";
    if (num(s.rush_td)) line += `, and added ${num(s.rush_td) === 1 ? "a rushing score" : `${count(num(s.rush_td), "rushing score")}`}`;
    else if (num(s.rush_yd) >= 20) line += `, and ran for ${num(s.rush_yd)} yards`;
  } else if (ctx.pos === "RB") {
    line = `${ctx.last} ran ${num(s.rush_att)} times for ${num(s.rush_yd)} yards${num(s.rush_td) ? ` and ${count(num(s.rush_td), "touchdown")}` : ""}`;
    if (num(s.rec)) line += `, with ${num(s.rec)} catches for ${num(s.rec_yd)} yards`;
  } else {
    line = `${ctx.last} caught ${num(s.rec)} of ${num(s.rec_tgt)} targets for ${num(s.rec_yd)} yards${num(s.rec_td) ? ` and ${count(num(s.rec_td), "touchdown")}` : ""}`;
  }
  line += ` in the ${score}${word} ${where(g)}.`;

  // One usage fact: who got the targets, his workload, or his share.
  let usage = "";
  if (ctx.pos === "QB") {
    const top = ctx.topTargets[e.week];
    if (top) usage = ` ${top.name} led the team with ${top.targets} targets.`;
  } else if (ctx.pos === "RB") {
    const snaps = num(s.off_snp), team = num(s.tm_off_snp);
    if (snaps && team) usage = ` He played ${Math.round((snaps / team) * 100)}% of the offensive snaps.`;
  } else {
    const team = num(s.team_tgt);
    if (team && num(s.rec_tgt)) usage = ` That was ${Math.round((num(s.rec_tgt) / team) * 100)}% of the team's targets.`;
  }

  let take = `${one(pts)} ${ctx.scoring} points${fin ? `, ${ctx.pos === "RB" ? "an" : "a"} ${ctx.pos}${fin} finish` : ""}`;
  let avgNote: string | null = null;
  if (avg !== null && played(ctx).length > 1) {
    const d = pts - avg;
    avgNote = Math.abs(d) < 0.5 ? `right at his ${one(avg)} average` : `${one(Math.abs(d))} ${d > 0 ? "above" : "below"} his ${one(avg)} average`;
    const diff = pts - avg;
    take += Math.abs(diff) < 0.5 ? `, right at his season average of ${one(avg)}.` : `, ${one(Math.abs(diff))} ${diff > 0 ? "above" : "below"} his season average of ${one(avg)}.`;
  } else take += ".";

  const impact = recapImpact(ctx.pos, fin, pts, avg);
  return {
    id: `recap-${ctx.season}-${e.week}`,
    type: "game",
    // The day is known, the publish time is not: printed as a date.
    ms: (g.kickoffMs ?? 0) + 4 * 3_600_000,
    hasTime: false,
    headline,
    summary: line + usage,
    take,
    impact,
    source: { name: "StatChasers box score", url: ctx.gameLogHref },
    also: [],
    url: ctx.gameLogHref,
    external: false,
    group: gameGroup(g),
    pointsLine: `${one(pts)} fantasy points${fin ? ` · ${ctx.pos}${fin}` : ""}`,
    avgNote,
    panel: {
      caption: `Week ${e.week} fantasy result`,
      big: one(pts),
      suffix: `${ctx.scoring} pts${fin ? `, ${ctx.pos}${fin}` : ""}`,
      lines: statLines(ctx.pos, e),
      injuryLink: false,
    },
  };
}

/** A wire or club item's type, from the category the archive derives. */
export function typeOf(item: NewsItem): NewsType {
  const c = item.category ?? "other";
  if (c === "injury" || c === "status") return "status";
  if (c === "practice") return "prac";
  if (c === "transaction") return /\b(contract|extension|extend|restructur|guarantee|re-?work)/i.test(`${item.title} ${item.summary ?? ""}`) ? "contract" : "transaction";
  if (c === "depth-chart") return "depth";
  if (c === "recap") return "game";
  return "analysis";
}

const OUT = /^(out|ir|pup|injured reserve|doubtful|questionable|suspended)/i;

/**
 * The rule-based take (mak, 2026-09-30): what the page's own data can say
 * about the item's week, and otherwise what the item type means for fantasy.
 */
function ruleTake(ctx: NewsContext, type: NewsType, group: WeekGroup): { take: string; impact: Impact } {
  const g = group.week !== null ? ctx.games.find((x) => x.week === group.week) : undefined;
  const e = group.week !== null ? ctx.log.find((x) => x.week === group.week) : undefined;
  const final = g?.status === "final";
  const active = e && (e.game_status ?? "active") === "active" && e.stats;
  if (final && active && (type === "status" || type === "prac" || type === "analysis" || type === "game")) {
    const fin = e!.pos_rank;
    return {
      take: `He played in Week ${group.week}: ${one(ctx.points(e!))} ${ctx.scoring} points${fin ? `, ${ctx.pos === "RB" ? "an" : "a"} ${ctx.pos}${fin} finish` : ""}.`,
      impact: type === "game" ? recapImpact(ctx.pos, fin, ctx.points(e!), seasonAvg(ctx)) : "flat",
    };
  }
  if (final && !active && (type === "status" || type === "prac")) {
    return { take: `He did not play in Week ${group.week}.`, impact: "down" };
  }
  if (type === "status") {
    if (group.week !== null && !final) {
      return ctx.designation && OUT.test(ctx.designation)
        ? { take: `He is listed as ${ctx.designation.toLowerCase()} for Week ${group.week}; check his status before kickoff.`, impact: "down" }
        : { take: `He carries no injury designation for Week ${group.week} so far.`, impact: "flat" };
    }
    return group.key === "pre"
      ? { take: "A preseason health note; his Week 1 availability is what matters for fantasy.", impact: "flat" }
      : { take: "An offseason health note; watch for it again when practice reports start.", impact: "flat" };
  }
  if (type === "prac") return { take: "Practice and camp notes are context; his usage in games is what moves his value.", impact: "flat" };
  if (type === "transaction") return { take: "A roster move: watch how it changes his snaps and targets in the next game.", impact: "flat" };
  if (type === "contract") return { take: "Contract news: his fantasy value still comes from his role on the field.", impact: "flat" };
  if (type === "depth") return { take: "A depth-chart change: his role drives his value, and the Outlook tab has the full picture.", impact: "flat" };
  return { take: "Context for his season; the Outlook tab has our rest-of-season view.", impact: "flat" };
}

/**
 * The season's feed: a recap for every game he was active in, and his archive
 * items from this season, typed and given a take. A wire recap of a game that
 * has a generated recap merges into it as "Also reported by" (spec 4.8).
 */
export function buildFeed(ctx: NewsContext, news: NewsItem[]): { items: FeedItem[]; pending: WeekGroup[] } {
  const start = seasonOpens(ctx.season);
  const recaps = new Map<number, FeedItem>();
  for (const e of played(ctx)) {
    const g = ctx.games.find((x) => x.week === e.week);
    if (g) recaps.set(e.week, gameRecap(ctx, e, g));
  }

  const items: FeedItem[] = [...recaps.values()];
  for (const item of news) {
    const ms = itemTimestamp(item);
    if (ms === null || etDay(ms) < start) continue;
    const type = typeOf(item);
    let group = groupFor(ms, ctx.games, ctx.season);
    if (type === "game") {
      const g = gameOf(ms, ctx.games);
      if (g) {
        const recap = recaps.get(g.week);
        if (recap) {
          recap.also.push({ name: (item.source ?? "").trim() || "Wire report", url: item.link ?? null });
          continue;
        }
        group = gameGroup(g);
      }
    }
    const { take, impact } = ruleTake(ctx, type, group);
    items.push({
      id: item.id,
      type,
      ms,
      hasTime: true,
      // The wire prefixes its own player's name ("Jacoby Brissett: Gets in
      // some work"); on his page that is the page's own subject.
      headline: stripName(item.title, ctx.name),
      summary: (item.summary ?? "").trim(),
      take,
      impact,
      source: { name: (item.source ?? "").trim() || "Source", url: item.link ?? null },
      also: [],
      url: item.link ?? null,
      external: true,
      group,
      panel: null,
      pointsLine: null,
      avgNote: null,
    });
  }

  // A final game he has no log line for yet: the recap is coming (spec 4.9).
  const logged = new Set(ctx.log.map((e) => e.week));
  const pending = ctx.games
    .filter((g) => g.status === "final" && !logged.has(g.week))
    .map(gameGroup);

  items.sort((a, b) => b.ms - a.ms);
  return { items, pending };
}

const HIGHER: NewsType[] = ["status", "transaction", "contract", "depth"];

/**
 * The lead (spec 4.1): the newest item, except that the latest game recap
 * leads over newer practice notes and analysis until the next week's first
 * status item.
 */
export function pickLead(items: FeedItem[]): FeedItem | null {
  if (items.length === 0) return null;
  const newest = items[0]!;
  const recap = items.filter((i) => i.type === "game" && i.group.week !== null).sort((a, b) => b.group.week! - a.group.week!)[0];
  if (!recap || newest === recap) return newest;
  const laterStatus = items.some((i) => i.type === "status" && i.group.week !== null && i.group.week > recap.group.week!);
  if (laterStatus) return newest;
  const outranks = items.find((i) => i.ms > recap.ms && HIGHER.includes(i.type));
  return outranks ?? recap;
}

/* --------------------------------------------------------- sentence case */

export interface Proper {
  /** Single words kept capitalized: club cities and nicknames, the club's roster surnames. */
  words: Set<string>;
  /** Full player names, lowercased: a first name is kept only inside one. */
  names: Set<string>;
}

const properCache = new Map<string, Proper>();

/**
 * The proper nouns a club headline can carry. Every player's full name, but
 * single surnames only for the club's own roster: a first name like "Chase"
 * or a surname like "Love" is an ordinary word unless it is someone here.
 */
export function properNouns(players: Player[], club: string | null): Proper {
  const key = `${players.length}|${club ?? ""}`;
  const hit = properCache.get(key);
  if (hit) return hit;
  const words = new Set<string>();
  const add = (s: string) => s.split(/[\s.'’-]+/).filter((w) => w.length > 1).forEach((w) => words.add(w.toLowerCase()));
  for (const t of TEAMS) {
    add(t.city);
    add(t.nickname);
  }
  const names = new Set<string>();
  for (const p of players) {
    names.add(p.name.toLowerCase());
    if (club && p.team && p.team.toUpperCase() === club.toUpperCase()) {
      const parts = p.name.split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w));
      if (parts.length > 1) add(parts[parts.length - 1]!);
    }
  }
  ["nfl", "nfc", "afc", "ota", "otas", "super", "bowl", "pro", "monday", "sunday", "thursday", "saturday", "friday", "wednesday", "tuesday", "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december"].forEach((w) => words.add(w));
  const out = { words, names };
  properCache.set(key, out);
  return out;
}

const bare = (w: string): string => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");

/**
 * "Getting Back To My Old Self" → "Getting back to my old self" (spec 4.4:
 * headlines in sentence case). The first word, acronyms, words with inner
 * capitals, full player names and the proper-noun words keep their case; a
 * headline already in sentence case is returned as it came.
 */
export function sentenceCase(title: string, proper: Proper): string {
  const words = title.split(" ");
  const titled = words.filter((w) => /^[A-Z][a-z]/.test(bare(w))).length;
  if (titled < Math.max(3, words.length * 0.6)) return title;
  // Words inside a full player name keep their case.
  const keep = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    for (const n of [3, 2]) {
      const span = words.slice(i, i + n).map(bare).join(" ").toLowerCase().replace(/'s$/, "");
      if (i + n <= words.length && proper.names.has(span)) for (let k = i; k < i + n; k++) keep.add(k);
    }
  }
  let first = true;
  return words
    .map((w, i) => {
      const core = bare(w);
      const isFirst = first && core.length > 0;
      if (core) first = false;
      if (isFirst || !core || keep.has(i)) return w;
      return w
        .split("-")
        .map((part) => {
          const c = bare(part);
          if (!c) return part;
          if (/^[A-Z]{2,}$/.test(c) || /[a-z][A-Z]/.test(c) || c === "I") return part;
          if (proper.words.has(c.toLowerCase().replace(/'s$/, ""))) return part;
          return part.replace(c, c.charAt(0).toLowerCase() + c.slice(1));
        })
        .join("-");
    })
    .join(" ")
    // After a colon or a question, a new sentence starts.
    .replace(/([:?!]\s+["'“‘]?)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** "Jacoby Brissett: Gets in some work" → "Gets in some work". */
export function stripName(title: string, name: string): string {
  const m = /^([^:]{3,40}):\s+(.+)$/.exec(title);
  return m && searchKey(m[1]) === searchKey(name) ? m[2]! : title;
}

/** Matching the archive's player tag, as the player's own news does. */
export const sameName = (a: string | null | undefined, b: string): boolean => searchKey(a) === searchKey(b);
