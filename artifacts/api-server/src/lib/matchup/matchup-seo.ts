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
import { matchupScoreboardGame, matchupShare, matchupTitle, recapDescription, seasonGameLead } from "./matchup-render";
import { SHARE_HEIGHT, SHARE_WIDTH } from "./og-image";
import { scoreboardPageDescription, scoreboardTitleCandidates } from "./scoreboard-hero";
import { fitTitle, TITLE_MAX } from "../title-fit";

const SITE_NAME = "StatChasers";

/**
 * The longest title a page may carry: sixty characters, the shared budget in
 * lib/title-fit.ts. Two full team names spend up to 45 of it, so the phrase
 * has to earn its place and the nicknames step in when it cannot. Was 70 with
 * the brand tried first until 2026-10-08.
 */
export const MATCHUP_TITLE_MAX = TITLE_MAX;

/**
 * The first candidate that fits, most descriptive first. No brand: the full
 * team names are what people search. The last candidate is written short
 * enough to fit for every pair.
 */
export function fitMatchupTitle(candidates: string[]): string {
  return fitTitle(candidates, MATCHUP_TITLE_MAX);
}

/** "Cardinals vs Chiefs" - the fallback when the full names leave no room. */
function nicknames(data: MatchupData): string {
  return `${data.pair.a.nickname} vs ${data.pair.b.nickname}`;
}

/**
 * "Seahawks won 13-10", or "" when there is no final score.
 *
 * One function so the API's description and the WordPress plugin's cannot
 * disagree about the wording - the plugin receives this string in a header and
 * pastes it in front of the same sentence.
 */
export function matchupScoreLine(data: MatchupData): string {
  const featured = data.featured;
  // A game address always has a score to lead with; the pair's address only
  // while it is leading with a result - just played, or any of this season's.
  if (!data.pinned && data.matchupState !== "recently_completed" && !seasonGameLead(data)) return "";
  if (!featured?.score || !featured.winner) return "";
  const high = Math.max(featured.score.home, featured.score.away);
  const low = Math.min(featured.score.home, featured.score.away);
  return `${featured.winner.nickname} won ${high}-${low}.`;
}

/**
 * A completed game's recap: the spec's description (result, venue, what the
 * page holds), og:type article and the share image. `canonical` makes the
 * image URL absolute; `origin` overrides it (the plugin's API origin).
 */
function withRecap(meta: TeamPageMeta, data: MatchupData, canonical: string): TeamPageMeta {
  const share = matchupShare(data);
  // A game address wrote its own description (the brief's "Winner pts, Loser
  // pts on Mon D, Year: full box score..."); only the pair's page takes the
  // recap's.
  const description = data.pinned ? meta.description : recapDescription(data);
  if (!share || !description) return meta;
  let url: string | null = null;
  try {
    url = new URL(share.path, canonical).toString();
  } catch {
    url = null;
  }
  return {
    ...meta,
    description,
    ogType: "article",
    image: url ? { url, width: SHARE_WIDTH, height: SHARE_HEIGHT, alt: share.alt } : null,
  };
}

export function matchupPageMeta(data: MatchupData, canonical: string): TeamPageMeta {
  return withRecap(baseMeta(data, canonical), data, canonical);
}

function baseMeta(data: MatchupData, canonical: string): TeamPageMeta {
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
      // "Steelers vs Browns Player Stats & Box Score, Week 4 2026" (the SEO
      // brief of 2026-10-10), from the same game object the hero draws, so
      // the two cannot disagree about the order or the round. MIRRORED by
      // statchasers_matchup_game_meta() in the plugin for an API that sends
      // no title header.
      title: fitMatchupTitle(
        game
          ? scoreboardTitleCandidates(game)
          : [
              `${short} Player Stats & Box Score, ${label} ${gameSeason}`,
              `${short} Box Score, ${label} ${gameSeason}`,
              `${short} Box Score, ${label}`,
            ],
      ),
      description: game
        ? scoreboardPageDescription(game)
        : `${scored ? `${scored} ` : ""}${a.nickname} vs ${b.nickname}, ${label} ${gameSeason}: ` +
          `full box score, fantasy points for every player, scoring summary and team stats.`,
      canonical,
      siteName: SITE_NAME,
    };
  }

  // The upcoming decision page: a game-level fantasy preview, with start/sit
  // as one section of it (mak approved this title and description, 2026-10-05;
  // the spec's 2026-10-03 "Start/Sit, Fantasy Matchups, Odds & Prediction"
  // title is retired).
  const pv = data.matchupState === "upcoming" ? data.preview : null;
  if (pv) {
    const label = `${pv.away.team.nickname} vs ${pv.home.team.nickname}`;
    const week = pv.meeting.weekLabel;
    const long =
      `${label} ${week} fantasy football preview with start/sit recommendations, projections, ` +
      `matchup data, injuries, usage and points allowed by position.`;
    // With a last meeting summarized above the preview (the SEO brief of
    // 2026-10-10) the title says so: "Falcons vs Saints Week 17 2026:
    // Fantasy Preview & Last Meeting Stats", the year dropped when it runs
    // past sixty. A pair meeting for the first time keeps the 2026-10-05
    // wording.
    const title = data.lastMeeting
      ? fitMatchupTitle([
          `${label} ${week} ${pv.meeting.season}: Fantasy Preview & Last Meeting Stats`,
          `${label} ${week}: Fantasy Preview & Stats`,
        ])
      : fitMatchupTitle([`${label} Fantasy Football Matchup Preview - ${week}`]);
    return {
      title,
      description:
        long.length <= 160
          ? long
          : `${label} ${week} fantasy football preview: start/sit calls, matchup data, injuries, usage and points allowed by position.`,
      canonical,
      siteName: SITE_NAME,
    };
  }

  // The pair's page while it leads with one of this season's played games,
  // whether just played or back in Week 2: "Browns vs Buccaneers Player Stats
  // & Fantasy Points (Week 2, 2026)", mak's wording (2026-10-09), with the
  // same words in the H1 (seasonGameHeading). The spec's string runs past
  // sixty for most pairs, so the ladder drops the year first - the searches
  // are "browns vs buccaneers player stats", so "Player Stats" outranks
  // "2026" (mak, 2026-10-09) - and only then the shorter wordings. The
  // head-to-head wording below is now only for a pair that has not met this
  // season.
  const lead = seasonGameLead(data);
  if (lead) {
    const when = `(${lead.weekLabel}, ${lead.season})`;
    const scored = matchupScoreLine(data);
    return {
      title: fitMatchupTitle([
        `${short} Player Stats & Fantasy Points ${when}`,
        `${short} Player Stats & Fantasy Points (${lead.weekLabel})`,
        `${short} Stats & Fantasy Points ${when}`,
        `${short} Player Stats ${when}`,
      ]),
      description:
        `${scored ? `${scored} ` : ""}${a.nickname} vs ${b.nickname} ${lead.weekLabel} ${lead.season} ` +
        `player stats and fantasy points by player, plus the final score and the head-to-head record.`,
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
        `${names}: Head-to-Head Record & History`,
        `${names}: Head-to-Head History`,
        `${short}: Head-to-Head Record & History`,
      ]);
      description =
        `${a.nickname} vs ${b.nickname}: the regular-season head-to-head record, ` +
        `recent meetings, and ${season} team stats side by side.`;
  }

  return { title, description, canonical, siteName: SITE_NAME };
}
