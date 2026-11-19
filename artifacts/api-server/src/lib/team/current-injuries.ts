/**
 * A team page's injuries as of the club's next game - the ONE place a team
 * hub turns a week-less status into a current one (final injury pass,
 * 2026-11-19).
 *
 * Sleeper's `injury_status` (and its `practice_participation`) is not tied to
 * a week, and neither are the depth-chart feed's Q/D/O codes. Read raw, they
 * carried Sione Vaki's Week 10 Questionable into Week 11 on the Detroit News
 * tab while his player page said "No injury designation for Week 11". This
 * module applies the rule the player pages and the matchup preview use
 * (matchup/availability.ts) once, in getTeamPageData(), so every hub surface
 * - Overview, News Injury Watch, Depth Chart, depth FAQ, season FAQ, status
 * chips - reads the same normalized data:
 *
 *   - reserve lists (IR, PUP, NFI, suspension, exempt) stand;
 *   - Out / Doubtful / Questionable only from this week's official report,
 *     or, before it is out, a Sleeper designation for a player who missed the
 *     club's last game becomes "Pending";
 *   - a designation for a game he then played has expired and is dropped;
 *   - practice participation is this week's official report line ("DNP Wed"),
 *     never Sleeper's week-less field, and is never a game status.
 *
 * Skill players (the roster index) get gameAvailability() in full. Other
 * depth-chart rows have no game logs, so for them the official report alone
 * decides: this week's game status, or "Pending" when last week's report had
 * him Out and this week's has none yet.
 */

import {
  clubPreviousWeek,
  gameRoster,
  PENDING,
  reportLine,
  type AvailabilityOptions,
} from "../matchup/availability";

/** Injected stores, for the tests (matchup/availability.ts AvailabilityOptions). */
export type InjuryDeps = Pick<AvailabilityOptions, "logs" | "practice">;
import { nextGameWeek, STATUS_STALE_MS } from "../player/current-status";
import type { DepthRow, TeamDepthCharts } from "./depth-charts";
import type { RosterPlayer, TeamRoster } from "./roster";
import type { TeamSchedule } from "./schedule";
import type { NflTeam } from "./teams";

const GAME = /^(out|doubtful|questionable)$/i;

/** The club's next regular-season game week, or null (season over, or no schedule). */
export function injuryWeek(schedule: TeamSchedule | null): number | null {
  return nextGameWeek((schedule?.games ?? []).filter((g) => g.seasonType === "regular"));
}

const fantasyRank = (p: RosterPlayer): number => p.searchRank ?? Number.MAX_SAFE_INTEGER;
const POSITION_RANK: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

/**
 * The roster with each player's status for the club's next game, and its
 * injury list rebuilt from those statuses (same order as roster.ts: search
 * rank, depth, position, name). Raw roster when there is no roster.
 */
export function currentRoster(
  team: NflTeam,
  season: number,
  schedule: TeamSchedule | null,
  roster: TeamRoster | null,
  deps: InjuryDeps = {},
): TeamRoster | null {
  if (!roster) return null;
  const week = injuryWeek(schedule);
  const rows =
    week === null
      ? gameRoster(team, season, 99, roster.players, { ...deps, nextGame: false })
      : gameRoster(team, season, week, roster.players, { ...deps });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fix = (p: RosterPlayer): RosterPlayer => {
    const r = byId.get(p.id);
    const status = r?.injuryStatus ?? null;
    return {
      ...p,
      injuryStatus: status,
      // A body part only beside a current status; practice only from this
      // week's official report (the availability's own line), never Sleeper's.
      injuryBodyPart: status ? p.injuryBodyPart : null,
      practice: r?.availability?.practice ?? null,
    };
  };
  const players = roster.players.map(fix);
  const fixedById = new Map(players.map((p) => [p.id, p]));
  const depthChart = Object.fromEntries(
    Object.entries(roster.depthChart).map(([pos, list]) => [pos, list.map((p) => fixedById.get(p.id) ?? fix(p))]),
  ) as TeamRoster["depthChart"];
  const injuries = players
    .filter((p) => p.injuryStatus)
    .sort(
      (a, b) =>
        fantasyRank(a) - fantasyRank(b) ||
        (a.depthOrder ?? 99) - (b.depthOrder ?? 99) ||
        (POSITION_RANK[a.position] ?? 9) - (POSITION_RANK[b.position] ?? 9) ||
        a.name.localeCompare(b.name),
    );
  return { ...roster, players, depthChart, injuries };
}

const SHORT: Record<string, string> = { Q: "Questionable", D: "Doubtful", O: "Out" };

/**
 * The depth-chart feed's rows with current statuses: a roster-index player
 * reads his normalized status; anyone else keeps a reserve-list code and has
 * Q/D/O only as the official report confirms it.
 */
export function currentDepthCharts(
  team: NflTeam,
  season: number,
  schedule: TeamSchedule | null,
  depth: TeamDepthCharts | null,
  roster: TeamRoster | null,
  deps: InjuryDeps = {},
): TeamDepthCharts | null {
  if (!depth) return null;
  const week = injuryWeek(schedule);
  const byName = new Map((roster?.players ?? []).map((p) => [nameKey(p.name), p]));
  const byId = new Map((roster?.players ?? []).map((p) => [p.id, p]));
  const prev = week === null ? null : clubPreviousWeek(team, season, week, deps.logs);
  const fixRow = (row: DepthRow): DepthRow => {
    const known = (row.id ? byId.get(row.id) : undefined) ?? byName.get(nameKey(row.name));
    if (known) return { ...row, injuryStatus: known.injuryStatus, injuryBodyPart: row.injuryStatus && known.injuryStatus ? row.injuryBodyPart : null };
    const raw = row.injuryStatus;
    if (!raw) return row;
    const word = SHORT[raw.toUpperCase()] ?? raw;
    if (!GAME.test(word)) return row; // IR, PUP, NFI, Sus, exempt: stands
    if (week === null) return { ...row, injuryStatus: null };
    const now = reportLine(team, season, week, row.name, deps.practice);
    if (now?.gameStatus) return { ...row, injuryStatus: now.gameStatus };
    const before = prev === null ? null : reportLine(team, season, prev, row.name, deps.practice);
    if (before?.gameStatus === "Out" && !now?.gameStatus) return { ...row, injuryStatus: PENDING };
    return { ...row, injuryStatus: null };
  };
  return {
    ...depth,
    views: depth.views.map((view) => ({
      ...view,
      columns: view.columns.map((column) => ({ ...column, rows: column.rows.map(fixRow) })),
    })),
    football: depth.football.map((side) => ({
      ...side,
      slots: side.slots.map((slot) => ({ ...slot, rows: slot.rows.map(fixRow) })),
    })),
  };
}

/** The same fold the depth-chart module uses for names. */
function nameKey(name: string): string {
  const words = name.toLowerCase().replace(/[.']/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  while (words.length > 1 && suffixes.has(words[words.length - 1] ?? "")) words.pop();
  return words.join(" ");
}

export interface InjuryFreshness {
  week: number | null;
  /** The club's official report for `week` is on file. */
  reportPublished: boolean;
  /** When the roster snapshot (reserve lists, Sleeper status) was pulled. */
  rosterFetchedAt: number | null;
  /** current, or stale (snapshot older than STATUS_STALE_MS), or unavailable (none). */
  state: "current" | "stale" | "unavailable";
  /** One sentence for the injury components, or null when nothing needs saying. */
  note: string | null;
}

/** What the injury components should say about their own freshness. */
export function injuryFreshness(
  team: NflTeam,
  season: number,
  schedule: TeamSchedule | null,
  rosterFetchedAt: number,
  now: number = Date.now(),
  deps: InjuryDeps = {},
): InjuryFreshness {
  const week = injuryWeek(schedule);
  const at = rosterFetchedAt > 0 ? rosterFetchedAt : null;
  const state = at === null ? "unavailable" : now - at > STATUS_STALE_MS ? "stale" : "current";
  const reportPublished = week !== null && reportLine(team, season, week, "", deps.practice) !== null;
  let note: string | null = null;
  if (state === "unavailable") note = "Current injury statuses are unavailable; nothing here is a confirmed current status.";
  else if (state === "stale") note = `Injury statuses as of ${new Date(at!).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })} may be out of date.`;
  else if (week !== null && !reportPublished) note = `No Week ${week} injury report is on file yet: reserve lists, and Pending for players who missed the last game.`;
  return { week, reportPublished, rosterFetchedAt: at, state, note };
}
