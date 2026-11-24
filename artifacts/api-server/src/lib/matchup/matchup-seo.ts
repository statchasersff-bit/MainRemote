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
import { matchupHasHighlights, matchupScoreboardGame, matchupShare, matchupTitle, seriesShowsPlayerStats } from "./matchup-render";
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
 * The upcoming preview's title, the one template allowed past TITLE_MAX:
 * mak specified its wording (2026-11-06), 77 characters for Packers vs.
 * Patriots. The ladder still has to fit somewhere, so it stops here.
 */
export const PREVIEW_TITLE_MAX = 82;

/**
 * The first candidate that fits, most descriptive first. No brand: the full
 * team names are what people search. The last candidate is written short
 * enough to fit for every pair.
 */
export function fitMatchupTitle(candidates: string[], max: number = MATCHUP_TITLE_MAX): string {
  return fitTitle(candidates, max);
}

/**
 * A completed game's title, the pair page's and the dated page's: a soft
 * seventy, not sixty (mak, 2026-11-11: "I'd rather have a slightly longer,
 * descriptive title than remove useful search terms"). Google truncates the
 * end of a long title; it does not penalize it, so "Highlights" and the year
 * stay for every pair. MIRRORED in statchasers_matchup_completed_meta().
 */
export const COMPLETED_TITLE_MAX = 70;

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
  // A game address only: the pair's address is the series page (WEB-001),
  // whose title and description are about the series, not one result.
  if (!data.pinned) return "";
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
  // A game address wrote its own description (completedGameDescription:
  // "{Away} vs {Home} match player stats from Week N, YYYY: ..."), and the
  // pair's address is the series page with the series description (WEB-001,
  // 2026-11-24; until then a pair page took the led game's recap).
  const description = meta.description;
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
          ? scoreboardTitleCandidates(game, { highlights: matchupHasHighlights(data) })
          : [
              `${short} Player Stats & Box Score | ${label}, ${gameSeason}`,
              `${short} Player Stats & Box Score | ${label}`,
              `${short} Box Score | ${label}`,
            ],
        COMPLETED_TITLE_MAX,
      ),
      description: game
        ? scoreboardPageDescription(game)
        : `${scored ? `${scored} ` : ""}${a.nickname} vs ${b.nickname}, ${label} ${gameSeason}: ` +
          `full box score, fantasy points for every player, scoring summary and team stats.`,
      canonical,
      siteName: SITE_NAME,
    };
  }

  // The upcoming preview targets the general game search, fantasy as one part
  // of it (mak's SEO brief, 2026-11-06): "Packers vs. Patriots Preview:
  // Matchups, Odds, Injuries & Analysis | Week 9, 2026", away team first, the
  // H1 "Packers vs. Patriots: Week 9 Game Preview" (previewPageHeading). mak
  // named this title himself, so it runs past the 60-character cap the other
  // templates keep; shorter rungs only for the longest nickname pairs. Was
  // "{pair} {week} {year}: Fantasy Preview & Last Meeting Stats" (2026-10-10).
  const pv = data.matchupState === "upcoming" ? data.preview : null;
  if (pv) {
    const label = `${pv.away.team.nickname} vs. ${pv.home.team.nickname}`;
    const week = pv.meeting.weekLabel;
    const when = `${week}, ${pv.meeting.season}`;
    const long =
      `${label} ${week} preview: the odds, keys to the game, recent form, player matchups, ` +
      `injuries and weather, plus fantasy start/sit calls.`;
    return {
      title: fitTitle(
        [
          `${label} Preview: Matchups, Odds, Injuries & Analysis | ${when}`,
          `${label} Preview: Odds, Injuries & Analysis | ${when}`,
          `${label} Preview: Odds & Injuries | ${when}`,
        ],
        PREVIEW_TITLE_MAX,
      ),
      description:
        long.length <= 160 ? long : `${label} ${week} preview: odds, keys to the game, form, matchups, injuries and fantasy start/sit.`,
      canonical,
      siteName: SITE_NAME,
    };
  }

  // The pair's address is the head-to-head series page (WEB-001, 2026-11-24):
  // every finished game is self-canonical at its dated page, which carries
  // the "{Away} vs {Home} Player Stats & Box Score" title the pair page wore
  // for this season's games from 2026-10-09 (the Search Console briefs of
  // 10-09 and 10-30). Only the upcoming states below keep their own wording.
  // MIRRORED by statchasers_matchup_meta() in the plugin.
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
    default:
      // A series page that prints its latest game's player stats keeps
      // "Player Stats" and adds "Head-to-Head History" (mak, 2026-11-24);
      // the box score's own week and year stay on the dated game page.
      if (seriesShowsPlayerStats(data)) {
        title = fitMatchupTitle([
          `${names} Player Stats & Head-to-Head History`,
          `${short} Player Stats & Head-to-Head History`,
          `${short} Player Stats & H2H History`,
        ]);
        description =
          `${a.nickname} vs ${b.nickname} player stats from their latest meeting, the head-to-head record ` +
          `and every meeting with its box score.`;
        break;
      }
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
