/**
 * Games played and missed in one season - the one definition every player
 * component uses (audit WEB-039, 2026-11-18: Isiah Pacheco's page said 2, 4,
 * 5 and 9 games missed, from four different counts).
 *
 * The rule:
 *
 *   - A TEAM GAME is a week his club has a completed game in the stored game
 *     logs (the same per-club week list the matchup availability rule reads).
 *     Byes and unplayed weeks are not team games.
 *   - His club in a week is his own log row's team. For a week with no row,
 *     the nearest row's team (earlier first), else his current team - but a
 *     week before his first row counts only if an injury or reserve record
 *     covers it, so a player who joined in Week 8 is not charged Weeks 1-7.
 *   - PLAYED: a log row with a snap or Sleeper's game-played flag.
 *   - MISSED TO INJURY: a team game not played inside an injury entry's
 *     WINDOW: from the entry's week, his club's games he did not play, until
 *     the entry's games missed are used up or he plays again - counted in
 *     games, so a bye inside the window is skipped, not charged (WEB-039,
 *     2026-11-24: Pacheco's Week 6 bye). A game named on one of the entry's
 *     own report weeks counts too. An OPEN entry (the caller says he is still
 *     out: a reserve list, an Out, or pending) runs to the last completed
 *     game, so a stint the history builder last counted a week ago is not a
 *     week short (Pacheco: "9 games missed so far" beside 10). A game he
 *     played does not end a window while the same entry lists him again
 *     later (Out, a reserve list): it runs to its last report week
 *     (2026-11-27). Each week counts for one entry only, the earliest.
 *   - NOT PLAYED, REASON UNKNOWN: every other team game not played. Never
 *     called an injury: a healthy scratch, a suspension or a personal matter
 *     looks the same in a box score.
 *
 * Pure apart from reading the stored logs.
 */

import { loadGameLogs } from "./data";
import type { NflInjuryEntry } from "./injury";
import type { GameLogEntry } from "./types";

/** One injury entry's window in the season: the club games it cost him. */
export interface InjuryWindow {
  /** The entry's week (the history's `week`). */
  week: number;
  /** The history builder's count, as stored. */
  recorded: number;
  /** Club game weeks inside the window he did not play. */
  missedWeeks: number[];
  /** Still running: the caller said he is out, and he has not played since. */
  open: boolean;
  /**
   * The week of an earlier entry that already counts a game this one would
   * have: he did not play it, but it is that injury's game, not this one's.
   * Null when no game was shared. A row with no games of its own and this set
   * was not "played through" (Pittman's Week 11 foot listing while on IR).
   */
  sharedWith: { week: number; type: string } | null;
  /** The entry's injury ("Calf", "Injured reserve") and body part, so a reader can tie the window to a body region. */
  type: string;
  bodyPart: string | null;
}

export interface SeasonAvailability {
  season: number;
  /** The last completed week any club has played. */
  throughWeek: number;
  /** His club's completed games while he was on it. */
  teamGames: number;
  played: number;
  /** Team games not played, for any reason. */
  notPlayed: number;
  missedInjury: number;
  /** Not played and no injury record covers it. */
  notPlayedOther: number;
  weeksMissedInjury: number[];
  weeksNotPlayedOther: number[];
  /** The season's injury entries' windows, in the entries' order (season entries only). */
  windows: InjuryWindow[];
  /**
   * One letter per week 1..throughWeek, the durability grid's alphabet
   * (injury-impact gridiron.json `w`): P played, X missed to injury, - not
   * played for a reason no injury record names, B no club game (a bye), N not
   * yet on a club (a week before his first row that no record covers). The
   * Durability Profile draws the season on the page from it, so its boxes
   * are the same games as the season count (WEB-039, 2026-11-26).
   */
  weekCodes: string;
}

const clubWeeksCache = new WeakMap<object, Map<string, Set<number>>>();

/** Every club's completed game weeks, from the logs. */
function clubWeeks(season: number, injected?: Record<string, GameLogEntry[]>): Map<string, Set<number>> {
  const logs = injected ?? loadGameLogs(season);
  const hit = clubWeeksCache.get(logs);
  if (hit) return hit;
  const out = new Map<string, Set<number>>();
  for (const entries of Object.values(logs)) {
    for (const g of entries ?? []) {
      if (!g.team) continue;
      const code = g.team.toUpperCase();
      if (!out.has(code)) out.set(code, new Set());
      out.get(code)!.add(g.week);
    }
  }
  clubWeeksCache.set(logs, out);
  return out;
}

function playedRow(stats: Record<string, unknown> | undefined): boolean {
  if (!stats) return false;
  const n = (k: string): number => (typeof stats[k] === "number" ? (stats[k] as number) : 0);
  return n("off_snp") > 0 || n("def_snp") > 0 || n("st_snp") > 0 || n("gp") > 0;
}

export function seasonAvailability(input: {
  season: number;
  playerId: string;
  /** His current club code, for weeks no log row names. */
  currentTeam: string | null;
  injuries: NflInjuryEntry[];
  /** Count only weeks up to this one (default: every completed week). */
  throughWeek?: number;
  /** The season's logs, for the tests; the stored file by default. */
  logs?: Record<string, GameLogEntry[]>;
  /**
   * He is still out (reserve list, Out, or pending after a missed game): his
   * latest entry this season, if he has not played since it, is open and runs
   * through the last completed game.
   */
  stillOut?: boolean;
}): SeasonAvailability {
  const { season, playerId } = input;
  const clubs = clubWeeks(season, input.logs);
  let through = 0;
  for (const weeks of clubs.values()) for (const w of weeks) through = Math.max(through, w);
  if (input.throughWeek != null) through = Math.min(through, input.throughWeek);

  const rows = ((input.logs ?? loadGameLogs(season))[playerId] ?? []).slice().sort((a, b) => a.week - b.week);
  const rowByWeek = new Map(rows.map((r) => [r.week, r]));
  const firstRow = rows[0]?.week ?? null;

  const teamFor = (week: number): string | null => {
    const own = rowByWeek.get(week)?.team;
    if (own) return own.toUpperCase();
    const before = rows.filter((r) => r.week < week && r.team).pop();
    if (before?.team) return before.team.toUpperCase();
    const after = rows.find((r) => r.week > week && r.team);
    if (after?.team) return after.team.toUpperCase();
    return input.currentTeam ? input.currentTeam.toUpperCase() : null;
  };
  const clubGame = (w: number): boolean => {
    const club = teamFor(w);
    return !!club && !!clubs.get(club)?.has(w);
  };
  const played = (w: number): boolean => {
    const row = rowByWeek.get(w);
    return !!row && playedRow(row.stats as unknown as Record<string, unknown>);
  };

  // Each entry's window, walked in club games (see the header).
  const entries = input.injuries.filter((e) => e.season === season && typeof e.week === "number");
  // Entries in week order, so an earlier stint claims a week before a later
  // listing of the same absence does (the history builder's rule: each missed
  // week is one injury's). Michael Pittman Jr.'s Week 11 re-listing, while
  // still on IR from his Week 2 foot, must not count Week 11 a second time.
  const claimedWeeks = new Map<number, { week: number; type: string }>();
  const order = entries.map((_, i) => i).sort((a, b) => entries[a]!.week! - entries[b]!.week! || a - b);
  const windows: InjuryWindow[] = new Array(entries.length);
  for (const i of order) {
    const e = entries[i]!;
    const start = e.week!;
    const recorded = Math.max(0, e.gamesMissed ?? 0);
    const reportWeeks = new Set((e.reports ?? []).map((r) => r.week));
    // The stint runs at least to its own last report week: a game he played
    // inside it (a Questionable he played through) does not end it when the
    // same entry has him Out or on a reserve list later (WEB-039, 2026-11-27:
    // Alec Pierce played Weeks 1-2, was Out in Week 3 and on IR since, and
    // read "2026 games missed 0"; Pittman read 2 beside "7 games missed").
    const lastReport = Math.max(start, ...reportWeeks);
    const missedWeeks: number[] = [];
    let sharedWith: { week: number; type: string } | null = null;
    for (let w = start; w <= through; w += 1) {
      if (!clubGame(w)) continue;
      if (played(w)) {
        if (w > start && w >= lastReport) break;
        continue;
      }
      if (claimedWeeks.has(w)) {
        if (reportWeeks.has(w) || missedWeeks.length < recorded) sharedWith ??= claimedWeeks.get(w)!;
        continue;
      }
      if (missedWeeks.length >= recorded && !reportWeeks.has(w)) {
        if (w > lastReport) break;
        continue;
      }
      missedWeeks.push(w);
    }
    for (const w of missedWeeks) claimedWeeks.set(w, { week: start, type: e.type });
    windows[i] = { week: start, recorded, missedWeeks, open: false, sharedWith, type: e.type, bodyPart: e.bodyPart ?? null };
  }

  // Still out: the running stint is OPEN and runs through the last completed
  // game, so a stint the builder last counted a week ago is not a week short.
  // The running stint is the window holding his latest injury game (Pittman:
  // the Week 2 foot, not the Week 11 re-listing whose game it already
  // counts); with none yet, the latest entry. Never once he has played since.
  if (input.stillOut && windows.length) {
    let run: InjuryWindow | null = null;
    let last = -1;
    for (const win of windows) {
      const l = win.missedWeeks[win.missedWeeks.length - 1] ?? -1;
      if (l > last) [run, last] = [win, l];
    }
    if (!run) {
      const latest = entries.reduce((m, e, i) => (e.week! > entries[m]!.week! ? i : m), 0);
      run = windows[latest]!;
    }
    const from = last >= 0 ? last + 1 : run.week;
    let returned = false;
    for (let w = last >= 0 ? last + 1 : run.week + 1; w <= through; w += 1) if (clubGame(w) && played(w)) returned = true;
    if (!returned) {
      for (let w = from; w <= through; w += 1) {
        if (!clubGame(w) || played(w) || claimedWeeks.has(w)) continue;
        run.missedWeeks.push(w);
        claimedWeeks.set(w, { week: run.week, type: run.type });
      }
      run.open = true;
    }
  }

  const injuryWeeks = new Set<number>();
  for (const win of windows) for (const w of win.missedWeeks) injuryWeeks.add(w);

  const out: SeasonAvailability = {
    season,
    throughWeek: through,
    teamGames: 0,
    played: 0,
    notPlayed: 0,
    missedInjury: 0,
    notPlayedOther: 0,
    weeksMissedInjury: [],
    weeksNotPlayedOther: [],
    windows,
    weekCodes: "",
  };
  for (let w = 1; w <= through; w += 1) {
    const club = teamFor(w);
    if (!club || !clubs.get(club)?.has(w)) {
      out.weekCodes += "B";
      continue;
    }
    const row = rowByWeek.get(w);
    // Before his first row: on the roster only if a record says so.
    if (!row && (firstRow === null || w < firstRow) && !injuryWeeks.has(w)) {
      out.weekCodes += "N";
      continue;
    }
    out.teamGames += 1;
    if (played(w)) {
      out.played += 1;
      out.weekCodes += "P";
      continue;
    }
    out.notPlayed += 1;
    if (injuryWeeks.has(w)) {
      out.missedInjury += 1;
      out.weeksMissedInjury.push(w);
      out.weekCodes += "X";
    } else {
      out.notPlayedOther += 1;
      out.weeksNotPlayedOther.push(w);
      out.weekCodes += "-";
    }
  }
  return out;
}

/**
 * His club's game in `week` is still to be played: past the season's last
 * completed week, or a week his club has no completed game in yet. A week
 * on the injury report never is a bye, so "B" there is a game to come
 * (Wednesday's Packers game logged, Sunday's still to play). An injury
 * listed only for such a week has cost no game yet, and has not been
 * played through either (WEB-039, 2026-11-26: Bo Melton's Week 12 quad read
 * "played through it without missing time" before the game).
 */
export function gameToCome(avail: Pick<SeasonAvailability, "weekCodes">, week: number): boolean {
  return week > avail.weekCodes.length || avail.weekCodes[week - 1] === "B";
}
