/**
 * The draft-season fantasy outlook for a team, written by hand.
 *
 * The only block on this page that is an opinion rather than a reading. Every
 * other section is a number some provider reported - a rank, a snap count, an
 * injury designation - and can be refreshed by asking again. This one is a
 * take: where the offense is going, and what that means on draft day. It is
 * kept in the repo, per team, in data/team/outlooks_<season>.json (moved out
 * of this file on 2026-11-10), because there is no feed for it and because a
 * take with nobody's name on it should at least be reviewable in a diff.
 *
 * Three consequences of that, and they are the whole shape of this module.
 *
 * First, a team with no entry renders no section - the same rule the fetched
 * blocks follow. Thirty-two half-written outlooks would be worse than one
 * finished one, so the table fills in as they are written and the page is
 * honest about the gap in the meantime.
 *
 * Second, every outlook carries the `season` it was written for and the month
 * it was last touched. A take goes stale in a way a stat line does not:
 * "A.J. Brown arrives" is true for one offseason and misleading forever after.
 * The renderer prints both, and the caller can drop an outlook that has been
 * overtaken rather than the page quietly presenting last year's draft advice
 * as this year's.
 *
 * Third, the players are grouped rather than listed. A flat run of seven cards
 * is a directory; two bands - the pieces that decide a draft and the ones that
 * fill it in - is a take about which is which, which is the thing a reader
 * came for. The bands are written per team, not derived, because "core" is a
 * judgment and there is no rank this module could compute it from.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { readDataJson } from "./read-json";

/**
 * One "what changed" fact - the kind no stats feed can report.
 *
 * `rank` exists so the value can stay short without the league context being
 * thrown away: "23.6 pts/g" is the reading and "8th" is what makes it mean
 * something, and at this size they cannot share one line at one weight.
 */
export interface OutlookFact {
  label: string;
  value: string;
  /** e.g. "24th". Null when the fact is not something 32 teams can be ranked on. */
  rank?: string;
}

/**
 * One player, with the fantasy call in front of the reasoning.
 *
 * The order of the fields is the order the card reads, and it is deliberate:
 * `tier` first because a reader scanning seven cards wants the classification
 * and nothing else; `thesis` next because a one-line claim is what makes the
 * paragraph optional; `stats` as the evidence for the claim; `note` last, for
 * the reader who has decided this player is worth the paragraph.
 *
 * This carried a market rank ("WR9") and a verdict chip ("Target", "Fade")
 * once. Those said where the market was and whether to beat it, which is a
 * different question from what the player is - and as two pills side by side
 * they read as a scorecard rather than as analysis. `tier` answers the
 * question the pills were being used to answer, in the reader's own language.
 */
export interface OutlookPlayer {
  name: string;
  /** Position chip, e.g. "QB". Drives the chip color via .sct-slot. */
  position: string;
  /** The fantasy classification, e.g. "Elite QB1", "Deep sleeper". */
  tier: string;
  /** The card's headline claim, in one sentence. */
  thesis: string;
  /**
   * Three or so compact supporting facts, shown as a single scannable row.
   *
   * Regular season only, here and in `note` and `thesis` below. The rest of
   * this page is built from feeds pinned to the regular season - see the
   * `seasontype=2` in team/stats.ts and team/schedule.ts - so a card quoting
   * an eighteen-game split reads as the same kind of number as the rank two
   * inches above it and is not. A playoff run is allowed to be the reason a
   * take exists; it is not allowed to be the evidence for one.
   *
   * Numbers where the take has numbers and short phrases where it does not -
   * a player who arrived this offseason has no season line to quote, and
   * inventing one to make the row look uniform would be the page's one lie.
   * An empty array renders no row at all.
   */
  stats: string[];
  /** The case for and against, in two or three sentences. */
  note: string;
}

/**
 * A band of players - the curation, not just a bucket.
 *
 * `label` is what the band asserts ("Core fantasy pieces"), so it is written
 * out per team rather than drawn from a fixed vocabulary: a team whose whole
 * offense is one running back does not have four core pieces, and the heading
 * should be allowed to say so.
 */
export interface OutlookGroup {
  label: string;
  players: OutlookPlayer[];
}

export interface TeamOutlook {
  /** The season this take describes. Printed in the heading. */
  season: number;
  /** When it was last written, e.g. "August 2026". Printed in the meta line. */
  updated: string;
  /** Two or three sentences on where the offense stands. */
  summary: string;
  facts: OutlookFact[];
  groups: OutlookGroup[];
  /** The closing line - the one thing to remember about this offense. */
  bottomLine: string;
}

/**
 * The season whose file the Outlook tab reads. Bumped by hand at the August
 * rollover, when the next season's outlooks are written (docs/SEASON-ROLLOVER.md);
 * the renderer still drops any entry whose own `season` the calendar has passed.
 */
export const OUTLOOK_SEASON = 2026;

/**
 * data/team/outlooks_<season>.json: `teams` keyed by our canonical team id
 * (Sleeper's lowercase code), the same key the news pipeline and TEAM_COLORS
 * use. Not every team has to be there; see the module note above.
 */
interface OutlooksDoc {
  season: number;
  teams: Record<string, TeamOutlook>;
}

const outlookFile = () => dataPath("team", `outlooks_${OUTLOOK_SEASON}.json`);

/** The outlook for a team, or null when none has been written. */
export function getTeamOutlook(abbreviation: string): TeamOutlook | null {
  return readDataJson<OutlooksDoc>(outlookFile())?.teams?.[abbreviation] ?? null;
}

/**
 * A fingerprint for the hub cache: the file's mtime, because it is edited by
 * hand and an editor will not bump a stamp inside it. Empty when the file is
 * missing.
 */
export function outlookVersion(): string {
  try {
    return String(fs.statSync(outlookFile()).mtimeMs);
  } catch {
    return "";
  }
}
