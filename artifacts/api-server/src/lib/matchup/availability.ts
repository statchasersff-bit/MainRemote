/**
 * Game-specific availability for the upcoming matchup page (P0 of mak's
 * 2026-11-18 preview brief: "never automatically carry a previous week's Out
 * designation into the current matchup").
 *
 * The roster's `injuryStatus` is Sleeper's `injury_status`, which is not tied
 * to a week: a player ruled Out for Week 10 still reads "Out" on the Tuesday
 * before Week 11, until the club's next report replaces it. The page used to
 * print that as this week's status (Kenneth Walker III, Out for KC at ATL in
 * Week 10, listed Out for ARI at KC in Week 11 before any Week 11 report
 * existed, while also being named the Chiefs' lead back).
 *
 * The rule, per player, for the game's own season and week:
 *
 *   1. Reserve lists (IR, PUP, NFI, suspension, ...) are not game
 *      designations; they stand until the player is activated. Kept.
 *   2. When the official NFL.com report for THIS week has the club (the
 *      practice store, data/player/practice_reports/<season>.json, refreshed
 *      three times a day on production), it decides: the player's game status
 *      once it is published (Friday for a Sunday game); before that, a player
 *      who missed the club's last game and is on the report is "pending"; a
 *      player not on the report has no designation.
 *   3. With no report for this week yet, a Sleeper game designation (Out,
 *      Doubtful, Questionable) is NOT believed as current: Sleeper's field is
 *      not tied to a week, and a designation is filed before the game it is
 *      for, so a player who was Questionable and played still reads
 *      Questionable the Tuesday after (Luther Burden III, Week 10 to Week 11,
 *      audit WEB-039, 2026-11-18). A player who missed the last game with one
 *      is "pending"; one who played has no current designation, and the
 *      note carries the old one as history. (Until 2026-11-19 a player who
 *      played kept the designation.)
 *
 * Nothing is inferred from news or headlines.
 */

import { dataPath } from "../data-dir";
import { loadGameLogs } from "../player/data";
import type { GameLogEntry } from "../player/types";
import type { RosterPlayer } from "../team/roster";
import { readDataJson } from "../team/read-json";
import type { NflTeam } from "../team/teams";

/** The status the page uses for a player whose designation this week is not confirmed. */
export const PENDING = "Pending";

export type AvailabilityKind = "active" | "questionable" | "doubtful" | "out" | "reserve" | "pending";

export interface Availability {
  kind: AvailabilityKind;
  /** The designation to show for THIS game, or null for none. "Pending" for kind "pending". */
  status: string | null;
  /** Where the status came from. */
  source: "nfl-report" | "sleeper" | "reserve" | "none";
  /** The club's last game before this one: its week, and whether this player played in it. */
  lastGame: { week: number; played: boolean } | null;
  /** The designation he carried for that last game, when known ("Out"). */
  priorStatus: string | null;
  /** The week's practice line so far, e.g. "DNP Wed", when the report has him. */
  practice: string | null;
  /** One plain sentence for the page; null when there is nothing to say. */
  note: string | null;
}

const RESERVE = new Set(["ir", "pup", "nfi", "sus", "suspended", "dnr", "cov", "na", "ir-r"]);
const GAME = new Set(["out", "doubtful", "questionable"]);

interface PracticeRow {
  name: string;
  pos: string;
  injury: string | null;
  gameStatus: string | null;
  final: string | null;
  days: Record<string, string>;
}
export interface PracticeDoc {
  weeks: Record<string, { teams: Record<string, Record<string, PracticeRow>> }>;
}

function practiceDoc(season: number): PracticeDoc | null {
  return readDataJson<PracticeDoc>(dataPath("player", "practice_reports", `${season}.json`));
}

/** "Kenneth Walker III" -> "kennethwalker", the same fold on both sides of a match. */
export function availabilityKey(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  while (words.length > 1 && /^(jr|sr|ii|iii|iv|v)$/.test(words[words.length - 1]!)) words.pop();
  return words.join("");
}

/** The club's rows on one week's report, by name key; null when the report does not have the club yet. */
function reportFor(season: number, week: number, team: NflTeam, doc?: PracticeDoc | null): Map<string, PracticeRow> | null {
  const wk = (doc === undefined ? practiceDoc(season) : doc)?.weeks?.[String(week)];
  if (!wk) return null;
  const club = wk.teams?.[team.nickname];
  if (!club || !Object.keys(club).length) return null;
  return new Map(Object.values(club).map((r) => [availabilityKey(r.name), r]));
}

/** The club's last game week before `week`, from every player's game log. Cached per season and log object. */
const lastWeekCache = new WeakMap<object, Map<string, number[]>>();
function teamWeeks(season: number, injected?: Record<string, GameLogEntry[]>): Map<string, number[]> {
  const logs = injected ?? loadGameLogs(season);
  const hit = lastWeekCache.get(logs);
  if (hit) return hit;
  const weeks = new Map<string, Set<number>>();
  for (const entries of Object.values(logs)) {
    for (const g of entries ?? []) {
      if (!g.team || !g.stats) continue;
      const code = g.team.toUpperCase();
      if (!weeks.has(code)) weeks.set(code, new Set());
      weeks.get(code)!.add(g.week);
    }
  }
  const out = new Map([...weeks].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
  lastWeekCache.set(logs, out);
  return out;
}

function playedIn(season: number, playerId: string, week: number, injected?: Record<string, GameLogEntry[]>): boolean {
  const g = ((injected ?? loadGameLogs(season))[playerId] ?? []).find((x) => x.week === week);
  if (!g || !g.stats) return false;
  const s = g.stats as unknown as Record<string, number | null | undefined>;
  // A snap on offense, defense or special teams, or a game played at all.
  return (s.off_snp ?? 0) > 0 || (s.def_snp ?? 0) > 0 || (s.st_snp ?? 0) > 0 || (s.gp ?? 0) > 0;
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

function practiceLine(r: PracticeRow): string | null {
  const days = Object.entries(r.days ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (days.length) {
    const [date, v] = days[days.length - 1]!;
    return `${v.toUpperCase() === "DNP" ? "DNP" : v.charAt(0) + v.slice(1).toLowerCase()} ${DAY.format(new Date(`${date}T12:00:00Z`))}`;
  }
  return r.final ? r.final.charAt(0) + r.final.slice(1).toLowerCase() : null;
}

function kindOf(status: string): AvailabilityKind {
  const s = status.toLowerCase();
  if (s === "out") return "out";
  if (s === "doubtful") return "doubtful";
  if (s === "questionable") return "questionable";
  return "reserve";
}

export interface AvailabilityOptions {
  /** False for a game that is not the club's next one. */
  nextGame?: boolean;
  /** The season's game logs; the stored file by default. For the tests. */
  logs?: Record<string, GameLogEntry[]>;
  /** The season's practice-report store; the stored file by default. For the tests. */
  practice?: PracticeDoc | null;
}

/**
 * Availability for every player on a roster, for one game. `weekLabel` is the
 * page's ("Week 11"), for the notes.
 */
export function gameAvailability(
  team: NflTeam,
  season: number,
  week: number,
  roster: RosterPlayer[],
  options: AvailabilityOptions = {},
): Map<string, Availability> {
  // A game that is not the club's next one has no designations yet: any
  // Out, Doubtful or Questionable on file belongs to an earlier game.
  // Reserve lists still apply.
  const nextGame = options.nextGame !== false;
  const out = new Map<string, Availability>();
  const report = reportFor(season, week, team, options.practice);
  const weeks = teamWeeks(season, options.logs).get(team.code.toUpperCase()) ?? [];
  const last = [...weeks].filter((w) => w < week).pop() ?? null;
  const lastReport = last !== null ? reportFor(season, last, team, options.practice) : null;

  for (const r of roster) {
    const raw = (r.injuryStatus ?? "").trim();
    const lower = raw.toLowerCase();
    const lastGame = last !== null ? { week: last, played: playedIn(season, r.id, last, options.logs) } : null;
    const prior = lastReport?.get(availabilityKey(r.name))?.gameStatus ?? null;
    const base = { lastGame, priorStatus: prior, practice: null as string | null };

    if (RESERVE.has(lower)) {
      out.set(r.id, { ...base, kind: "reserve", status: raw, source: "reserve", note: null });
      continue;
    }

    if (!nextGame) {
      out.set(r.id, { ...base, kind: "active", status: null, source: "none", note: null });
      continue;
    }

    if (report) {
      const row = report.get(availabilityKey(r.name)) ?? null;
      const practice = row ? practiceLine(row) : null;
      if (row?.gameStatus && GAME.has(row.gameStatus.toLowerCase())) {
        const status = row.gameStatus.charAt(0).toUpperCase() + row.gameStatus.slice(1).toLowerCase();
        out.set(r.id, { ...base, practice, kind: kindOf(status), status, source: "nfl-report", note: null });
      } else if (row && lastGame && !lastGame.played && (raw || prior)) {
        out.set(r.id, {
          ...base,
          practice,
          kind: "pending",
          status: PENDING,
          source: "nfl-report",
          note: `Missed Week ${lastGame.week}${row.injury ? ` (${row.injury.toLowerCase()})` : ""}; no Week ${week} game status yet${practice ? ` (practice: ${practice})` : ""}.`,
        });
      } else {
        out.set(r.id, { ...base, practice, kind: "active", status: null, source: row ? "nfl-report" : "none", note: null });
      }
      continue;
    }

    if (GAME.has(lower)) {
      if (lastGame && !lastGame.played) {
        const was = prior && GAME.has(prior.toLowerCase()) ? prior : raw;
        out.set(r.id, {
          ...base,
          kind: "pending",
          status: PENDING,
          source: "sleeper",
          note:
            `${was === "Out" || raw === "Out" ? "Out" : `Listed ${was}`} for Week ${lastGame.week}${r.injuryBodyPart ? ` (${r.injuryBodyPart.toLowerCase()})` : ""} and did not play; ` +
            `no Week ${week} designation yet.`,
        });
      } else {
        // Expired: filed for a game he then played (or for no known game).
        const was = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        out.set(r.id, {
          ...base,
          kind: "active",
          status: null,
          source: "none",
          note: lastGame
            ? `Listed ${was} for Week ${lastGame.week} and played; no Week ${week} designation reported yet.`
            : `No current game designation reported.`,
        });
      }
      continue;
    }

    out.set(r.id, { ...base, kind: "active", status: raw || null, source: raw ? "sleeper" : "none", note: null });
  }
  return out;
}

/**
 * One player's line on the club's official report for `week`, by name, for a
 * player the roster index does not carry (team-page depth charts list every
 * position; the index only skill players). Null when the report does not
 * have the club yet; `{ onReport: false }` when it does and he is not on it.
 */
export function reportLine(
  team: NflTeam,
  season: number,
  week: number,
  name: string,
  practice?: PracticeDoc | null,
): { onReport: boolean; gameStatus: string | null; practice: string | null } | null {
  const report = reportFor(season, week, team, practice);
  if (!report) return null;
  const row = report.get(availabilityKey(name));
  if (!row) return { onReport: false, gameStatus: null, practice: null };
  const gs = row.gameStatus && GAME.has(row.gameStatus.toLowerCase())
    ? row.gameStatus.charAt(0).toUpperCase() + row.gameStatus.slice(1).toLowerCase()
    : null;
  return { onReport: true, gameStatus: gs, practice: practiceLine(row) };
}

/** The club's last game week before `week`, from the stored logs; null when none. */
export function clubPreviousWeek(team: NflTeam, season: number, week: number, logs?: Record<string, GameLogEntry[]>): number | null {
  const weeks = teamWeeks(season, logs).get(team.code.toUpperCase()) ?? [];
  return [...weeks].filter((w) => w < week).pop() ?? null;
}

/** A reserve-list status (IR, PUP, NFI, suspension, ...), not a game designation. */
export function isReserveStatus(status: string | null | undefined): boolean {
  return RESERVE.has((status ?? "").trim().toLowerCase());
}

/**
 * The roster as the page should read it for this game: each player's
 * `injuryStatus` replaced by his game-specific status ("Pending" when it is
 * not confirmed), and his availability attached.
 */
export function gameRoster(
  team: NflTeam,
  season: number,
  week: number,
  roster: RosterPlayer[],
  options: AvailabilityOptions = {},
): Array<RosterPlayer & { availability?: Availability }> {
  const map = gameAvailability(team, season, week, roster, options);
  return roster.map((r) => {
    const a = map.get(r.id);
    if (!a) return r;
    return { ...r, injuryStatus: a.status, availability: a };
  });
}

/** Not expected to play: confirmed Out, on a reserve list, or pending after missing the last game. */
export function notExpected(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s === "out" || s === PENDING.toLowerCase() || RESERVE.has(s);
}

/**
 * Is `week` the club's next game? The first game on its schedule (same
 * season type) that has no result yet. True when the schedule is unknown,
 * which keeps the old behavior rather than hiding designations.
 */
export function isNextGame(
  games: Array<{ week: number; seasonType?: string; status?: string; awayScore?: number | null; homeScore?: number | null }> | null | undefined,
  week: number,
  seasonType?: string,
): boolean {
  if (!games?.length) return true;
  const open = games
    .filter((g) => (!seasonType || !g.seasonType || g.seasonType === seasonType) && g.status !== "final" && g.status !== "canceled" && g.awayScore == null)
    .sort((a, b) => a.week - b.week);
  return !open.length || open[0]!.week === week;
}
