/**
 * Metadata for a matchup page. Same posture as team-seo.ts: this origin is
 * noindex and WordPress owns the indexed title; these strings are MIRRORED by
 * statchasers_matchup_meta() in the plugin, and the two must agree.
 *
 * The title carries the state, because the query does: a reader searching
 * "patriots vs eagles" the week of the game wants the time and the channel,
 * and the week after wants the score. The URL does not change; the words do.
 */

import type { TeamPageMeta } from "../team-seo";
import type { MatchupData } from "./matchup-data";
import { matchupTitle } from "./matchup-render";

const SITE_NAME = "StatChasers";

export function matchupPageMeta(data: MatchupData, canonical: string): TeamPageMeta {
  const names = matchupTitle(data);
  const { a, b } = data.pair;
  const season = data.state.season;

  let title: string;
  let description: string;
  switch (data.matchupState) {
    case "upcoming":
      title = `${names} ${season}: Where to Watch, Stats, Injuries & History`;
      description =
        `${a.nickname} vs ${b.nickname} in ${season}: kickoff time, TV, venue, ` +
        `team stats side by side, injury designations and the head-to-head record.`;
      break;
    case "recently_completed":
      title = `${names} ${season}: Score, Stats & Head-to-Head`;
      description =
        `${a.nickname} vs ${b.nickname} ${season} result and score, with team stats ` +
        `side by side, injuries and the recent head-to-head record.`;
      break;
    default:
      title = `${names}: Head-to-Head Record, Stats & History`;
      description =
        `${a.nickname} vs ${b.nickname}: the regular-season head-to-head record, ` +
        `recent meetings, and ${season} team stats side by side.`;
  }

  return { title: `${title} | ${SITE_NAME}`, description, canonical, siteName: SITE_NAME };
}
