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

/**
 * "Seahawks won 13-10", or "" when there is no final score.
 *
 * One function so the API's description and the WordPress plugin's cannot
 * disagree about the wording — the plugin receives this string in a header and
 * pastes it in front of the same sentence.
 */
export function matchupScoreLine(data: MatchupData): string {
  const featured = data.featured;
  // A game address always has a score to lead with; the pair's address only
  // while it is leading with a result.
  if (!data.pinned && data.matchupState !== "recently_completed") return "";
  if (!featured?.score || !featured.winner) return "";
  const high = Math.max(featured.score.home, featured.score.away);
  const low = Math.min(featured.score.home, featured.score.away);
  return `${featured.winner.nickname} won ${high}-${low}.`;
}

export function matchupPageMeta(data: MatchupData, canonical: string): TeamPageMeta {
  const names = matchupTitle(data);
  const { a, b } = data.pair;
  const season = data.state.season;

  let title: string;
  let description: string;

  // A game address is its own page with its own subject, so it is answered
  // before the pair's three states are consulted at all: "patriots seahawks
  // week 1 2026" is a different search from "patriots vs seahawks", and the
  // two must not answer it with the same string.
  if (data.pinned) {
    const week = data.pinned.week;
    const gameSeason = data.pinned.season;
    const scored = matchupScoreLine(data);
    return {
      title:
        `${names}, Week ${week} ${gameSeason}: Final Score, Player Stats & ` +
        `Fantasy Recap | ${SITE_NAME}`,
      description:
        `${scored ? `${scored} ` : ""}Full box score from ${a.nickname} vs ` +
        `${b.nickname} in Week ${week} of ${gameSeason}: quarter-by-quarter ` +
        `scoring, every passing, rushing and receiving line, snap counts and ` +
        `fantasy points.`,
      canonical,
      siteName: SITE_NAME,
    };
  }

  switch (data.matchupState) {
    case "upcoming":
      title = `${names} ${season}: Where to Watch, Stats, Injuries & History`;
      description =
        `${a.nickname} vs ${b.nickname} in ${season}: kickoff time, TV, venue, ` +
        `team stats side by side, injury designations and the head-to-head record.`;
      break;
    case "recently_completed": {
      title = `${names} ${season}: Score, Player Stats & Fantasy Recap`;
      // The score itself when the page has one. A snippet that already carries
      // the number answers the search on the results page, which is the point:
      // the reader who clicks through after that is the one who wants the
      // player stats under it, and those are what this page now leads with.
      const scored = matchupScoreLine(data);
      description =
        `${scored ? `${scored} ` : ""}${a.nickname} vs ${b.nickname} ${season} final score, quarter-by-quarter ` +
        `scoring, full player stats and the fantasy takeaways from the game.`;
      break;
    }
    default:
      title = `${names}: Head-to-Head Record, Stats & History`;
      description =
        `${a.nickname} vs ${b.nickname}: the regular-season head-to-head record, ` +
        `recent meetings, and ${season} team stats side by side.`;
  }

  return { title: `${title} | ${SITE_NAME}`, description, canonical, siteName: SITE_NAME };
}
