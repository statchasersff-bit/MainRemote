/**
 * A team page's injuries as of the club's next game (release gate,
 * 2026-11-19), by the rule the player pages and the matchup preview use
 * (matchup/availability.ts gameRoster): reserve lists stand, Out/Doubtful/
 * Questionable count only for this week, "Pending" after a missed game with
 * no new status. A designation filed for a game the player then played has
 * expired and is left out (Sione Vaki, DET: Questionable for Week 10, played,
 * "No injury designation for Week 11" on his page).
 *
 * The overview's Injuries & Availability panel, its backfield line and the
 * season FAQ's injury answer all read this, so they cannot disagree.
 */
import { gameRoster } from "../matchup/availability";
import type { TeamPageData } from "./team-data";
import type { ScheduleGame } from "./schedule";

/**
 * The club's next regular-season game week. On the release branch this is
 * player/current-status.ts nextGameWeek(), which this base does not have; at
 * merge, import that one and drop this copy. NOTE: on this base gameRoster()
 * does not yet expire a played-through designation (that is in the release
 * branch's matchup/availability.ts), so the statuses here equal the roster's
 * until the two branches meet.
 */
function nextGameWeek(games: ScheduleGame[]): number | null {
  const open = games
    .filter((g) => g.seasonType === "regular" && g.status !== "final" && (g.status as string) !== "canceled" && g.result == null)
    .sort((a, b) => a.week - b.week);
  return open[0]?.week ?? null;
}

/** Player id -> this week's status; absent = no current status. */
export function currentStatuses(data: TeamPageData): Map<string, string> {
  const roster = data.roster?.players ?? [];
  const week = nextGameWeek((data.schedule?.games ?? []).filter((g) => g.seasonType === "regular"));
  const rows =
    week === null
      ? gameRoster(data.team, data.state.season, 99, roster, { nextGame: false })
      : gameRoster(data.team, data.state.season, week, roster);
  const out = new Map<string, string>();
  for (const r of rows) if (r.injuryStatus) out.set(r.id, r.injuryStatus);
  return out;
}

/** data.injuries limited to current statuses, each carrying this week's status. */
export function currentInjuries(data: TeamPageData): TeamPageData["injuries"] {
  const current = currentStatuses(data);
  return data.injuries.filter((p) => current.has(p.id)).map((p) => ({ ...p, injuryStatus: current.get(p.id) ?? null }));
}
