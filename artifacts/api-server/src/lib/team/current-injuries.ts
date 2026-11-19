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
import { nextGameWeek } from "../player/current-status";
import type { TeamPageData } from "./team-data";

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
