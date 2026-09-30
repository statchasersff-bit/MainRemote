/**
 * The Injury tab's spec sections, to mak's "Build Instructions: StatChasers
 * Player Injury Tab" of 2026-09-30, appended UNDER the tab's existing content
 * (mak's instruction; see new-spec-sections-go-below).
 *
 * Seven parts: current status with the practice grid, the history at a
 * glance, the body map with the body-part table and risk factors, the dated
 * timeline with its sidebar, "if he misses time", a FAQ, and the footer. Every
 * count comes from injury-tab-data.ts's one event list, so the tiles, map,
 * table, timeline and FAQ agree (4.9).
 *
 * Where the spec asks for something this server cannot supply:
 *   - Status is the Sleeper roster designation the rest of the page uses;
 *     "Status checked" is when that snapshot was taken, never the render time.
 *   - Practice participation is the league's official report, read from
 *     NFL.com by scripts/player/buildPracticeReports.mjs. Days are only known
 *     from the day that builder first ran; before that a week has its final
 *     report only, and the earlier days print "—" (no entry in our data).
 *   - The history records carry no source, so no entry has a source link and
 *     the section says so (the spec's "unsourced isn't published" rule would
 *     empty the timeline; left for mak).
 *   - SEO is untouched (mak): no title, meta or JSON-LD, and this FAQ is not
 *     added to the page's FAQPage node.
 */

import { escapeHtml } from "../render";
import { titleCase } from "./title-case";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { SCORING_SHORT } from "./scoring";
import { lastName, STARTSIT_BASE, teamInk } from "./header";
import { getTeamByAbbreviation } from "../team/teams";
import {
  bodyMap,
  buildEvents,
  labelWidth,
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
import type { UpcomingGame } from "./upcoming";

const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const POS_WORD: Record<string, string> = { QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end" };
/** A snapshot older than this, in season, gets the "Latest report pending" note. */
const STALE_MS = 24 * 60 * 60 * 1000;
/** Past this many entries the timeline shows the newest ten and folds the rest. */
const TIMELINE_FOLD = 15;

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

function open(id: string, heading: string, lede: string, extra = ""): string {
  return (
    `<section class="scp-ox-sec${extra}" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase(heading))}</h2>` +
    (lede ? `<p class="scp-ox-lede">${escapeHtml(lede)}</p>` : "")
  );
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

function timeTag(ms: number, text: string): string {
  return `<time datetime="${escapeHtml(new Date(ms).toISOString())}">${escapeHtml(text)}</time>`;
}

/* ------------------------------------------------------------------ model */

type StatusCode = "ACTIVE" | "Q" | "D" | "O" | "IR" | "PUP" | "NFI" | "SUSP" | "OFFSEASON";

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
  lastPlayedWeek: number | null;
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
    lastPlayedWeek: injury.lastPlayedWeek,
    playedThisSeason,
    report,
    practice: [],
    practiceHead: "",
    practiceNote: null,
    starter: data.depth?.order === 1,
    rc: `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(player.slug)}`,
    hasOutlook:
      /\S/.test(data.fantasyOutlook2026?.body ?? "") ||
      Boolean(data.fantasyOutlook2026?.weeklyRole || data.fantasyOutlook2026?.restOfSeason) ||
      (data.outlookDrivers ?? []).length > 0,
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
  if (past) return { text: "—", kind: "none" };
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
      let first = "No injury designation.";
      if (m.next) {
        const at = m.next.homeAway === "home" ? "against the" : "at the";
        first = `No injury designation for ${wk} ${at} ${nextGameText(m.next).opp}.`;
      }
      const missed =
        m.seasonMissed === 0 && m.playedThisSeason > 0
          ? ` ${m.last} has not missed a game this season.`
          : m.seasonMissed
            ? ` ${m.last} has missed ${games(m.seasonMissed)} this season.`
            : "";
      return first + missed;
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

/**
 * One status strip: the status and its answer, then three short facts. It was
 * four ~160px cards under their own "Is he injured?" heading; mak asked for one
 * strip of about 100px with the status dominant and the timestamp out of the
 * way in the corner (2026-09-30).
 */
function renderStatus(m: Model, data: PlayerPageData): string {
  const kind = STATUS_KIND[m.code];
  const word = STATUS_WORD[m.code];
  const stale = m.checkedMs > 0 && m.next !== null && m.now - m.checkedMs > STALE_MS;
  const checked =
    m.checkedMs > 0
      ? `<span class="scp-in-checked">Checked ${timeTag(m.checkedMs, stampText(m.checkedMs))}` +
        (stale ? ` <span class="scp-in-stale">· latest report pending</span>` : "") +
        `</span>`
      : "";

  const cells: string[] = [];
  if (m.seasonMissed !== null) {
    const lp = m.lastPlayedWeek;
    const g = lp !== null ? data.schedule.find((s) => s.week === lp && s.kickoffMs !== null) : null;
    cells.push(
      cell(
        `${m.season} games missed`,
        String(m.seasonMissed),
        lp !== null ? `Last played Week ${lp}${g ? `, ${mmmD(et(g.kickoffMs!).iso)}` : ""}` : "Hasn't played this season",
      ),
    );
  }
  const latest = m.t.latest;
  if (latest) {
    const when = latest.phase === "PRE" ? `Preseason ${latest.season}` : latest.week ? `Week ${latest.week}, ${latest.season}` : String(latest.season);
    cells.push(
      cell(
        "Latest injury",
        latest.category === OTHER_CATEGORY ? cap(injuryName(latest.type)) : latest.category.split(" / ")[0]!,
        `${when}, ${latest.games ? `${games(latest.games)} missed` : "played through"}`,
      ),
    );
  }
  if (m.next) {
    const { line } = nextGameText(m.next);
    const [where, ...when] = line.split(", ");
    cells.push(cell("Next game", `Week ${m.next.week} ${where}`, when.join(", ")));
  }

  return (
    `<div class="scp-in-statusbar">` +
    `<div class="scp-in-main is-${kind}">` +
    `<div class="scp-in-big">${escapeHtml(word)}</div>` +
    checked +
    `<p>${escapeHtml(statusAnswer(m))}</p>` +
    `</div>` +
    cells.join("") +
    `</div>`
  );
}

function cell(label: string, value: string, sub: string): string {
  return (
    `<div><div class="scp-in-label">${escapeHtml(label)}</div>` +
    `<div class="scp-in-v">${escapeHtml(value)}</div>` +
    (sub ? `<div class="scp-in-s">${escapeHtml(sub)}</div>` : "") +
    `</div>`
  );
}

const PILL: Record<string, [string, string]> = {
  FULL: ["full", "Full"],
  LIMITED: ["lim", "Limited"],
  DNP: ["dnp", "DNP"],
  NONE: ["none", "—"],
  MISSING: ["none", "—"],
};

function pill(kind: string, text: string): string {
  return `<span class="scp-pp is-${kind}">${escapeHtml(text)}</span>`;
}

function renderPractice(m: Model): string {
  if (!m.next) return "";
  const head =
    `<div class="scp-in-phead"><h3>Practice participation</h3>` +
    (m.practiceHead ? `<span>${escapeHtml(m.practiceHead)}</span>` : "") +
    `</div>`;
  if (m.practice.length === 0) {
    return (
      `<div class="scp-in-practice">${head}` +
      `<p class="scp-in-pread">${escapeHtml(`${m.last} hasn't appeared on an injury report this season.`)}</p></div>`
    );
  }
  // The column headers are the current week's days; a past week in a
  // different rhythm (a Thursday game) names its own in each cell's label.
  const dayNames = m.practice[0]!.days.map((d) => d.day);
  const rows = m.practice
    .map((r) => {
      const days = r.days
        .map((d, i) => {
          const label = d.day !== dayNames[i] ? `${d.day} ` : "";
          if (d.value === "PENDING") return `<td>${pill("soon", mmmD(d.date))}</td>`;
          const [kind, text] = PILL[d.value]!;
          return `<td>${pill(kind, `${label}${text}${d.estimated ? " (est.)" : ""}`)}</td>`;
        })
        .join("");
      const game = r.game.kind === "soon" ? pill("soon", `Due ${r.days[r.days.length - 1]!.day}`) : pill(r.game.kind, r.game.text);
      return (
        `<tr${r.current ? ` class="is-cur"` : ""}>` +
        `<th scope="row" class="scp-in-wk"><b>Week ${r.week}</b><small>${escapeHtml(r.where)}</small></th>` +
        `<td>${escapeHtml(r.injury ?? "—")}</td>` +
        days +
        `<td>${game}</td></tr>`
      );
    })
    .join("");
  const weeks = m.practice.map((r) => r.week).sort((x, y) => x - y);
  const caption = `${m.name} practice participation by day, Week${weeks.length > 1 ? "s" : ""} ${listWords(weeks.map(String))}`;
  return (
    `<div class="scp-in-practice">${head}` +
    (m.practiceNote ? `<p class="scp-in-pread"><strong>What it means:</strong> ${escapeHtml(m.practiceNote)}</p>` : "") +
    `<div class="scp-in-ptable"><table class="scp-ox-table">` +
    `<caption class="scp-in-sr">${escapeHtml(caption)}</caption>` +
    `<thead><tr><th scope="col">Week</th><th scope="col">Injury</th>` +
    dayNames.map((d) => `<th scope="col">${d}</th>`).join("") +
    `<th scope="col">Game status</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<div class="scp-in-plegend" aria-label="Legend">` +
    `<span>${pill("full", "Full")} 100% of reps</span>` +
    `<span>${pill("lim", "Limited")} fewer than normal reps</span>` +
    `<span>${pill("dnp", "DNP")} did not practice</span>` +
    `<span>${pill("soon", "Date")} report not out yet</span>` +
    `<span>${pill("none", "—")} no entry in our data</span>` +
    `</div></div>`
  );
}

function renderSection1(m: Model, data: PlayerPageData): string {
  return (
    // No heading: the tab's H1 sits right above, and the panel answers the
    // "is he injured?" question the old heading asked.
    `<section class="scp-ox-sec scp-in-now" aria-label="Current injury status">` +
    renderStatus(m, data) +
    renderPractice(m) +
    `</section>`
  );
}

/* ----------------------------------------------------- section 2: glance */

function glanceLede(m: Model): string {
  const { t } = m;
  if (t.injuries === 0) return `No logged injuries.`;
  const counts = new Map<string, number>();
  for (const ev of m.events) counts.set(ev.category, (counts.get(ev.category) ?? 0) + 1);
  const repeat = [...counts.entries()].filter(([c, n]) => n >= 2 && c !== OTHER_CATEGORY).sort((x, y) => y[1] - x[1])[0];
  let s =
    `${cap(word(t.injuries))} logged ${t.injuries === 1 ? "injury" : "injuries"} in ${word(m.seasonsPlayed)} season${m.seasonsPlayed === 1 ? "" : "s"}` +
    (repeat ? `, including ${word(repeat[1])} ${repeat[0].toLowerCase().split(" / ")[0]} injuries` : "") +
    ".";
  const top = t.longest;
  if (top && t.games > 0) {
    const others = m.events.filter((e) => e !== top).reduce((mx, e) => Math.max(mx, e.games), 0);
    const share = top.games / t.games;
    s +=
      share >= 0.5
        ? ` Most of his lost time came from ${article(injuryName(top.type))} in ${top.season}` +
          (others === 0 ? "; nothing else has cost him a game." : `; nothing else has cost him more than ${games(others)}.`)
        : ` His lost time is spread out: the most any one injury cost was ${games(top.games)}.`;
  } else if (t.games === 0) {
    s += " None of them has cost him a regular-season game.";
  }
  return s;
}

function renderGlance(m: Model, data: PlayerPageData): string {
  const { t } = m;
  const h = data.injury!.history;
  const tiles: string[] = [];
  if (h.grade && h.score !== null) {
    const kind = /^[AB]/.test(h.grade) ? "good" : /^C/.test(h.grade) ? "mid" : "bad";
    tiles.push(
      tile(
        `${escapeHtml(h.grade)}<small>${escapeHtml(`${h.score}/100`)}</small>`,
        "Durability score",
        "Based on games missed to injury, not games played",
        ` is-${kind}`,
      ),
    );
  }
  tiles.push(tile(String(t.games), "Games missed", "Career, regular season, all injuries"));
  tiles.push(tile(String(t.injuries), "Logged injuries", `Across ${t.parts} body part${t.parts === 1 ? "" : "s"}`));
  const top = t.longest;
  tiles.push(
    tile(
      top ? `${top.games}<small>game${top.games === 1 ? "" : "s"}</small>` : "—",
      "Longest absence",
      top ? `${cap([sideWord(top), injuryName(top.type)].filter(Boolean).join(" "))}, ${top.season}` : "No games missed to injury",
    ),
  );
  return (
    open("scp-in-glance-h", "Injury history at a glance", glanceLede(m)) +
    `<div class="scp-in-glance">${tiles.join("")}</div></section>`
  );
}

function tile(valueHtml: string, title: string, sub: string, extra = ""): string {
  return (
    `<div class="scp-in-gl${extra}"><div class="scp-in-glv">${valueHtml}</div>` +
    `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub)}</p></div>`
  );
}

/* --------------------------------------------------------- section 3: map */


function renderSvg(m: Model): string {
  const map = m.map;
  const figure =
    `<circle class="scp-bm-fig" cx="150" cy="42" r="22"/>` +
    `<rect class="scp-bm-fig" x="142" y="60" width="16" height="16" rx="4"/>` +
    `<path class="scp-bm-fig" d="M112 82 Q150 70 188 82 L183 192 Q150 202 117 192 Z"/>` +
    `<polyline class="scp-bm-limb" stroke-width="20" points="116,92 100,150 90,206"/>` +
    `<polyline class="scp-bm-limb" stroke-width="20" points="184,92 200,150 210,206"/>` +
    `<circle class="scp-bm-fig" cx="89" cy="216" r="11"/>` +
    `<circle class="scp-bm-fig" cx="211" cy="216" r="11"/>` +
    `<polyline class="scp-bm-limb" stroke-width="26" points="134,192 132,300 130,382"/>` +
    `<polyline class="scp-bm-limb" stroke-width="26" points="166,192 168,300 170,382"/>`;
  const lines = map.labels
    .map((l) => {
      const w = labelWidth(l.marker.title, l.marker.sub);
      const mk = l.marker;
      // Beside its marker: to the label's near edge. Below it: to its top.
      const below = l.y - 12 > mk.y + mk.r;
      const x2 = below
        ? l.column === "left"
          ? Math.min(8 + w / 2, mk.x)
          : Math.max(292 - w / 2, mk.x)
        : l.column === "left"
          ? Math.min(8 + w + 4, mk.x - mk.r)
          : Math.max(292 - w - 4, mk.x + mk.r);
      const y2 = below ? l.y - 13 : l.y + 3;
      return `<line class="scp-bm-line" x1="${mk.x}" y1="${mk.y}" x2="${Math.round(x2)}" y2="${y2}"/>`;
    })
    .join("");
  const markers = map.markers
    .map((mk) => `<circle class="${mk.thru ? "scp-bm-thru" : "scp-bm-hit"}" cx="${mk.x}" cy="${mk.y}" r="${mk.r}"/>`)
    .join("");
  const labels = map.labels
    .map((l) => {
      const x = l.column === "left" ? 8 : 292;
      const anchor = l.column === "left" ? "" : ` text-anchor="end"`;
      return (
        `<text class="scp-bm-t" x="${x}" y="${l.y}"${anchor}>${escapeHtml(l.marker.title)}</text>` +
        `<text class="scp-bm-s" x="${x}" y="${l.y + 15}"${anchor}>${escapeHtml(l.marker.sub)}</text>`
      );
    })
    .join("");
  const aria =
    map.markers.length > 0
      ? `Body map of ${m.name}'s injuries: ${map.markers.map((mk) => mk.aria).join("; ")}.`
      : `Body map of ${m.name}: no logged injuries.`;
  return (
    `<svg viewBox="0 0 300 400" role="img" aria-label="${escapeHtml(aria)}">` +
    figure +
    lines +
    markers +
    labels +
    `</svg>`
  );
}

function renderMap(m: Model): string {
  const map = m.map;
  let caption = "Front view: the player's right side is on your left.";
  if (map.sideless.length) caption += ` Side not recorded for the ${listWords(map.sideless)}.`;
  if (map.unplaced.length) caption += ` Not shown: ${listWords(map.unplaced.map((u) => u.toLowerCase()))}.`;
  if (m.t.injuries === 0) caption = "No logged injuries.";

  const figure =
    `<figure class="scp-in-bodymap">${renderSvg(m)}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;

  let right = "";
  if (m.t.injuries > 0) {
    const rows = m.t.rows
      .map(
        (r) =>
          `<tr><th scope="row">${escapeHtml(r.category)}</th><td>${r.injuries}</td>` +
          `<td>${r.games > 0 ? `<span class="scp-in-mbar" style="width:${Math.min(r.games * 10, 80)}px"></span>` : `<span class="scp-in-mbar is-zero"></span>`}${r.games}</td></tr>`,
      )
      .join("");
    const table =
      `<div class="scp-ox-tbl scp-in-parts"><table class="scp-ox-table">` +
      `<caption>Injuries by body part, regular-season games missed</caption>` +
      `<thead><tr><th scope="col">Body part</th><th scope="col">Injuries</th><th scope="col">Games missed</th></tr></thead>` +
      `<tbody>${rows}<tr class="is-tot"><th scope="row">Total</th><td>${m.t.injuries}</td><td>${m.t.games}</td></tr></tbody>` +
      `</table></div>`;
    const chip: Record<string, string> = { good: "Low risk", mid: "Moderate", bad: "High" };
    const factors =
      `<div class="scp-in-factors" aria-label="Injury risk factors">` +
      m.factors
        .map(
          (f) =>
            `<div class="scp-in-factor"><h3>${escapeHtml(f.title)}</h3><p>${escapeHtml(f.evidence)}</p>` +
            `<span class="scp-in-chip is-${f.level}">${chip[f.level]}</span></div>`,
        )
        .join("") +
      `</div>`;
    right = `<div>${table}${factors}</div>`;
  }

  return (
    open("scp-in-map-h", "Where he's been hurt", "Marker size shows games missed. A dashed ring means he played through it.") +
    `<div class="scp-in-mapwrap">${figure}${right}</div></section>`
  );
}

/* ---------------------------------------------------- section 4: history */

function chipFor(ev: InjuryEvent): string {
  if (ev.phase === "POST") return `<span class="scp-in-chip is-mid scp-in-miss">Postseason</span>`;
  if (ev.games > 0) return `<span class="scp-in-chip is-bad scp-in-miss">${games(ev.games)}</span>`;
  return `<span class="scp-in-chip is-mid scp-in-miss">Played through</span>`;
}

function metaFor(ev: InjuryEvent): string {
  const when =
    ev.phase === "PRE" ? "Preseason" : ev.phase === "POST" ? `Postseason${ev.week ? `, Week ${ev.week}` : ""}` : ev.week ? `Week ${ev.week}` : `${ev.season} season`;
  const club = ev.team ? getTeamByAbbreviation(ev.team)?.nickname : null;
  return club ? `${when}, with the ${club}` : when;
}

function renderEvent(ev: InjuryEvent): string {
  const side = ev.side ? (ev.side === "R" ? "Right" : "Left") : "";
  const node = ev.games > 0 ? "" : " is-thru";
  const title = /\b(surgery)\b/i.test(ev.type) || !ev.surgery ? ev.type : `${ev.type}, surgery`;
  return (
    `<li><span class="scp-in-yr">${ev.season}</span><span class="scp-in-node${node}"></span>` +
    `<div class="scp-in-ev"><h3>${escapeHtml(title)}` +
    (side ? ` <span class="scp-in-side">${side}</span>` : "") +
    ` ${chipFor(ev)}</h3>` +
    `<p class="scp-in-meta">${escapeHtml(metaFor(ev))}</p>` +
    (ev.note ? `<p>${escapeHtml(ev.note)}</p>` : "") +
    `</div></li>`
  );
}

function renderHistory(m: Model): string {
  const items: string[] = [];
  const thisSeason = m.events.some((e) => e.season === m.season);
  if (!thisSeason && m.seasonMissed === 0 && m.lastPlayedWeek !== null && m.playedThisSeason > 0) {
    items.push(
      `<li><span class="scp-in-yr">${m.season}</span><span class="scp-in-node is-now"></span>` +
        `<div class="scp-in-ev"><h3>Healthy <span class="scp-in-chip is-good scp-in-miss">0 games missed</span></h3>` +
        `<p class="scp-in-meta">${escapeHtml(m.lastPlayedWeek > 1 ? `Weeks 1–${m.lastPlayedWeek}` : "Week 1")}</p>` +
        `<p>${escapeHtml(`No injury has cost ${m.last} a game this season.`)}</p></div></li>`,
    );
  }
  const evs = m.events.map(renderEvent);
  let list: string;
  if (m.events.length >= TIMELINE_FOLD) {
    list =
      `<ol class="scp-in-tl">${items.join("")}${evs.slice(0, 10).join("")}</ol>` +
      `<details class="scp-in-more"><summary>${escapeHtml(`Show all ${m.events.length} injuries`)}</summary>` +
      `<ol class="scp-in-tl" start="11">${evs.slice(10).join("")}</ol></details>`;
  } else {
    list = `<ol class="scp-in-tl">${items.join("")}${evs.join("")}</ol>`;
  }
  const note =
    `<p class="scp-in-src">${escapeHtml(
      "Compiled injury record; entries are not individually sourced. Games missed are regular-season games.",
    )}</p>`;

  // Sidebar.
  const since = m.season - 3;
  const recentGames = m.events.filter((e) => e.season > since).reduce((n, e) => n + e.games, 0);
  const lastMissed = m.events.find((e) => e.games > 0)?.season ?? null;
  const missedSince =
    recentGames > 0
      ? `he's missed ${games(recentGames)} to injury since ${since + 1}`
      : lastMissed
        ? `he hasn't missed a game to injury since ${lastMissed}`
        : "he hasn't missed a regular-season game to a logged injury";
  const high = m.factors.filter((f) => f.level === "bad").length;
  const outlook = m.hasOutlook ? a(m.tabUrl("outlook"), "outlook") : "outlook";
  const roleRisk = m.starter
    ? m.pos === "QB"
      ? "keeping the job and the offense around him"
      : "how much of the work he keeps week to week"
    : "earning playing time";
  let impact: string;
  if (m.code !== "ACTIVE" && m.code !== "OFFSEASON" && m.code !== "SUSP") {
    impact =
      escapeHtml(`The current ${STATUS_WORD[m.code].toLowerCase()} designation is the first thing to weigh. Beyond it, `) +
      escapeHtml(`${missedSince}, and the bigger picture is in our `) +
      outlook +
      ".";
  } else if (high >= 2 || recentGames >= 6) {
    impact =
      escapeHtml(
        `Injury is a real part of ${m.last}'s risk: ${missedSince}. Build in a backup plan; the rest of the picture is in our `,
      ) +
      outlook +
      ".";
  } else {
    impact =
      escapeHtml(
        `Injury isn't the main risk to ${m.last}'s value: ${missedSince}. The bigger question is ${roleRisk}, which our `,
      ) +
      outlook +
      " covers.";
  }
  const lead =
    m.code === "ACTIVE"
      ? m.starter
        ? "A healthy starter"
        : "A healthy backup"
      : m.code === "OFFSEASON"
        ? "Heading into next season"
        : `${STATUS_WORD[m.code]} this week`;
  const sidebar =
    `<aside aria-label="Fantasy impact">` +
    `<div class="scp-ox-panel"><h3>Fantasy impact</h3><p class="scp-in-impact">${impact}</p></div>` +
    `<div class="scp-ox-panel is-rc"><h3>Redraft Command</h3>` +
    `<p>${escapeHtml(`${lead}: see how Redraft Command weighs that in ${m.last}'s rest-of-season rank and trade value.`)}</p>` +
    `<a class="scp-ox-btn" href="${escapeHtml(m.rc)}" data-cta="redraft-command-injury-sidebar">${escapeHtml(`Open ${m.last} in Redraft Command`)}</a>` +
    `</div></aside>`;

  return (
    `<section class="scp-ox-sec" aria-labelledby="scp-in-tl-h"><div class="scp-ox-read"><div>` +
    `<h2 class="scp-ox-h2" id="scp-in-tl-h">${escapeHtml(titleCase(`${m.name} injury history`))}</h2>` +
    `<p class="scp-ox-lede">Every logged injury, most recent first. Games missed are regular-season games.</p>` +
    list +
    note +
    `</div>${sidebar}</div></section>`
  );
}

/* ---------------------------------------------------- section 5: backup */

function renderContingency(m: Model, data: PlayerPageData, emphasis: boolean): string {
  if (!m.starter) return "";
  const next = data.depth?.next ?? null;
  const cards: string[] = [];
  if (next) {
    const nm = next.slug ? a(m.playerUrl(next.slug), next.name) : escapeHtml(next.name);
    const advice: Record<string, string> = {
      QB: `In superflex leagues he's worth a speculative bench spot for ${m.last} managers; in 1QB leagues he's a waiver add only if ${m.last} misses time.`,
      RB: `He's the handcuff: worth a bench spot in deeper leagues and for ${m.last} managers, since the same backfield work would pass to him.`,
      WR: `The targets would likely spread across the offense rather than pass to one player, so he's a waiver add only if ${m.last} misses time.`,
      TE: `Tight end targets would mostly move to the receivers, so he's a streaming option at best if ${m.last} misses time.`,
    };
    cards.push(
      `<div class="scp-ox-card"><h3>${escapeHtml(`Next man up: ${next.name}`)}</h3>` +
        `<p>${nm}${escapeHtml(` is next on the ${m.nickname ?? "team"} depth chart at ${POS_WORD[m.pos] ?? m.pos}. ${advice[m.pos] ?? ""}`)}</p></div>`,
    );
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
    cards.push(`<div class="scp-ox-card"><h3>Who else it affects</h3><p>${text}</p></div>`);
  }
  if (cards.length === 0) return "";
  const pos = m.pos.toLowerCase();
  const cta =
    `<div class="scp-in-cta"><span>${escapeHtml(`Want a backup plan at ${POS_WORD[m.pos] ?? m.pos} before you need one?`)}</span>` +
    a(
      `${REDRAFT_COMMAND_URL}?position=${encodeURIComponent(pos)}`,
      `See rest-of-season ${m.pos} rankings in Redraft Command`,
      ` data-cta="redraft-command-injury-backup"`,
    ) +
    `</div>`;
  return (
    open("scp-in-plan-h", `If ${m.last} misses time`, "", emphasis ? " scp-in-urgent" : "") +
    `<div class="scp-ox-two">${cards.join("")}</div>${cta}</section>`
  );
}

/* ------------------------------------------------------- section 6: FAQ */

function renderFaq(m: Model, options: PlayerRenderOptions): string {
  const items: Array<{ q: string; html: string }> = [];
  const asOf = m.checkedMs > 0 ? longDate(m.checkedMs) : null;
  const part = m.bodyPart ? `${m.bodyPart.toLowerCase()} injury` : "injury";

  // 1. Is he injured?
  let a1: string;
  if (m.code === "ACTIVE" || m.code === "OFFSEASON") {
    a1 =
      `No. ${asOf ? `As of ${asOf}, ` : ""}${m.last} is ${m.code === "ACTIVE" ? "active" : "healthy"} with no injury designation.` +
      (m.seasonMissed === 0 && m.playedThisSeason > 0 ? ` He has played every game in ${m.season}.` : "");
  } else if (m.code === "SUSP") {
    a1 = `No. ${asOf ? `As of ${asOf}, ` : ""}${m.last} is suspended, not injured.`;
  } else {
    a1 = `Yes. ${asOf ? `As of ${asOf}, ` : ""}${m.last} is ${m.code === "IR" ? "on injured reserve" : STATUS_WORD[m.code].toLowerCase()}${m.bodyPart ? ` with ${article(part)}` : ""}.`;
  }
  items.push({ q: `Is ${m.name} injured?`, html: escapeHtml(a1) });

  // 2. Is he playing this week?
  if (m.next) {
    const opp = m.next.opponent?.nickname ?? m.next.opponentName;
    const date = m.next.kickoffMs ? (() => { const p = et(m.next.kickoffMs!); return `${new Date(m.next.kickoffMs!).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" })}, ${MONTHS[p.m - 1]} ${p.d}`; })() : "";
    const vs = `Week ${m.next.week} ${m.next.homeAway === "home" ? "against" : "at"} the ${opp}${date ? ` on ${date}` : ""}`;
    let s =
      m.code === "ACTIVE"
        ? `He carries no injury designation heading into ${vs}.`
        : `He's ${m.code === "IR" ? "on injured reserve" : STATUS_WORD[m.code].toLowerCase()} heading into ${vs}.`;
    if (m.practiceNote) s += ` ${m.practiceNote}`;
    if (m.code === "Q" && !/game-time/.test(s)) s += " Treat him as a game-time decision.";
    if (m.practiceHead && /starts/.test(m.practiceHead)) s += ` The ${m.practiceHead.replace(/^Week (\d+) report starts/, "first Week $1 practice report comes out")}.`;
    const startSit = `${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(m.slug)}`;
    items.push({
      q: `Is ${m.name} playing this week?`,
      html: `${escapeHtml(s)} ${a(startSit, "Should you start him?", ` data-cta="startsit-injury-faq"`)}`,
    });
  }

  // 3. Most recent injury.
  const latest = m.t.latest;
  if (latest) {
    const when =
      latest.phase === "PRE" ? `the ${latest.season} preseason` : latest.week ? `Week ${latest.week} of ${latest.season}` : String(latest.season);
    const name = [sideWord(latest), injuryName(latest.type)].filter(Boolean).join(" ");
    const outcome = latest.games > 0 ? `It cost him ${games(latest.games)}.` : "He missed no regular-season games.";
    items.push({
      q: `What was ${m.name}'s most recent injury?`,
      html: escapeHtml(`${cap(article(name))} in ${when}. ${outcome}`),
    });
  }

  // 4. Games missed.
  const missed = m.events.filter((e) => e.games > 0).sort((x, y) => y.games - x.games || y.season - x.season);
  const parts = missed.map((e) => `${e.games} for ${article([sideWord(e), injuryName(e.type)].filter(Boolean).join(" "))} in ${e.season}`);
  items.push({
    q: `How many games has ${m.name} missed due to injury?`,
    html: escapeHtml(
      m.t.games === 0
        ? `None. ${m.last} hasn't missed a regular-season game to a logged injury.`
        : `${m.t.games} regular-season game${m.t.games === 1 ? "" : "s"} across his career: ${listWords(parts)}.`,
    ),
  });

  // 5. Recurring.
  const byCat = new Map<string, InjuryEvent[]>();
  for (const e of m.events) if (e.category !== OTHER_CATEGORY) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
  const repeats = [...byCat.entries()].filter(([, v]) => v.length >= 2).sort((x, y) => y[1].length - x[1].length);
  let a5: string;
  if (repeats.length === 0) {
    a5 =
      m.t.injuries === 0
        ? `None. ${m.last} has no logged injuries.`
        : `No. His ${word(m.t.injuries)} logged ${m.t.injuries === 1 ? "injury was" : `injuries were to ${word(m.t.parts)} different body parts`}.`;
  } else {
    const desc = repeats.map(([cat, evs]) => {
      const yrs = [...new Set(evs.map((e) => e.season))].sort((x, y) => x - y);
      const g = evs.reduce((n, e) => n + e.games, 0);
      return `${cat.toLowerCase().split(" / ")[0]} injuries in ${listWords(yrs.map(String))} (${g ? `${games(g)} missed` : "no games missed"})`;
    });
    a5 = `Yes: ${listWords(desc)}.`;
  }
  items.push({ q: `Does ${m.name} have any recurring injuries?`, html: escapeHtml(a5) });

  // Not pushed to options.faqSink: the FAQPage JSON-LD is an SEO change, which
  // mak approves separately.
  return (
    open("scp-in-faq-h", `${m.name} injury FAQ`, "") +
    `<div class="scp-ox-faq scp-in-faq">` +
    items.map((f, i) => `<details${i === 0 ? " open" : ""}><summary>${escapeHtml(f.q)}</summary><p>${f.html}</p></details>`).join("") +
    `</div></section>`
  );
}

/* ------------------------------------------------------------------ the tab */

export function renderInjuryTab(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const m = model(data, options);
  if (!m) return "";
  const out = m.code === "O" || m.code === "IR" || m.code === "PUP" || m.code === "NFI";
  const plan = renderContingency(m, data, out);
  const body =
    renderSection1(m, data) +
    (out ? plan : "") +
    renderGlance(m, data) +
    renderMap(m) +
    renderHistory(m) +
    (out ? "" : plan) +
    renderFaq(m, options);

  const doc = loadPracticeReports(data.leagueSeason);
  const checked = m.checkedMs > 0 ? ` Status last checked ${timeTag(m.checkedMs, stampText(m.checkedMs))}.` : "";
  const practice = doc?.updatedAt
    ? ` Practice participation is from the league's official injury report on NFL.com, last read ${timeTag(Date.parse(doc.updatedAt), stampText(Date.parse(doc.updatedAt)))}.`
    : "";
  const foot =
    `<footer class="scp-st-foot"><p>` +
    escapeHtml(
      "Injury status is the designation each club has filed, as our last check found it. " +
        "History covers regular-season games missed. The durability score measures time lost to injury only; games not played as a backup don't count against it.",
    ) +
    checked +
    practice +
    `</p><p>${escapeHtml(`Fantasy points use ${SCORING_SHORT[data.format]} scoring.`)}</p></footer>`;

  const ink = teamInk(data.team);
  return `<div class="scp-ox scp-st scp-in"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${body}${foot}</div>`;
}
