/**
 * Which logged injury a missed week belongs to.
 *
 * The week strip and the game log print "Did not play" for a week the player
 * sat out. The brief of 2026-10-10 asks for the reason when it is known: the
 * injury record carries the week an injury was logged in and the games it
 * cost, so a missed week inside that span is that injury. Anything else is
 * "inactive", which is all the log knows. A leaf module: both renderers
 * import it, and neither should import the other.
 */

import type { NflInjuryEntry } from "./injury";
import type { PlayerPageData } from "./player-data";

/** The injury covering `week` of `season`, or null. */
export function injuryForWeek(
  data: Pick<PlayerPageData, "injury">,
  season: number,
  week: number,
): NflInjuryEntry | null {
  for (const entry of data.injury?.history.nfl ?? []) {
    if (entry.season !== season || typeof entry.week !== "number") continue;
    // The week it was logged in (he may have left that game) and the games
    // missed after it.
    if (week >= entry.week && week <= entry.week + (entry.gamesMissed ?? 0)) return entry;
  }
  return null;
}

/**
 * "Did not play (hamstring)", "Active, did not play" or "Did not play".
 *
 * Only what is known (the game-log audit, 2026-11-04): the injury when the
 * record has one; "active" when the week's log row says he dressed (Sleeper's
 * gp) and took no snap - a healthy backup, not an inactive; and plain "Did
 * not play" otherwise, because the log has no inactive list to confirm the
 * word against.
 */
export function didNotPlayLabel(
  injury: NflInjuryEntry | null,
  stats?: { gp?: number } | null,
): string {
  const reason = injury ? (injury.bodyPart ?? injury.type ?? "").trim().toLowerCase() : "";
  if (reason) return `Did not play (${reason})`;
  if ((stats?.gp ?? 0) > 0) return "Active, did not play";
  return "Did not play";
}
