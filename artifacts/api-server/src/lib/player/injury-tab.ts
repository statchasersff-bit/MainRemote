/**
 * The Injury tab's spec sections, to mak's "Build Instructions: StatChasers
 * Player Injury Tab" of 2026-09-30, appended UNDER the tab's existing content
 * (mak's instruction; see new-spec-sections-go-below).
 *
 * Seven parts: current status with the practice grid, the history at a
 * glance, the body map with the body-part table and risk factors, the dated
 * timeline with its sidebar, "if he misses time" and a FAQ (the footer went 2026-10-22). Every
 * count comes from injury-tab-data.ts's one event list, so the tiles, map,
 * table, timeline and FAQ agree (4.9).
 *
 * Where the spec asks for something this server cannot supply:
 *   - Status is the Sleeper roster designation the rest of the page uses;
 *     "Status checked" is when that snapshot was taken, never the render time.
 *   - Practice participation is the league's official report, read from
 *     NFL.com by scripts/player/buildPracticeReports.mjs. Days are only known
 *     from the day that builder first ran; before that a week has its final
 *     report only, and the earlier days print "-" (no entry in our data).
 *   - The history records carry no source, so no entry has a source link and
 *     the section says so (the spec's "unsourced isn't published" rule would
 *     empty the timeline; left for mak).
 *   - SEO is untouched (mak): no title, meta or JSON-LD, and this FAQ is not
 *     added to the page's FAQPage node.
 */

import { escapeHtml } from "../render";
import { possessive } from "./title-case";
import { renderFaqSection, selectFaq, type FaqCandidate, type FaqItem } from "./faq-engine";
import { etDay } from "./news-tab-data";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { lastName, STARTSIT_BASE, teamInk } from "./header";
import { NO_DESIGNATION, NO_DESIGNATION_YET } from "../matchup/availability";
import { getTeamByAbbreviation } from "../team/teams";
import {
  bodyMap,
  buildEvents,
  clubAt,
  loadPracticeReports,
  OTHER_CATEGORY,
  parseValue,
  practiceDays,
  practiceRead,
  reportRows,
  riskFactors,
  totals,
  type BodyMap,
  type Factor,
  type InjuryEvent,
  type InjuryTotals,
  type PracticeValue,
  type ReportRow,
} from "./injury-tab-data";
import { hasPlayerSection, sectionHref } from "./sections";
import type { UpcomingGame } from "./upcoming";
import { redraftPlayerUrl } from "./redraft-link";

const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const POS_WORD: Record<string, string> = { QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end" };
/** A snapshot older than this, in season, gets the "Latest report pending" note. */
const STALE_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ atoms */

const word = (n: number): string => WORDS[n] ?? String(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const games = (n: number): string => `${n} game${n === 1 ? "" : "s"}`;

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function a(href: string, text: string, attrs = ""): string {
  return `<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(text)}</a>`;
}

/** "an MCL sprain", "a hamstring injury". */
function article(phrase: string): string {
  if (/^[aeiou]/i.test(phrase)) return `an ${phrase}`;
  if (/^[AEFHILMNORSX][A-Z]/.test(phrase)) return `an ${phrase}`;
  return `a ${phrase}`;
}

/** The injury as a sentence names it: "thumb fracture", "hamstring injury", "MCL sprain". */
const INJURY_NOUN =
  /(fracture|sprain|strain|tear|torn|rupture|surgery|concussion|contusion|dislocat|tendin|bruis|inflammation|injur|illness|soreness|stinger|laceration|break|separation)/i;

function injuryName(type: string): string {
  const name = type
    .split(/\s+/)
    .map((w) => (/^[A-Z]{2,}$/.test(w) || /^achilles$/i.test(w) ? w : w.toLowerCase()))
    .join(" ");
  return INJURY_NOUN.test(type) ? name : `${name} injury`;
}

function sideWord(ev: InjuryEvent): string {
  return ev.side === "R" ? "right" : ev.side === "L" ? "left" : "";
}

/** Parts of an Eastern date-time. */
function et(ms: number): { y: number; m: number; d: number; dow: string; time: string; iso: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  return {
    y,
    m,
    d,
    dow: String(parts.weekday),
    time: `${parts.hour}:${parts.minute} ${String(parts.dayPeriod ?? "").toUpperCase()}`.trim(),
    iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  };
}

const shortMonth = (m: number): string => MONTHS[m - 1]!.slice(0, 3);

/** "2026-09-30" → "Sep 30". */
function mmmD(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${shortMonth(m!)} ${d}`;
}

/** "2026-09-30" → "Wednesday, Sep 30". */
function dayMmmD(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${dow}, ${mmmD(date)}`;
}

/** "Sep 29, 2026, 7:02 PM ET" */
function stampText(ms: number): string {
  const p = et(ms);
  return `${shortMonth(p.m)} ${p.d}, ${p.y}, ${p.time} ET`;
}

/** "September 29, 2026" */
function longDate(ms: number): string {
  const p = et(ms);
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/* ------------------------------------------------------------------ model */

export type StatusCode = "ACTIVE" | "Q" | "D" | "O" | "IR" | "PUP" | "NFI" | "SUSP" | "OFFSEASON";

const STATUS_WORD: Record<StatusCode, string> = {
  ACTIVE: "Active",
  Q: "Questionable",
  D: "Doubtful",
  O: "Out",
  IR: "Injured reserve",
  PUP: "PUP list",
  NFI: "NFI list",
  SUSP: "Suspended",
  OFFSEASON: "Offseason",
};

const STATUS_KIND: Record<StatusCode, string> = {
  ACTIVE: "good",
  Q: "mid",
  D: "bad",
  O: "bad",
  IR: "bad",
  PUP: "bad",
  NFI: "bad",
  SUSP: "susp",
  OFFSEASON: "good",
};

function statusCode(raw: string | null | undefined, inSeason: boolean): StatusCode {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return inSeason ? "ACTIVE" : "OFFSEASON";
  if (s.startsWith("q")) return "Q";
  if (s.startsWith("doubt")) return "D";
  if (s === "out" || s === "dnr") return "O";
  if (s === "ir" || s.includes("reserve")) return "IR";
  if (s.includes("pup")) return "PUP";
  if (s === "na" || s.includes("nfi")) return "NFI";
  if (s.startsWith("sus")) return "SUSP";
  return "O";
}

interface PracticeRow {
  week: number;
  current: boolean;
  where: string;
  injury: string | null;
  days: Array<{ day: string; date: string; value: PracticeValue | "PENDING" | "MISSING"; estimated: boolean }>;
  game: { text: string; kind: string };
}

interface Model {
  name: string;
  last: string;
  slug: string;
  pos: string;
  season: number;
  nickname: string | null;
  code: StatusCode;
  bodyPart: string | null;
  now: number;
  checkedMs: number;
  next: UpcomingGame | null;
  events: InjuryEvent[];
  t: InjuryTotals;
  factors: Factor[];
  map: BodyMap;
  seasonsPlayed: number;
  seasonMissed: number | null;
  /** Weeks sat out for any reason; seasonMissed counts injuries only. */
  seasonOut: number | null;
  lastPlayedWeek: number | null;
  /**
   * Missed his club's last game with no game status yet for the next one
   * (current-status kind "pending", Phase 5). The headline must not read "No
   * injury designation", which says healthy.
   */
  pending: { missedWeek: number | null } | null;
  /**
   * No designation, and this week's report is missing or has no game
   * statuses yet (current-status reportState): "No designation yet", never
   * "Active" or "on track to play" (WEB-039).
   */
  notYet: boolean;
  playedThisSeason: number;
  report: ReportRow[];
  practice: PracticeRow[];
  practiceHead: string;
  practiceNote: string | null;
  starter: boolean;
  rc: string;
  hasOutlook: boolean;
  tabUrl: (tab: string) => string;
  playerUrl: (slug: string) => string;
}

function model(data: PlayerPageData, options: PlayerRenderOptions): Model | null {
  const injury = data.injury;
  if (!injury) return null;
  const { player } = data;
  const now = options.now ?? Date.now();
  const teamCode = data.team?.code ?? null;

  const events = buildEvents(injury.history.nfl, (season, week) => clubAt(player.id, season, week));
  const t = totals(events);
  const seasonsPlayed = Math.max(1, Object.keys(data.seasonClubs ?? {}).length || (data.logSeasons ?? []).length);
  const next = (data.upcoming ?? [])[0] ?? null;
  const inSeason = next !== null && data.schedule.some((g) => g.kickoffMs !== null && g.kickoffMs < now);
  const code = statusCode(data.designation?.injuryStatus, next !== null);

  const playedThisSeason = (data.season === data.leagueSeason ? data.gameLog : []).filter(
    (e) => e.game_status === "active",
  ).length;

  const report = reportRows(loadPracticeReports(data.leagueSeason), teamCode, player.name);
  const prefix = options.playerPathPrefix ?? "/player/";
  const tabUrl = (tab: string) => `${prefix}${player.slug}/${tab}/${options.linkQuery ?? ""}`;

  const m: Model = {
    name: player.name,
    last: lastName(player.name),
    slug: player.slug,
    pos: player.position ?? "",
    season: data.leagueSeason,
    nickname: data.team?.nickname ?? null,
    code,
    bodyPart: data.designation?.injuryBodyPart ?? null,
    now,
    checkedMs: data.rosterFetchedAt,
    next,
    events,
    t,
    factors: riskFactors(events, t, data.leagueSeason, seasonsPlayed),
    map: bodyMap(events),
    seasonsPlayed,
    seasonMissed: injury.seasonMissed,
    seasonOut: injury.seasonOut,
    lastPlayedWeek: injury.lastPlayedWeek,
    pending:
      data.currentStatus?.kind === "pending"
        ? { missedWeek: data.currentStatus.missedWeek ?? null }
        : null,
    notYet:
      code === "ACTIVE" &&
      next !== null &&
      !!data.currentStatus &&
      data.currentStatus.kind !== "pending" &&
      data.currentStatus.reportState !== "final",
    playedThisSeason,
    report,
    practice: [],
    practiceHead: "",
    practiceNote: null,
    starter: data.depth?.order === 1,
    rc: redraftPlayerUrl(player),
    // The same test the Outlook tab applies to itself, so this tab never
    // links to an Outlook page that is not there.
    hasOutlook: hasPlayerSection(data, "outlook"),
    tabUrl,
    playerUrl: (slug: string) => `${prefix}${slug}/${options.linkQuery ?? ""}`,
  };
  if (inSeason || next) buildPractice(m, data);
  return m;
}

/* --------------------------------------------------------------- practice */

function gameCell(row: ReportRow | undefined, played: boolean, past: boolean, finalPassed: boolean): { text: string; kind: string } {
  if (past && played) return { text: "Played", kind: "clear" };
  const gs = (row?.gameStatus ?? "").trim();
  if (gs) {
    const kind = /^q/i.test(gs) ? "lim" : "dnp";
    return { text: gs, kind };
  }
  if (past) return { text: "-", kind: "none" };
  if (!finalPassed) return { text: "", kind: "soon" };
  return { text: "No status", kind: "clear" };
}

function buildPractice(m: Model, data: PlayerPageData): void {
  const today = et(m.now).iso;
  const byWeek = new Map(m.report.map((r) => [r.week, r]));
  const played = new Set(data.gameLog.filter((e) => e.game_status === "active").map((e) => e.week));
  const rows: PracticeRow[] = [];

  const where = (week: number): { text: string; date: string | null } => {
    const g = data.schedule.find((game) => game.week === week && game.kickoffMs !== null);
    if (!g) return { text: "", date: null };
    const date = et(g.kickoffMs!).iso;
    const opp = g.opponent?.code ?? g.opponentName;
    return { text: `${g.homeAway === "home" ? "vs" : "@"} ${opp}, ${mmmD(date)}`, date };
  };

  const rowFor = (week: number, current: boolean): PracticeRow | null => {
    const w = where(week);
    if (!w.date) return null;
    const rep = byWeek.get(week);
    const days = practiceDays(w.date);
    const past = w.date < today;
    const finalPassed = days[days.length - 1]!.date < today;
    return {
      week,
      current,
      where: w.text,
      injury: rep?.injury ?? null,
      days: days.map((d, i) => {
        const stored = parseValue(rep?.days[d.date]) ?? (i === days.length - 1 && finalPassed ? parseValue(rep?.final) : null);
        if (stored) return { ...d, value: stored.value, estimated: stored.estimated };
        // Not out yet: today's report may still be coming.
        if (d.date >= today && !past) return { ...d, value: "PENDING", estimated: false };
        return { ...d, value: "MISSING", estimated: false };
      }),
      game: gameCell(rep, played.has(week), past, finalPassed),
    };
  };

  const nextWeek = m.next?.week ?? null;
  const onReport = m.report.length > 0;
  if (nextWeek !== null && onReport) {
    const cur = rowFor(nextWeek, true);
    if (cur) rows.push(cur);
  }
  for (const rep of m.report) {
    if (rows.length >= 4) break;
    if (rep.week === nextWeek) continue;
    const row = rowFor(rep.week, false);
    if (row) rows.push(row);
  }
  m.practice = rows;

  // The head line: when this week's report starts, or the latest one.
  if (nextWeek !== null) {
    const w = where(nextWeek);
    if (w.date) {
      const days = practiceDays(w.date);
      const first = days[0]!;
      const lastDay = days[days.length - 1]!;
      if (first.date > today) m.practiceHead = `Week ${nextWeek} report starts ${dayMmmD(first.date)}`;
      else if (lastDay.date < today) m.practiceHead = `Final report: ${dayMmmD(lastDay.date)}`;
      else m.practiceHead = `Week ${nextWeek} reports: ${days.map((d) => d.day).join(", ")}`;
    }
  }

  // "What it means". The pattern rules read a week from its first day, so a
  // week whose first day we never saw gets the facts and no reading.
  const cur = rows.find((r) => r.current);
  const veteran = (data.player.years_exp ?? 0) >= 6;
  const known = (v: string): v is PracticeValue => v === "FULL" || v === "LIMITED" || v === "DNP";
  const values = (r: PracticeRow) => r.days.map((d) => d.value).filter(known);
  const readOf = (r: PracticeRow) => (known(r.days[0]!.value) ? practiceRead(values(r), r.injury, veteran) : null);
  if (cur && values(cur).length) {
    m.practiceNote = readOf(cur);
  } else {
    const prev = rows.find((r) => !r.current);
    if (prev) {
      const read = readOf(prev);
      const listed = prev.injury ? ` with ${article(injuryName(prev.injury))}` : "";
      const after =
        prev.game.text === "Played" ? "played" : prev.game.kind === "dnp" || prev.game.kind === "lim" ? `was ${prev.game.text.toLowerCase()}` : "was listed";
      const lastKnown = [...prev.days].reverse().find((d) => known(d.value));
      const how = !lastKnown
        ? ""
        : lastKnown.value === "FULL"
          ? "practiced in full"
          : lastKnown.value === "LIMITED"
            ? "was limited"
            : "did not practice";
      m.practiceNote =
        `${m.last} was on the Week ${prev.week} report${listed}${how ? `, ${how} on ${DAY_NAME[lastKnown!.day] ?? lastKnown!.day}` : ""} and ${after}.` +
        (read && !/^A veteran/.test(read) ? ` ${read}` : "");
    }
  }
}

const DAY_NAME: Record<string, string> = {
  Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday",
};

/* ------------------------------------------------------ section 1: status */

/**
 * The answer to "is he injured?", which the status panel carries now that the
 * section has no heading of its own to ask it (mak, 2026-09-30).
 */
function statusAnswer(m: Model): string {
  const wk = m.next ? `Week ${m.next.week}` : "this week";
  const part = m.bodyPart ? `${m.bodyPart.toLowerCase()} injury` : "an injury";
  switch (m.code) {
    case "Q":
      return `${m.last} is questionable for ${wk} with ${m.bodyPart ? article(part) : part}.`;
    case "D":
      return `${m.last} is doubtful for ${wk} with ${m.bodyPart ? article(part) : part}.`;
    case "O":
      return `${m.last} is out for ${wk} with ${m.bodyPart ? article(part) : part}.`;
    case "IR":
    case "PUP":
    case "NFI":
      return `${m.last} is on ${m.code === "IR" ? "injured reserve" : `the ${STATUS_WORD[m.code]}`}${m.bodyPart ? ` with ${article(part)}` : ""}.`;
    case "SUSP":
      return `${m.last} is suspended, not injured.`;
    case "OFFSEASON":
      return `No current injury designation; the season is over.`;
    default: {
      if (m.pending) {
        return `${m.last} has no ${wk} game designation yet${m.pending.missedWeek ? ` after missing Week ${m.pending.missedWeek}` : ""}.`;
      }
      let first = "No injury designation.";
      if (m.next) {
        const at = m.next.homeAway === "home" ? "against the" : "at the";
        first = `No injury designation for ${wk} ${at} ${nextGameText(m.next).opp}.`;
      }
      // No "has (not) missed a game this season" tail (mak, 2026-11-06):
      // the "2026 games missed" figure beside the card says it.
      return first;
    }
  }
}

function nextGameText(g: UpcomingGame): { opp: string; line: string } {
  const opp = g.opponent?.nickname ?? g.opponentName;
  const where = g.homeAway === "home" ? "vs" : "@";
  let when = "";
  if (g.kickoffMs) {
    const p = et(g.kickoffMs);
    when = `, ${p.dow} ${shortMonth(p.m)} ${p.d}${g.timeConfirmed ? `, ${p.time} ET` : ""}`;
  }
  return { opp, line: `${where} ${g.opponentCode}${when}` };
}

/* ------------------------------------------------ the answer-first block */

/**
 * The one-sentence answer to "Is he injured?", which the section opens on
 * and the page's description starts with (mak's refresh, 2026-10-09).
 */
export interface InjuryAnswer {
  /** Whether the answer begins "Yes". A suspension is a "No": not injured. */
  yes: boolean;
  /** "No. Bijan Robinson has no injury designation for Week 6 (Falcons vs Buccaneers, Oct 12). Last checked Oct 9." */
  sentence: string;
  /** The same answer, short, for the front of the meta description. */
  lead: string;
  /** "Games missed in 2026: 0. Career games missed: 4." */
  missed: string;
  /** The ISO date (Eastern) of the latest report or status change - the title's "(Updated Mon D)". */
  updated: string;
}

/** How the week's practice reads, for the answer: "after limited practice Wednesday and Thursday". */
function practicePhrase(m: Model): string {
  const cur = m.practice.find((r) => r.current);
  if (!cur) return "";
  const today = et(m.now).iso;
  const known = cur.days.filter((d) => d.date <= today && (d.value === "FULL" || d.value === "LIMITED" || d.value === "DNP"));
  if (known.length === 0) return "";
  const noun: Record<string, string> = { FULL: "full practice", LIMITED: "limited practice", DNP: "no practice" };
  const dayName = (d: string) => DAY_NAME[d] ?? d;
  const first = known[0]!.value;
  if (known.every((d) => d.value === first)) {
    return ` after ${noun[first]} ${listWords(known.map((d) => dayName(d.day)))}`;
  }
  return ` after ${listWords(known.map((d) => `${noun[d.value]} ${dayName(d.day)}`))}`;
}

/** "Week 6 (Falcons vs Buccaneers, Oct 12)" - the game the designation is for. */
function weekPhrase(m: Model): string {
  if (!m.next) return "this week";
  const g = m.next;
  const opp = g.opponent?.nickname ?? g.opponentName;
  const own = m.nickname ?? "";
  const pair = own ? `${own} ${g.homeAway === "home" ? "vs" : "at"} ${opp}` : `${g.homeAway === "home" ? "vs" : "at"} ${opp}`;
  const when = g.kickoffMs ? `, ${mmmD(et(g.kickoffMs).iso)}` : "";
  return `Week ${g.week} (${pair}${when})`;
}

/** "Week 6 vs TB" - the short form the description uses. */
function weekShort(m: Model): string {
  if (!m.next) return "this week";
  return `Week ${m.next.week} ${m.next.homeAway === "home" ? "vs" : "at"} ${m.next.opponentCode}`;
}

/**
 * The date of the latest injury report or status change for HIM, never the
 * render date: the title carries it and must not bump unless the data did.
 *
 * In order: the latest day a league report listed him (the final report
 * counts as the week's last report day); an injury logged this season, dated
 * at its game; a player on no report at all takes the latest report day the
 * league has issued, because his absence from it is what says he is healthy;
 * failing all of those, the roster snapshot the status was read from.
 */
function updatedIso(m: Model, data: PlayerPageData): string {
  const today = et(m.now).iso;
  let best = "";
  const bump = (iso: string | null | undefined): void => {
    if (iso && iso <= today && iso > best) best = iso;
  };
  const gameDate = (week: number): string | null => {
    const g = data.schedule.find((s) => s.week === week && s.kickoffMs !== null);
    return g ? et(g.kickoffMs!).iso : null;
  };
  const reportDays = (week: number): string[] => {
    const date = gameDate(week);
    return date ? practiceDays(date).map((d) => d.date) : [];
  };

  for (const r of m.report) {
    for (const [date, raw] of Object.entries(r.days)) if (parseValue(raw)) bump(date);
    if (r.final || r.gameStatus) {
      const days = reportDays(r.week);
      bump(days[days.length - 1]);
    }
  }
  for (const ev of m.events) {
    if (ev.season === data.leagueSeason && ev.week) bump(gameDate(ev.week));
  }
  if (!best) {
    const doc = loadPracticeReports(data.leagueSeason);
    for (const wk of Object.keys(doc?.weeks ?? {})) for (const day of reportDays(Number(wk))) bump(day);
  }
  if (!best && m.checkedMs > 0) best = et(m.checkedMs).iso;
  return best || today;
}

function answerOf(m: Model, data: PlayerPageData): InjuryAnswer {
  const checked = m.checkedMs > 0 ? mmmD(et(m.checkedMs).iso) : null;
  const tail = checked ? ` Last checked ${checked}.` : "";
  const paren = checked ? ` (checked ${checked})` : "";
  const part = m.bodyPart ? ` (${m.bodyPart.toLowerCase()})` : "";
  const wk = weekPhrase(m);
  const wkShort = weekShort(m);
  let yes = true;
  let sentence: string;
  let lead: string;

  switch (m.code) {
    case "Q":
    case "D":
    case "O": {
      const word = STATUS_WORD[m.code];
      sentence = `Yes. ${m.name} is ${word}${part} for ${wk}${practicePhrase(m)}.${tail}`;
      lead = `${word}${part} for ${wkShort}${paren}.`;
      break;
    }
    case "IR":
    case "PUP":
    case "NFI": {
      const where = m.code === "IR" ? "on injured reserve" : `on the ${STATUS_WORD[m.code]}`;
      sentence = `Yes. ${m.name} is ${where}${part} and out for ${wk}.${tail}`;
      lead = `${cap(where)}${part}, out for ${wkShort}${paren}.`;
      break;
    }
    case "SUSP":
      yes = false;
      sentence = `No. ${m.name} is suspended, not injured, and out for ${wk}.${tail}`;
      lead = `Suspended, not injured, for ${wkShort}${paren}.`;
      break;
    case "OFFSEASON":
      yes = false;
      sentence = `No. ${m.name} has no injury designation; the ${m.season} season is over.${tail}`;
      lead = `No injury designation; the ${m.season} season is over${paren}.`;
      break;
    default:
      yes = false;
      sentence = `No. ${m.name} has no injury designation for ${wk}.${tail}`;
      lead = `No injury designation for ${wkShort}${paren}.`;
  }

  const thisSeason =
    data.season === data.leagueSeason && m.seasonMissed !== null
      ? `Games missed to injury in ${m.season}: ${m.seasonMissed}.`
      : `No ${m.season} games played yet.`;
  const missed = `${thisSeason} Career games missed: ${m.t.games}.`;

  return { yes, sentence, lead, missed, updated: updatedIso(m, data) };
}

/** The answer block for a player with an injury record; null without one. */
export function injuryAnswer(data: PlayerPageData, options: PlayerRenderOptions = {}): InjuryAnswer | null {
  const m = model(data, options);
  return m ? answerOf(m, data) : null;
}

/** One of the status strip's short facts. */
export interface StatusCell {
  key: "missed" | "latest" | "next";
  label: string;
  value: string;
  sub: string;
}

/** The three short facts beside the status: games missed this season, the latest injury, the next game. */
function statusCells(m: Model, data: PlayerPageData): StatusCell[] {
  const cells: StatusCell[] = [];
  if (m.seasonMissed !== null) {
    const lp = m.lastPlayedWeek;
    const g = lp !== null ? data.schedule.find((s) => s.week === lp && s.kickoffMs !== null) : null;
    cells.push({
      key: "missed",
      label: `${m.season} games missed`,
      value: String(m.seasonMissed),
      sub: lp !== null ? `Last played Week ${lp}${g ? `, ${mmmD(et(g.kickoffMs!).iso)}` : ""}` : "Hasn't played this season",
    });
  }
  const latest = m.t.latest;
  if (latest) {
    const when = latest.phase === "PRE" ? `Preseason ${latest.season}` : latest.week ? `Week ${latest.week}, ${latest.season}` : String(latest.season);
    cells.push({
      key: "latest",
      label: "Latest injury",
      // "Undisclosed", not "Undisclosed injury": the label already says injury (mak, 2026-11-06).
      value: latest.category === OTHER_CATEGORY ? cap(injuryName(latest.type)).replace(/^Undisclosed injury$/, "Undisclosed") : latest.category.split(" / ")[0]!,
      sub: `${when}, ${latest.games ? `${games(latest.games)} missed` : latest.pending ? "no report yet" : "played through"}`,
    });
  }
  if (m.next) {
    const { line } = nextGameText(m.next);
    const [where, ...when] = line.split(", ");
    cells.push({ key: "next", label: "Next game", value: `Week ${m.next.week} ${where}`, sub: when.join(", ") });
  }
  return cells;
}

const PILL: Record<string, [string, string]> = {
  FULL: ["full", "Full"],
  LIMITED: ["lim", "Limited"],
  DNP: ["dnp", "DNP"],
  NONE: ["none", "-"],
  MISSING: ["none", "-"],
};

function metaFor(ev: InjuryEvent): string {
  const when =
    ev.phase === "PRE" ? "Preseason" : ev.phase === "POST" ? `Postseason${ev.week ? `, Week ${ev.week}` : ""}` : ev.week ? `Week ${ev.week}` : `${ev.season} season`;
  const club = ev.team ? getTeamByAbbreviation(ev.team)?.nickname : null;
  return club ? `${when} · with the ${club}` : when;
}

/** Whether the timeline opens on a "Healthy" row for this season. */
function healthyRow(m: Model): string | null {
  const thisSeason = m.events.some((e) => e.season === m.season);
  if (!thisSeason && m.seasonMissed === 0 && m.lastPlayedWeek !== null && m.playedThisSeason > 0) {
    return `No injury has cost ${m.last} a game this season.`;
  }
  return null;
}

/* ---------------------------------------------------- section 5: backup */

/** The "If he misses time" cards: each a heading and an HTML paragraph (names link), plus the position CTA. */
export interface ContingencyModel {
  heading: string;
  cards: Array<{ key: "next" | "others"; title: string; html: string }>;
  cta: { text: string; href: string; label: string };
}

function contingencyModel(m: Model, data: PlayerPageData): ContingencyModel | null {
  if (!m.starter) return null;
  const next = data.depth?.next ?? null;
  const cards: ContingencyModel["cards"] = [];
  if (next) {
    const nm = next.slug ? a(m.playerUrl(next.slug), next.name) : escapeHtml(next.name);
    const advice: Record<string, string> = {
      QB: `In superflex leagues he's worth a speculative bench spot for ${m.last} managers; in 1QB leagues he's a waiver add only if ${m.last} misses time.`,
      RB: `He's the handcuff: worth a bench spot in deeper leagues and for ${m.last} managers, since the same backfield work would pass to him.`,
      WR: `The targets would likely spread across the offense rather than pass to one player, so he's a waiver add only if ${m.last} misses time.`,
      TE: `Tight end targets would mostly move to the receivers, so he's a streaming option at best if ${m.last} misses time.`,
    };
    cards.push({
      key: "next",
      title: `Next man up: ${next.name}`,
      html: `${nm}${escapeHtml(` is next on the ${m.nickname ?? "team"} depth chart at ${POS_WORD[m.pos] ?? m.pos}. ${advice[m.pos] ?? ""}`)}`,
    });
  }
  const mates = (data.teammates ?? []).slice(0, 2);
  if (mates.length) {
    const link = (t: { name: string; slug: string | null }) =>
      t.slug ? a(m.playerUrl(t.slug), t.name) : escapeHtml(t.name);
    const names = mates.map(link);
    const joined = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0]!;
    const text =
      m.pos === "QB"
        ? `A quarterback change matters most for ${joined}, his ${mates.length === 2 ? "two most-targeted pass catchers" : "most-targeted pass catcher"} this season.`
        : `His absence would move work to the rest of the offense, and ${joined} would lose one of ${mates.length === 1 ? "his" : "their"} main options.`;
    cards.push({ key: "others", title: "Who else it affects", html: text });
  }
  if (cards.length === 0) return null;
  const pos = m.pos.toLowerCase();
  return {
    heading: `If ${m.last} misses time`,
    cards,
    cta: {
      text: `Want a backup plan at ${POS_WORD[m.pos] ?? m.pos} before you need one?`,
      href: `${REDRAFT_COMMAND_URL}?position=${encodeURIComponent(pos)}`,
      label: `See rest-of-season ${m.pos} rankings in Redraft Command`,
    },
  };
}

/* ------------------------------------------- the premium comparison's model */

/** One practice day, as the strip prints it: "Wed: Limited". */
export interface PremiumPracticeDay {
  day: string;
  text: string;
  kind: string;
}

export interface PremiumPracticeWeek {
  week: number;
  current: boolean;
  where: string;
  injury: string | null;
  days: PremiumPracticeDay[];
  game: { text: string; kind: string };
}

/**
 * What the premium Injury Status and History comparison prints from (mak's
 * brief, 2026-11-05; lib/player/injury-premium.ts): the same model the tab's
 * own sections read, exposed as facts so the two cannot disagree. Null when
 * the tab itself would not render.
 */
export interface InjuryPremiumModel {
  name: string;
  last: string;
  pos: string;
  posWord: string;
  nickname: string | null;
  logo: string | null;
  season: number;
  out: boolean;
  /** `part`: the designation's body part ("Hamstring") while he carries one, for the phone's status cell. */
  status: {
    code: StatusCode;
    word: string;
    kind: string;
    answer: string;
    part: string | null;
    checked: { iso: string; text: string } | null;
    stale: boolean;
    /**
     * What the normalized status (current-status.ts) adds: a previous week's
     * designation as history, a missed last game with no new status, or a
     * stale feed. Visible body text only - the answer sentence above feeds
     * the meta description and is unchanged.
     */
    note: string | null;
  };
  cells: StatusCell[];
  practice: { head: string; note: string | null; empty: string | null; weeks: PremiumPracticeWeek[] };
  healthy: string | null;
  events: InjuryEvent[];
  contingency: ContingencyModel | null;
}

export function injuryPremiumModel(data: PlayerPageData, options: PlayerRenderOptions = {}): InjuryPremiumModel | null {
  const m = model(data, options);
  if (!m) return null;
  const out = m.code === "O" || m.code === "IR" || m.code === "PUP" || m.code === "NFI";
  const cs = data.currentStatus;
  const stale = (m.checkedMs > 0 && m.next !== null && m.now - m.checkedMs > STALE_MS) || cs?.freshness === "stale";
  const pending = m.code === "ACTIVE" && cs?.kind === "pending";
  // No designation (WEB-039, 2026-11-24): "No designation yet" until this
  // week's report has its game statuses, never "Active" - a missing or empty
  // report is not a clean bill of health. Neutral, not green, until then.
  const undesignated = m.code === "ACTIVE" && !pending && m.next !== null;
  const notYet = m.notYet;
  // The note under the status: the shared record's own sentence (what this
  // week's report says, practice, last week's tag as history, a Sleeper tag
  // that is not official) whenever it adds to the card's line above.
  const adds = !!cs && (cs.reportState !== "final" || !!cs.practice || !!cs.prior || cs.source === "sleeper");
  const statusNote = !cs
    ? null
    : pending || (undesignated && adds)
      ? cs.message
      : m.code === "ACTIVE" && cs.prior
        ? `No current game designation reported. Listed ${cs.prior.status} for Week ${cs.prior.week}.`
        : cs.freshness === "unavailable" && m.next
          ? "Current injury report unavailable; this is the last known status."
          : null;
  const weeks: PremiumPracticeWeek[] = m.practice.map((r) => ({
    week: r.week,
    current: r.current,
    where: r.where,
    injury: r.injury,
    days: r.days.map((d) => {
      if (d.value === "PENDING") return { day: d.day, text: `due ${mmmD(d.date)}`, kind: "soon" };
      const [kind, text] = PILL[d.value]!;
      return { day: d.day, text: `${text}${d.estimated ? " (est.)" : ""}`, kind };
    }),
    game: r.game.kind === "soon" ? { text: `Due ${r.days[r.days.length - 1]!.day}`, kind: "soon" } : r.game,
  }));
  // No report rows: a player with a designation has a report the feed has
  // not carried yet, which is not the same as never being listed.
  const listed = m.code !== "ACTIVE" && m.code !== "OFFSEASON" && m.code !== "SUSP";
  const empty = m.next
    ? weeks.length
      ? null
      : listed
        ? `No practice report on file for Week ${m.next.week} yet.`
        : `${m.last} hasn't appeared on an injury report this season.`
    : null;
  return {
    name: m.name,
    last: m.last,
    pos: m.pos,
    posWord: POS_WORD[m.pos] ?? m.pos,
    nickname: m.nickname,
    logo: data.team?.logo ?? null,
    season: m.season,
    out,
    status: {
      code: m.code,
      word: pending ? "Status pending" : undesignated ? (notYet ? NO_DESIGNATION_YET : NO_DESIGNATION) : STATUS_WORD[m.code],
      kind: pending ? "mid" : notYet ? "susp" : STATUS_KIND[m.code],
      answer: statusAnswer(m),
      part: ["Q", "D", "O", "IR", "PUP", "NFI"].includes(m.code) && m.bodyPart ? m.bodyPart : null,
      checked: m.checkedMs > 0 ? { iso: new Date(m.checkedMs).toISOString(), text: stampText(m.checkedMs) } : null,
      stale,
      note: statusNote,
    },
    cells: statusCells(m, data),
    practice: { head: m.practiceHead, note: m.practiceNote, empty, weeks },
    healthy: healthyRow(m),
    events: m.events,
    contingency: contingencyModel(m, data),
  };
}

/** The timeline's words for an event, shared with the premium cards. */
export function eventWords(ev: InjuryEvent): { title: string; side: string; meta: string; chip: { kind: string; text: string } } {
  const side = ev.side ? (ev.side === "R" ? "Right" : "Left") : "";
  const title = /\b(surgery)\b/i.test(ev.type) || !ev.surgery ? ev.type : `${ev.type}, surgery`;
  const chip =
    ev.phase === "POST" ? { kind: "mid", text: "Postseason" } : ev.games > 0 ? { kind: "bad", text: `${games(ev.games)} missed` } : ev.pending ? { kind: "mid", text: "No report yet" } : { kind: "mid", text: "Played through" };
  return { title, side, meta: metaFor(ev), chip };
}

/* ------------------------------------------------------- section 6: FAQ */



/**
 * The Injury FAQ pool (faq-engine.ts), state-aware (mak, 2026-09-30). A healthy
 * player is asked the healthy questions; a designation adds what the injury
 * is and why he isn't playing. "Is he playing today" shows only on a game
 * day, "did he practice today" only on a day with a report reading. Return
 * timelines are never asked: nothing in the data says when anyone comes back.
 */
function injuryPool(m: Model, data: PlayerPageData, options: PlayerRenderOptions): FaqCandidate[] {
  const pool: FaqCandidate[] = [];
  const asOf = m.checkedMs > 0 ? longDate(m.checkedMs) : null;
  const part = m.bodyPart ? `${m.bodyPart.toLowerCase()} injury` : "injury";
  const hurt = !["ACTIVE", "OFFSEASON", "SUSP"].includes(m.code);
  const statusWord = m.code === "IR" ? "on injured reserve" : STATUS_WORD[m.code].toLowerCase();
  const outlookHref = sectionHref(data, options, "outlook");
  const outlook = outlookHref ? { href: outlookHref, text: `See how the injury changes his rest-of-season value.` } : null;
  const missedLine =
    m.seasonMissed === 0 && m.playedThisSeason > 0
      ? m.seasonOut
        ? ` No injury has cost him a game in ${m.season}.`
        : ` He has played every game in ${m.season}.`
      : m.seasonMissed ? ` He has missed ${games(m.seasonMissed)} to injury this season.` : "";

  // 1. Is he injured?
  pool.push({
    key: "injured",
    q: `Is ${m.name} injured?`,
    a: m.code === "SUSP"
      ? `No. ${asOf ? `As of ${asOf}, ` : ""}${m.name} is suspended, not injured.${missedLine}`
      : hurt
        ? `Yes. ${asOf ? `As of ${asOf}, ` : ""}${m.name} is ${statusWord}${m.bodyPart ? ` with ${article(part)}` : ""}.${missedLine}`
        : m.notYet
          ? `No. ${asOf ? `As of ${asOf}, ` : ""}${m.name} has no injury designation for Week ${m.next!.week} yet; the club's game statuses are not out.${missedLine}`
          : `No. ${asOf ? `As of ${asOf}, ` : ""}${m.name} is ${m.code === "ACTIVE" ? "active" : "healthy"} with no injury designation.${missedLine}`,
    link: hurt ? outlook : null,
  });

  // 2. Playing this week (the week named in the answer, never hard-coded).
  if (m.next) {
    const opp = m.next.opponent?.nickname ?? m.next.opponentName;
    const date = m.next.kickoffMs ? (() => { const p = et(m.next.kickoffMs!); return `${new Date(m.next.kickoffMs!).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" })}, ${MONTHS[p.m - 1]} ${p.d}`; })() : "";
    const vs = `Week ${m.next.week} ${m.next.homeAway === "home" ? "against" : "at"} the ${opp}${date ? ` on ${date}` : ""}`;
    let s =
      m.code === "ACTIVE" && m.notYet
        ? `${m.name} has no injury designation for ${vs} yet; the club's game statuses are not out.`
        : m.code === "ACTIVE"
        ? `${m.name} has no injury designation for ${vs}, so he is on track to play.`
        : m.code === "O" || m.code === "IR" || m.code === "PUP" || m.code === "NFI" || m.code === "SUSP"
          ? `No. ${m.name} is ${statusWord} for ${vs}.`
          : `${m.name} is ${statusWord} for ${vs}.`;
    if (m.practiceNote) s += ` ${m.practiceNote}`;
    if (m.code === "Q" && !/game-time/.test(s)) s += " Treat him as a game-time decision.";
    pool.push({
      key: "playing",
      q: `Is ${m.name} playing this week?`,
      a: s,
      link: { href: `${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(m.slug)}`, text: `Should you start him?`, cta: "startsit-injury-faq" },
    });

    // 3. Today, on a game day only.
    if (m.next.kickoffMs && etDay(m.next.kickoffMs) === etDay(m.now)) {
      const p = et(m.next.kickoffMs);
      pool.push({
        key: "today",
        q: `Is ${m.name} playing today?`,
        a: (hurt ? `${m.name} is ${statusWord} for today's game` : `${m.name} has no injury designation for today's game`) +
          ` ${m.next.homeAway === "home" ? "against" : "at"} the ${opp}${m.next.timeConfirmed ? `, kickoff ${p.time} ET` : ""}.` +
          (hurt ? ` Check the inactive list, released about 90 minutes before kickoff.` : ` He is expected to be active barring a late change.`),
      });
    }
  }

  // 4. Practice: today when there is a reading for today, else this week.
  const row = m.practice.find((r) => r.current);
  if (row) {
    const read = row.days.filter((d) => d.value === "FULL" || d.value === "LIMITED" || d.value === "DNP" || d.value === "NONE");
    const today = read.find((d) => d.date === etDay(m.now));
    const word = (v: string): string => (v === "FULL" ? "full" : v === "LIMITED" ? "limited" : v === "DNP" ? "did not practice" : "not listed");
    if (read.length) {
      const days = read.map((d) => `${d.day} ${word(d.value)}`).join(", ");
      const onReport = read.some((d) => d.value !== "NONE");
      pool.push(
        today
          ? {
              key: "practice",
              q: `Did ${m.name} practice today?`,
              a: today.value === "NONE"
                ? `${m.name} was not on today's injury report, which lists only players with an injury, so he practiced without limits. His Week ${row.week} report so far: ${days}.`
                : `${m.name} was ${today.value === "DNP" ? "a non-participant" : `a ${word(today.value)} participant`} in today's practice. His Week ${row.week} report so far: ${days}.`,
            }
          : {
              key: "practice",
              q: `Did ${m.name} practice this week?`,
              a: onReport
                ? `${possessive(m.name)} Week ${row.week} practice report: ${days}.${m.practiceNote ? ` ${m.practiceNote}` : ""}`
                : `${m.name} has not been on the Week ${row.week} injury report, which lists only players with an injury, so he has practiced without limits.`,
            },
      );
    }
  }

  // 5. What the injury is, and 6. why he isn't playing (designated only).
  if (hurt && m.bodyPart) {
    pool.push({
      key: "what",
      q: `What injury does ${m.name} have?`,
      a: `${m.name} has ${article(part)} and is ${statusWord}${m.next ? ` for Week ${m.next.week}` : ""}.` +
        (m.practiceNote ? ` ${m.practiceNote}` : "") + missedLine,
    });
  }
  if (["O", "IR", "PUP", "NFI"].includes(m.code)) {
    pool.push({
      key: "why",
      q: `Why isn't ${m.name} playing?`,
      a: `${m.name} is ${statusWord}${m.bodyPart ? ` with ${article(part)}` : ""}, ${
        data.currentStatus?.source === "sleeper" ? "reported since his last game and not yet on the official injury report" : "the designation his club filed"
      }${asOf ? ` as of ${asOf}` : ""}.` +
        (m.next ? ` That rules him out of Week ${m.next.week}.` : ""),
    });
  }

  // 7. Games missed this season.
  if (m.seasonMissed !== null && m.playedThisSeason + (m.seasonMissed ?? 0) > 0) {
    pool.push({
      key: "missed",
      q: `Has ${m.name} missed any games this season?`,
      a: m.seasonMissed === 0
        ? m.seasonOut
          ? `Not to injury. ${m.name} has played in ${games(m.playedThisSeason)} in ${m.season}, and no injury has kept him out of one.`
          : `No. ${m.name} has played in every ${m.nickname ?? "team"} game in ${m.season}, ${games(m.playedThisSeason)} so far.`
        : `Yes. ${m.name} has missed ${games(m.seasonMissed)} to injury in ${m.season} and played in ${m.playedThisSeason}.`,
    });
  }

  // 8. Injury history, 9. most recent, 10. recurring, 11. worst.
  const missed = m.events.filter((e) => e.games > 0).sort((x, y) => y.games - x.games || y.season - x.season);
  const named = (e: InjuryEvent): string => [sideWord(e), injuryName(e.type)].filter(Boolean).join(" ");
  if (m.t.injuries > 0) {
    pool.push({
      key: "history",
      q: `What is ${possessive(m.name)} injury history?`,
      a: `${m.name} has ${m.t.injuries} logged NFL injur${m.t.injuries === 1 ? "y" : "ies"}` +
        (m.t.games > 0
          ? `, which ${m.t.injuries === 1 ? "has" : "have"} cost him ${games(m.t.games)} in all: ${listWords(missed.map((e) => `${e.games} for ${article(named(e))} in ${e.season}`))}.`
          : m.t.injuries === 1 ? `, which did not cost him a regular-season game.` : `, none of which has cost him a regular-season game.`) +
        ` ${m.t.injuries > 1 && m.t.parts === m.t.injuries ? "No body part has been injured twice." : ""}`.trimEnd(),
    });
  }
  const latest = m.t.latest;
  if (latest) {
    const when =
      latest.phase === "PRE" ? `the ${latest.season} preseason` : latest.week ? `Week ${latest.week} of ${latest.season}` : String(latest.season);
    pool.push({
      key: "latest",
      q: `What was ${possessive(m.name)} most recent injury?`,
      a: `${possessive(m.name)} most recent logged injury was ${article(named(latest))} in ${when}. ` +
        (latest.games > 0 ? `It cost him ${games(latest.games)}.` : latest.pending ? "No injury report has listed it yet." : "He played through it and missed no regular-season games."),
    });
  }
  const byCat = new Map<string, InjuryEvent[]>();
  for (const e of m.events) if (e.category !== OTHER_CATEGORY) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
  const repeats = [...byCat.entries()].filter(([, v]) => v.length >= 2).sort((x, y) => y[1].length - x[1].length);
  if (m.t.injuries > 0) {
    pool.push({
      key: "recurring",
      q: `Does ${m.name} have any recurring injuries?`,
      a: repeats.length === 0
        ? `No. ${possessive(m.name)} ${word(m.t.injuries)} logged ${m.t.injuries === 1 ? "injury was" : `injuries were to ${word(m.t.parts)} different body parts`}, so the record shows no recurring pattern.`
        : `Yes: ${listWords(repeats.map(([cat, evs]) => {
            const yrs = [...new Set(evs.map((e) => e.season))].sort((x, y) => x - y);
            const g = evs.reduce((n, e) => n + e.games, 0);
            return `${cat.toLowerCase().split(" / ")[0]} injuries in ${listWords(yrs.map(String))} (${g ? `${games(g)} missed` : "no games missed"})`;
          }))}.`,
    });
  }
  const worst = m.t.longest;
  if (worst && worst.games > 0) {
    pool.push({
      key: "worst",
      q: `What was ${possessive(m.name)} worst injury?`,
      a: `${possessive(m.name)} longest absence came from ${article(named(worst))} in ${worst.season}, which cost him ${games(worst.games)}` +
        (m.t.games > worst.games ? ` of the ${m.t.games} he has missed in his career.` : `, all of the games he has missed to injury.`),
    });
  }
  return pool;
}

function renderFaq(data: PlayerPageData, items: FaqItem[]): string {
  // The page's FAQPage node is built from these same items (faqText in
  // injuryTabParts), so the section itself pushes nothing to the sink.
  return renderFaqSection("injury", data, items, {}, "scp-in-faq");
}

/* ------------------------------------------------------------------ the tab */

export interface InjuryTabParts {
  /** Everything above the footer. */
  body: string;
  /** Empty since 2026-10-22: the methodology footer was removed (mak). */
  foot: string;
  /** The FAQ, in its own .scp-in wrapper so it can stand after the peers rail. */
  faq: string;
  /** The FAQ as plain text, for the FAQPage node. */
  faqText: Array<{ question: string; answer: string }>;
}

/** The tab with its FAQ last, as one block. */
export function renderInjuryTab(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
  moreFaq: Array<{ question: string; answer: string }> = [],
  tail = "",
): string {
  const parts = injuryTabParts(data, options, moreFaq, tail);
  return parts ? parts.body + parts.foot + parts.faq : "";
}

/**
 * The tab split at its FAQ: mak moved the FAQ under the Nearby Positional
 * Peers rail (2026-09-30), and the rail belongs to the page, not the tab.
 */
export function injuryTabParts(
  data: PlayerPageData,
  options: PlayerRenderOptions = {},
  moreFaq: Array<{ question: string; answer: string }> = [],
  /** The tab's body: the premium dashboard (player-render.ts renderInjury). */
  tail = "",
): InjuryTabParts | null {
  const m = model(data, options);
  if (!m) return null;
  // The tab's body IS the premium dashboard (lib/player/injury-premium.ts,
  // mak's brief of 2026-11-05; "remove the older version" the same day),
  // handed in as `tail` by player-render.ts renderInjury(). The sections it
  // replaced (question + status strip + practice grid, durability, history,
  // contingency, glance, body map) were deleted 2026-11-10; the premium
  // prints from their models (injuryPremiumModel, durabilityParts), so the
  // words and numbers are the same. The FAQ below is unchanged.
  const body = tail;
  const faqItems = selectFaq(injuryPool(m, data, options));

  // No methodology footer since 2026-10-22 (mak): the status strip carries
  // its own "Checked" stamp, and the scoring note lives in the header.
  const ink = teamInk(data.team);
  const wrap = (html: string) =>
    `<div class="scp-ox scp-st scp-in"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${html}</div>`;
  return {
    body: wrap(body),
    foot: "",
    faq: wrap(renderFaq(data, faqItems)),
    faqText: faqItems.map((f) => ({ question: f.q, answer: f.text })),
  };
}
