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
import { matchupScoreboardGame, matchupTitle } from "./matchup-render";
import { scoreboardTitleCandidates } from "./scoreboard-hero";

const SITE_NAME = "StatChasers";

/**
 * The longest title a page may carry. Site audits flag anything over 70, and
 * Google cuts the rest off in the result anyway; two full team names already
 * spend up to 45 of it, so the phrase and the brand have to earn their place.
 */
export const MATCHUP_TITLE_MAX = 70;

/**
 * The first candidate that fits, most descriptive first.
 *
 * Each candidate is tried with the brand and then without it, before the next
 * one is: the full team names are what people search, the brand is not, so a
 * pair with long names drops " | StatChasers" before it drops a word of its own.
 * The last candidate is written short enough to fit for every pair.
 */
export function fitMatchupTitle(candidates: string[]): string {
  for (const candidate of candidates) {
    const branded = `${candidate} | ${SITE_NAME}`;
    if (branded.length <= MATCHUP_TITLE_MAX) return branded;
    if (candidate.length <= MATCHUP_TITLE_MAX) return candidate;
  }
  return candidates[candidates.length - 1];
}

/** "Cardinals vs Chiefs" — the fallback when the full names leave no room. */
function nicknames(data: MatchupData): string {
  return `${data.pair.a.nickname} vs ${data.pair.b.nickname}`;
}

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
  const short = nicknames(data);
  const { a, b } = data.pair;
  const season = data.state.season;

  let title: string;
  let description: string;

  // A game address is its own page with its own subject, so it is answered
  // before the pair's three states are consulted at all: "patriots seahawks
  // week 1 2026" is a different search from "patriots vs seahawks", and the
  // two must not answer it with the same string.
  if (data.pinned) {
    const gameSeason = data.pinned.season;
    const scored = matchupScoreLine(data);
    // The round by name in the postseason: a Wild Card game is not "Week 1".
    const label = data.pinned.weekLabel;
    const game = matchupScoreboardGame(data);
    return {
      // "Cardinals vs Rams Wild Card 2021: Final Score 34–11, Stats & Recap",
      // from the same game object the hero draws, so the two cannot disagree
      // about the order, the round or the score.
      title: fitMatchupTitle(
        game
          ? scoreboardTitleCandidates(game)
          : [`${names}, ${label} ${gameSeason} Box Score`, `${short}, ${label} ${gameSeason} Box Score`],
      ),
      description:
        `${scored ? `${scored} ` : ""}Full box score from ${a.nickname} vs ` +
        `${b.nickname} in ${data.pinned.seasonType === "post" ? "the " : ""}${label} of ` +
        `${gameSeason}: quarter-by-quarter scoring, every passing, rushing and ` +
        `receiving line, snap counts and fantasy points.`,
      canonical,
      siteName: SITE_NAME,
    };
  }

  switch (data.matchupState) {
    case "upcoming":
      title = fitMatchupTitle([
        `${names} ${season}: Where to Watch, Stats & Injuries`,
        `${names} ${season}: Where to Watch & Stats`,
        `${names} ${season}: Where to Watch`,
        `${short} ${season}: Where to Watch`,
      ]);
      description =
        `${a.nickname} vs ${b.nickname} in ${season}: kickoff time, TV, venue, ` +
        `team stats side by side, injury designations and the head-to-head record.`;
      break;
    case "recently_completed": {
      title = fitMatchupTitle([
        `${names} ${season}: Score, Player Stats & Fantasy Recap`,
        `${names} ${season}: Score & Fantasy Recap`,
        `${names} ${season} Score & Stats`,
        `${short} ${season}: Score & Fantasy Recap`,
      ]);
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
      title = fitMatchupTitle([
        `${names}: Head-to-Head Record, Stats & History`,
        `${names}: Head-to-Head Record & History`,
        `${names}: Head-to-Head Record`,
        `${short}: Head-to-Head Record`,
      ]);
      description =
        `${a.nickname} vs ${b.nickname}: the regular-season head-to-head record, ` +
        `recent meetings, and ${season} team stats side by side.`;
  }

  return { title, description, canonical, siteName: SITE_NAME };
}
