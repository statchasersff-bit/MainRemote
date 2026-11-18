/**
 * Who starts, for the upcoming page's "Starters vs the Defense" card
 * (preview-premium.ts). The block this file used to render (defense cards and
 * the Sleeper-style lineup table, mak 2026-10-22/23) left the page with the
 * rest of the old decision layer on 2026-11-06; the starter rule stays here.
 *
 * Starters are Sleeper's depth order on the roster the preview already holds
 * (QB1, RB1-2, WR1-3, TE1); a player designated Out, IR or the like is
 * replaced by the next man up, and a Questionable or Doubtful starter keeps
 * his slot (the card badges him). Since 2026-11-18 the statuses are the
 * game's own (availability.ts): a player who missed the club's last game and
 * has no designation yet for this one ("Pending") is not counted as the
 * expected starter either; the man who replaced him is.
 */

import type { RosterPlayer } from "../team/roster";
import { notExpected } from "./availability";
import type { Pos } from "./preview";

/**
 * The starters at a position: Sleeper's depth order with the unavailable
 * skipped, so an Out RB1 hands his slot to the RB2 and the card never lists
 * a player who will not play. Unlisted players (no depth order) come last.
 */
export function starters(roster: RosterPlayer[], pos: Pos, n: number): RosterPlayer[] {
  return roster
    .filter((r) => r.position === pos && !notExpected(r.injuryStatus))
    .sort((a, b) => (a.depthOrder ?? 99) - (b.depthOrder ?? 99) || (a.searchRank ?? 9999) - (b.searchRank ?? 9999))
    .slice(0, n);
}

/**
 * The depth chart's top N at a position, available or not: who the club
 * would start at full health. For "who is missing" questions (Keys to the
 * Game's injury key), where starters() would already have skipped him.
 */
export function depthTop(roster: RosterPlayer[], pos: Pos, n: number): RosterPlayer[] {
  return roster
    .filter((r) => r.position === pos)
    .sort((a, b) => (a.depthOrder ?? 99) - (b.depthOrder ?? 99) || (a.searchRank ?? 9999) - (b.searchRank ?? 9999))
    .slice(0, n);
}
