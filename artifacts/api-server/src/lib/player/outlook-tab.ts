/**
 * The Outlook tab: what to expect going forward, and why.
 *
 * Built to mak's "Build Instructions: StatChasers Player Outlook Tab" of
 * 2026-09-29, then reshaped on 2026-11-05 to the reviewer's brief mak forwarded
 * ("the Outlook tab doesn't yet do enough to explain what should happen next").
 * Five sections, each answering a forward question, plus the FAQ:
 *
 *   1. ROS Outlook        the assessment: role tags, a two-paragraph read built
 *                         on opportunity (xFP) against production, the listed
 *                         quarterback TODAY, the schedule's verdict; what
 *                         supports and what threatens the value; the sidebar
 *                         (Redraft Command, Best fit by league from the ROS board)
 *   2. Opportunity vs.    PPR points against expected points, target / snap /
 *      Production         first-read shares, the last three games' drift
 *   3. What drives his    rank strips: target share, xFP, FPOE, first-read share,
 *      outlook            air-yards share (per position); the advanced row under
 *   4. What could change  catalysts and risks that are CHANGES with evidence -
 *      his value          a quarterback change, a rising or sliding share, the
 *                         gap between expected and actual, a matchup stretch -
 *                         never a generic "could get hurt or benched"
 *   5. Remaining schedule the next four opponents with their rank and band, the
 *                         verdict, and the fantasy-playoff weeks
 *   -  the preseason piece, collapsed, at the bottom (history, not the outlook)
 *   -  the FAQ, answered from the same model as the sections above
 *
 * Rules the brief set, kept here on purpose:
 *   - The quarterback is the depth chart's listed starter (outlook-context.ts),
 *     not whoever threw the most passes so far; when those differ the tab says
 *     so, as a change, everywhere the passer matters.
 *   - The schedule is read once (scheduleRead) and appears as upside OR risk,
 *     never both: more soft matchups than tough is upside, more tough than soft
 *     is risk, a split is neither.
 *   - xFP against actual is the lead opportunity read (mak's wording from the
 *     usage report: a gap "does not guarantee" improvement).
 *   - League-fit chips come from the rest-of-season board when he is on it,
 *     and say what they assume.
 *   - SEO is untouched: the lead heading keeps its words, no title, meta or
 *     JSON-LD here, and the H2 ladder the brief proposed waits for mak.
 */

import { escapeHtml } from "../render";
import { possessive, titleCase } from "./title-case";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { getEntryPoints, SCORING_SHORT } from "./scoring";
import { lastName, matchupBand, teamInk } from "./header";
import { outlookMeasures, tierOf, type AdvancedCell, type DriverRow, type OutlookMeasures, type Tier } from "./outlook-tab-data";
import { sectionHref } from "./sections";
import type { UpcomingGame } from "./upcoming";
import { renderFaqSection, selectFaq, type FaqCandidate } from "./faq-engine";
import { samePerson, type PlayerUsage, type RosRank, type StartingQb, type UsageMetric } from "./outlook-context";
import { baseWords, surname, type Trend } from "../team/usage";

const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

/* ---- icons: the redesign's glyphs (mak's brief, 2026-11-05), inline so no
   icon dependency; every one aria-hidden, the words beside it carry the
   meaning. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  bars: svg(`<path d="M5 20v-6M12 20V9M19 20V4"/>`),
  check: svg(`<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>`),
  alert: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>`),
  calendar: svg(`<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`),
  triangle: svg(`<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>`),
  target: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`),
  crosshair: svg(`<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>`),
  layers: svg(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5"/><path d="M12 13v3.5"/><path d="M8.5 20h7M10 16.5h4v3.5h-4z"/>`),
  eye: svg(`<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>`),
  down: svg(`<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>`),
  up: svg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  steady: svg(`<path d="M4 12h16"/><path d="M15 8l4 4-4 4"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
  football: svg(`<path d="M5.2 18.8c-2.3-2.3-1.4-8.1 2.6-12.1s9.8-4.9 12.1-2.6 1.4 8.1-2.6 12.1-9.8 4.9-12.1 2.6z"/><path d="M9 15l6-6"/>`),
};

const MINUS = "−";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ------------------------------------------------------------------ atoms */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const word = (n: number): string => WORDS[n] ?? String(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const one = (v: number): string => v.toFixed(1).replace(/^-/, MINUS);
const signed = (v: number): string => `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)}`;
const pct = (v: number): string => `${v.toFixed(1)}%`;

function a(href: string, text: string, attrs = ""): string {
  return `<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;
}

function open(id: string, heading: string, lede: string, extra = ""): string {
  return (
    `<section class="scp-ox-sec${extra}" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase(heading))}</h2>` +
    (lede ? `<p class="scp-ox-lede">${escapeHtml(lede)}</p>` : "")
  );
}

/** "2026-06-16" → { iso, text: "June 16, 2026", month: "June 2026" }. */
function dateParts(raw: string | null | undefined): { iso: string; text: string; month: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, text: `${month} ${Number(m[3])}, ${m[1]}`, month: `${month} ${m[1]}` };
}

/** "November 4", in Eastern time, for the as-of line. */
function easternDay(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" }).format(new Date(ms));
}

const NOUN: Record<string, string> = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end" };
const noun = (pos: string): string => NOUN[pos] ?? pos;

function listWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------ model */

export type Chip = { label: string; kind: "good" | "mid" | "bad" };

const STARTER: Chip = { label: "Weekly starter", kind: "good" };
const STREAM: Chip = { label: "Streamer", kind: "mid" };
const FLEX: Chip = { label: "Flex play", kind: "mid" };
const MATCHUP: Chip = { label: "Matchup play", kind: "mid" };
const STASH: Chip = { label: "Bench stash", kind: "mid" };
const WAIVER: Chip = { label: "Waiver wire", kind: "bad" };

const LEAGUES: Record<string, [string, string, string]> = {
  QB: ["Superflex / 2QB", "1QB, 12+ teams", "1QB, 10 teams"],
  RB: ["12-team PPR", "10-team PPR", "Half-PPR"],
  WR: ["12-team PPR", "10-team PPR", "Half-PPR"],
  TE: ["TE-premium", "12-team", "10-team"],
};

/** The spec's cutoff table (2026-09-29): his rank to a chip per league row. */
export function leagueChips(pos: string, rank: number): [Chip, Chip, Chip] {
  if (pos === "QB") {
    if (rank <= 12) return [STARTER, STARTER, STARTER];
    if (rank <= 20) return [STARTER, STREAM, STREAM];
    if (rank <= 28) return [STARTER, STREAM, WAIVER];
    if (rank <= 36) return [STREAM, WAIVER, WAIVER];
    return [STASH, WAIVER, WAIVER];
  }
  if (pos === "TE") {
    if (rank <= 12) return [STARTER, STARTER, STARTER];
    if (rank <= 18) return [STARTER, MATCHUP, MATCHUP];
    if (rank <= 24) return [MATCHUP, STASH, WAIVER];
    return [STASH, WAIVER, WAIVER];
  }
  if (rank <= 24) return [STARTER, STARTER, STARTER];
  if (rank <= 36) return [FLEX, FLEX, FLEX];
  if (rank <= 48) return [STASH, WAIVER, STASH];
  return [WAIVER, WAIVER, WAIVER];
}

/**
 * Lineup-aware chips for the two flex positions (the brief, 2026-11-05): a
 * 12-team league starts three receivers and a flex, a 10-team league two and
 * a flex, so the same rank is a starter in one and a flex in the other. The
 * assumptions are printed under the chips. Quarterbacks and tight ends keep
 * the spec's table, which already splits by league shape.
 */
export function fitChips(pos: string, rank: number): [Chip, Chip, Chip] {
  if (pos === "QB" || pos === "TE") return leagueChips(pos, rank);
  const ladder = (starter: number, flex: number, stash: number): Chip =>
    rank <= starter ? STARTER : rank <= flex ? FLEX : rank <= stash ? STASH : WAIVER;
  if (pos === "RB") return [ladder(20, 30, 45), ladder(16, 26, 40), ladder(20, 30, 45)];
  return [ladder(30, 42, 60), ladder(20, 32, 48), ladder(30, 42, 60)];
}

const FIT_ASSUMES: Record<string, string> = {
  RB: "Assumes two backs and a flex in a 12-team league, two and a flex in a 10-team league; half-PPR reads the same rank.",
  WR: "Assumes three receivers and a flex in a 12-team league, two and a flex in a 10-team league; half-PPR reads the same rank.",
  QB: "Assumes one starting quarterback per lineup in 1QB leagues, two in superflex.",
  TE: "Assumes one starting tight end per lineup.",
};

interface SeasonLine {
  season: number;
  gp: number;
  points: number;
  ppg: number;
  rank: number | null;
}

interface ScheduleRead {
  /** The next four fixtures that carry a matchup rank. */
  next: UpcomingGame[];
  soft: UpcomingGame[];
  tough: UpcomingGame[];
  /** More soft than tough is an upside, more tough than soft a risk, a split neither. */
  verdict: "soft" | "tough" | "mixed" | "none";
  /** Weeks 15 to 17, the usual fantasy playoffs, with a matchup rank. */
  playoffs: UpcomingGame[];
}

interface Model {
  name: string;
  last: string;
  pos: string;
  slug: string;
  rc: string;
  season: number;
  week: number;
  preseason: boolean;
  now: SeasonLine | null;
  prior: SeasonLine | null;
  /** The rank everything is judged on: this season's, or last season's before Week 1. */
  rank: number | null;
  projected: number | null;
  measures: OutlookMeasures | null;
  chips: [Chip, Chip, Chip] | null;
  /** Where the chips' rank came from. */
  fit: { rank: number; source: "ros" | "season" } | null;
  ros: RosRank | null;
  injured: string | null;
  /** A Questionable / Doubtful tag, when the designation is short of out. */
  questionable: string | null;
  upcoming: UpcomingGame[];
  sched: ScheduleRead;
  scoring: string;
  usage: PlayerUsage | null;
  qb: StartingQb | null;
  /** The season's leading passer, when the listed starter is someone else. */
  qbChange: { from: string; to: StartingQb } | null;
  nickname: string | null;
  teamSlug: string | null;
  /** "November 4": the stats' refresh day, for the as-of line. */
  updated: string | null;
}

/** The rank the header prints for this season. */
function currentRank(data: PlayerPageData): number | null {
  const row = data.production?.find((r) => r.season === data.season);
  return row?.posFinishPpg ?? data.seasonRank ?? row?.posFinishTotal ?? data.seasonRankTotal ?? null;
}

function seasonLine(data: PlayerPageData, season: number, rank: number | null): SeasonLine | null {
  const log = (data.logCareer ?? []).find((s) => s.season === season);
  if (!log || log.weeks.length === 0) return null;
  const points = log.weeks.reduce((sum, e) => sum + getEntryPoints(e.stats, data.format), 0);
  const gp = log.weeks.length;
  return { season, gp, points, ppg: points / gp, rank: rank ?? log.finish };
}

/**
 * The preseason projection, from the published record: its authored range when
 * it has one, otherwise the rank its own text names ("around the QB30 range").
 */
export function projectedRank(data: PlayerPageData): number | null {
  const record = data.fantasyOutlook2026;
  const band = record?.range?.expected;
  if (band && Number.isFinite(band.best) && Number.isFinite(band.worst)) {
    return Math.round((band.best + band.worst) / 2);
  }
  const pos = data.player.position ?? "";
  const m = new RegExp(`\\b${pos}(\\d{1,2}) range\\b`).exec(record?.body ?? "");
  return m ? Number(m[1]) : null;
}

function scheduleRead(upcoming: UpcomingGame[], season: UpcomingGame[]): ScheduleRead {
  const next = upcoming.filter((g) => g.matchup).slice(0, 4);
  const soft = next.filter((g) => matchupBand(g.matchup!.rank) === "soft");
  const tough = next.filter((g) => matchupBand(g.matchup!.rank) === "tough");
  const verdict: ScheduleRead["verdict"] =
    next.length === 0 ? "none" : tough.length >= 2 && tough.length > soft.length ? "tough" : soft.length >= 2 && soft.length > tough.length ? "soft" : "mixed";
  const playoffs = season.filter((g) => g.matchup && g.week >= 15 && g.week <= 17);
  return { next, soft, tough, verdict, playoffs };
}

function model(data: PlayerPageData): Model | null {
  const pos = data.player.position ?? "";
  if (!LEAGUES[pos]) return null;
  const season = data.leagueSeason ?? data.season;
  const week = data.leagueWeek ?? 0;
  const now = seasonLine(data, season, currentRank(data));
  const prior = seasonLine(data, season - 1, null);
  const preseason = week < 1 || !now;
  const rank = preseason ? prior?.rank ?? null : now?.rank ?? null;
  const status = (data.designation?.injuryStatus ?? data.player.injury_status ?? "").trim();
  const out = /^(out|ir|pup|injured reserve|doubtful)/i.test(status);
  const questionable = !out && /^questionable/i.test(status) ? "Questionable" : null;
  const part = data.designation?.injuryBodyPart ?? null;

  // The chips judge the rest-of-season board's rank when he is on it (the
  // brief: "connect league-fit labels to actual rankings"), else the
  // season-to-date rank the page already prints.
  const ros = preseason ? null : data.rosRank ?? null;
  const fit = ros ? { rank: ros.rank, source: "ros" as const } : rank === null ? null : { rank, source: "season" as const };
  let chips = fit ? fitChips(pos, fit.rank) : null;
  if (chips && out) {
    // Injured: a spot on the bench or nothing, never a start.
    chips = chips.map((c) => (c.kind === "bad" ? WAIVER : STASH)) as [Chip, Chip, Chip];
  }

  const qb = data.startingQb ?? null;
  const passer = pos !== "QB" ? (data.teammates ?? [])[0] ?? null : null;
  const qbChange = qb && passer && !samePerson(passer.name, qb.name) ? { from: passer.name, to: qb } : null;
  const upcoming = (data.upcoming ?? []).slice(0, 4);

  return {
    name: data.player.name,
    last: lastName(data.player.name),
    pos,
    slug: data.player.slug,
    rc: `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`,
    season,
    week,
    preseason,
    now,
    prior,
    rank,
    projected: projectedRank(data),
    // The current season's line when he has one (mak, 2026-10-22), else last
    // season's from the outlook record.
    measures: outlookMeasures(data.fantasyOutlook2026, {
      season: week >= 1 ? season : undefined,
      playerId: data.player.id ?? null,
      position: pos,
    }),
    chips,
    fit,
    ros,
    injured: out ? `${cap(status.toLowerCase() === "ir" ? "on injured reserve" : status.toLowerCase())}${part ? `, ${part.toLowerCase()}` : ""}` : null,
    questionable: questionable ? `${questionable}${part ? ` (${part.toLowerCase()})` : ""}` : null,
    upcoming,
    sched: scheduleRead(upcoming, data.upcomingSeason ?? []),
    scoring: SCORING_SHORT[data.format] ?? "PPR",
    usage: preseason ? null : data.usage ?? null,
    qb,
    qbChange,
    nickname: data.team?.nickname ?? null,
    teamSlug: data.team?.slug ?? null,
    updated: data.statsUpdatedMs ? easternDay(data.statsUpdatedMs) : null,
  };
}

/** "a weekly starter in superflex and 2QB leagues and a streamer in 1QB leagues", for the Overview FAQ. */
export function leagueFit(data: PlayerPageData): string | null {
  const m = model(data);
  return m && m.chips ? fitSentence(m) : null;
}

/**
 * "QB2, streamer": the tier and the 12-team league's call in a few words, for
 * the News tab's quick answers. Null when the tab itself would have no tier.
 */
export function outlookShort(data: PlayerPageData): string | null {
  const m = model(data);
  if (!m || m.rank === null || !m.chips) return null;
  return `${bucket(m.pos, m.rank)}, ${m.chips[1].label.toLowerCase()}`;
}

/**
 * The News sidebar's snapshot (mak, 2026-10-05): the season tier ("QB2") and
 * the 1QB/12-team call ("Streamer"), the same two words outlookShort joins.
 */
export function outlookSnapshot(data: PlayerPageData): { tier: string; call: string } | null {
  const m = model(data);
  if (!m || m.rank === null || !m.chips) return null;
  return { tier: bucket(m.pos, m.rank), call: m.chips[1].label };
}

/** "QB2": the fantasy tier a rank sits in. */
function bucket(pos: string, rank: number): string {
  const size = 12;
  const tier = Math.floor((rank - 1) / size) + 1;
  if (pos === "TE" && tier > 2) return "depth TE";
  if (tier > 4) return `depth ${pos}`;
  return `${pos}${tier}`;
}

const ADJECTIVE: Record<string, string> = {
  "Passing volume": "Volume-driven",
  Efficiency: "Efficient",
  Rushing: "Dual-threat",
  "Rushing volume": "Workhorse",
  "Receiving role": "Pass-catching",
  "Target share": "Target-heavy",
  "Downfield role": "Downfield",
  "Route participation": "Every-down",
  "Expected points": "High-opportunity",
  "First-read share": "First-read",
};

const PHRASE: Record<string, string> = {
  "Weekly starter": "every week",
  Streamer: "with streaming weeks",
  "Flex play": "with flex weeks",
  "Matchup play": "with matchup weeks",
  "Bench stash": "worth a bench spot",
  "Waiver wire": "for deep leagues only",
};

/** The rows the drivers section shows, ranked; FPOE is left out of "top" and "weak". */
function rankedDrivers(m: Model): DriverRow[] {
  return driverRows(m).filter((d) => d.rank !== null && d.label !== "Points over expected");
}

function topDriver(m: Model): DriverRow | null {
  return [...rankedDrivers(m)].sort((x, y) => x.rank! / x.of - y.rank! / y.of)[0] ?? null;
}

function weakDriver(m: Model): DriverRow | null {
  const worst = [...rankedDrivers(m)].sort((x, y) => y.rank! / y.of - x.rank! / x.of)[0] ?? null;
  return worst && worst.tier !== "good" ? worst : null;
}

/** The template tier line: "{Role adjective} {POS}{tier} {strength}", 4–8 words, no period. */
export function tierLine(m: Model): string | null {
  if (m.rank === null || !m.chips) return null;
  const top = topDriver(m);
  const adj = top && top.tier === "good" ? ADJECTIVE[top.label] ?? null : null;
  const phrase = PHRASE[m.chips[1].label] ?? "";
  if (m.injured) return `${adj ? `${adj} ` : ""}${bucket(m.pos, m.rank)} on the sideline for now`;
  return [adj, bucket(m.pos, m.rank), phrase].filter(Boolean).join(" ");
}

/** The league rows as a sentence names them. */
const PROSE_LEAGUES: Record<string, [string, string, string]> = {
  QB: ["superflex and 2QB", "12-team 1QB", "10-team 1QB"],
  RB: ["12-team PPR", "10-team PPR", "half-PPR"],
  WR: ["12-team PPR", "10-team PPR", "half-PPR"],
  TE: ["TE-premium", "12-team", "10-team"],
};

/** Rows that share a chip, merged: [[chip, "12-team 1QB and 10-team 1QB"]]. */
function fitGroups(m: Model): Array<[Chip, string]> {
  if (!m.chips) return [];
  const names = PROSE_LEAGUES[m.pos]!;
  const groups: Array<[Chip, string[]]> = [];
  m.chips.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last && last[0].label === c.label) last[1].push(names[i]!);
    else groups.push([c, [names[i]!]]);
  });
  return groups.map(([c, n]) => [
    c,
    m.pos === "QB" && n.length === 2 && n.every((x) => x.endsWith("1QB")) ? "1QB" : listWords(n),
  ]);
}

/** "he's a weekly starter in superflex and 2QB leagues and a streamer in 1QB leagues". */
function fitSentence(m: Model): string {
  return listWords(fitGroups(m).map(([c, where]) => `${chipPhrase(c)} in ${where} leagues`));
}

/** The chip as a noun phrase: "a streamer", "waiver-wire material". */
function chipPhrase(c: Chip): string {
  return c.label === "Waiver wire" ? "waiver-wire material" : `a ${c.label.toLowerCase()}`;
}

function oppName(g: UpcomingGame): string {
  return g.opponent?.nickname ?? g.opponentName;
}

function matchupList(games: UpcomingGame[]): string {
  return listWords(games.slice(0, 2).map((g) => `the ${oppName(g)} in Week ${g.week}`));
}

/* ------------------------------------------------------------ usage reads */

const u = (m: Model): PlayerUsage["row"] | null => m.usage?.row ?? null;
const n = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** "10th of 96" for a usage metric, or null when he is not ranked on it. */
function uRank(m: Model, metric: UsageMetric): { rank: number; of: number } | null {
  return m.usage?.ranks[metric] ?? null;
}

function rankWords(r: { rank: number; of: number } | null, pos: string): string {
  return r ? `${ordinal(r.rank)} of ${r.of} ${pos}s` : "";
}

/** The gap between production and expected, in the usage report's three bands. */
function fpoeBand(m: Model): "under" | "over" | "near" | null {
  const row = u(m);
  if (!row || !n(row.fpoePerGame) || !n(row.xfpPerGame)) return null;
  return row.fpoePerGame <= -1.5 ? "under" : row.fpoePerGame >= 1.5 ? "over" : "near";
}

/** The usage report's buy-low rule, by the points: volume the box score has not paid. */
function unpaid(m: Model): boolean {
  const row = u(m);
  return Boolean(row && n(row.fpoePerGame) && n(row.xfpPerGame) && row.fpoePerGame <= -2 && row.xfpPerGame >= 9);
}

function mean3(t: Trend): number | null {
  const known = t.trail.filter((v): v is number => v !== null);
  return known.length ? known.reduce((s, v) => s + v, 0) / known.length : null;
}

/** The role in a tag: "High-volume starter", "Lead back", "QB1 range" - or his spot on the chart when he is not the starter. */
function roleTag(m: Model, depth: PlayerPageData["depth"] = null): Chip | null {
  if (depth && depth.order > 1) return { label: `${depth.position}${depth.order} on the depth chart`, kind: "bad" };
  const row = u(m);
  if (row) {
    if (m.pos === "WR") {
      const ts = row.targetShare ?? 0;
      if (ts >= 20) return { label: "High-volume starter", kind: "good" };
      if (ts >= 17) return { label: "Starter-level role", kind: "good" };
      if (ts >= 15) return { label: "Flex-range role", kind: "mid" };
      return { label: "Secondary role", kind: "mid" };
    }
    if (m.pos === "TE") {
      const ts = row.targetShare ?? 0;
      if (ts >= 17) return { label: "High-volume TE1", kind: "good" };
      if (ts >= 12) return { label: "Starting TE role", kind: "good" };
      return { label: "Secondary role", kind: "mid" };
    }
    if (m.pos === "RB") {
      const share = row.woppShare ?? 0;
      if (share >= 65) return { label: "Workhorse back", kind: "good" };
      if (share >= 50) return { label: "Lead back", kind: "good" };
      if (share >= 35) return { label: "Committee back", kind: "mid" };
      return { label: "Change-of-pace role", kind: "mid" };
    }
    const r = uRank(m, "xfpPerGame");
    if (r) {
      if (r.rank <= 8) return { label: "Top-8 opportunity QB", kind: "good" };
      if (r.rank <= 16) return { label: "QB1-range opportunity", kind: "good" };
      return { label: "Streaming-range QB", kind: "mid" };
    }
  }
  if (m.rank !== null && m.chips) return { label: `${bucket(m.pos, m.rank)}, ${m.chips[1].label.toLowerCase()}`, kind: m.chips[1].kind };
  return null;
}

/** The hero's tags: role, the expected-points gap, a quarterback change, the schedule, a designation. */
function tags(m: Model, depth: PlayerPageData["depth"]): Chip[] {
  const out: Chip[] = [];
  const role = roleTag(m, depth);
  if (role) out.push(role);
  if (m.injured) out.push({ label: m.injured.split(",")[0]!, kind: "bad" });
  else if (m.questionable) out.push({ label: "Questionable", kind: "mid" });
  if (m.qbChange) out.push({ label: "QB change", kind: "mid" });
  if (m.sched.verdict === "tough") out.push({ label: "Tough upcoming schedule", kind: "bad" });
  else if (m.sched.verdict === "soft") out.push({ label: "Soft upcoming schedule", kind: "good" });
  const band = fpoeBand(m);
  const row = u(m);
  if (band === "under" && row && row.fpoePerGame! <= -2) out.push({ label: "Scoring under expected", kind: "mid" });
  else if (band === "over" && row && row.fpoePerGame! >= 2) out.push({ label: "Scoring over expected", kind: "mid" });
  return out.slice(0, 5);
}

/* ------------------------------------------------------ section 1: the take */

// In season the hero, the read and its sidebar are the premium block
// (outlook-projection-premium.ts, printed by the page right after this body)
// since 2026-11-05, when mak approved it and had the originals removed.

/**
 * The Best fit panel: the league-by-league call, judged on the ROS board's
 * rank when he is on it, with the lineup assumptions written under it.
 */
/** The Best fit panel's facts: the league rows, their chips, and the assumptions line. */
export interface FitsModel {
  leagues: [string, string, string];
  chips: [Chip, Chip, Chip];
  note: string;
}

function fitsModel(m: Model): FitsModel | null {
  if (!m.chips || !m.fit) return null;
  const leagues = LEAGUES[m.pos]!;
  const basis =
    m.fit.source === "ros" && m.ros
      ? `Based on his StatChasers rest-of-season rank, ${m.pos}${m.ros.rank}${m.ros.updatedAt ? ` (updated ${m.ros.updatedAt.replace(/, \d{4}$/, "")})` : ""}.`
      : `Based on his ${m.scoring} points-per-game rank this season, ${m.pos}${m.fit.rank}.`;
  return { leagues, chips: m.chips, note: `${basis} ${FIT_ASSUMES[m.pos] ?? ""}`.trim() };
}

function renderFits(m: Model): string {
  const fm = fitsModel(m);
  if (!fm) return "";
  return (
    `<div class="scp-ox-panel scp-ol-fitwrap"><h3><span class="scp-ol-panel-icon" aria-hidden="true">${ICON.layers}</span>Best fit</h3>` +
    `<div class="scp-ol-fits" role="list" aria-label="Best fit by league type">` +
    fm.chips
      .map(
        (chip, i) =>
          `<div class="scp-ol-fit" role="listitem"><span>${escapeHtml(fm.leagues[i]!)}</span>` +
          `<span class="scp-ol-chip is-${chip.kind}">${escapeHtml(chip.label)}</span></div>`,
      )
      .join("") +
    `</div>` +
    `<p class="scp-ol-fitnote">${escapeHtml(fm.note)}</p>` +
    `</div>`
  );
}

/** The Redraft Command card's sentence, the same on the tab and in the premium block. */
function rcCopy(m: Model): string {
  return `This outlook explains the why. Redraft Command gives you the number: ${possessive(m.last)} rest-of-season rank and trade value for your league's scoring, updated after every game.`;
}

/** What the supports / threatens cells say when the data gives them nothing. */
function emptyWords(m: Model, data: PlayerPageData): { supports: string; threatens: string } {
  return {
    supports:
      data.depth && data.depth.order > 1 && !m.injured
        ? "His season-to-date usage was a starter's, but the depth chart no longer lists him first."
        : "Nothing in the usage data stands out yet.",
    threatens: "No material threat in the data right now: his role, his quarterback and his next four matchups are steady.",
  };
}

/* ---------------------------------------------- section 1: the written read */

/**
 * The featured panel's one-line takeaway over the read: the role tag's
 * words and where production stands against expectation, both already
 * judged by the model (roleTag, fpoeBand). Nothing new is claimed.
 */
function featHeadline(m: Model, depth: PlayerPageData["depth"]): string {
  const role = roleTag(m, depth);
  const band = fpoeBand(m);
  // "High-volume starter" reads as a role word here; the other tags already do.
  const lead = role
    ? role.label
        .toLowerCase()
        .replace(/^high-volume starter$/, "high-volume role")
        // Position words stay as they are written ("Top-8 opportunity QB").
        .replace(/\b(qb|rb|wr|te)(\d?)\b/g, (_, p: string, d: string) => `${p.toUpperCase()}${d}`)
    : "";
  const prod =
    band === "under"
      ? "production below expectation"
      : band === "over"
        ? "production ahead of expectation"
        : band === "near"
          ? "production in line with expectation"
          : "";
  const parts = [lead, prod].filter(Boolean);
  return parts.length ? `${cap(parts.join(", "))}.` : "";
}

/** The opportunity sentence: shares and ranks, then expected against actual. */
function opportunityParagraph(m: Model): string | null {
  const row = u(m);
  if (!row) return null;
  const parts: string[] = [];
  const pos = m.pos;
  if (pos === "WR" || pos === "TE") {
    const ts = uRank(m, "targetShare");
    const ays = uRank(m, "airYardsShare");
    const fr = uRank(m, "firstReadShare");
    if (n(row.targetShare)) {
      parts.push(
        `${possessive(m.last)} ${pct(row.targetShare)} target share${ts ? ` ranks ${ordinal(ts.rank)} among ${ts.of} qualifying ${noun(pos)}s` : " leads his role"}` +
          (n(row.airYardsShare) && ays ? `, and his ${pct(row.airYardsShare)} air-yards share ${ordinal(ays.rank)}` : "") +
          `.`,
      );
    }
    if (n(row.firstReadShare) && fr) {
      parts.push(`He is the first read on ${pct(row.firstReadShare)} of his quarterback's dropbacks (${ordinal(fr.rank)} of ${fr.of}), so the targets are designed, not incidental.`);
    }
  } else if (pos === "RB") {
    const w = uRank(m, "woppPerGame");
    if (n(row.woppShare) && n(row.woppPerGame)) {
      parts.push(
        `${m.last} handles ${pct(row.woppShare)} of the ${m.nickname ?? "team"} backfield's weighted opportunities, ${one(row.woppPerGame)} a game${w ? ` (${ordinal(w.rank)} of ${w.of} qualifying backs)` : ""}.`,
      );
    }
    if (row.rzTouches > 0) parts.push(`${m.usage!.leadsRz ? (m.usage!.rzCoLead ? "He co-leads" : "He leads") : "He has"} ${m.usage!.leadsRz ? "the club with" : ""} ${row.rzTouches} red-zone touches.`.replace(/\s+/g, " "));
  } else {
    const x = uRank(m, "xfpPerGame");
    if (n(row.xfpPerGame)) parts.push(`${m.last} earns ${one(row.xfpPerGame)} expected PPR points a game${x ? `, ${ordinal(x.rank)} of ${x.of} qualifying quarterbacks` : ""}.`);
    if (n(row.designedRunRate) && row.designedRunRate >= 8) parts.push(`A ${row.designedRunRate}% designed-run rate adds a rushing floor.`);
  }
  const band = fpoeBand(m);
  if (band && n(row.fpPerGame) && n(row.xfpPerGame)) {
    parts.push(
      band === "under"
        ? `He is earning high-value opportunities but averaging just ${one(row.fpPerGame)} PPR points against ${one(row.xfpPerGame)} expected.`
        : band === "over"
          ? `He is averaging ${one(row.fpPerGame)} PPR points against ${one(row.xfpPerGame)} expected, efficiency that may not repeat.`
          : `His ${one(row.fpPerGame)} PPR points a game sit right at the ${one(row.xfpPerGame)} expected, so this is volume, not a hot streak.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}

/** The forward sentence(s): the quarterback, the schedule, and what makes the read less sure. */
function forwardParagraph(m: Model, depth: PlayerPageData["depth"]): string | null {
  const parts: string[] = [];
  const unsure: Array<{ text: string; plural: boolean }> = [];
  if (m.qbChange) {
    const to = m.qbChange.to;
    const attempts = to.attempts > 0 ? `, and ${surname(to.name)} has ${to.attempts} attempts so far` : "";
    parts.push(
      `${to.name} is now the ${m.nickname ? `${m.nickname}' ` : ""}listed starting quarterback; ${m.qbChange.from} threw most of the passes through Week ${m.week}${attempts}. That introduces uncertainty around how the targets are distributed.`,
    );
    unsure.push({ text: "a new quarterback", plural: false });
  } else if (m.qb && m.pos !== "QB") {
    parts.push(`${m.qb.name} is his quarterback.`);
  }
  const s = m.sched;
  const withRank = (g: UpcomingGame): string => `the ${oppName(g)} in Week ${g.week} (${ordinal(g.matchup!.rank)})`;
  if (s.verdict === "tough") {
    parts.push(`${cap(word(s.tough.length))} of his next ${word(s.next.length)} opponents ${s.tough.length === 1 ? "is" : "are"} among the stingiest defenses against ${m.pos}s: ${listWords(s.tough.map(withRank))}.`);
    unsure.push({ text: "difficult upcoming matchups", plural: true });
  } else if (s.verdict === "soft") {
    parts.push(`${cap(word(s.soft.length))} of his next ${word(s.next.length)} opponents ${s.soft.length === 1 ? "is a top-10 matchup" : "are top-10 matchups"} for ${m.pos}s: ${listWords(s.soft.map(withRank))}.`);
  } else if (s.verdict === "mixed" && (s.soft.length || s.tough.length)) {
    parts.push(
      `His next ${word(s.next.length)} matchups are mixed${s.soft.length ? `: ${listWords(s.soft.map(withRank))} ${s.soft.length === 1 ? "is a top-10 matchup" : "are top-10 matchups"} for ${m.pos}s` : ""}${
        s.tough.length ? `${s.soft.length ? ", while" : ":"} ${listWords(s.tough.map(withRank))} ${s.tough.length === 1 ? "is" : "are"} among the stingiest` : ""
      }.`,
    );
  }
  if (m.usage?.ts.confirmed && (m.usage.ts.delta ?? 0) <= -3) unsure.push({ text: "a sliding target share", plural: false });
  if (m.injured) unsure.unshift({ text: `his ${m.injured.toLowerCase()} status`, plural: false });
  const plural = unsure.length > 1 || unsure.some((x) => x.plural);
  const role = roleTag(m, depth);
  if (depth && depth.order > 1 && !m.injured) {
    parts.push(
      `He is ${depth.position}${depth.order} on the depth chart, so his value depends on the players ahead of him${unsure.length ? `, and ${listWords(unsure.map((x) => x.text))} make${plural ? "" : "s"} even that less predictable` : ""}.`,
    );
    return parts.join(" ");
  }
  const roleWords = role && role.kind === "good" ? "His established role supports his fantasy value" : "His role is what his fantasy value rides on";
  if (unsure.length) parts.push(`${roleWords}, but ${listWords(unsure.map((x) => x.text))} make${plural ? "" : "s"} his near-term production less predictable.`);
  else if (parts.length) parts.push(`${roleWords}, and nothing in the schedule or the depth chart changes the read right now.`);
  return parts.length ? parts.join(" ") : null;
}

/** The read's paragraphs, in season. */
function paragraphs(m: Model, data: PlayerPageData): string[] {
  const out: string[] = [];
  const opp = opportunityParagraph(m);
  if (opp) out.push(opp);
  else {
    // No usage row: the season line and the drivers, as before.
    const top = topDriver(m);
    const weak = weakDriver(m);
    if (m.now) {
      let p = m.projected ? `We projected ${m.last} in the ${m.pos}${m.projected} range this summer. ` : "";
      p += `Through ${m.now.gp} game${m.now.gp === 1 ? "" : "s"} he's ${m.pos}${m.now.rank ?? "-"} at ${one(m.now.ppg)} ${m.scoring} points per game`;
      if (m.prior) {
        p += `, against ${one(m.prior.ppg)} over ${m.prior.gp} games last season${m.prior.rank ? ` (${m.pos}${m.prior.rank})` : ""}.`;
        const diff = m.now.ppg - m.prior.ppg;
        p += Math.abs(diff) <= 1 ? " The role is producing the same fantasy output two years running." : diff > 0 ? " He's running ahead of last season's pace." : " He's running behind last season's pace.";
      } else p += ".";
      out.push(p);
    }
    const drivers = rankedDrivers(m);
    if (drivers.length) {
      const ms = m.measures!;
      let p =
        `${ms.season === m.season && ms.week !== null ? `Through Week ${ms.week} he ranks ` : `Last season he ranked `}` +
        listWords(drivers.map((d) => `${ordinal(d.rank!)} of ${d.of} in ${d.label.toLowerCase()} (${d.unit === d.label.toLowerCase() ? d.value : `${d.value} ${d.unit}`})`)) +
        `.`;
      if (top && top.tier === "good") p += ` His points come from his ${top.label.toLowerCase()}.`;
      if (weak) p += ` ${cap(weak.label.toLowerCase())} is the soft spot.`;
      const mates = data.teammates ?? [];
      if (m.pos === "QB" && mates.length >= 2) p += ` ${mates[0]!.name} and ${mates[1]!.name} are his top two targets.`;
      out.push(p);
    }
  }
  const fwd = forwardParagraph(m, data.depth);
  if (fwd) out.push(fwd);
  if (m.injured) {
    out.push(`He's ${m.injured.toLowerCase()}. Until he's back, his value is a bench spot at most${data.depth?.next ? `, and ${data.depth.next.name} takes his snaps` : ""}.`);
  }
  return out;
}

/** What supports and what threatens the value, as short phrases. */
function supportsThreatens(m: Model, data: PlayerPageData): { supports: string[]; threatens: string[] } {
  const supports: string[] = [];
  const threatens: string[] = [];
  const row = u(m);
  const usage = m.usage;
  // A player the chart no longer lists first is not supported by the usage he
  // had as the starter; the depth chart is the read.
  const benched = Boolean(data.depth && data.depth.order > 1 && !m.injured);
  if (row && !benched) {
    if (m.pos === "WR" || m.pos === "TE") {
      const ts = uRank(m, "targetShare");
      if (n(row.targetShare) && row.targetShare >= 17) supports.push(`heavy target volume (${pct(row.targetShare)}${ts ? `, ${ordinal(ts.rank)} of ${ts.of}` : ""})`);
      const fr = uRank(m, "firstReadShare");
      if (n(row.firstReadShare) && fr && fr.rank <= Math.ceil(fr.of / 3)) supports.push(`strong first-read involvement (${pct(row.firstReadShare)})`);
      const ays = uRank(m, "airYardsShare");
      if (n(row.airYardsShare) && ays && ays.rank <= Math.ceil(ays.of / 3)) supports.push(`substantial downfield opportunity (${pct(row.airYardsShare)} air-yards share)`);
    } else if (m.pos === "RB") {
      if (n(row.woppShare) && row.woppShare >= 50) supports.push(`a lead role (${pct(row.woppShare)} of the backfield's weighted opportunities)`);
      if (n(row.targetShare) && row.targetShare >= 10) supports.push(`a receiving role (${pct(row.targetShare)} target share)`);
    } else {
      const x = uRank(m, "xfpPerGame");
      if (x && x.rank <= 12) supports.push(`top-12 opportunity (${one(row.xfpPerGame!)} expected points a game)`);
      if (n(row.designedRunRate) && row.designedRunRate >= 8) supports.push(`a designed-run role (${row.designedRunRate}%)`);
    }
    if (usage?.leadsRz && row.rzTouches >= 5) supports.push(`${usage.rzCoLead ? "a share of the" : "the"} red-zone lead (${row.rzTouches} touches)`);
    if (usage?.ts.confirmed && (usage.ts.delta ?? 0) >= 3) supports.push(`a rising target share (up ${one(usage.ts.delta!)} points over his last three games)`);
    if (unpaid(m)) supports.push(`room for the points to catch his opportunity (${one(row.xfpPerGame!)} expected against ${one(row.fpPerGame!)} scored)`);
  }
  if (!supports.length && !benched) {
    const top = topDriver(m);
    if (top && top.tier === "good") supports.push(`${top.label.toLowerCase()} (${top.value} ${top.unit}, ${ordinal(top.rank!)} of ${top.of})`);
  }

  if (m.injured) threatens.push(`his ${m.injured.toLowerCase()} status`);
  else if (m.questionable) threatens.push(`a ${m.questionable.toLowerCase()} designation this week`);
  if (m.sched.verdict === "tough") threatens.push(`${word(m.sched.tough.length)} difficult matchups in his next ${word(m.sched.next.length)}`);
  else if (m.sched.tough.length > m.sched.soft.length) threatens.push(`a tough matchup against the ${oppName(m.sched.tough[0]!)} in Week ${m.sched.tough[0]!.week}`);
  if (m.qbChange) threatens.push(`uncertainty over how targets are distributed with ${surname(m.qbChange.to.name)} starting`);
  if (usage?.ts.confirmed && (usage.ts.delta ?? 0) <= -3) threatens.push(`a target share down ${one(Math.abs(usage.ts.delta!))} points over his last three games`);
  if (usage?.snap.confirmed && (usage.snap.delta ?? 0) <= -10) threatens.push(`a snap share down ${Math.round(Math.abs(usage.snap.delta!))} points over his last three games`);
  if (fpoeBand(m) === "over" && row && row.fpoePerGame! >= 2) threatens.push(`production ${signed(row.fpoePerGame!)} a game over his opportunity, which may not repeat`);
  if (data.depth && data.depth.order > 1 && !m.injured) threatens.push(`a ${data.depth.position}${data.depth.order} spot on the depth chart`);
  if (usage && usage.aheadOfHim.length >= 2) threatens.push(`${listWords(usage.aheadOfHim.slice(0, 2))} ahead of him in target share`);
  const weak = weakDriver(m);
  if (weak && weak.tier === "bad" && threatens.length < 3) threatens.push(`${weak.label.toLowerCase()} in the bottom third (${weak.value} ${weak.unit})`);
  return { supports: supports.slice(0, 3), threatens: threatens.slice(0, 3) };
}

/**
 * The preseason piece: the staff's outlook under its byline, with the
 * Redraft Command panel and the Best fit panel beside it. In season the
 * projection is the premium block (outlook-projection-premium.ts), which
 * prints from outlookProjectionModel() below.
 */
function renderRead(m: Model, data: PlayerPageData): string {
  if (!m.preseason) return "";
  const record = data.fantasyOutlook2026;
  const preseasonParas = (record?.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (preseasonParas.length === 0) return "";
  const published = dateParts((record as unknown as { generatedAt?: string } | null)?.generatedAt);
  const prose = preseasonParas.map((p) => escapeHtml(p));
  const byline = `By the StatChasers staff.${published ? ` Published <time datetime="${published.iso}">${published.text}</time>.` : ""}`;

  const rc =
    `<div class="scp-ox-panel is-rc"><h3><span class="scp-ol-panel-icon" aria-hidden="true">${ICON.crosshair}</span>Redraft Command</h3>` +
    `<p>${escapeHtml(rcCopy(m))}</p>` +
    `<a class="scp-ox-btn" href="${escapeHtml(m.rc)}" data-cta="redraft-command-outlook-sidebar">${escapeHtml(`Open ${m.last} in Redraft Command`)}<span class="scp-ol-btn-arrow" aria-hidden="true">${ICON.arrow}</span></a>` +
    `</div>`;
  const fits = renderFits(m);

  return (
    open("scp-ol-read-h", `Our ${m.season} preseason outlook`, "") +
    `<div class="scp-ox-read">` +
    `<div><p class="scp-st-byline">${byline}</p><div class="scp-ox-prose">${prose.map((p) => `<p>${p}</p>`).join("")}</div></div>` +
    `<aside class="scp-ox-aside" aria-label="${escapeHtml(`${m.last} in Redraft Command`)}">${rc}${fits}</aside>` +
    `</div></section>`
  );
}

/* ------------------------------------- section 2: opportunity vs. production */

/** One of the six Opportunity vs. Production tiles. */
export interface OpportunityTile {
  label: string;
  value: string;
  sub: string;
  lead: boolean;
}

/** One takeaway row: the bold claim and its sentence. */
export interface OpportunityTake {
  kind: "ok" | "up" | "down" | "flat" | "warn";
  claim: string;
  text: string;
}

export interface OpportunityModel {
  lede: string;
  tiles: OpportunityTile[];
  takes: OpportunityTake[];
  link: { href: string; text: string } | null;
}

/**
 * The Opportunity vs. Production facts: the explanation line, the six
 * tiles, the takeaway rows and the usage-report link. The tab's section and
 * the premium block both print from this, so they cannot disagree.
 */
function opportunityModel(m: Model, options: PlayerRenderOptions): OpportunityModel | null {
  const row = u(m);
  const usage = m.usage;
  if (!row || !usage || !n(row.xfpPerGame) || !n(row.fpPerGame)) return null;
  const posWord = `${m.pos}s`;
  const tile = (label: string, value: string, sub: string, lead = false): OpportunityTile => ({ label, value, sub, lead });
  const tiles: OpportunityTile[] = [
    tile("PPR points per game", one(row.fpPerGame), "Actual", true),
    tile("Expected points per game", one(row.xfpPerGame), rankWords(uRank(m, "xfpPerGame"), m.pos) || "xFP"),
    tile("Points over expected", n(row.fpoePerGame) ? signed(row.fpoePerGame) : "-", "per game"),
  ];
  if (m.pos === "WR" || m.pos === "TE") {
    if (n(row.targetShare)) tiles.push(tile("Target share", pct(row.targetShare), rankWords(uRank(m, "targetShare"), m.pos)));
    if (n(row.firstReadShare)) tiles.push(tile("First-read share", pct(row.firstReadShare), rankWords(uRank(m, "firstReadShare"), m.pos)));
    if (n(row.snapShare)) tiles.push(tile("Snap share", `${Math.round(row.snapShare)}%`, rankWords(uRank(m, "snapShare"), m.pos)));
  } else if (m.pos === "RB") {
    if (n(row.woppShare)) tiles.push(tile("Backfield share", pct(row.woppShare), "of weighted opportunities"));
    if (n(row.woppPerGame)) tiles.push(tile("Weighted opportunities", one(row.woppPerGame), `per game, ${rankWords(uRank(m, "woppPerGame"), m.pos)}`.replace(/, $/, "")));
    if (n(row.snapShare)) tiles.push(tile("Snap share", `${Math.round(row.snapShare)}%`, rankWords(uRank(m, "snapShare"), m.pos)));
  } else {
    tiles.push(tile("Dropbacks per game", one(row.dropbacks / Math.max(1, row.games)), ""));
    if (n(row.designedRunRate)) tiles.push(tile("Designed-run rate", `${row.designedRunRate}%`, ""));
    tiles.push(tile("Carries inside the 10", String(row.gzCarries), ""));
  }

  // mak's xFP language from the usage report (2026-10-03), the gap never a promise.
  const band = fpoeBand(m);
  const gap = Math.abs(row.fpoePerGame ?? 0);
  const read =
    band === "under"
      ? `${m.last} is averaging ${one(row.xfpPerGame)} expected PPR points a game but producing ${one(row.fpPerGame)}. His opportunity profile is stronger than his output, running ${one(gap)} points a game below the value of his opportunities: a potential regression signal if the role holds, though the gap does not guarantee improvement.`
      : band === "over"
        ? `${m.last} is scoring ${signed(row.fpoePerGame!)} points a game over expected, efficiency that may not repeat; his ${one(row.xfpPerGame)} expected points a game is the opportunity underneath it.`
        : `${possessive(m.last)} production is running right at expected (${one(row.fpPerGame)} scored against ${one(row.xfpPerGame)} expected), so this is volume, not a hot streak.`;

  // The takeaways (mak's brief, 2026-11-05): the same three readings the
  // paragraphs carried, each a bold claim with its sentence, in one panel.
  // Only readings the data supports are rows; nothing is added to fill three.
  const takes: OpportunityTake[] = [
    {
      kind: band === "near" ? "ok" : band === "under" ? "warn" : "up",
      claim:
        band === "under"
          ? "Production is running below expectation."
          : band === "over"
            ? "Production is running above expectation."
            : "Production is running about at expectation.",
      text: read,
    },
  ];
  // The last three games against the three before (usage.ts trend()).
  const share = m.pos === "WR" || m.pos === "TE" ? "target share" : null;
  if (share) {
    const t = usage.ts;
    const recent = mean3(t);
    if (recent !== null && t.delta !== null && t.baseWeeks.length) {
      const steady = Math.abs(t.delta) < 2;
      takes.push({
        kind: steady ? "flat" : t.delta > 0 ? "up" : "down",
        claim: steady ? "Recent target share is steady." : `Recent target share is ${t.delta > 0 ? "up" : "down"} vs. earlier in the season.`,
        text: steady
          ? `His ${share} is steady: ${pct(recent)} over his last three games against ${pct(recent - t.delta)} in ${baseWords(t)}.`
          : `His ${share} over his last three games (${pct(recent)}) is ${t.delta > 0 ? "up" : "down"} ${one(Math.abs(t.delta))} points on ${baseWords(t)}${t.confirmed ? "" : ", though the latest game did not extend the move"}.`,
      });
    }
  }
  const sn = usage.snap;
  const snapRecent = mean3(sn);
  if (snapRecent !== null && sn.delta !== null && Math.abs(sn.delta) >= 5 && sn.baseWeeks.length) {
    const alsoWord = takes.length > 1 && takes[1]!.kind === (sn.delta > 0 ? "up" : "down") ? " also" : "";
    takes.push({
      kind: sn.delta > 0 ? "up" : "down",
      claim: sn.delta > 0 ? `Snap share has${alsoWord} risen.` : `Snap share has${alsoWord} dipped.`,
      text: `His snap share is ${sn.delta > 0 ? "up" : "down"} ${Math.round(Math.abs(sn.delta))} points over the same window (${Math.round(snapRecent)}% of snaps).`,
    });
  }

  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const q = options.linkQuery ?? "";
  const link = m.teamSlug ? { href: `${teamPrefix}${m.teamSlug}/usage/${q}`, text: `See the ${m.nickname ?? "team"} usage report` } : null;
  const lede = `Through Week ${usage.throughWeek}, PPR. Expected points (xFP) is the fantasy value of the opportunities he is given; points over expected (FPOE) is what he has scored above or below that. Ranks are among qualifying ${posWord} league-wide.`;
  return { lede, tiles, takes, link };
}

// Opportunity vs. Production is the premium block's section B since
// 2026-11-05 (outlook-projection-premium.ts), fed by opportunityModel() above.

/* ------------------------- the projection + opportunity premium block's model */

/**
 * What the premium comparison of the first two sections prints from (mak's
 * brief, 2026-11-05, lib/player/outlook-projection-premium.ts): the same
 * heading words, chips, headline, paragraphs, supports / threatens, sidebar
 * copy, Best fit rows and Opportunity facts the tab's own sections use, so
 * the two versions cannot disagree. In season only; null before Week 1.
 */
export interface OutlookProjectionModel {
  name: string;
  last: string;
  pos: string;
  heading: string;
  asOf: string;
  chips: Chip[];
  injured: string | null;
  headline: string;
  paragraphs: string[];
  supports: string[];
  threatens: string[];
  supportsEmpty: string;
  threatensEmpty: string;
  rc: { href: string; copy: string; cta: string };
  fits: FitsModel | null;
  opportunity: OpportunityModel | null;
}

export function outlookProjectionModel(data: PlayerPageData, options: PlayerRenderOptions = {}): OutlookProjectionModel | null {
  const m = model(data);
  if (!m || m.preseason || !tierLine(m) || !m.chips) return null;
  const paras = paragraphs(m, data);
  if (!paras.length) return null;
  const { supports, threatens } = supportsThreatens(m, data);
  const empty = emptyWords(m, data);
  return {
    name: m.name,
    last: m.last,
    pos: m.pos,
    heading: titleCase(`${m.name} rest-of-season projection`),
    asOf: m.week >= 1 ? `Through Week ${m.week}` : "",
    chips: tags(m, data.depth),
    injured: m.injured,
    headline: featHeadline(m, data.depth),
    paragraphs: paras,
    supports,
    threatens,
    supportsEmpty: empty.supports,
    threatensEmpty: empty.threatens,
    rc: { href: m.rc, copy: rcCopy(m), cta: `Open ${m.last} in Redraft Command` },
    fits: fitsModel(m),
    opportunity: opportunityModel(m, options),
  };
}

/* --------------------------------------------------------- section 3: drivers */

/** The usage report's metrics as driver rows, ranked league-wide. */
function usageDriverRows(m: Model): DriverRow[] {
  const row = u(m);
  if (!row) return [];
  const rows: DriverRow[] = [];
  const push = (metric: UsageMetric, label: string, unit: string, value: string, words: [string, string, string], tier?: Tier): void => {
    const r = uRank(m, metric);
    const t = tier ?? (r ? tierOf(r.rank, r.of) : null);
    rows.push({
      label,
      word: t === null ? null : words[t === "good" ? 0 : t === "mid" ? 1 : 2],
      tier: t,
      value,
      unit,
      rank: r?.rank ?? null,
      of: r?.of ?? 0,
    });
  };
  if (n(row.xfpPerGame)) push("xfpPerGame", "Expected points", "xFP per game", one(row.xfpPerGame), ["High-value", "Average", "Low-value"]);
  if (n(row.fpoePerGame)) {
    const band = fpoeBand(m);
    push(
      "fpoePerGame",
      "Points over expected",
      "FPOE per game",
      signed(row.fpoePerGame),
      ["Over expected", "Near expected", "Under expected"],
      band === "over" ? "good" : band === "under" ? "bad" : "mid",
    );
  }
  if ((m.pos === "WR" || m.pos === "TE") && n(row.firstReadShare)) push("firstReadShare", "First-read share", "first-read share", pct(row.firstReadShare), ["Primary", "Secondary", "Limited"]);
  return rows;
}

/**
 * The rows the drivers section shows, in the brief's order: the position's
 * share metric, expected points, the gap, first-read share, then the rest.
 */
function driverRows(m: Model): DriverRow[] {
  const adv = m.measures?.drivers ?? [];
  const usage = usageDriverRows(m);
  if (!usage.length) return adv;
  const by = (label: string): DriverRow | undefined => adv.find((d) => d.label === label) ?? usage.find((d) => d.label === label);
  const order: Record<string, string[]> = {
    WR: ["Target share", "Expected points", "Points over expected", "First-read share", "Downfield role"],
    TE: ["Route participation", "Target share", "Expected points", "Points over expected", "First-read share"],
    RB: ["Rushing volume", "Receiving role", "Expected points", "Points over expected", "Efficiency"],
    QB: ["Passing volume", "Efficiency", "Rushing", "Expected points", "Points over expected"],
  };
  return (order[m.pos] ?? []).map(by).filter((d): d is DriverRow => Boolean(d));
}

/** The drivers section's model: its rows, the field they are ranked in, the advanced cells, and its words. */
export interface DriversModel {
  rows: DriverRow[];
  season: number;
  week: number | null;
  minGames: number;
  posWord: string;
  advanced: AdvancedCell[];
  title: string;
  lede: string;
}

function driversModel(m: Model): DriversModel | null {
  const ms = m.measures;
  const rows = driverRows(m);
  if (!rows.length) return null;
  const season = ms?.season ?? m.usage?.season ?? m.season;
  const week = ms?.week ?? m.usage?.throughWeek ?? null;
  const n1 = noun(m.pos);
  const min = ms?.minGames ?? 6;
  const games = `${word(min)} game${min === 1 ? "" : "s"}`;
  // Two tables feed the rows (the advanced table and the usage report), each
  // with its own field, so the lede does not name one count; each row does.
  const mixed = rows.some((d) => d.of !== rows[0]!.of);
  const field = mixed || !ms?.field ? `the ${n1}s` : `the ${ms.field} ${n1}s`;
  const each = mixed ? ` Each row names its field.` : "";
  return {
    rows,
    season,
    week,
    minGames: min,
    posWord: `${m.pos}s`,
    advanced: ms?.advanced ?? [],
    title: `What drives ${possessive(m.name)} fantasy value?`,
    lede:
      week !== null
        ? `His ${season} rank through Week ${week} among ${field} who have played at least ${games}.${each} Each bar is one ${n1}, best on the left; his is highlighted.`
        : `His ${season} rank among ${field} who played at least ${games}.${each} Each bar is one ${n1}, best on the left; his is highlighted.`,
  };
}

/* ---------------------------------------------------- section 4: upside / risk */

/** One upside or risk: the claim you read, the evidence under it. */
export interface TriggerItem {
  claim: string;
  evidence: string;
}

/**
 * The upside and risk lists. The claim is the line you read; the evidence
 * sits under it as subtext (mak, 2026-10-01). Every item is a CHANGE with
 * its evidence (the brief, 2026-11-05) - not the drivers restated, and never
 * "could get hurt". The original card and the premium both draw this.
 */
function triggerItems(m: Model, data: PlayerPageData): { up: TriggerItem[]; risk: TriggerItem[] } {
  const up: TriggerItem[] = [];
  const risk: TriggerItem[] = [];
  const b = (label: string, text: string): TriggerItem => ({ claim: label.replace(/\.$/, ""), evidence: text });
  const row = u(m);
  const usage = m.usage;
  const depth = data.depth;
  const season = m.usage?.season ?? m.measures?.season ?? m.season;
  const withRank = (g: UpcomingGame): string => `the ${oppName(g)} in Week ${g.week} (${ordinal(g.matchup!.rank)})`;

  // Upside: catalysts. A player listed below first on the chart gets none
  // from the usage he had as the starter.
  const benched = Boolean(depth && depth.order > 1 && !m.injured);
  if (row && unpaid(m) && !benched) {
    up.push(b("Room for the points to catch his role.", `${one(row.xfpPerGame!)} expected PPR points a game against ${one(row.fpPerGame!)} scored; if the role holds, that gap is where the upside is.`));
  }
  if (usage?.ts.confirmed && (usage.ts.delta ?? 0) >= 3) {
    up.push(b("Target share is climbing.", `${pct(mean3(usage.ts)!)} over his last three games, up ${one(usage.ts.delta!)} points on ${baseWords(usage.ts)}.`));
  }
  if (usage?.snap.confirmed && (usage.snap.delta ?? 0) >= 10) {
    up.push(b("More snaps.", `${Math.round(mean3(usage.snap)!)}% of snaps over his last three games, up ${Math.round(usage.snap.delta!)} points on ${baseWords(usage.snap)}.`));
  }
  if (usage?.leadsRz && row && row.rzTouches >= 5) {
    up.push(b("The red-zone role.", `${usage.rzCoLead ? "Co-leads" : "Leads"} the ${m.nickname ?? "club"} with ${row.rzTouches} red-zone touches through Week ${usage.throughWeek}.`));
  }
  const s = m.sched;
  if (s.soft.length > s.tough.length) {
    up.push(b(s.soft.length >= 2 ? "A soft stretch." : "A soft spot.", `${cap(listWords(s.soft.map(withRank)))} ${s.soft.length === 1 ? "is a top-10 matchup" : "are top-10 matchups"} for ${m.pos}s.`));
  }
  // The drivers are restated here only when there is no catalyst at all - the
  // card is for changes, not a second copy of the strips above.
  if (up.length === 0) {
    const good = rankedDrivers(m).filter((d) => d.tier === "good");
    for (const d of good.slice(0, 2)) {
      const label = d.label.toLowerCase().startsWith((d.word ?? "").toLowerCase()) ? `${d.label}.` : `${d.word} ${d.label.toLowerCase()}.`;
      up.push(b(label, `${d.value} ${d.unit}, ${ordinal(d.rank!)} of ${d.of} ${m.pos}s in ${season}.`));
    }
  }

  // Risk: changes and headwinds with evidence.
  if (m.injured) risk.push(b("Injury.", `He's ${m.injured.toLowerCase()}${depth?.next ? `, and ${depth.next.name} is next on the depth chart` : ""}.`));
  else if (m.questionable) risk.push(b("Questionable.", `Listed ${m.questionable.toLowerCase()} this week; check the Injury tab before kickoff.`));
  if (m.qbChange) {
    const to = m.qbChange.to;
    risk.push(
      b(
        "A new quarterback.",
        `${to.name} is now the listed starter; ${m.qbChange.from} threw most of the passes through Week ${m.week}. How targets are distributed under ${surname(to.name)} is unknown${to.attempts > 0 ? ` (${to.attempts} attempts so far)` : ""}.`,
      ),
    );
  }
  if (s.tough.length > s.soft.length) {
    const through = row && n(row.targetShare) && row.targetShare >= 20 ? ` His ${pct(row.targetShare)} target share is the way through them.` : "";
    risk.push(b(s.tough.length === 1 ? "A tough matchup." : "Tough matchups.", `${cap(listWords(s.tough.map(withRank)))} ${s.tough.length === 1 ? "is" : "are"} among the stingiest defenses against ${m.pos}s.${through}`));
  }
  if (usage?.ts.confirmed && (usage.ts.delta ?? 0) <= -3) {
    risk.push(b("Target share is sliding.", `${pct(mean3(usage.ts)!)} over his last three games, down ${one(Math.abs(usage.ts.delta!))} points on ${baseWords(usage.ts)}.`));
  }
  if (usage?.snap.confirmed && (usage.snap.delta ?? 0) <= -10) {
    risk.push(b("Fewer snaps.", `${Math.round(mean3(usage.snap)!)}% of snaps over his last three games, down ${Math.round(Math.abs(usage.snap.delta!))} points on ${baseWords(usage.snap)}.`));
  }
  if (row && fpoeBand(m) === "over" && row.fpoePerGame! >= 2) {
    risk.push(b("Scoring over his opportunity.", `${signed(row.fpoePerGame!)} points a game over expected (${one(row.xfpPerGame!)} xFP); efficiency that may not repeat.`));
  }
  if (depth && depth.order > 1 && !m.injured) risk.push(b("Role.", `He's ${depth.position}${depth.order} on the depth chart, so a bigger role needs a change ahead of him.`));
  if (usage && usage.aheadOfHim.length >= 2) risk.push(b("Competition for targets.", `${listWords(usage.aheadOfHim.slice(0, 2))} both carry a bigger target share.`));
  const weak = rankedDrivers(m).filter((d) => d.tier === "bad");
  for (const d of weak.slice(0, 1)) {
    const label = d.label.toLowerCase().startsWith((d.word ?? "").toLowerCase()) ? `${d.label}.` : `${d.word} ${d.label.toLowerCase()}.`;
    if (risk.length < 3) risk.push(b(label, `${d.value} ${d.unit}, ${ordinal(d.rank!)} of ${d.of} ${m.pos}s in ${season}.`));
  }
  // The same line the drivers were read from, so the season named matches.
  const ks = m.measures?.line ?? data.fantasyOutlook2026?.keyStats;
  const k = (key: string): number | null => (typeof ks?.[key] === "number" ? (ks[key] as number) : null);
  if (risk.length < 3 && m.pos === "QB" && k("sacks") !== null && k("pressurePct") !== null) {
    risk.push(b("Pressure and sacks.", `${k("sacks")} sacks and a ${k("pressurePct")!.toFixed(1)}% pressure rate in ${m.measures?.season ?? m.season - 1}.`));
  }
  if (risk.length < 3 && m.pos !== "QB" && k("fumbles") && k("fumbles")! >= 2) {
    risk.push(b("Ball security.", `${k("fumbles")} fumbles in ${m.measures?.season ?? m.season - 1}.`));
  }
  if (risk.length < 3 && (m.pos === "WR" || m.pos === "TE") && k("dropPct") !== null && k("dropPct")! >= 6) {
    risk.push(b("Drops.", `A ${k("dropPct")!.toFixed(1)}% drop rate in ${m.measures?.season ?? m.season - 1}.`));
  }
  return { up: up.slice(0, 3), risk: risk.slice(0, 3) };
}

/** The comparison line under the upside and risk cards. */
function ctaText(m: Model): string {
  return `Weighing ${m.last} against another ${noun(m.pos)} on your roster?`;
}

/* ------------------------------------------------------- section 5: schedule */

const BAND_WORD = { soft: "Favorable", mid: "Neutral", tough: "Tough" } as const;

/** One of the next games as the schedule prints it. */
export interface ScheduleCard {
  g: UpcomingGame;
  band: "soft" | "mid" | "tough";
  kind: "good" | "mid" | "bad";
  word: string;
  /** "at KC". */
  opp: string;
  /** "31st vs WRs". */
  rankText: string;
}

export interface ScheduleModel {
  cards: ScheduleCard[];
  verdict: string;
  playoffs: string;
  title: string;
  lede: string;
}

function scheduleModel(m: Model): ScheduleModel | null {
  const s = m.sched;
  if (!s.next.length) return null;
  const cards: ScheduleCard[] = s.next.map((g) => {
    const band = matchupBand(g.matchup!.rank);
    const kind = band === "soft" ? "good" : band === "tough" ? "bad" : "mid";
    return { g, band, kind, word: BAND_WORD[band], opp: `${g.homeAway === "away" ? "at" : "vs"} ${g.opponentCode}`, rankText: `${ordinal(g.matchup!.rank)} vs ${m.pos}s` };
  });
  const verdict =
    s.verdict === "tough"
      ? `A difficult stretch: ${word(s.tough.length)} of the next ${word(s.next.length)} are bottom-10 matchups for ${m.pos}s${s.soft.length ? `, with ${word(s.soft.length)} top-10 matchup to break it up` : ""}.`
      : s.verdict === "soft"
        ? `A favorable stretch: ${word(s.soft.length)} of the next ${word(s.next.length)} are top-10 matchups for ${m.pos}s${s.tough.length ? `, against ${word(s.tough.length)} tough one` : ""}.`
        : s.soft.length || s.tough.length
          ? `A mixed stretch: ${word(s.soft.length)} top-10 matchup${s.soft.length === 1 ? "" : "s"} and ${word(s.tough.length)} bottom-10 in the next ${word(s.next.length)}.`
          : `A neutral stretch: none of the next ${word(s.next.length)} is a top-10 or a bottom-10 matchup for ${m.pos}s.`;
  const playoffs = s.playoffs.length
    ? `Fantasy playoffs (Weeks 15 to 17): ${listWords(
        s.playoffs.map((g) => `${g.homeAway === "away" ? "at" : "vs"} ${oppName(g)} in Week ${g.week} (${ordinal(g.matchup!.rank)})`),
      )}; ${(() => {
        const soft = s.playoffs.filter((g) => matchupBand(g.matchup!.rank) === "soft").length;
        const tough = s.playoffs.filter((g) => matchupBand(g.matchup!.rank) === "tough").length;
        return soft && !tough ? `${word(soft)} favorable, none tough` : tough && !soft ? `${word(tough)} tough, none favorable` : soft || tough ? `${word(soft)} favorable, ${word(tough)} tough` : "none favorable or tough";
      })()}.`
    : "";
  return {
    cards,
    verdict,
    playoffs,
    title: `${m.name} upcoming matchups`,
    lede: `His next ${word(s.next.length)} opponents, ranked by ${m.scoring} points allowed to ${m.pos}s this season: 1st allows the most, 32nd the fewest.`,
  };
}

/* ----------------------------------------------------- the preseason archive */

/** The June piece, collapsed, at the foot of the tab (the brief: history last). */
export interface ArchiveModel {
  summary: string;
  stamp: string;
  paras: string[];
}

function archiveModel(m: Model, data: PlayerPageData): ArchiveModel | null {
  if (m.preseason) return null;
  const record = data.fantasyOutlook2026;
  const published = dateParts((record as unknown as { generatedAt?: string } | null)?.generatedAt);
  const paras = (record?.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length || !published) return null;
  return {
    summary: `Read our preseason outlook (${published.month})`,
    stamp: `Published ${published.text}. Kept for reference; the outlook above replaces it. Point totals in this piece are as published in June; the figures above are ${m.scoring} points per game.`,
    paras,
  };
}

/**
 * The four sections' models for the premium comparison (mak's brief,
 * 2026-11-05): drawn from the same model() the tab renders, so the two
 * cannot disagree. Null when the tab itself would not render.
 */
export interface OutlookPremiumModel {
  name: string;
  last: string;
  pos: string;
  posNoun: string;
  rc: string;
  drivers: DriversModel | null;
  triggers: { up: TriggerItem[]; risk: TriggerItem[] };
  cta: string;
  schedule: ScheduleModel | null;
  archive: ArchiveModel | null;
}

export function outlookPremiumModel(data: PlayerPageData): OutlookPremiumModel | null {
  const m = model(data);
  if (!m) return null;
  return {
    name: m.name,
    last: m.last,
    pos: m.pos,
    posNoun: noun(m.pos),
    rc: m.rc,
    drivers: driversModel(m),
    triggers: triggerItems(m, data),
    cta: ctaText(m),
    schedule: scheduleModel(m),
    archive: archiveModel(m, data),
  };
}

/* ------------------------------------------------------------- section 6: FAQ */

/**
 * The Outlook FAQ (faq-engine.ts): forward-looking only, answered from the
 * same model as the sections above so the two never disagree. Rosterability
 * is the Overview's; last season's line is the Stats tab's.
 */
function outlookPool(m: Model, data: PlayerPageData, options: PlayerRenderOptions): Array<FaqCandidate | null> {
  const pool: Array<FaqCandidate | null> = [];
  const through = m.week >= 1 && m.now ? ` through Week ${m.week}` : "";
  const ros = m.week >= 1 ? `the rest of the ${m.season} season` : `the ${m.season} season`;
  const top = topDriver(m);
  const weak = weakDriver(m);
  const row = u(m);
  const usage = m.usage;
  const season = usage?.season ?? m.measures?.season ?? m.season;
  const drv = (d: DriverRow): string => `${d.label.toLowerCase()} (${d.value} ${d.unit}, ${ordinal(d.rank!)} of ${d.of} ${m.pos}s in ${season})`;
  const nounV = m.pos === "QB" ? "pass attempts" : m.pos === "RB" ? "touches" : "targets";
  const log = data.season === m.season ? (data.gameLog ?? []).filter((e) => (e.game_status ?? "active") === "active" && e.stats) : [];
  const vol = (e: (typeof log)[number]): number =>
    m.pos === "QB" ? e.stats.pass_att ?? 0 : m.pos === "RB" ? (e.stats.rush_att ?? 0) + (e.stats.rec_tgt ?? 0) : e.stats.rec_tgt ?? 0;
  const s = m.sched;
  const withRank = (g: UpcomingGame): string => `the ${oppName(g)} in Week ${g.week} (${ordinal(g.matchup!.rank)})`;
  const band = fpoeBand(m);

  // 1. The outlook.
  const tier = tierLine(m);
  if (tier && m.chips) {
    pool.push({
      key: "outlook",
      q: `What is ${possessive(m.name)} fantasy outlook for ${ros}?`,
      a:
        `${m.name} projects as ${/^[aeiou]/i.test(tier) ? "an" : "a"} ${tier.charAt(0).toLowerCase() + tier.slice(1)} for ${ros}: ${fitSentence(m)}.` +
        (row && band && n(row.xfpPerGame) && n(row.fpPerGame)
          ? band === "under"
            ? ` He is averaging ${one(row.fpPerGame)} PPR points against ${one(row.xfpPerGame)} expected, so his opportunity is stronger than his output.`
            : band === "over"
              ? ` He is averaging ${one(row.fpPerGame)} PPR points against ${one(row.xfpPerGame)} expected, efficiency that may not repeat.`
              : ` His ${one(row.fpPerGame)} PPR points a game match his ${one(row.xfpPerGame)} expected, so the production is the role.`
          : top && top.tier === "good"
            ? ` His ${drv(top)} supports that.`
            : "") +
        (m.qbChange ? ` ${m.qbChange.to.name} taking over at quarterback makes the near term less predictable.` : weak ? ` His ${drv(weak)} holds him back.` : ""),
      link: { href: m.rc, text: `See his live rank in Redraft Command.` },
    });
  }

  // 2. Rank against the projection and the ROS board.
  if (m.rank !== null) {
    pool.push({
      key: "rosrank",
      q: `What is ${possessive(m.name)} rest-of-season fantasy ranking?`,
      a:
        `${m.name} is the ${m.pos}${m.rank} in ${m.scoring} points per game${through}` +
        (m.ros ? `, and ${m.pos}${m.ros.rank} on the StatChasers rest-of-season board` : m.projected ? `, against a preseason projection of about ${m.pos}${m.projected}` : "") +
        `. That puts him in ${bucket(m.pos, m.fit?.rank ?? m.rank)} territory, ${chipPhrase(m.chips![1])} in ${PROSE_LEAGUES[m.pos]![1]} leagues.`,
    });
  }

  // 3. Buy low or sell high: from expected points when the report has him, else from the projection.
  if (row && band && n(row.xfpPerGame) && n(row.fpPerGame) && m.week >= 2 && !m.injured) {
    pool.push({
      key: "trade",
      q: `Should I buy low or sell high on ${m.name}?`,
      a: unpaid(m)
        ? `${m.name} is a buy-low candidate on the numbers: ${one(row.xfpPerGame)} expected PPR points a game against ${one(row.fpPerGame)} scored. The role is there and the points are not yet; if the role holds, that gap is a potential regression signal, though it does not guarantee improvement${m.qbChange ? `, and a new quarterback adds uncertainty` : ""}.`
        : band === "over" && row.fpoePerGame! >= 2
          ? `${m.name} is a sell-high candidate on the numbers: ${signed(row.fpoePerGame!)} PPR points a game over his ${one(row.xfpPerGame)} expected. Efficiency like that may not repeat, so an offer that pays for the points rather than the role is worth taking.`
          : `Neither: ${possessive(m.name)} ${one(row.fpPerGame)} PPR points a game sit close to his ${one(row.xfpPerGame)} expected, so his price matches his role. Hold him unless a trade fills a bigger need.`,
    });
  } else if (m.rank !== null && m.projected && m.week >= 2 && !m.injured) {
    const gap = m.projected - m.rank;
    pool.push({
      key: "trade",
      q: `Should I buy low or sell high on ${m.name}?`,
      a: gap >= 6
        ? `${m.name} is outperforming his projection, ${m.pos}${m.rank} against about ${m.pos}${m.projected}, so his trade value is near its high. Selling is reasonable if an offer pays for the ${bucket(m.pos, m.rank)} he has been rather than the ${bucket(m.pos, m.projected)} he was projected to be.`
        : gap <= -6
          ? `${m.name} is below his projection, ${m.pos}${m.rank} against about ${m.pos}${m.projected}, which is a buy-low window if his usage holds` + (top && top.tier === "good" ? `: his ${drv(top)} is still there.` : ".")
          : `Neither: ${m.name} is playing to his projection, ${m.pos}${m.rank} against about ${m.pos}${m.projected}, so his price matches his production. Hold him unless a trade fills a bigger need.`,
    });
  }

  // 4. The quarterback.
  if (m.qb && m.pos !== "QB") {
    pool.push({
      key: "quarterback",
      q: `Who is ${possessive(m.name)} quarterback?`,
      a: m.qbChange
        ? `${m.qbChange.to.name} is the ${m.nickname ? `${m.nickname}' ` : ""}listed starting quarterback now. ${m.qbChange.from} threw most of the passes through Week ${m.week}${m.qbChange.to.attempts > 0 ? `; ${surname(m.qbChange.to.name)} has ${m.qbChange.to.attempts} attempts so far` : ""}. How the targets are distributed under the new starter is the open question for ${possessive(m.last)} rest-of-season value.`
        : `${m.qb.name} is the ${m.nickname ? `${m.nickname}' ` : ""}listed starting quarterback${m.qb.attempts > 0 ? `, with ${m.qb.attempts} pass attempts through Week ${m.week}` : ""}.`,
    });
  }

  // 5. Role going forward.
  const depth = data.depth;
  if (depth) {
    pool.push({
      key: "role",
      q: `What is ${possessive(m.name)} projected role going forward?`,
      a: depth.order === 1
        ? `${m.name} is the listed starting ${depth.position}${depth.next ? `, with ${depth.next.name} next on the depth chart` : ""}. ` +
          (m.injured
            ? `He is ${m.injured.toLowerCase()} for now, which puts that role on hold.`
            : row && n(row.targetShare) && (m.pos === "WR" || m.pos === "TE")
              ? `His ${pct(row.targetShare)} target share${usage?.ts.delta !== null && usage?.ts.delta !== undefined && Math.abs(usage.ts.delta) >= 2 ? ` is ${usage.ts.delta > 0 ? "up" : "down"} ${one(Math.abs(usage.ts.delta))} points over his last three games` : " has held steady"}${m.qbChange ? `; the quarterback change is the variable to watch` : ""}.`
              : `Nothing on the chart threatens the job, so the role is his to lose on performance.`)
        : `${m.name} is ${depth.position}${depth.order} on the depth chart, so a bigger role needs an injury or a change ahead of him.`,
    });
  }

  // 6. Volume trend (three games or more).
  if (log.length >= 3) {
    const avg = log.reduce((t, e) => t + vol(e), 0) / log.length;
    const recent = log.slice(-2).reduce((t, e) => t + vol(e), 0) / 2;
    const diff = recent - avg;
    const steady = Math.abs(diff) < Math.max(1.5, avg * 0.08);
    pool.push({
      key: "volume",
      q: `Will ${m.name} get more ${nounV}?`,
      a:
        `${possessive(m.name)} ${nounV} are ${steady ? "holding steady" : diff > 0 ? "trending up" : "trending down"}: ${one(recent)} a game over his last two games against ${one(avg)} for the season.` +
        (m.qbChange ? ` With ${m.qbChange.to.name} now starting, the next two games will say more than the last two.` : m.pos === "QB" ? ` Game script drives much of that, and trailing teams throw more.` : ` His share of the offense is what his fantasy value rides on.`),
    });
  }

  // 7. Upside.
  const bestWeek = log.length ? [...log].sort((x, y) => getEntryPoints(y.stats, data.format) - getEntryPoints(x.stats, data.format))[0] : null;
  const softUp = s.soft.length > s.tough.length ? s.soft : [];
  if (bestWeek || (top && top.tier === "good") || softUp.length || unpaid(m)) {
    const parts: string[] = [];
    if (row && unpaid(m)) parts.push(`his ${one(row.xfpPerGame!)} expected points a game say the role is worth more than the ${one(row.fpPerGame!)} he has scored`);
    if (bestWeek) parts.push(`his ceiling this season is ${one(getEntryPoints(bestWeek.stats, data.format))} ${m.scoring} points (Week ${bestWeek.week}${bestWeek.pos_rank ? `, ${m.pos}${bestWeek.pos_rank}` : ""})`);
    if (top && top.tier === "good") parts.push(`his ${drv(top)} gives him a weekly floor to build on`);
    if (softUp.length) parts.push(`${matchupList(softUp)} ${softUp.length === 1 ? "is a top-10 matchup" : "are top-10 matchups"} for ${m.pos}s`);
    pool.push({
      key: "upside",
      q: `What is ${possessive(m.name)} fantasy football upside?`,
      a: `${possessive(m.name)} upside: ${listWords(parts)}.`,
    });
  }

  // 8. Risk.
  const risks: string[] = [];
  if (m.injured) risks.push(`he is ${m.injured.toLowerCase()}`);
  if (m.qbChange) risks.push(`${m.qbChange.to.name} has taken over at quarterback, so how the targets are shared is unsettled`);
  if (s.tough.length > s.soft.length) risks.push(`${listWords(s.tough.slice(0, 2).map(withRank))} ${s.tough.length === 1 ? "is a tough matchup" : "are tough matchups"}`);
  if (usage?.ts.confirmed && (usage.ts.delta ?? 0) <= -3) risks.push(`his target share is down ${one(Math.abs(usage.ts.delta!))} points over his last three games`);
  if (row && band === "over" && row.fpoePerGame! >= 2) risks.push(`he is scoring ${signed(row.fpoePerGame!)} a game over his opportunity, which may not repeat`);
  if (depth && depth.order > 1 && !m.injured) risks.push(`he is ${depth.position}${depth.order} on the depth chart`);
  if (weak && weak.tier === "bad") risks.push(`his ${drv(weak)} limits his scoring`);
  if (risks.length) {
    pool.push({
      key: "risk",
      q: `What could hurt ${possessive(m.name)} fantasy value?`,
      a: `${possessive(m.name)} risks: ${listWords(risks)}.`,
      link: ((href) => (href ? { href, text: `See his injury status and history.` } : null))(sectionHref(data, options, "injury")),
    });
  }

  // 9. The remaining schedule, and 10. the playoffs - the same read as the section.
  if (s.next.length >= 3) {
    pool.push({
      key: "schedule",
      q: `How difficult is ${possessive(m.name)} remaining fantasy schedule?`,
      a: `${s.verdict === "soft" ? "Favorable" : s.verdict === "tough" ? "Difficult" : "Mixed"}: of his next ${word(s.next.length)} games, ${word(s.soft.length)} ${s.soft.length === 1 ? "comes" : "come"} against a top-10 matchup for ${m.pos}s and ${word(s.tough.length)} against one of the stingiest defenses, by ${m.scoring} points allowed to the position${
        s.tough.length > s.soft.length && row && n(row.targetShare) && row.targetShare >= 20 ? `. A ${pct(row.targetShare)} target share is how a receiver plays through tough matchups` : ""
      }.`,
    });
  }
  if (s.playoffs.length >= 2) {
    const soft = s.playoffs.filter((g) => matchupBand(g.matchup!.rank) === "soft").length;
    pool.push({
      key: "playoffs",
      q: `Is ${m.name} a good fantasy playoff option?`,
      a: `His Weeks 15 to 17 opponents are ${listWords(s.playoffs.map((g) => `the ${oppName(g)} (${ordinal(g.matchup!.rank)} in points allowed to ${m.pos}s)`))}; ${soft ? `${word(soft)} of them ${soft === 1 ? "is" : "are"} favorable` : "none of them is a top-10 matchup"}.`,
    });
  }
  return pool;
}

function renderFaq(m: Model, data: PlayerPageData, options: PlayerRenderOptions): string {
  const items = selectFaq(outlookPool(m, data, options));
  return renderFaqSection("outlook", data, items, options, "scp-ol-faq");
}

/* ------------------------------------------------------------------ the tab */

export function renderOutlookTab(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const parts = outlookTabParts(data, options);
  return parts ? parts.body + parts.foot + parts.faq : "";
}

/**
 * The tab split at its footer and FAQ, which the page stands under the peers
 * rail, footer first (mak, 2026-09-30).
 */
export function outlookTabParts(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
): { body: string; foot: string; faq: string } | null {
  const m = model(data);
  if (!m) return null;
  // In season the first two sections (the projection with its sidebar, and
  // Opportunity vs. Production) are the premium block,
  // outlook-projection-premium.ts, which the page prints right after this
  // body (player-render.ts) from outlookProjectionModel() below; sections 3
  // to 6 are outlook-premium.ts the same way. mak approved both on
  // 2026-11-05 and had the originals removed. The preseason piece still
  // renders here.
  const main = renderRead(m, data);
  const faq = renderFaq(m, data, options);
  if (!main && !faq) return null;
  // No methodology footer (mak, 2026-10-02).
  const foot = "";
  const ink = teamInk(data.team);
  const wrap = (html: string): string =>
    html ? `<div class="scp-ox scp-st scp-ol"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${html}</div>` : "";
  return { body: wrap(main), foot: wrap(foot), faq: wrap(faq) };
}
