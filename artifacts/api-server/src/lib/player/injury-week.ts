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

/** "Did not play (hamstring)" or "Did not play (inactive)". */
export function didNotPlayLabel(injury: NflInjuryEntry | null): string {
  const reason = injury ? (injury.bodyPart ?? injury.type ?? "").trim().toLowerCase() : "";
  return `Did not play (${reason || "inactive"})`;
}
