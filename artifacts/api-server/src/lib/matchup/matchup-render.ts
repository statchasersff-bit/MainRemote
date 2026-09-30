/**
 * The matchup page: two teams, one evergreen URL.
 *
 * Renders from MatchupData and lays itself out for the state that data
 * declares — the next meeting leads when there is one, the result when one
 * was just played, the head-to-head when neither. The URL never changes with
 * the state, so nothing here prints a date-dependent heading a search snippet
 * could go stale on; the hero names the two teams and the season, and the
 * state decides what comes under it.
 *
 * Built from the team page's own components — the scoreboard, the game card,
 * the stat rows, the injury list — so a matchup page and the two hubs it sits
 * between cannot disagree about how a game or a number looks. What is new
 * here is only the side-by-side.
 *
 * Nothing is invented to fill a section. No broadcaster means no network line;
 * no kickoff time means "Time TBD" as the schedule already says; no meetings in
 * the window means the history block is absent, not a sentence about rivalry.
 */

import { escapeHtml, escapeJsonLd } from "../render";
import {
  ARROW,
  gameDateLine,
  h2,
  injurySeverity,
  matchupSide,
  networkDefs,
  networkHtml,
  playerName,
  PUBLIC_SECTIONS,
  rankTier,
  sectionPath,
  slotChip,
  styleAttr,
  TIER_WORD,
} from "../team-render";
import {
  canonicalizeMatchupPair,
  gameSegment,
  isUpcomingFixture,
  meetingHasOwnAddress,
  type MatchupGameRef,
} from "./pair";
import { getPlayerSlugByName } from "../player/data";
import type { DefenseLine } from "./fantasy-points";
import { playerContexts, ratesFor } from "./fantasy-data";
import {
  renderFantasyMatchups,
  renderFantasySection,
  topScorers,
  verdictPlayers,
  type FantasySectionInput,
} from "./fantasy-section";
import {
  bettingSeason,
  pointsAllowed,
  seasonGames,
  seasonToDate,
  storedMeetings,
  storedSeasons,
  type TeamSeason,
} from "./season-data";
import { statLine } from "./leaders-strip";
import { shareImageAlt, shareImageFile, type ShareImageInput } from "./og-image";
import { gameNotes, schemaVideo, type GameVideo } from "./game-notes";
import { renderPossessions } from "./possessions";
import { renderWinProbability } from "./win-probability";
import type { ScoringPlay } from "./scoring-plays";
import {
  beforeAfter,
  breadcrumbSchema,
  jsonLdScript,
  renderBeforeAfter,
  renderExploreCard,
  renderBetting,
  renderExplore,
  renderHighlights,
  gameAfter,
  renderMeantCards,
  spreadLabel,
  type BettingExtras,
  videoSchema,
  type ExploreColumn,
  type ExploreGame,
  type GameLogLink,
  type SeasonSide,
} from "./recap-extras";
import { type NflTeam } from "../team/teams";
import { getFPAUrl, getPlayerProfileUrl, getSOSUrl, getTeamHubUrl } from "../team/links";
import { logger } from "../logger";
import { loadPlayers } from "../player/data";
import { appearances } from "./appearances";
import { buildGamePlayers, nameKey, type GamePlayers } from "./game-players";
import { renderLeadersStrip } from "./leaders-strip";
import { renderScoringSummary, validateScoringPlays } from "./scoring-summary";
import { historyForPair } from "./rivalry-data";
import { rivalryIntroFor } from "./rivalry-notes";
import {
  allTimeSummary,
  divisionRivalsSince,
  validateAllTime,
  type RivalryGame,
  type RivalryInput,
} from "./rivalry";
import {
  heroSideFill,
  pairColors as heroPairColors,
  renderScoreboardHero,
  scoreboardResult,
  scoreboardSportsEvent,
  type ScoreboardGame,
  type ScoreboardTeam,
} from "./scoreboard-hero";
import { buildRecap, renderRecap, START_SIT_URL, superBowlNumeral } from "./recap";
import { recapNotes } from "./recap-notes";
import {
  recapFaq,
  recapFaqSchema,
  renderRecapBody,
  renderStatCompare,
  type BodyTeam,
  type CompareRow,
  type FaqScorer,
  type RecapBodyInput,
} from "./recap-body";
import { headshotUrl } from "../team/roster";
import { ordinal, type StatRow, type TeamStats } from "../team/stats";
import type { ScheduleGame } from "../team/schedule";
import type { TeamPageData } from "../team/team-data";
import type { FpaRow } from "../fpa/fpa-data";
import { FANTASY_POSITIONS, type FantasyPosition } from "../fpa/nflverse";
import { HISTORY_SEASONS, type MatchupData, type Meeting } from "./matchup-data";
import {
  boxLineFor,
  boxStatsFor,
  formatClock,
  type BoxTeamStats,
} from "./boxscore";
import type {
  FantasyRow,
  GameStats,
  PassingRow,
  ReceivingRow,
  RushingRow,
  TeamUsage,
  UsageRow,
  UsageSlice,
} from "./game-stats";
import type { GameLeader, GameLeaders } from "./leaders";

export interface MatchupRenderOptions {
  /** Inside a statchasers.com page: no H1, no page chrome. */
  embed?: boolean;
  /** Where a team hub link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /** Where matchup pages live. Defaults to this app's own /nfl/. */
  matchupPathPrefix?: string;
  /** Carried onto internal links so embed mode stays embed mode. */
  linkQuery?: string;
  now?: number;
  /**
   * The meeting this request asked for, when the URL is a game address.
   *
   * Strictly a description of the request rather than of the rendering — the
   * renderer reads data.pinned, not this — but it travels with the option bag
   * because it changes which data is built, and therefore has to reach the
   * cache key beside everything else that does.
   */
  game?: MatchupGameRef | null;
}

/** The public address of a pair: `<prefix><a>-vs-<b>/`. */
export function matchupPath(prefix: string, slug: string): string {
  return `${prefix}${slug}/`;
}

/** The public address of one meeting: `<prefix><a>-vs-<b>/2026-week-1/`. */
export function gamePath(prefix: string, slug: string, ref: MatchupGameRef): string {
  return `${matchupPath(prefix, slug)}${gameSegment(ref)}/`;
}

/** The pair as a heading: "New England Patriots vs Philadelphia Eagles". */
export function matchupTitle(data: MatchupData): string {
  return `${data.pair.a.fullName} vs ${data.pair.b.fullName}`;
}

/* ------------------------------------------------------------------ atoms */

/**
 * The meeting list's week, short enough for a narrow column.
 *
 * "WK 1" where the season has weeks, and the postseason round's own short form
 * where it does not — "Conference Championship" is four times the width of
 * anything else in that column and would set the column's width for every row
 * on the page.
 */
const SHORT_ROUNDS: Record<string, string> = {
  "wild card": "WILD CARD",
  "divisional round": "DIVISIONAL",
  "conference championship": "CONF CHAMP",
  "super bowl": "SUPER BOWL",
};

function shortWeek(meeting: Meeting): string {
  if (meeting.seasonType === "regular") return `WK ${meeting.week}`;
  const label = meeting.weekLabel.trim();
  return SHORT_ROUNDS[label.toLowerCase()] ?? label.toUpperCase();
}

/**
 * A meeting in the shape the shared game helpers take. They read a game from
 * one team's side; for date and tag purposes the side does not matter, so the
 * home team stands in.
 */
function asGame(meeting: Meeting): ScheduleGame {
  return {
    week: meeting.week,
    seasonType: meeting.seasonType,
    weekLabel: meeting.weekLabel,
    espnEventId: meeting.espnEventId,
    kickoffMs: meeting.kickoffMs,
    timeConfirmed: meeting.timeConfirmed,
    homeAway: "home",
    neutralSite: meeting.neutralSite,
    opponent: meeting.away,
    opponentName: meeting.away.fullName,
    venue: meeting.venue,
    venueCity: meeting.venueCity,
    venueState: meeting.venueState,
    international: false,
    divisional: meeting.home.division === meeting.away.division,
    network: meeting.network,
    status: meeting.status,
    result: null,
  };
}

/* ------------------------------------------------------------------- hero */

/**
 * Whether the page lays itself out as a game page rather than as a fixture.
 *
 * One predicate, asked once, because the whole page hangs off it: the hero, the
 * order of the sections, what three of them are called. A final score is the
 * condition — not the matchup state — so a pair whose last meeting was two
 * seasons ago still gets the result treated as a result.
 */
function isPostgame(data: MatchupData): boolean {
  // A game address is a recap by definition — that is the whole reason it is a
  // separate URL. It does not age out, because nothing on it is advice: on a
  // dated page the stats and the usage are what happened in that week, read
  // by someone who came looking for that week.
  if (data.pinned) return data.pinned.score !== null;

  return (
    data.matchupState === "recently_completed" &&
    data.featured?.status === "final" &&
    data.featured.score !== null
  );
}

/**
 * Whether the blocks that describe *now* belong on this page.
 *
 * Season Form, the injury report and the Fantasy Matchups ranks are all read
 * from today's data, which is right on the pair's own address and right on a
 * game address from the season in progress — the reader asking about Week 1 in
 * December is still playing fantasy in 2026. It is wrong on a game from an
 * earlier season: a 2024 recap carrying 2026 injury designations is not history
 * with a bonus, it is three blocks of the wrong answer under a heading that
 * says 2024.
 */
function describesNow(data: MatchupData): boolean {
  return !data.pinned || data.pinned.season === data.state.season;
}

/**
 * Whether the featured meeting has a result to describe at all.
 *
 * Wider than isPostgame(): a pair whose last meeting was three seasons ago
 * still has a box score worth printing, and "patriots vs eagles 2023 player
 * stats" is a real search.
 */
function hasResult(data: MatchupData): boolean {
  return data.featured?.status === "final" && data.featured.score !== null;
}

/**
 * The pair's own address when no meeting is coming: the recap layout, built on
 * the latest game, so the pair page reads like the game pages under it.
 *
 */
function isHistoricalRecap(data: MatchupData): boolean {
  return !data.pinned && data.matchupState === "historical" && hasResult(data);
}

/**
 * The featured meeting as the scoreboard hero's game object.
 *
 * Home and away are the meeting's, which meetingFrom() read off ESPN's own
 * `homeAway` field for the team whose schedule it came from — never the pair's
 * order, which is alphabetical. The quarters are the box score's, looked up by
 * team rather than by position, and the hero sums them: the total it prints is
 * the line it prints, by construction.
 *
 * With no line score (ESPN's summary is a separate upstream and does fail) a
 * final keeps its score through `score`, which the hero reads only then.
 */
export function matchupScoreboardGame(data: MatchupData): ScoreboardGame | null {
  const meeting = data.featured;
  if (!meeting) return null;

  const status =
    meeting.status === "final" && meeting.score
      ? "final"
      : meeting.status === "live"
        ? "in_progress"
        : meeting.status === "final"
          ? null
          : "upcoming";
  if (!status) return null;

  const playoff = meeting.seasonType === "post";
  const superBowl = /super bowl/i.test(meeting.weekLabel);
  // The conference is what makes "Wild Card" a particular Wild Card game. Two
  // teams from one conference are the only pairs that can meet before the
  // Super Bowl, so the pair says which conference it is.
  const conference =
    playoff && !superBowl && meeting.home.conference === meeting.away.conference
      ? `${meeting.home.conference} `
      : "";

  const team = (club: NflTeam, side: "home" | "away"): ScoreboardTeam => {
    const line = status === "upcoming" ? null : boxLineFor(data.boxscore, club);
    return {
      abbr: club.code.toUpperCase(),
      name: club.fullName,
      short: club.nickname,
      quarters: status === "upcoming" ? [] : line ? line.periods.slice(0, 4) : null,
      ot:
        line && line.periods.length > 4
          ? line.periods.slice(4).reduce((sum, n) => sum + n, 0)
          : null,
      score: line ? null : (meeting.score?.[side] ?? null),
      logoUrl: club.logo,
      url: getTeamHubUrl(club),
    };
  };

  return {
    status,
    seasonLabel: String(meeting.season),
    gameType: playoff ? "playoff" : "regular",
    roundLabel: `${conference}${meeting.weekLabel}`,
    kickoff: meeting.kickoffMs === null ? null : new Date(meeting.kickoffMs).toISOString(),
    timeConfirmed: meeting.timeConfirmed,
    venue: meeting.venue
      ? {
          name: meeting.venue,
          city: meeting.venueCity,
          state: meeting.venueState,
          neutral: meeting.neutralSite,
        }
      : null,
    away: team(meeting.away, "away"),
    home: team(meeting.home, "home"),
  };
}

/** The heading's id, which the hero's aria-labelledby points at. */
const HERO_HEADING_ID = "sct-mu-title";

/**
 * The hero: the scoreboard for the featured meeting.
 *
 * A game address is headed by its game, in the scoreboard's own wording. The
 * pair's address keeps the pair's name, because that URL outlives any one
 * meeting and its H1 must not change when the next one is featured.
 *
 * Embedded, the heading is an H2 marked `data-sct-hero-heading`: the plugin
 * promotes it to the page's H1 when it is the one supplying the heading, and
 * leaves it an H2 under a theme that prints its own. An older plugin, which
 * prints its own H1 above the fragment, therefore still gets exactly one.
 */
function renderHero(data: MatchupData, options: MatchupRenderOptions): string {
  const headingTag = options.embed ? "h2" : "h1";
  const game = matchupScoreboardGame(data);
  if (game) {
    return renderScoreboardHero(game, {
      headingTag,
      headingId: HERO_HEADING_ID,
      heading: data.pinned ? undefined : matchupTitle(data),
    });
  }

  // No meeting in the window at all, which is two clubs from different
  // conferences in a bad year for the schedule, or ESPN down for all of it:
  // the panel, the names, and nothing invented to fill the board.
  return (
    `<header class="sct-sbh is-bare" data-status="none" aria-labelledby="${HERO_HEADING_ID}"` +
    styleAttr([
      `--sbh-away:${heroSideFill(data.pair.a.code)}`,
      `--sbh-home:${heroSideFill(data.pair.b.code)}`,
    ]) +
    `>` +
    `<${headingTag} class="sct-sbh-title" id="${HERO_HEADING_ID}" data-sct-hero-heading>` +
    `${escapeHtml(matchupTitle(data))}</${headingTag}>` +
    `<p class="sct-sbh-note">` +
    escapeHtml("Head-to-head record, team stats, injuries and recent meetings") +
    `</p>` +
    `</header>`
  );
}

/**
 * The game recap under the hero: headline, standfirst, and prose written from
 * the box score — see recap.ts for what it will and will not claim. Absent
 * without a line score, since every paragraph starts from the quarters.
 */
function renderGameRecap(data: MatchupData, options: MatchupRenderOptions, after = ""): string {
  const meeting = data.featured;
  const game = matchupScoreboardGame(data);
  if (!meeting || !game || game.status !== "final") return "";

  const now = options.now ?? Date.now();
  const next = data.thisSeason.find(
    (m) =>
      m !== meeting &&
      m.status !== "final" &&
      (m.kickoffMs === null || m.kickoffMs > now),
  );

  const recap = buildRecap({
    game,
    awayCity: meeting.away.city,
    homeCity: meeting.home.city,
    awayStats: boxStatsFor(data.boxscore, meeting.away),
    homeStats: boxStatsFor(data.boxscore, meeting.home),
    winnerPostseason:
      data.winnerPostseason?.map((g) => ({
        round: g.weekLabel,
        week: g.week,
        outcome: g.result?.outcome ?? null,
        teamScore: g.result?.teamScore ?? null,
        opponentScore: g.result?.opponentScore ?? null,
        opponent: g.opponent?.nickname ?? g.opponentName,
      })) ?? null,
    next: next ? { label: next.weekLabel, season: String(next.season) } : null,
    notes: recapNotes(
      data.pair.slug,
      gameSegment({ season: meeting.season, week: meeting.week, seasonType: meeting.seasonType }),
    ),
  });
  return recap
    ? renderRecap(recap, {
        playerNames: Object.values(gamePlayers(data)).map((p) => p.name),
        playerUrl: getPlayerProfileUrl,
      }, after)
    : "";
}

/* ------------------------------------------------- the game's own players */

let positionsByName: Map<string, string | null> | null = null;

/**
 * A position from the player dictionary, for a name ESPN's box score gives
 * without one. A name two players share is left unplaced rather than guessed.
 */
function dictionaryPosition(name: string): string | null {
  if (!positionsByName) {
    positionsByName = new Map();
    for (const player of loadPlayers()) {
      const key = nameKey(player.name);
      if (!key || player.position === "DEF") continue;
      positionsByName.set(key, positionsByName.has(key) ? null : player.position);
    }
  }
  return positionsByName.get(nameKey(name)) ?? null;
}

const playersCache = new WeakMap<MatchupData, GamePlayers>();

/**
 * Everyone with a line in the featured game: ESPN's box score, or the
 * Sleeper logs when it has no player block. Memoised per page data, because
 * the recap's links, the leaders strip and the scoring summary all ask.
 */
function gamePlayers(data: MatchupData): GamePlayers {
  const hit = playersCache.get(data);
  if (hit) return hit;
  const box = data.boxscore;
  const players = data.featured
    ? buildGamePlayers(
        box?.players ?? null,
        box?.players.length ? null : appearances(data.featured),
        box?.scoringPlays ?? [],
        dictionaryPosition,
      )
    : {};
  playersCache.set(data, players);
  return players;
}

/** The leaders strip, full width under the hero on a recap page. */
function renderGameLeadersStrip(data: MatchupData): string {
  const game = matchupScoreboardGame(data);
  if (!game || game.status !== "final") return "";
  return renderLeadersStrip({ game, players: gamePlayers(data), playerUrl: getPlayerProfileUrl });
}

/**
 * The scoring summary, after "Why won". What does not add up against the
 * hero's line is logged and the table still prints: the plays are the feed's
 * own record, and a warning is how a dropped play gets noticed.
 */
function renderGameScoring(data: MatchupData): string {
  const game = matchupScoreboardGame(data);
  const plays = data.boxscore?.scoringPlays ?? [];
  if (!game || game.status !== "final" || plays.length === 0) return "";
  const problems = validateScoringPlays(game, plays);
  if (problems.length) {
    logger.warn({ matchup: data.pair.slug, problems }, "Scoring plays do not match the final score");
  }
  return renderScoringSummary({ game, plays, playerUrl: getPlayerProfileUrl });
}

/* ------------------------------------------- stored seasons: extras */

/** The Betting tab's extras: the pair's priced meetings, each club's season against the lines, and what is next. */
function bettingExtras(data: MatchupData, game: ScoreboardGame, options: MatchupRenderOptions): BettingExtras | null {
  const meeting = data.featured;
  if (!meeting) return null;
  const away = game.away.abbr;
  const home = game.home.abbr;
  const through = { seasonType: meeting.seasonType, week: meeting.week } as const;
  const seasons = storedSeasons(meeting.season - HISTORY_SEASONS, meeting.season);
  const next: BettingExtras["next"] = {};
  for (const side of seasonSides(data)) {
    const after = gameAfter(side, game);
    if (!after) {
      next[side.abbr] = null;
      continue;
    }
    const opp = after.opponent?.nickname ?? after.opponentName;
    const home = after.homeAway === "home";
    const label = `${home ? `${opp} at ${side.short}` : `${side.short} at ${opp}`}, ${after.weekLabel}`;
    const team = side.abbr === meeting.away.code.toUpperCase() ? meeting.away : meeting.home;
    const oppCode = after.opponent?.code.toUpperCase() ?? null;
    const stored = oppCode
      ? seasonGames(meeting.season).find(
          (g) =>
            g.seasonType === after.seasonType &&
            g.week === after.week &&
            [g.away, g.home].includes(side.abbr) &&
            [g.away, g.home].includes(oppCode),
        )
      : undefined;
    next[side.abbr] = {
      label,
      url: scheduleGameUrl(team, after, meeting.season, options, side.games),
      line: stored?.odds ? spreadLabel(stored.odds) : null,
    };
  }
  return {
    meetings: storedMeetings(seasons, away, home, { season: meeting.season, ...through }),
    seasons: {
      [away]: bettingSeason(meeting.season, away, through, "away"),
      [home]: bettingSeason(meeting.season, home, through, "home"),
    },
    next,
  };
}

/**
 * "Season to date": both clubs' regular season from the stored box scores,
 * in the "Why won" table's design. The heading names the week the numbers run
 * through, so a Week 1 recap read in Week 3 does not look like a preview.
 */
function renderSeasonToDate(data: MatchupData, game: ScoreboardGame): string {
  const meeting = data.featured;
  if (!meeting) return "";
  const std = seasonToDate(meeting.season, [game.away.abbr, game.home.abbr]);
  if (!std) return "";
  const a = std.teams[game.away.abbr] ?? null;
  const h = std.teams[game.home.abbr] ?? null;
  const per = (t: TeamSeason | null, n: (t: TeamSeason) => number): number | null =>
    t && t.games ? n(t) / t.games : null;
  const one = (v: number | null): string => (v === null ? "—" : v.toFixed(1));
  const rec = (t: TeamSeason | null): string => (t ? `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}` : "—");
  const rows: CompareRow[] = [
    { label: "Record", away: a ? a.wins : null, home: h ? h.wins : null, awayText: rec(a), homeText: rec(h), better: "higher" },
    ...(
      [
        ["Points per game", (t: TeamSeason) => t.pointsFor, "higher"],
        ["Yards per game", (t: TeamSeason) => t.yardsFor, "higher"],
        ["Points allowed per game", (t: TeamSeason) => t.pointsAgainst, "lower"],
        ["Yards allowed per game", (t: TeamSeason) => t.yardsAgainst, "lower"],
      ] as const
    ).map(([label, f, better]) => {
      const x = per(a, f);
      const y = per(h, f);
      return { label, away: x, home: y, awayText: one(x), homeText: one(y), better } as CompareRow;
    }),
  ];
  const ypp = (t: TeamSeason | null): number | null => (t && t.playsFor ? t.yardsFor / t.playsFor : null);
  rows.splice(3, 0, {
    label: "Yards per play",
    away: ypp(a),
    home: ypp(h),
    awayText: one(ypp(a)),
    homeText: one(ypp(h)),
    better: "higher",
  });
  const colors = heroPairColors(game.away.abbr, game.home.abbr);
  return (
    `<section class="sct-rb-section sct-mu-form" aria-labelledby="season-to-date">` +
    `<h3 class="sct-rb-h3" id="season-to-date">${escapeHtml(`Season to date (through Week ${std.throughWeek})`)}</h3>` +
    `<p class="sct-rb-sub">${escapeHtml(`The ${meeting.season} regular season, from each game's box score.`)}</p>` +
    renderStatCompare({
      caption: `Season to date, ${game.away.short} vs ${game.home.short}`,
      awayName: game.away.short,
      homeName: game.home.short,
      awayInk: colors.away.ink,
      homeInk: colors.home.ink,
      rows,
    }) +
    `</section>`
  );
}

/** Points allowed by position for the Fantasy tab, with player positions from the dictionary. */
function renderGameMatchups(data: MatchupData, game: ScoreboardGame): string {
  const meeting = data.featured;
  if (!meeting) return "";
  return renderFantasyMatchups(game, pointsAllowed(meeting.season, [game.away.abbr, game.home.abbr], dictionaryPosition));
}

/** The two best PPR lines in the game, for the FAQ. */
function faqScorers(data: MatchupData): FaqScorer[] {
  const input = fantasyInput(data);
  if (!input) return [];
  return topScorers(input)
    .slice(0, 2)
    .map((t) => ({ name: t.name, ppr: t.ppr, line: statLine(t.player) }));
}

/* ------------------------------------------- the recap's added sections */

/**
 * A club's schedule row as a link: its game page once it has one, the pair page before.
 * `games` is that club's season, which says whether the two meet again — see
 * meetingHasOwnAddress().
 */
function scheduleGameUrl(
  team: NflTeam,
  g: ScheduleGame,
  season: number,
  options: MatchupRenderOptions,
  games: ScheduleGame[],
): string | null {
  const pair = g.opponent ? canonicalizeMatchupPair(team, g.opponent) : null;
  if (!pair) return null;
  const prefix = (options.matchupPathPrefix ?? "/nfl/").trim();
  const query = options.linkQuery ?? "";
  const final = g.status === "final" && g.result !== null;
  const now = options.now ?? Date.now();
  const rematchAhead = games.some(
    (other) =>
      other.opponent?.abbreviation === g.opponent?.abbreviation &&
      isUpcomingFixture(other.status === "final", other.kickoffMs, now),
  );
  return meetingHasOwnAddress(g.kickoffMs, final, now, rematchAhead)
    ? `${gamePath(prefix, pair.slug, { season, week: g.week, seasonType: g.seasonType })}${query}`
    : `${matchupPath(prefix, pair.slug)}${query}`;
}

/** Both clubs' seasons as the extras read them, away first. */
function seasonSides(data: MatchupData): SeasonSide[] {
  const meeting = data.featured;
  if (!meeting || !data.seasonGames) return [];
  const gamesOf = (team: NflTeam): ScheduleGame[] =>
    team.abbreviation === data.pair.a.abbreviation ? data.seasonGames!.a : data.seasonGames!.b;
  return [meeting.away, meeting.home].map((team) => ({
    abbr: team.code.toUpperCase(),
    name: team.fullName,
    short: team.nickname,
    games: gamesOf(team),
  }));
}

/** Made field goals by distance, per kicker, from the scoring plays. */
function fieldGoalsByKicker(plays: ScoringPlay[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const play of plays) {
    if (play.type !== "field_goal" || !play.scorer || play.yards === null) continue;
    const key = `${play.team}:${nameKey(play.scorer)}`;
    (out[key] ??= []).push(play.yards);
  }
  return out;
}

/**
 * Each defense's game, from the other side's box score and the scoring plays.
 * Absent for a side whose opponent has no figures: a D/ST score from a guessed
 * sack count is exactly what the page must not print.
 */
function defenseLines(data: MatchupData, game: ScoreboardGame): Record<string, DefenseLine> {
  const meeting = data.featured;
  const result = scoreboardResult(game);
  if (!meeting || !result) return {};
  const plays = data.boxscore?.scoringPlays ?? [];
  const out: Record<string, DefenseLine> = {};
  for (const [side, other] of [["away", "home"], ["home", "away"]] as const) {
    const abbr = game[side].abbr;
    const opp = boxStatsFor(data.boxscore, meeting[other]);
    if (!opp || opp.sacked == null || opp.interceptionsThrown == null) continue;
    const mine = plays.filter((p) => p.team === abbr);
    out[abbr] = {
      sacks: opp.sacked,
      ints: opp.interceptionsThrown,
      fumRec: opp.fumblesLost ?? 0,
      safeties: mine.filter((p) => p.type === "safety").length,
      defTd: mine.filter((p) => p.type === "int_return_td" || p.type === "fumble_return_td").length,
      retTd: mine.filter((p) => p.type === "punt_return_td" || p.type === "kickoff_return_td").length,
      pointsAllowed: result[other],
    };
  }
  return out;
}

/** Redraft Command's start/sit launcher for one player, from his slug. */
function startSitFor(name: string): string | null {
  const slug = getPlayerSlugByName(name);
  return slug ? `${START_SIT_URL}${encodeURIComponent(slug)}` : null;
}

const fantasyCache = new WeakMap<MatchupData, FantasySectionInput | null>();

/** The fantasy section's input, memoised: the section, the game logs and the FAQ all read it. */
function fantasyInput(data: MatchupData): FantasySectionInput | null {
  if (fantasyCache.has(data)) return fantasyCache.get(data)!;
  const meeting = data.featured;
  const game = matchupScoreboardGame(data);
  let input: FantasySectionInput | null = null;
  if (meeting && game && game.status === "final") {
    const players = gamePlayers(data);
    const post = meeting.seasonType === "post";
    const live = meeting.season === data.state.season && !post;
    const notes = gameNotes(
      data.pair.slug,
      gameSegment({ season: meeting.season, week: meeting.week, seasonType: meeting.seasonType }),
    );
    const next: Record<string, { label: string; opponent: string } | null> = {};
    if (live) {
      for (const side of seasonSides(data)) {
        const after = side.games
          .filter((g) => g.status !== "final" && (g.kickoffMs ?? Infinity) > (meeting.kickoffMs ?? 0))
          .sort((x, y) => (x.kickoffMs ?? 0) - (y.kickoffMs ?? 0))[0];
        next[side.abbr] = after ? { label: after.weekLabel, opponent: after.opponent?.nickname ?? after.opponentName } : null;
      }
    }
    input = {
      game,
      players,
      contexts: playerContexts(players, meeting.season, meeting.week, post),
      fieldGoals: fieldGoalsByKicker(data.boxscore?.scoringPlays ?? []),
      defense: defenseLines(data, game),
      rates: ratesFor(meeting.season),
      playerUrl: getPlayerProfileUrl,
      startSitUrl: startSitFor,
      countsInSeasonLong: !post,
      next: live ? next : null,
      injuries: notes.injuries ?? null,
      links: { redraftCommand: REDRAFT_COMMAND_URL },
    };
  }
  fantasyCache.set(data, input);
  return input;
}

function renderGameWinProbability(data: MatchupData): string {
  const game = matchupScoreboardGame(data);
  const plays = data.boxscore?.scoringPlays ?? [];
  if (!game || game.status !== "final" || plays.length === 0) return "";
  return renderWinProbability({ game, plays, odds: data.boxscore?.odds ?? null, playerUrl: getPlayerProfileUrl });
}

function renderGamePossessions(data: MatchupData): string {
  const game = matchupScoreboardGame(data);
  const meeting = data.featured;
  if (!game || !meeting || game.status !== "final" || !data.boxscore) return "";
  return renderPossessions({
    game,
    stats: { away: boxStatsFor(data.boxscore, meeting.away), home: boxStatsFor(data.boxscore, meeting.home) },
    drives: data.boxscore.drives ?? [],
    players: gamePlayers(data),
    places: {
      [meeting.away.code.toUpperCase()]: meeting.away.city,
      [meeting.home.code.toUpperCase()]: meeting.home.city,
    },
  });
}

function gameVideo(data: MatchupData): GameVideo | null {
  const meeting = data.featured;
  if (!meeting) return null;
  return (
    gameNotes(data.pair.slug, gameSegment({ season: meeting.season, week: meeting.week, seasonType: meeting.seasonType }))
      .video ?? null
  );
}

/** The winner's games after this one: its playoff run, or its next few weeks. */
function winnerPath(data: MatchupData, game: ScoreboardGame, options: MatchupRenderOptions): ExploreColumn | null {
  const meeting = data.featured;
  const result = scoreboardResult(game);
  if (!meeting || !result) return null;
  const key = result.winner ?? "home";
  const team = meeting[key];
  const side = seasonSides(data).find((s) => s.abbr === team.code.toUpperCase());
  if (!side) return null;
  const ordered = [...side.games].sort((a, b) =>
    a.seasonType !== b.seasonType ? (a.seasonType === "regular" ? -1 : 1) : a.week - b.week,
  );
  const at = ordered.findIndex(
    (g) =>
      g.opponent?.abbreviation === meeting[key === "home" ? "away" : "home"].abbreviation &&
      g.week === meeting.week &&
      g.seasonType === meeting.seasonType,
  );
  if (at < 0) return null;
  const after = ordered.slice(at + 1).filter((g) => (game.gameType === "playoff" ? g.seasonType === "post" : true)).slice(0, 4);
  if (after.length === 0) return null;
  const last = after[after.length - 1]!;
  const title =
    game.gameType === "playoff"
      ? /super bowl/i.test(last.weekLabel)
        ? `The ${team.nickname}' road to Super Bowl ${superBowlNumeral(meeting.season)}`
        : `The ${team.nickname}' playoff run`
      : `The ${team.nickname}' next games`;
  const games: ExploreGame[] = after.map((g) => {
    const opp = g.opponent?.nickname ?? g.opponentName;
    const home = g.homeAway === "home";
    const mine = g.result?.teamScore ?? null;
    const theirs = g.result?.opponentScore ?? null;
    const date =
      g.kickoffMs === null
        ? ""
        : ` · ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date(g.kickoffMs))}`;
    return {
      away: home ? { short: opp, score: theirs } : { short: team.nickname, score: mine },
      home: home ? { short: team.nickname, score: mine } : { short: opp, score: theirs },
      neutral: g.neutralSite,
      meta: `${g.weekLabel}${date}`,
      url: scheduleGameUrl(team, g, meeting.season, options, side.games),
    };
  });
  const teamPrefix = (options.teamPathPrefix ?? "/team/").trim();
  const hasSchedule = (PUBLIC_SECTIONS as readonly string[]).includes("schedule");
  return {
    title,
    games,
    footer: hasSchedule
      ? { text: `${team.nickname} ${meeting.season} schedule`, url: `${sectionPath(teamPrefix, team.slug, "schedule")}${options.linkQuery ?? ""}` }
      : null,
  };
}

/** "Keep exploring": the winner's path, the game logs, and its own pills to the hubs. */
function renderGameExplore(data: MatchupData, input: RecapBodyInput, options: MatchupRenderOptions): string {
  const game = matchupScoreboardGame(data);
  const meeting = data.featured;
  if (!game || !meeting) return "";
  const fantasy = fantasyInput(data);
  const colors = heroPairColors(game.away.abbr, game.home.abbr);
  const logs: GameLogLink[] = (fantasy ? verdictPlayers(fantasy) : []).flatMap((p) => {
    const profile = getPlayerProfileUrl(p.name);
    if (!profile) return [];
    const base = profile.endsWith("/") ? profile : `${profile}/`;
    return [
      {
        name: p.name,
        team: p.team,
        pos: p.pos,
        url: `${base}game-log/?log=${meeting.season}`,
        ink: p.team === game.home.abbr ? colors.home.ink : colors.away.ink,
      },
    ];
  });
  const prefix = (options.matchupPathPrefix ?? "/nfl/").trim();
  const query = options.linkQuery ?? "";
  const pill = (href: string | null, text: string): string =>
    href ? `<li><a class="sct-rb-pill" href="${escapeHtml(href)}">${escapeHtml(text)}</a></li>` : "";
  const pills = [game.away.abbr, game.home.abbr]
    .map((abbr) => {
      const t = input.teams[abbr]!;
      return pill(t.hub, `${t.name} hub`) + pill(t.matchups, `All ${t.short} matchups`);
    })
    .join("") +
    (data.pinned ? pill(`${matchupPath(prefix, data.pair.slug)}${query}`, `Every ${game.away.short} vs ${game.home.short} game`) : "");
  const nav = pills
    ? `<nav class="sct-ex-hubs" aria-label="Team and rivalry pages">` +
      `<h3 class="sct-rb-h3">Team pages</h3><ul class="sct-rb-pills">${pills}</ul></nav>`
    : "";
  return renderExplore([], { season: String(meeting.season), players: logs }, nav);
}

/** The recap build spec's sections that live outside recap-body.ts, for the tabs to place. */
function renderAddedSections(data: MatchupData, input: RecapBodyInput, options: MatchupRenderOptions): AddedSections {
  const game = input.game;
  return {
    meant: renderMeantCards(game, seasonSides(data)),
    highlights: renderHighlights(game, gameVideo(data)),
    winProbability: renderGameWinProbability(data),
    possessions: renderGamePossessions(data),
    betting: renderBetting(game, data.boxscore?.odds ?? null, bettingExtras(data, game, options)),
    explore: renderGameExplore(data, input, options),
  };
}

/** The recap build spec's sections, one by one, for the tabs to place. */
interface AddedSections {
  meant: string;
  highlights: string;
  winProbability: string;
  possessions: string;
  betting: string;
  explore: string;
}

function renderGameBeforeAfter(data: MatchupData, options: MatchupRenderOptions): string {
  const game = matchupScoreboardGame(data);
  const meeting = data.featured;
  if (!game || !meeting) return "";
  const teams = [meeting.away, meeting.home];
  const sides = seasonSides(data)
    .map((side, i) => beforeAfter(side, game, (g) => scheduleGameUrl(teams[i]!, g, meeting.season, options, side.games)))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  // The winner's next games follow, as their own card.
  return renderBeforeAfter(game, sides) + renderExploreCard(winnerPath(data, game, options));
}

/** The recap's VideoObject as an inert island for the plugin, or "". */
function matchupVideoIsland(data: MatchupData): string {
  const meeting = data.featured;
  const game = matchupScoreboardGame(data);
  if (!meeting || !game) return "";
  const node = videoSchema(
    game,
    schemaVideo(data.pair.slug, gameSegment({ season: meeting.season, week: meeting.week, seasonType: meeting.seasonType })),
  );
  return node
    ? `<script type="application/json" class="sct-matchup-video-data">${escapeJsonLd(JSON.stringify(node))}</script>`
    : "";
}

/** "Breadcrumbs, the highlights video": the recap's extra JSON-LD nodes. */
export function matchupRecapSchema(
  data: MatchupData,
  options: MatchupRenderOptions,
  canonical: string,
): string {
  if (!isPostgame(data) && !isHistoricalRecap(data)) return "";
  const game = matchupScoreboardGame(data);
  if (!game) return "";
  const prefix = (options.matchupPathPrefix ?? "/nfl/").trim();
  const round = game.roundLabel.replace(/^(AFC|NFC)\s+/, "");
  // Absolute, from the page's own canonical: schema.org wants a full URL.
  const absolute = (path: string): string | null => {
    try {
      return new URL(path, canonical).toString();
    } catch {
      return null;
    }
  };
  const crumbs = [
    { name: "NFL", url: absolute(prefix) },
    { name: "Matchups", url: null },
    { name: `${game.away.short} vs ${game.home.short}`, url: absolute(matchupPath(prefix, data.pair.slug)) },
    { name: `${game.seasonLabel} ${round}`, url: canonical || null },
  ];
  const meeting = data.featured;
  const video = meeting
    ? schemaVideo(data.pair.slug, gameSegment({ season: meeting.season, week: meeting.week, seasonType: meeting.seasonType }))
    : null;
  return jsonLdScript([breadcrumbSchema(crumbs), videoSchema(game, video)]);
}

/** Redraft Command's own page, for the sidebar's "Connect your league". */
const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

/**
 * The recap body's input, from the page data: the same game object as the
 * hero, both clubs, the box score, the series and the tool links. Away, home
 * and each side's score are copied from each meeting's own fields.
 */
export function recapBodyInput(
  data: MatchupData,
  options: MatchupRenderOptions,
): RecapBodyInput | null {
  const game = matchupScoreboardGame(data);
  const meeting = data.featured;
  if (!game || !meeting || game.status !== "final") return null;

  const teamPrefix = (options.teamPathPrefix ?? "/team/").trim();
  const matchupPrefix = (options.matchupPathPrefix ?? "/nfl/").trim();
  const query = options.linkQuery ?? "";
  const hasMatchups = (PUBLIC_SECTIONS as readonly string[]).includes("matchups");
  const bodyTeam = (team: NflTeam): BodyTeam => ({
    abbr: team.code.toUpperCase(),
    name: team.fullName,
    short: team.nickname,
    singular: team.singular,
    city: team.city,
    hub: `${teamPrefix}${team.slug}/${query}`,
    matchups: hasMatchups ? `${sectionPath(teamPrefix, team.slug, "matchups")}${query}` : null,
  });
  const code = (team: NflTeam): string => team.code.toUpperCase();

  // The game this page is about has no link of its own, and nor does one the
  // pair's own address is still leading with: that dated URL 301s back.
  const current = (m: Meeting): boolean => m === meeting;
  // On the historical pair page the featured game keeps its own address, so it
  // links there like any other meeting.
  const ownPage = isHistoricalRecap(data);
  const linked = (m: Meeting): string | null =>
    (current(m) && !ownPage) || (data.matchupState === "recently_completed" && data.featured === m)
      ? null
      : `${gamePath(matchupPrefix, data.pair.slug, {
          season: m.season,
          week: m.week,
          seasonType: m.seasonType,
        })}${query}`;

  const now = options.now ?? Date.now();
  const played = [...data.thisSeason, ...data.history].filter(
    (m) => m.status === "final" && m.score !== null,
  );
  const upcoming = data.thisSeason.filter(
    (m) => m.status === "scheduled" && (m.kickoffMs === null || m.kickoffMs > now),
  );

  const rivalry = pageRivalry(data, played, linked);

  return {
    game,
    rivalry,
    teams: {
      [code(data.pair.a)]: bodyTeam(data.pair.a),
      [code(data.pair.b)]: bodyTeam(data.pair.b),
    },
    stats: {
      away: boxStatsFor(data.boxscore, meeting.away),
      home: boxStatsFor(data.boxscore, meeting.home),
    },
    series: {
      sinceSeason: data.state.season - HISTORY_SEASONS,
      games: played.map((m) => ({
        season: m.season,
        weekLabel: m.weekLabel,
        playoff: m.seasonType === "post",
        kickoff: m.kickoffMs === null ? null : new Date(m.kickoffMs).toISOString(),
        away: code(m.away),
        home: code(m.home),
        awayScore: m.score!.away,
        homeScore: m.score!.home,
        neutral: m.neutralSite,
        url: linked(m),
        current: current(m),
      })),
      upcoming: upcoming.map((m) => ({
        season: m.season,
        weekLabel: m.weekLabel,
        kickoff: m.kickoffMs === null ? null : new Date(m.kickoffMs).toISOString(),
        timeConfirmed: m.timeConfirmed,
        away: code(m.away),
        home: code(m.home),
        neutral: m.neutralSite,
        venueCity: m.venueCity,
      })),
    },
    links: {
      redraftCommand: REDRAFT_COMMAND_URL,
      startSit: START_SIT_URL,
      pointsAllowed: getFPAUrl(),
      strengthOfSchedule: getSOSUrl(),
      // No address yet: the card shows once SC_MATCHUP_ANALYZER_URL names one.
      matchupAnalyzer: process.env["SC_MATCHUP_ANALYZER_URL"]?.trim() || null,
    },
    topScorers: faqScorers(data),
    info: {
      tv: meeting.network ?? data.boxscore?.broadcast ?? null,
      attendance: data.boxscore?.attendance ?? null,
    },
  };
}


/**
 * The all-time series input: every complete season from the shipped history,
 * then this season's finals from the page's own schedule — one list, so the
 * tiles are counted from a single source. A game with a recap page on this
 * site carries its URL. Logs when the all-time count disagrees with the
 * "since" series printed under it.
 */
function pageRivalry(
  data: MatchupData,
  played: Meeting[],
  linked: (m: Meeting) => string | null,
): RivalryInput | null {
  const { a, b } = data.pair;
  const history = historyForPair(a.code, b.code);
  if (!history || history.games.length === 0) return null;

  const same = (g: RivalryGame, m: Meeting): boolean =>
    g.season === m.season &&
    g.away === m.away.code.toUpperCase() &&
    g.home === m.home.code.toUpperCase() &&
    g.awayScore === m.score!.away &&
    g.homeScore === m.score!.home;

  const games = history.games;
  for (const g of games) {
    const m = played.find((x) => same(g, x));
    if (m) g.url = linked(m);
  }
  for (const m of played) {
    if (m.season <= history.throughSeason) continue;
    games.push({
      season: m.season,
      date: m.kickoffMs === null ? `${m.season}-12-31` : new Date(m.kickoffMs).toISOString().slice(0, 10),
      away: m.away.code.toUpperCase(),
      home: m.home.code.toUpperCase(),
      awayScore: m.score!.away,
      homeScore: m.score!.home,
      playoff: m.seasonType === "post",
      url: linked(m),
    });
  }

  const shared = a.division === b.division;
  const rivalry: RivalryInput = {
    intro: rivalryIntroFor(data.pair.slug),
    divisionName: shared ? a.division : null,
    divisionRivalsSince: shared
      ? divisionRivalsSince(games, a.code, b.code, history.throughSeason)
      : null,
    allGames: games,
  };

  const summary = allTimeSummary(rivalry, a.code, b.code);
  if (summary) {
    const wins: Record<string, number> = { [a.code]: 0, [b.code]: 0 };
    let ties = 0;
    for (const m of played) {
      const { away, home } = m.score!;
      if (away === home) ties += 1;
      else wins[(away > home ? m.away : m.home).code] = (wins[(away > home ? m.away : m.home).code] ?? 0) + 1;
    }
    const problems = validateAllTime(summary, { wins, ties, games: played.length });
    if (problems.length) {
      logger.warn({ matchup: data.pair.slug, problems }, "All-time series disagrees with the recent series");
    }
  }
  return rivalry;
}

/** The FAQ's JSON-LD (standalone) or island (embed), on a recap page only. */
export function matchupFaqSchema(
  data: MatchupData,
  options: MatchupRenderOptions,
  embed: boolean,
): string {
  if (!isPostgame(data) && !isHistoricalRecap(data)) return "";
  const input = recapBodyInput(data, options);
  return input ? recapFaqSchema(recapFaq(input), embed) : "";
}

/**
 * The hero's game as structured data.
 *
 * On the standalone page, JSON-LD of its own. Embedded, an inert island the
 * plugin lifts into Rank Math's graph in the <head> and strips from the markup,
 * the way the team pages carry their FAQ — a second ld+json script injected
 * from inside the fragment would compete with the host's graph, not join it.
 */
export function matchupEventSchema(data: MatchupData, embed: boolean): string {
  const game = matchupScoreboardGame(data);
  const node = game ? scoreboardSportsEvent(game) : null;
  if (!node) return "";
  if (embed) {
    return (
      `<script type="application/json" class="sct-matchup-event-data">` +
      escapeJsonLd(JSON.stringify(node)) +
      `</script>`
    );
  }
  return (
    `<script type="application/ld+json">` +
    escapeJsonLd(JSON.stringify({ "@context": "https://schema.org", ...node })) +
    `</script>`
  );
}

/* ---------------------------------------------------------- game leaders */

/**
 * The caption over a two-sided comparison: one name per column, the join between.
 *
 * The grid is an inner element and NOT the <caption> itself, which is the whole
 * reason this is a function. Setting `display: flex` or `display: grid` on a
 * caption replaces `display: table-caption`, so the browser stops treating it
 * as a caption at all and wraps it in an anonymous cell — it was rendering at
 * the width of the first column, clustered over the left-hand side's numbers
 * instead of spanning the three columns it names. The caption keeps its own
 * display; the row inside it does the layout.
 *
 * `hidden` is what a screen reader hears in place of the three words, which on
 * their own are two team names and a preposition.
 */
function compareCaption(
  leftName: string,
  join: string,
  rightName: string,
  hidden: string,
): string {
  return (
    `<caption class="sct-mu-cmp-title">` +
    `<span class="sct-mu-cmp-row">` +
    `<span class="sct-mu-cmp-side" data-side="a">${escapeHtml(leftName)}</span>` +
    `<span class="sct-mu-cmp-vs">${escapeHtml(join)}</span>` +
    `<span class="sct-mu-cmp-side" data-side="b">${escapeHtml(rightName)}</span>` +
    `</span>` +
    `<span class="sct-visually-hidden">${escapeHtml(hidden)}</span>` +
    `</caption>`
  );
}

/**
 * "QB · SEA", with the position carrying its own colour.
 *
 * The four skill positions are colour-coded across the whole site — the depth
 * chart's slot chips and the outlook cards use the same four inks, and they are
 * tokens rather than literals so a page cannot drift from the others. Split
 * into its own element because only the POSITION is coloured: the team code
 * beside it stays muted, or a row of these becomes a row of two-tone text with
 * no hierarchy in it.
 *
 * Either part may be absent, and the separator is drawn only when both are
 * there — a player with no position must not render a leading dot.
 */
function positionTag(
  position: string | null | undefined,
  teamCode: string | null | undefined,
  className: string,
): string {
  const pos = (position ?? "").trim();
  const code = (teamCode ?? "").trim().toUpperCase();
  if (!pos && !code) return "";
  return (
    `<span class="${className}">` +
    (pos
      ? `<span class="sct-pos" data-pos="${escapeHtml(pos.toUpperCase())}">${escapeHtml(pos)}</span>`
      : "") +
    (pos && code ? `<span class="sct-pos-dot" aria-hidden="true">·</span>` : "") +
    (code ? `<span class="sct-pos-team">${escapeHtml(code)}</span>` : "") +
    `</span>`
  );
}

/**
 * A player's face, in the round well the depth chart and the outlook cards use.
 *
 * Decorative, so the alt is empty: the name is on the row beside it and
 * announcing the face as well reads the player out twice. The well is drawn by
 * the stylesheet and survives an image that 404s, which is the ordinary case
 * for a rookie Sleeper has no thumbnail for — a missing face leaves a tinted
 * disc rather than a broken-image glyph.
 */
function playerPhoto(playerId: string, className: string, size: number): string {
  return (
    `<span class="${className}" aria-hidden="true">` +
    `<img src="${escapeHtml(headshotUrl(playerId))}" alt=""` +
    ` width="${size}" height="${size}" loading="lazy" decoding="async" />` +
    `</span>`
  );
}

/**
 * Who led the game, in four cards.
 *
 * Postgame only, and silent when the logs cannot answer. The name is the
 * loudest thing in each card: the number is the reason the card exists, but the
 * name is what the reader came for and what the search that brought them here
 * was about. The face is there because these are the four players the page is
 * about and a row of text undersold them.
 */
function renderLeaders(data: MatchupData): string {
  const leaders: GameLeaders | null = data.gameStats?.leaders ?? null;
  if (!leaders) return "";

  const card = (label: string, leader: GameLeader | null): string => {
    if (!leader) return "";
    const code = leader.team?.code ?? "";
    // The crest of the team he played for THAT day, as the card's watermark —
    // the device the outlook cards already use, and the reason it is a CSS
    // background rather than an <img>: it is texture, not a second picture of
    // something. A leader whose team the logs could not name simply has none,
    // and the card falls back to the plain surface it had before.
    const logo = leader.team?.logo ?? null;
    return (
      `<li class="sct-mu-leader${logo ? " has-team-logo" : ""}"` +
      styleAttr([logo ? `--mu-leader-logo:url('${logo}')` : null]) +
      `>` +
      `<p class="sct-mu-leader-label">${escapeHtml(label)}</p>` +
      `<div class="sct-mu-leader-body">` +
      playerPhoto(leader.player.id, "sct-mu-leader-photo", 56) +
      `<div class="sct-mu-leader-who">` +
      playerName(leader.player.name, "sct-mu-leader-name") +
      positionTag(leader.player.position, code, "sct-mu-leader-tag") +
      `</div>` +
      `</div>` +
      `<p class="sct-mu-leader-stat">` +
      `<span class="sct-mu-leader-value">${escapeHtml(leader.value)}</span>` +
      `<span class="sct-mu-leader-unit">${escapeHtml(leader.unit)}</span>` +
      `</p>` +
      // The fantasy card puts the position here, so it is not always a stat
      // line — hence no leading separator baked into the markup.
      (leader.line
        ? `<p class="sct-mu-leader-line">${escapeHtml(leader.line)}</p>`
        : "") +
      `</li>`
    );
  };

  const cards =
    card("Passing", leaders.passing) +
    card("Rushing", leaders.rushing) +
    card("Receiving", leaders.receiving) +
    card("Fantasy", leaders.fantasy);
  if (!cards) return "";

  return (
    `<section class="sct-block sct-mu-leaders">` +
    h2("Game Leaders") +
    `<ul class="sct-mu-leader-grid">${cards}</ul>` +
    `</section>`
  );
}

/* ------------------------------------------------------ how it was won */

/** One comparison row of the glance: a label, two figures, two bars. */
interface GlanceRow {
  label: string;
  description: string;
  away: number | null;
  home: number | null;
  /** How each figure prints. */
  format: (value: number) => string;
  /**
   * Which end of this metric is the good one.
   *
   * It decides both the highlight and the bar, and it has to, because a bar
   * drawn straight from the raw number says the wrong thing on a row like
   * turnovers: three against none fills the bar of the side that threw them
   * away, and a longer bar everywhere else on this table means the side that
   * did better. `lower` inverts the bar so length always means the same thing.
   * `neutral` is for a metric with no better end at all — sixty-seven plays is
   * more plays, not a better game — where a highlight would be a verdict the
   * number does not support.
   */
  better: "higher" | "lower" | "neutral";
}

function glanceRows(away: BoxTeamStats, home: BoxTeamStats): GlanceRow[] {
  const whole = (value: number): string => String(Math.round(value));
  const tenth = (value: number): string => value.toFixed(1);
  const pct = (value: number): string => `${Math.round(value)}%`;
  return [
    {
      label: "Total Yards",
      description: "Total net yards gained",
      away: away.totalYards,
      home: home.totalYards,
      format: whole,
      better: "higher",
    },
    {
      label: "Yards / Play",
      description: "Net yards gained per offensive play",
      away: away.yardsPerPlay,
      home: home.yardsPerPlay,
      format: tenth,
      better: "higher",
    },
    {
      label: "Plays",
      description: "Offensive plays run",
      away: away.plays,
      home: home.plays,
      format: whole,
      better: "neutral",
    },
    {
      label: "Turnovers",
      description: "Giveaways",
      away: away.turnovers,
      home: home.turnovers,
      format: whole,
      better: "lower",
    },
    {
      label: "Third Down",
      description: "Third-down conversion rate",
      away: away.thirdDown?.percent ?? null,
      home: home.thirdDown?.percent ?? null,
      format: pct,
      better: "higher",
    },
    {
      label: "Possession",
      description: "Time of possession",
      away: away.possessionSeconds,
      home: home.possessionSeconds,
      format: (value) => formatClock(value) ?? "",
      better: "higher",
    },
  ];
}

/**
 * One sentence saying what the numbers above add up to.
 *
 * Composed from the same rows the block just printed, and only from the gaps
 * wide enough to be worth a word — a two-play difference in volume is not
 * "controlling the game". Every clause it can produce is backed by a row
 * directly above it, and when no gap clears its threshold the sentence is
 * absent rather than hedged into meaninglessness.
 */
function glanceSentence(
  winner: NflTeam,
  loser: NflTeam,
  forWinner: BoxTeamStats,
  forLoser: BoxTeamStats,
): string {
  const gap = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : x - y;

  // Collected as nouns rather than as whole clauses, so the sentence can say
  // "won the efficiency and turnover battles" instead of repeating the verb
  // once per advantage, which is what naming them as phrases produced.
  const winnerBattles: string[] = [];
  const loserBattles: string[] = [];
  let volumeFor: NflTeam | null = null;

  const efficiency = gap(forWinner.yardsPerPlay, forLoser.yardsPerPlay);
  if (efficiency !== null && Math.abs(efficiency) >= 0.8) {
    (efficiency > 0 ? winnerBattles : loserBattles).push("efficiency");
  }

  const turnovers = gap(forLoser.turnovers, forWinner.turnovers);
  if (turnovers !== null && Math.abs(turnovers) >= 2) {
    (turnovers > 0 ? winnerBattles : loserBattles).push("turnover");
  }

  const third = gap(forWinner.thirdDown?.percent ?? null, forLoser.thirdDown?.percent ?? null);
  if (third !== null && Math.abs(third) >= 15) {
    (third > 0 ? winnerBattles : loserBattles).push("third-down");
  }

  const plays = gap(forWinner.plays, forLoser.plays);
  if (plays !== null && Math.abs(plays) >= 8) volumeFor = plays > 0 ? winner : loser;

  const list = (parts: string[]): string =>
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  const clauses = (team: NflTeam, battles: string[]): string => {
    const parts: string[] = [];
    if (battles.length) {
      parts.push(`won the ${list(battles)} battle${battles.length > 1 ? "s" : ""}`);
    }
    if (volumeFor?.abbreviation === team.abbreviation) parts.push("controlled the volume");
    return parts.join(" and ");
  };

  const winnerHas = clauses(winner, winnerBattles);
  const loserHas = clauses(loser, loserBattles);

  if (winnerHas && loserHas) {
    return `The ${loser.nickname} ${loserHas}, but the ${winner.nickname} ${winnerHas}.`;
  }
  if (winnerHas) return `The ${winner.nickname} ${winnerHas}.`;
  // An em dash rather than a second "and": "won the efficiency battle and
  // controlled the volume and still lost" is one conjunction too many.
  if (loserHas) return `The ${loser.nickname} ${loserHas} — and lost anyway.`;
  return "";
}

/**
 * The game in six figures, as one comparison rather than six cards.
 *
 * Named for the result: "Why the Seahawks Won" when there was a winner, and
 * "How the Game Was Won" when it was a tie or the sides are too close to give
 * the heading to one of them. That naming is the point of the section — the
 * pregame Snapshot asked which team is better, and after the game the only
 * question left is how this one went.
 *
 * The bars are drawn from the two figures against each other rather than
 * against the league, because both numbers describe the same sixty minutes:
 * 277 yards against 285 is a real comparison, where 277 against the league's
 * distribution would be a different section.
 */
function renderGlance(data: MatchupData): string {
  const meeting = data.featured;
  const box = data.boxscore;
  if (!meeting || !box) return "";

  const awayStats = boxStatsFor(box, meeting.away);
  const homeStats = boxStatsFor(box, meeting.home);
  if (!awayStats || !homeStats) return "";

  const rows = glanceRows(awayStats, homeStats).filter(
    (row) => row.away !== null || row.home !== null,
  );
  if (rows.length === 0) return "";

  const color = matchupColors(data.pair);
  const style = styleAttr([
    `--mu-cmp-left:${color(meeting.away)}`,
    `--mu-cmp-right:${color(meeting.home)}`,
  ]);

  const cell = (
    row: GlanceRow,
    value: number | null,
    other: number | null,
    side: "a" | "b",
  ): string => {
    if (value === null) return `<span class="sct-mu-cell is-empty">—</span>`;
    // Share of the pair's total, so the two bars together fill the row — and
    // inverted on a row whose good end is the low one, so that a longer bar is
    // the better side on every row of the table. Both zero (no turnovers
    // either way) draws two half bars rather than none, which is the honest
    // picture of a dead heat.
    const total = value + (other ?? 0);
    const mine = row.better === "lower" ? (other ?? 0) : value;
    const pct = total > 0 ? Math.round((mine / total) * 100) : 50;
    const better =
      other === null || row.better === "neutral"
        ? false
        : row.better === "lower"
          ? value < other
          : value > other;
    return (
      `<span class="sct-mu-cell">` +
      `<span class="sct-mu-figure">` +
      `<span class="sct-mu-val${better ? " is-better" : ""}">${escapeHtml(row.format(value))}</span>` +
      `</span>` +
      `<span class="sct-mu-bar" data-side="${side}" aria-hidden="true">` +
      `<span class="sct-mu-bar-fill" style="width:${pct}%"></span>` +
      `</span>` +
      `</span>`
    );
  };

  const winner = meeting.winner;
  const loser = winner
    ? winner.abbreviation === meeting.home.abbreviation
      ? meeting.away
      : meeting.home
    : null;
  const sentence =
    winner && loser
      ? glanceSentence(
          winner,
          loser,
          winner.abbreviation === meeting.home.abbreviation ? homeStats : awayStats,
          winner.abbreviation === meeting.home.abbreviation ? awayStats : homeStats,
        )
      : "";

  const title = winner ? `Why the ${winner.nickname} Won` : "How the Game Was Played";

  return (
    `<section class="sct-block sct-mu-glance">` +
    h2(title) +
    (sentence ? `<p class="sct-mu-glance-line">${escapeHtml(sentence)}</p>` : "") +
    `<table class="sct-mu-table"${style}>` +
    compareCaption(
      meeting.away.nickname,
      "at",
      meeting.home.nickname,
      " — team statistics from this game",
    ) +
    `<thead class="sct-visually-hidden"><tr>` +
    `<th scope="col">${escapeHtml(meeting.away.nickname)}</th>` +
    `<th scope="col">Statistic</th>` +
    `<th scope="col">${escapeHtml(meeting.home.nickname)}</th></tr></thead>` +
    `<tbody>` +
    rows
      .map(
        (row) =>
          `<tr>` +
          `<td class="sct-mu-td-side">${cell(row, row.away, row.home, "a")}</td>` +
          `<th scope="row" class="sct-mu-td-label">${escapeHtml(row.label)}` +
          `<span class="sct-visually-hidden"> — ${escapeHtml(row.description)}</span></th>` +
          `<td class="sct-mu-td-side">${cell(row, row.home, row.away, "b")}</td>` +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>` +
    `</section>`
  );
}

/* ------------------------------------------------------------ player stats */

/** The team code a stat row belongs to, as a chip. */
function statTeam(team: NflTeam | null): string {
  return team
    ? `<span class="sct-mu-ps-team">${escapeHtml(team.code.toUpperCase())}</span>`
    : "";
}

/** The name cell every stat table shares: face, link, position. */
function statName(
  row: { player: { id: string; name: string }; team: NflTeam | null; position: string | null },
  startSit: string | null = null,
): string {
  // The flex box is an inner span, not the cell. `display:flex` on a <th>
  // takes it out of table layout altogether, which left the name column a
  // different width from its own header and broke every row rule under it.
  //
  // `data-sort` is the name alone. The cell's text is the name, the position
  // and the team code run together, so sorting on what is written here would
  // sort "Drew LockQB · SEA" — right by accident for a name that leads the
  // cell, and wrong the moment the cell's order changes.
  return (
    `<th scope="row" class="sct-mu-ps-name" data-sort="${escapeHtml(row.player.name)}">` +
    `<span class="sct-mu-ps-cell">` +
    playerPhoto(row.player.id, "sct-mu-ps-photo", 32) +
    `<span class="sct-mu-ps-who">` +
    playerName(row.player.name, "sct-mu-ps-link") +
    positionTag(row.position, row.team?.code, "sct-mu-ps-meta") +
    (startSit
      ? `<a class="sct-mu-ps-ss" href="${escapeHtml(startSit)}" data-cta="player-stats-startsit" ` +
        `aria-label="${escapeHtml(`Start or sit ${row.player.name}`)}">Start/Sit →</a>`
      : "") +
    `</span>` +
    `</span>` +
    `</th>`
  );
}

/**
 * One column of a stat table.
 *
 * `type` is declared by the header rather than sniffed from the cells, which is
 * the contract the FPA table's sorting already uses: the client does not have
 * to guess whether a column of "16/22" is a number, and a column that happens
 * to hold only digits this week cannot change type next week.
 *
 * `sorted` marks the column the SERVER has already ordered the rows by, so the
 * table arrives with its sort state announced rather than claiming to be
 * unsorted while visibly sorted.
 */
interface StatColumn {
  label: string;
  type: "number" | "text";
  sorted?: boolean;
  /** Header labels per scoring format, for the column the switch relabels. */
  formats?: Record<"ppr" | "half" | "std", string>;
}

/** A numeric column, which is all of them but the name. */
function col(label: string, sorted = false): StatColumn {
  return sorted ? { label, type: "number", sorted } : { label, type: "number" };
}

/**
 * One stat table: a caption, a header row, and the rows a caller built.
 *
 * `data-sct-sortable` is the opt-in the client bundle looks for. The header
 * cells are plain text here and the buttons are built in the browser — a
 * control that cannot work must not be in the HTML, which is the rule the game
 * log on the player pages follows for the same reason.
 */
function statTable(
  title: string | null,
  label: string,
  columns: StatColumn[],
  rows: string[],
): string {
  if (rows.length === 0) return "";
  const header = (column: StatColumn): string =>
    `<th scope="col" data-sort-type="${column.type}"` +
    (column.sorted ? ` data-sort-default="descending"` : "") +
    (column.formats
      ? (["ppr", "half", "std"] as const)
          .map((f) => ` data-fmt-${f}="${escapeHtml(column.formats![f])}"`)
          .join("")
      : "") +
    `>${escapeHtml(column.label)}</th>`;
  return (
    `<div class="sct-mu-ps-block">` +
    (title ? `<h3 class="sct-mu-h3">${escapeHtml(title)}</h3>` : "") +
    `<div class="sct-mu-ps-scroll">` +
    `<table class="sct-mu-ps-table" data-sct-sortable>` +
    `<caption class="sct-visually-hidden">${escapeHtml(label)}</caption>` +
    `<thead><tr>` +
    header({ label: "Player", type: "text" }) +
    columns.map(header).join("") +
    `</tr></thead>` +
    `<tbody>${rows.join("")}</tbody>` +
    `</table>` +
    `</div>` +
    `</div>`
  );
}

/** The two fantasy columns every stat table ends with; the switch relabels the first. */
const FANTASY_COLUMNS: StatColumn[] = [
  { label: "PPR", type: "number", formats: { ppr: "PPR", half: "HALF", std: "STD" } },
  { label: "FIN", type: "number" },
];

/**
 * A cell the scoring switch rewrites: the PPR value as printed, and all three
 * as attributes — display and sort for each — for the client to swap in.
 */
function formatCell(
  values: Record<"ppr" | "half" | "std", { display: string; sort: number | null }>,
  className: string,
): string {
  const attr = (n: number | null): string => (n === null ? "" : escapeHtml(String(n)));
  return (
    `<td class="${className}" data-sort="${attr(values.ppr.sort)}"` +
    (["ppr", "half", "std"] as const)
      .map(
        (f) =>
          ` data-fmt-${f}="${escapeHtml(values[f].display)}" data-fmt-sort-${f}="${attr(values[f].sort)}"`,
      )
      .join("") +
    `>${escapeHtml(values.ppr.display)}</td>`
  );
}

function fantasyCell(row: FantasyRow | null): string {
  const v = (n: number | undefined) =>
    n === undefined ? { display: "—", sort: null } : { display: n.toFixed(1), sort: n };
  return formatCell({ ppr: v(row?.ppr), half: v(row?.half), std: v(row?.standard) }, "is-key sct-mu-fp");
}

/**
 * "WR6". Sorts on the rank alone, so WR6 and RB17 order as 6 and 17 — best
 * week at the position first. No finish is no value, not a zero.
 */
function finishCell(row: FantasyRow | null, position: string | null): string {
  const v = (rank: number | null | undefined) =>
    rank === null || rank === undefined || !position
      ? { display: "—", sort: null }
      : { display: `${position}${rank}`, sort: rank };
  return formatCell(
    { ppr: v(row?.positionFinish), half: v(row?.halfFinish), std: v(row?.standardFinish) },
    "sct-mu-fin",
  );
}

/**
 * One cell: what it shows, and what it sorts on.
 *
 * The two are separate because they disagree more often than not — "16/22" is
 * two numbers, "90%" is a string, "WR6" is a position and a rank, and "—" is
 * nothing at all. `sort` is null for that last case and the attribute is
 * emitted empty, which is what tells the client to sink the row rather than
 * treat the missing value as a zero and rank it above a real one.
 */
function statCell(
  display: string | number,
  sort: number | string | null,
  className = "",
): string {
  return (
    `<td${className ? ` class="${className}"` : ""}` +
    ` data-sort="${sort === null ? "" : escapeHtml(String(sort))}">` +
    `${escapeHtml(String(display))}</td>`
  );
}

/**
 * The box score, by category, both teams in one table.
 *
 * "eagles vs commanders match player stats" is a search this page was not built
 * to answer and now is. One table per category rather than one per team: the
 * reader is comparing the two quarterbacks, not reading two rosters, and a
 * category with nobody in it — a game with no completed pass — is absent rather
 * than empty.
 *
 * Every table ends with the fantasy points and positional finish — the figures
 * nobody else prints beside the line. PPR, half and standard are the three
 * scorings this site's readers actually play; the server prints PPR and the
 * client's switch swaps the other two in. The finish is what turns 26.2 points
 * into "the WR3 of the week", ranked separately in each format.
 */
function renderPlayerStats(data: MatchupData): string {
  const stats: GameStats | null = data.gameStats;
  if (!stats) return "";

  // Fantasy points and finish ride on each stat table rather than a table of
  // their own, so a line and what it scored read on one row. The total is the
  // player's whole game — a quarterback's rushing counts in the Passing table
  // too — which is why it is the same figure in every table he appears in.
  const byPlayer = new Map(stats.fantasy.map((row) => [row.player.id, row]));
  const fantasyCells = (row: { player: { id: string }; position: string | null }): string => {
    const f = byPlayer.get(row.player.id);
    return fantasyCell(f ?? null) + finishCell(f ?? null, row.position);
  };

  // Start/Sit, as the fantasy section links it: only for a player on an active
  // roster today, since there is no start-or-sit call to make on anyone else.
  // Matched by name because the two sections key players by different ids.
  const fantasy = fantasyInput(data);
  const active = new Map<string, boolean>();
  for (const [id, p] of Object.entries(fantasy?.players ?? {})) {
    active.set(p.name, fantasy?.contexts[id]?.active ?? false);
  }
  const startSit = (name: string): string | null => (active.get(name) ? startSitFor(name) : null);

  // A quarterback's runs sit on his passing row, so his whole game reads on
  // one line and he is not listed twice. A quarterback who ran but threw no
  // pass still gets a row here, with the passing side blank.
  const rushBy = new Map(stats.rushing.map((row) => [row.player.id, row]));
  const blank = (count: number): string => statCell("—", null).repeat(count);
  const rushCells = (rush: RushingRow | undefined): string =>
    rush
      ? statCell(rush.carries, rush.carries) +
        statCell(rush.yards, rush.yards, "is-key") +
        statCell(rush.touchdowns, rush.touchdowns, "sct-mu-ps-edge")
      : blank(2) + statCell("—", null, "sct-mu-ps-edge");
  const passerIds = new Set(stats.passing.map((row) => row.player.id));
  const passing = [
    ...stats.passing.map(
      (row: PassingRow) =>
        `<tr>` +
        statName(row, startSit(row.player.name)) +
        // Sorted on completions: the column reads "CMP/ATT" and CMP is the
        // number it leads with, so ordering by anything else would order it
        // by a figure the eye is not on.
        statCell(`${row.completions}/${row.attempts}`, row.completions) +
        statCell(row.yards, row.yards, "is-key") +
        statCell(row.touchdowns, row.touchdowns) +
        statCell(row.interceptions, row.interceptions, "sct-mu-ps-edge") +
        rushCells(rushBy.get(row.player.id)) +
        statCell(row.rating === null ? "—" : row.rating.toFixed(1), row.rating) +
        fantasyCells(row) +
        `</tr>`,
    ),
    ...stats.rushing
      .filter((rush) => rush.position === "QB" && !passerIds.has(rush.player.id))
      .map(
        (rush) =>
          `<tr>` +
          statName(rush, startSit(rush.player.name)) +
          blank(3) +
          statCell("—", null, "sct-mu-ps-edge") +
          rushCells(rush) +
          blank(1) +
          fantasyCells(rush) +
          `</tr>`,
      ),
  ];

  // Rushing and receiving are one table: a back's 18 carries and 5 catches are
  // one game, and the reader wants them on one row beside the points they made
  // rather than hunting for his name twice. One row per player, in the order
  // the rushing list met them and then whoever only caught the ball; a side a
  // player has nothing in reads "—" and sinks when that column is sorted.
  // Quarterbacks are left out: their runs are on the Passing table.
  const recBy = new Map(stats.receiving.map((row) => [row.player.id, row]));
  const skillIds = [...new Set([...rushBy.keys(), ...recBy.keys()])].filter(
    (id) => (rushBy.get(id) ?? recBy.get(id))?.position !== "QB",
  );

  // Ordered by the game's fantasy points, highest first — the one figure both
  // halves of the row add up to. A player with no fantasy line goes last.
  const points = (id: string): number => byPlayer.get(id)?.ppr ?? -Infinity;
  skillIds.sort((a, b) => points(b) - points(a));

  const skill = skillIds.map((id) => {
    const rush: RushingRow | undefined = rushBy.get(id);
    const rec: ReceivingRow | undefined = recBy.get(id);
    const row = (rush ?? rec)!;
    return (
      `<tr>` +
      statName(row, startSit(row.player.name)) +
      statCell(row.position ?? "—", row.position, "sct-mu-ps-pos") +
      (rush
        ? statCell(rush.carries, rush.carries) +
          statCell(rush.yards, rush.yards, "is-key") +
          statCell(rush.touchdowns, rush.touchdowns, "sct-mu-ps-edge")
        : blank(2) + statCell("—", null, "sct-mu-ps-edge")) +
      (rec
        ? statCell(rec.targets, rec.targets) +
          statCell(rec.receptions, rec.receptions) +
          statCell(rec.yards, rec.yards, "is-key") +
          statCell(rec.touchdowns, rec.touchdowns)
        : blank(4)) +
      fantasyCells(row) +
      `</tr>`
    );
  });

  // Passing over the combined table, each the full width of the section. The
  // combined table runs to eleven columns, which no half-width column holds.
  const passingBlock =
    statTable("Passing", "Passing statistics", [
      col("CMP/ATT"),
      col("Pass YDS", true),
      col("TD"),
      col("INT"),
      col("Rush ATT"),
      col("Rush YDS"),
      col("Rush TD"),
      col("Rate"),
      // FPTS in every format, as on the table below: the switch still swaps the values.
      { label: "FPTS", type: "number", formats: { ppr: "FPTS", half: "FPTS", std: "FPTS" } },
      FANTASY_COLUMNS[1]!,
    ], passing);

  const skillBlock = statTable(
    "Rushing & Receiving",
    "Rushing and receiving statistics",
    [
      { label: "POS", type: "text" },
      col("Rush ATT"),
      col("Rush YDS"),
      col("Rush TD"),
      col("TGT"),
      col("REC"),
      col("Rec YDS"),
      col("Rec TD"),
      // FPTS in every format: the switch still swaps the values under it.
      { label: "FPTS", type: "number", sorted: true, formats: { ppr: "FPTS", half: "FPTS", std: "FPTS" } },
      FANTASY_COLUMNS[1]!,
    ],
    skill,
  );

  const board = passingBlock + skillBlock;
  if (!board) return "";
  const blocks = `<div class="sct-mu-ps-row">${board}</div>`;

  return (
    `<section class="sct-block sct-mu-playerstats">` +
    // The heading and the scoring switch share a row. The client builds the
    // PPR / Half / Standard switch in the slot; without it the tables stay in
    // PPR, which is what the server printed.
    `<div class="sct-mu-ps-head">` +
    h2("Player Stats") +
    `<div class="sct-mu-scoring-slot" data-sct-scoring-slot></div>` +
    `</div>` +
    blocks +
    // A note, not an ad: no heading, no button, and only under a table that
    // has players in it.
    (byPlayer.size
      ? `<p class="sct-mu-rc-note">Have one of these players? ` +
        `<a href="${escapeHtml(REDRAFT_COMMAND_URL)}" data-cta="fantasy-table-footer">Redraft Command</a> ` +
        `tells you whether to start, sit, trade or hold him based on your roster and league settings.</p>`
      : "") +
    `</section>`
  );
}

/* ------------------------------------------------------------ fantasy usage */

/** A share as this section writes it: "85%". Null has no percentage at all. */
function usagePercent(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/** The ring's geometry, in the user units of its own 120-square viewBox. */
const USAGE_RING_RADIUS = 42;
const USAGE_RING_LENGTH = 2 * Math.PI * USAGE_RING_RADIUS;
/** The hairline of white between two neighbouring slices. */
const USAGE_SLICE_GAP = 2;

/** The pooled tail. Grey on purpose: "Other" is not a player and must not read as one. */
const USAGE_INK_OTHER = "#c2c8d2";

/**
 * One team's ink, a step lighter per slice.
 *
 * Six unrelated saturated colours in a 90px ring is a pie chart from a
 * spreadsheet. The slices of one team are one hue instead, separated by
 * lightness, and the legend beside them carries the name and the percentage —
 * so the colour is what groups the ring to its team, not what carries the
 * meaning. Nothing here is legible only in colour.
 *
 * A pale ink — Green Bay's yellow, Cincinnati's orange — is darkened toward the
 * page's navy before the ramp starts, because five steps lighter than #FFB612
 * is five steps of white on white.
 */
function usageRamp(base: string, count: number): string[] {
  const start = luminance(base) > 0.6 ? mixHex(base, "#0b1f33", 0.45) : base;
  return Array.from({ length: Math.max(count, 1) }, (_, i) =>
    mixHex(start, "#ffffff", Math.min(i * 0.15, 0.6)),
  );
}

/** The three lines a slice's hover tooltip carries. Supplemental, never the source. */
function usageTip(slice: UsageSlice, unit: string, metric: string): string {
  return (
    `${slice.label}\n` +
    `${slice.value} ${unit}\n` +
    `${Math.round(slice.share * 100)}% ${metric}`
  );
}

/** What each ring is called, counts, and says when it has nothing to draw. */
const USAGE_RINGS: ReadonlyArray<{
  key: "targets" | "carries";
  total: "targetTotal" | "carryTotal";
  heading: string;
  unit: string;
  metric: string;
  unavailable: string;
}> = [
  {
    key: "targets",
    total: "targetTotal",
    heading: "Target Share",
    unit: "targets",
    metric: "target share",
    unavailable: "Target share data unavailable",
  },
  {
    key: "carries",
    total: "carryTotal",
    heading: "Carry Share",
    unit: "carries",
    metric: "carry share",
    unavailable: "Carry share data unavailable",
  },
];

/**
 * One part-to-whole distribution: a ring, and the legend that says what it means.
 *
 * The ring is drawn as one dashed circle per slice — no chart library, no
 * canvas, no dependency — and it is `aria-hidden` because everything in it is
 * written out in the list beside it: the name, the percentage, and the raw
 * count in the span a screen reader reads and a sighted reader does not need.
 * The tooltips are the same three facts again, for a mouse.
 *
 * A zero denominator draws nothing. There is no such thing as a share of no
 * carries, and an empty ring would be a claim that there is.
 */
function usageRing(
  team: TeamUsage,
  spec: (typeof USAGE_RINGS)[number],
  ink: string,
): string {
  const total = team[spec.total];
  const slices = team[spec.key];
  const head =
    `<h4 class="sct-mu-usage-metric-h">${escapeHtml(spec.heading)}` +
    (total > 0
      ? `<span class="sct-mu-usage-denom">${total} ${escapeHtml(spec.unit)}</span>`
      : "") +
    `</h4>`;

  if (total <= 0 || slices.length === 0) {
    return (
      `<div class="sct-mu-usage-metric">${head}` +
      `<p class="sct-mu-usage-none">${escapeHtml(spec.unavailable)}</p>` +
      `</div>`
    );
  }

  const ramp = usageRamp(ink, slices.filter((slice) => slice.player).length);
  // The named slices are already highest-first and "Other" is already last, so
  // the ramp index is the slice index and the ring reads light-ward clockwise.
  const inked = slices.map((slice, i) => ({
    slice,
    tone: slice.player ? (ramp[i] ?? USAGE_INK_OTHER) : USAGE_INK_OTHER,
  }));

  let start = 0;
  const arcs = inked.map(({ slice, tone }) => {
    const length = slice.share * USAGE_RING_LENGTH;
    // The gap is taken off the drawn length, not added between arcs, so the
    // slices still sum to the circle. A ring with one slice in it keeps its
    // full length — a gap there looks like a broken circle, not a division.
    const drawn =
      inked.length > 1 ? Math.max(length - USAGE_SLICE_GAP, 0.75) : length;
    const offset = start;
    start += length;
    return (
      `<circle class="sct-mu-usage-arc" cx="60" cy="60" r="${USAGE_RING_RADIUS}"` +
      ` stroke="${escapeHtml(tone)}"` +
      ` stroke-dasharray="${drawn.toFixed(2)} ${(USAGE_RING_LENGTH - drawn).toFixed(2)}"` +
      ` stroke-dashoffset="${(-offset).toFixed(2)}">` +
      `<title>${escapeHtml(usageTip(slice, spec.unit, spec.metric))}</title>` +
      `</circle>`
    );
  });

  const legend = inked.map(({ slice, tone }) => {
    const name = slice.player
      ? playerName(slice.label, "sct-mu-usage-key-name")
      : `<span class="sct-mu-usage-key-name is-other">${escapeHtml(slice.label)}</span>`;
    return (
      `<li class="sct-mu-usage-key">` +
      `<span class="sct-mu-usage-swatch" aria-hidden="true"${styleAttr([`background:${tone}`])}></span>` +
      name +
      `<span class="sct-mu-usage-key-pct">${usagePercent(slice.share)}</span>` +
      `<span class="sct-visually-hidden">, ${slice.value} ${escapeHtml(spec.unit)}</span>` +
      `</li>`
    );
  });

  return (
    `<div class="sct-mu-usage-metric">${head}` +
    `<div class="sct-mu-usage-ring-row">` +
    `<svg class="sct-mu-usage-ring" viewBox="0 0 120 120" width="96" height="96"` +
    ` aria-hidden="true" focusable="false">` +
    `<g transform="rotate(-90 60 60)">${arcs.join("")}</g>` +
    `</svg>` +
    `<ol class="sct-mu-usage-keys">${legend.join("")}</ol>` +
    `</div>` +
    `</div>`
  );
}

/**
 * Snap share, as a ranked list rather than a ring.
 *
 * Snap percentages are not a distribution — five players can each be on the
 * field for 80% of the same snaps — so a pie of them would be arithmetic
 * nonsense. Ranked bars are the honest shape: the comparison is player against
 * player, and the eye does that down a column of left-aligned bars better than
 * around a circle.
 */
function usageBars(team: TeamUsage): string {
  if (team.snaps.length === 0) return "";
  const rows = team.snaps.map((row) => {
    const share = row.snapShare;
    const tip = `${row.player.name}\n${row.snaps} snaps\n${usagePercent(share)} snap share`;
    return (
      `<li class="sct-mu-usage-bar" title="${escapeHtml(tip)}">` +
      playerPhoto(row.player.id, "sct-mu-usage-face", 30) +
      `<span class="sct-mu-usage-bar-body">` +
      `<span class="sct-mu-usage-bar-head">` +
      playerName(row.player.name, "sct-mu-usage-bar-name") +
      // No team code: the player is already inside his own team's panel.
      positionTag(row.position, null, "sct-mu-usage-bar-meta") +
      `<span class="sct-mu-usage-bar-pct">${usagePercent(share)}</span>` +
      `</span>` +
      `<span class="sct-mu-usage-track" aria-hidden="true">` +
      `<span class="sct-mu-usage-fill"${styleAttr([
        `width:${Math.round((share ?? 0) * 100)}%`,
      ])}></span>` +
      `</span>` +
      `<span class="sct-mu-usage-bar-raw">${row.snaps} snaps</span>` +
      `</span>` +
      `</li>`
    );
  });
  return (
    `<div class="sct-mu-usage-metric">` +
    `<h4 class="sct-mu-usage-metric-h">Snap Share</h4>` +
    `<ol class="sct-mu-usage-bars">${rows.join("")}</ol>` +
    `</div>`
  );
}

/**
 * One team's panel: the badge, the bars, and the two rings under them.
 *
 * Both panels are built from the same function in the same order, which is the
 * whole point of splitting the section by team — Target Share is in the same
 * place on the right as it is on the left, so the two are compared by looking
 * across rather than by reading twice.
 */
function usagePanel(team: TeamUsage, ink: string): string {
  const bars = usageBars(team);
  const rings = USAGE_RINGS.map((spec) => usageRing(team, spec, ink));
  // A team with no snaps in the log and nothing to distribute has no panel.
  // The rings above return their own "unavailable" line, so this asks the data
  // rather than the markup.
  if (!bars && team.targetTotal <= 0 && team.carryTotal <= 0) return "";

  const name = team.team;
  return (
    `<article class="sct-mu-usage-team"${styleAttr([`--mu-usage-ink:${ink}`])}>` +
    (name
      ? `<h3 class="sct-mu-usage-team-name">` +
        `<img class="sct-mu-usage-logo" src="${escapeHtml(name.logo)}" alt=""` +
        ` width="28" height="28" loading="lazy" decoding="async" />` +
        `${escapeHtml(name.fullName)}</h3>`
      : "") +
    bars +
    `<div class="sct-mu-usage-rings">${rings.join("")}</div>` +
    `</article>`
  );
}

/**
 * Who controlled the snaps, the targets and the backfield, for each side.
 *
 * Snaps and share are the half of a fantasy day the box score misses: a
 * receiver who was on the field for 82% of the dropbacks and caught two passes
 * had a better day for next week than the one who caught two on a third of the
 * snaps. That was a six-column table on a page that already has five of them,
 * and a table is a poor answer to a question about proportion — so the default
 * layer is now two team panels of pictures, and the table it was built from is
 * one click underneath, unchanged and still sortable.
 *
 * The visual layer and the table disagree about quarterbacks on purpose. The
 * table is about snap counts, where a starting quarterback's row says 100%
 * every week and is worth no space; a carry distribution that leaves him out is
 * simply wrong. See usageByTeam() in game-stats.ts, which is where both
 * populations are decided — the page does not recalculate a share here.
 */
function renderUsage(data: MatchupData): string {
  const usage = data.gameStats?.usage ?? [];
  if (usage.length === 0) return "";

  const rows = usage.map(
    (row: UsageRow) =>
      `<tr>` +
      statName(row) +
      statCell(row.snaps, row.snaps) +
      // The share sorts on the fraction, not on the rounded percent it prints,
      // so two rows that both read 46% still order against each other.
      statCell(usagePercent(row.snapShare), row.snapShare, "is-key") +
      statCell(row.targets, row.targets) +
      statCell(usagePercent(row.targetShare), row.targetShare) +
      statCell(row.carries, row.carries) +
      `</tr>`,
  );

  const table = statTable(
    null,
    "Offensive snaps and share for the skill positions",
    [col("SNAPS"), col("SNAP %", true), col("TGT"), col("TGT %"), col("CAR")],
    rows,
  );

  // One colour per team for the whole page, the same resolution the Snapshot
  // and the Fantasy Matchups table use, so a reader learns the pair's two inks
  // once and carries them down.
  const color = matchupColors(data.pair);

  // The hero's order: away on the left, home on the right, like the
  // scoreboard above and every comparison under it. usageByTeam() hands these
  // back in whatever order the feed listed the teams, so the order is resolved
  // here, from the featured game. The pair's own order is the fallback for a
  // page with no game to read sides from.
  const [left, right] = data.featured
    ? [data.featured.away, data.featured.home]
    : [data.pair.a, data.pair.b];
  const order = new Map([
    [left.abbreviation, 0],
    [right.abbreviation, 1],
  ]);
  // A team the pair does not name cannot be placed against it, so it keeps the
  // position it arrived in rather than being sorted to the front.
  const place = (team: TeamUsage): number => order.get(team.team?.abbreviation ?? "") ?? 2;

  const panels = [...(data.gameStats?.usageByTeam ?? [])]
    .sort((left, right) => place(left) - place(right))
    .map((team) => usagePanel(team, team.team ? color(team.team) : "#0b1f33"))
    .filter((panel) => panel !== "");

  // Nothing to draw — a log with snaps but no team attribution — leaves the
  // table as the section, open, exactly as it was before the panels existed.
  if (panels.length === 0) {
    return `<section class="sct-block sct-mu-usage">` + h2("Fantasy Usage") + table + `</section>`;
  }

  return (
    `<section class="sct-block sct-mu-usage">` +
    h2("Fantasy Usage") +
    `<div class="sct-mu-usage-teams">${panels.join("")}</div>` +
    // <details> rather than a script: the table is in the HTML either way, so
    // it is one copy, it is indexed, and it opens with JavaScript switched off.
    (table
      ? `<details class="sct-mu-usage-full">` +
        `<summary class="sct-mu-usage-toggle">` +
        `<span class="sct-mu-usage-toggle-more">View full usage table</span>` +
        `<span class="sct-mu-usage-toggle-less">Hide full usage table</span>` +
        `</summary>` +
        table +
        `</details>`
      : "") +
    `</section>`
  );
}

/* ------------------------------------------------------- where to watch */

/**
 * Only for an upcoming meeting, and only the fields the schedule actually
 * carries. Streaming is not one of them — ESPN's schedule names a broadcaster,
 * not a service — so there is no streaming line rather than a guessed one.
 */
function renderWatch(data: MatchupData): string {
  if (data.matchupState !== "upcoming" || !data.featured) return "";
  const meeting = data.featured;
  const when = gameDateLine(asGame(meeting));

  const rows: Array<[string, string]> = [];
  if (meeting.kickoffMs !== null) rows.push(["Date", escapeHtml(when.date)]);
  // No " ET" appended: easternParts() already spells the zone into the time,
  // and the row was reading "1:00 PM ET ET" — the same slip the hero's
  // metadata line carries a note about. "Time TBD" is not a time to qualify
  // either, which appending would have done.
  if (when.time) rows.push(["Kickoff", escapeHtml(when.time)]);
  if (meeting.network) rows.push(["TV", networkHtml(meeting.network, "sct-mu-tv")]);
  if (meeting.venue) {
    rows.push([
      "Venue",
      escapeHtml(meeting.venueCity ? `${meeting.venue} · ${meeting.venueCity}` : meeting.venue),
    ]);
  }
  if (rows.length === 0) return "";

  return (
    `<section class="sct-block sct-mu-watch">` +
    h2(`Where to Watch ${data.pair.a.nickname} vs ${data.pair.b.nickname}`) +
    // The symbol the TV row's <use> points at. It used to be defined by the
    // featured card above, which no longer draws on a fixture page — a logo
    // whose symbol is nowhere on the page renders as an empty box.
    (meeting.network ? networkDefs([meeting.network]) : "") +
    `<dl class="sct-mu-facts">` +
    rows
      .map(
        ([label, value]) =>
          `<div class="sct-mu-fact"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`,
      )
      .join("") +
    `</dl>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- snapshot */

/**
 * The Snapshot's rows: one team down each side, the metric between them.
 *
 * This used to be three tables — both offences, then each offence against the
 * other defence — which printed the same nine figures twice under captions a
 * reader had to parse ("Patriots offense vs Seahawks defense") before any of
 * the numbers meant anything. One team per column says the same thing in a
 * sixth of the space: the left column IS the Patriots, all the way down.
 *
 * Both halves of the ladder are here rather than only the offensive one,
 * because "scores 24, allows 17" is the shape of a team and two offence rows
 * alone are half a scouting report. The labels are written out here instead of
 * taken from the metric: the Stats tab calls both rows "Points/G" and relies on
 * an Offense/Defense heading above them, which this table does not have.
 *
 * Keys are the Stats tab's. A row absent on both sides is skipped.
 */
const SNAPSHOT_ROWS: ReadonlyArray<{ key: string; label: string; description: string }> = [
  { key: "record", label: "Record", description: "Win-loss record this season" },
  { key: "off-points", label: "Pts/G", description: "Points scored per game" },
  { key: "off-total-yards", label: "Yds/G", description: "Total net yards gained per game" },
  { key: "off-yards-per-play", label: "Yds/Play", description: "Net yards gained per offensive play" },
  { key: "def-points", label: "Pts/G Allowed", description: "Points allowed per game" },
  { key: "def-total-yards", label: "Yds/G Allowed", description: "Total net yards allowed per game" },
];

/**
 * The record as a row of the table.
 *
 * Not a ranked metric and not pretending to be: no rank chip, no bar, and
 * `volume` so the renderer gives it no tier colour either. It leads the table
 * because it is the first thing anyone wants from two team names.
 */
function recordRow(side: TeamPageData): StatRow | null {
  const value = side.profile?.record;
  if (!value) return null;
  return {
    key: "record",
    label: "Record",
    description: "Win-loss record this season",
    value,
    rank: null,
    cumulative: true,
    rankLabel: null,
    previousRank: null,
    direction: "volume",
  };
}

function findRow(stats: TeamStats | null, key: string): StatRow | null {
  if (!stats) return null;
  for (const group of [stats.offense, stats.defense, stats.situational, stats.volume]) {
    const row = group.find((cell) => cell.key === key);
    if (row) return row;
  }
  return null;
}

/**
 * How full this side's bar is: 1st fills it, 32nd barely registers.
 *
 * Rank rather than the raw figure, because the raw figures are not comparable.
 * Two of these rows put an offence beside a defence, where 20 points scored and
 * 20 allowed are the same number meaning opposite things, and a bar drawn from
 * the values would show the better defence as the shorter bar. Rank already has
 * the direction folded in — 1st is the best of the thirty-two either way — so a
 * bar drawn from it reads the same on every row.
 *
 * Null for a metric nobody ranked, and for a `volume` one: pace has no better
 * end, and a bar is a claim that it does.
 */
function barPercent(row: StatRow | null): number | null {
  if (!row || row.direction === "volume" || row.rank === null) return null;
  const rank = Math.min(Math.max(row.rank, 1), 32);
  // 1st -> 100%, 32nd -> ~9%. Floored above zero so last place is still a mark
  // on the page rather than an empty slot that reads as missing data.
  return Math.round(((33 - rank) / 32) * 100);
}

function cell(row: StatRow | null, side: "a" | "b"): string {
  if (!row) return `<span class="sct-mu-cell is-empty">—</span>`;
  const tier = row.direction === "volume" ? "none" : rankTier(row.rank);
  const pct = barPercent(row);
  return (
    `<span class="sct-mu-cell">` +
    `<span class="sct-mu-figure">` +
    `<span class="sct-mu-val">${escapeHtml(row.value)}</span>` +
    (row.rankLabel
      ? `<span class="sct-stat-rank" data-tier="${tier}">${escapeHtml(row.rankLabel)}` +
        `<span class="sct-visually-hidden"> of 32${tier !== "none" ? ` — ${escapeHtml(TIER_WORD[tier] ?? "")}` : ""}</span></span>`
      : "") +
    `</span>` +
    // Decorative: the rank beside it is the same fact in words, and a screen
    // reader reading "83 percent" for a 6th-place defence would be inventing a
    // number the page never claims.
    (pct === null
      ? ""
      : `<span class="sct-mu-bar" data-side="${side}" aria-hidden="true">` +
        `<span class="sct-mu-bar-fill" style="width:${pct}%"></span>` +
        `</span>`) +
    `</span>`
  );
}

/* ----------------------------------------------------------------- colour */

/** A hex colour as three channels. Anything unparseable reads as black. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  const n = Number.parseInt(
    clean.length === 3 ? clean.split("").map((ch) => ch + ch).join("") : clean.slice(0, 6),
    16,
  );
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

/** `from` moved `amount` of the way toward `to`, back as a hex string. */
function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (i: number): string =>
    Math.round(a[i]! + (b[i]! - a[i]!) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Rough relative luminance — enough to ask "is this ink too pale for white". */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Two colours a reader can tell apart, for the two sides of a comparison.
 *
 * Several pairings share a primary. The Patriots and the Seahawks are both
 * #002244, and the Raiders, Saints and Steelers all wear the same near-black,
 * so a bar keyed straight to `primaryColor` would draw both sides of those
 * pages in one colour and the comparison would lose the only thing the colour
 * was there to carry.
 *
 * The right-hand side falls back to its own accent, which is the colour that
 * actually distinguishes it — Seattle's green against New England's navy, which
 * is the pair a reader expects anyway — and to a neutral grey in the case where
 * that clashes too, rather than to a third team's colour.
 *
 * Compared with a small distance rather than for equality: #101820 and #0B162A
 * are not the same value and are the same colour to the eye.
 */
function pairColors(a: NflTeam, b: NflTeam): [string, string] {
  const tooClose = (x: string, y: string): boolean => {
    const [r1, g1, b1] = hexToRgb(x);
    const [r2, g2, b2] = hexToRgb(y);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 60;
  };
  if (!tooClose(a.primaryColor, b.primaryColor)) {
    return [a.primaryColor, b.primaryColor];
  }
  if (!tooClose(a.primaryColor, b.secondaryColor)) {
    return [a.primaryColor, b.secondaryColor];
  }
  return [a.primaryColor, "#7a8699"];
}

/**
 * One colour per team, fixed for the whole page.
 *
 * Resolved from the pair once rather than per table. Deciding the colours
 * inside each table made Seattle green in one and navy in the next — the reader
 * has to be able to learn a colour once and carry it down the page, past the
 * Snapshot and into the Fantasy Matchups table under it.
 */
function matchupColors(pair: MatchupData["pair"]): (team: NflTeam) => string {
  const [colorA, colorB] = pairColors(pair.a, pair.b);
  return (team) => (team.abbreviation === pair.b.abbreviation ? colorB : colorA);
}

/**
 * The two sides in the hero's order: the featured game's away team on the
 * left, its home team on the right, as the scoreboard reads. The pair's own
 * (alphabetical) order only when there is no game to read sides from. Colours
 * stay keyed to the team, not the column — see matchupColors().
 */
function sides(data: MatchupData): {
  left: NflTeam;
  right: NflTeam;
  leftPage: TeamPageData;
  rightPage: TeamPageData;
  leftFpa: FpaRow | null;
  rightFpa: FpaRow | null;
} {
  const swap =
    !!data.featured && data.featured.away.abbreviation === data.pair.b.abbreviation;
  return swap
    ? {
        left: data.pair.b,
        right: data.pair.a,
        leftPage: data.b,
        rightPage: data.a,
        leftFpa: data.fpa?.b ?? null,
        rightFpa: data.fpa?.a ?? null,
      }
    : {
        left: data.pair.a,
        right: data.pair.b,
        leftPage: data.a,
        rightPage: data.b,
        leftFpa: data.fpa?.a ?? null,
        rightFpa: data.fpa?.b ?? null,
      };
}

/**
 * One comparison: two sides, the same metrics, side by side.
 *
 * The pairing is named once, in the caption, and the column headers that would
 * repeat it on every row are visually hidden. They stay in the markup because a
 * screen reader moving cell by cell still needs to hear which side it is on —
 * what came off the page is the repetition, not the information.
 *
 * `left.team`/`right.team` colour the bars and follow the TEAM rather than the
 * column. The Snapshot puts one team in each column so the two agree there, but
 * the Fantasy block below compares the two defences and reuses this, so the
 * colour has to be resolved from the team either way.
 */
function compareTable(
  caption: string,
  left: { team: NflTeam; name: string },
  right: { team: NflTeam; name: string },
  rows: Array<{ label: string; description: string; left: StatRow | null; right: StatRow | null }>,
  color: (team: NflTeam) => string,
): string {
  const kept = rows.filter((row) => row.left || row.right);
  if (kept.length === 0) return "";
  const style = styleAttr([
    `--mu-cmp-left:${color(left.team)}`,
    `--mu-cmp-right:${color(right.team)}`,
  ]);
  return (
    `<table class="sct-mu-table"${style}>` +
    compareCaption(left.name, "vs", right.name, ` — ${caption}`) +
    `<thead class="sct-visually-hidden"><tr>` +
    `<th scope="col">${escapeHtml(left.name)}</th>` +
    `<th scope="col">Metric</th>` +
    `<th scope="col">${escapeHtml(right.name)}</th></tr></thead>` +
    `<tbody>` +
    kept
      .map(
        (row) =>
          `<tr>` +
          `<td class="sct-mu-td-side">${cell(row.left, "a")}</td>` +
          `<th scope="row" class="sct-mu-td-label">${escapeHtml(row.label)}` +
          `<span class="sct-visually-hidden"> — ${escapeHtml(row.description)}</span></th>` +
          `<td class="sct-mu-td-side">${cell(row.right, "b")}</td>` +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>`
  );
}

/** "2026 regular season, through 3 games." — what the season numbers cover. */
function seasonNote(data: MatchupData, sa: TeamStats | null, sb: TeamStats | null): string {
  const season = sa?.season ?? sb?.season ?? data.state.statsSeason;
  const games = [sa?.gamesPlayed, sb?.gamesPlayed].filter((n): n is number => typeof n === "number");
  const played = games.length ? Math.min(...games) : 0;
  const spread = games.length === 2 && games[0] !== games[1] ? `–${Math.max(...games)}` : "";
  return season < data.state.season
    ? `${season} regular season — the ${data.state.season} season has no completed team stats yet.`
    : games.length
      ? `${season} regular season, through ${played}${spread} ${played === 1 && !spread ? "game" : "games"}.`
      : `${season} regular season to date.`;
}

/** Season Form's rows on a recap, spelled out the way "Why won" labels its rows. */
const FORM_ROWS: ReadonlyArray<{ key: string; label: string; better: CompareRow["better"] }> = [
  { key: "record", label: "Record", better: "higher" },
  { key: "off-points", label: "Points per game", better: "higher" },
  { key: "off-total-yards", label: "Yards per game", better: "higher" },
  { key: "off-yards-per-play", label: "Yards per play", better: "higher" },
  { key: "def-points", label: "Points allowed per game", better: "lower" },
  { key: "def-total-yards", label: "Yards allowed per game", better: "lower" },
];

/**
 * Season Form on a recap page, drawn in the "Why won" design — the figure
 * either side of the stat, the better one emphasised, a split bar under each
 * row — so the two comparisons on the page read as one. The record's bar is
 * drawn from wins. League ranks are left to the team hubs.
 */
function renderSeasonForm(data: MatchupData): string {
  if (!describesNow(data)) return "";
  const { left: a, right: b, leftPage, rightPage } = sides(data);
  const sa = leftPage.stats;
  const sb = rightPage.stats;
  if (!sa && !sb) return "";

  const number = (row: StatRow | null): number | null => {
    if (!row) return null;
    const n = row.key === "record" ? Number(row.value.split("-")[0]) : Number.parseFloat(row.value);
    return Number.isFinite(n) ? n : null;
  };
  const rows: CompareRow[] = FORM_ROWS.flatMap(({ key, label, better }) => {
    const l = key === "record" ? recordRow(leftPage) : findRow(sa, key);
    const r = key === "record" ? recordRow(rightPage) : findRow(sb, key);
    if (!l && !r) return [];
    return [{ label, away: number(l), home: number(r), awayText: l?.value ?? "—", homeText: r?.value ?? "—", better }];
  });
  if (rows.length === 0) return "";

  const colors = heroPairColors(a.abbreviation, b.abbreviation);
  return (
    `<section class="sct-rb-section sct-mu-form" aria-labelledby="sct-rb-form">` +
    `<h2 class="sct-rb-h2" id="sct-rb-form">Season Form</h2>` +
    `<p class="sct-rb-sub">${escapeHtml(seasonNote(data, sa, sb))}</p>` +
    renderStatCompare({
      caption: `Season stats comparison, ${a.nickname} vs ${b.nickname}`,
      awayName: a.nickname,
      homeName: b.nickname,
      awayInk: colors.away.ink,
      homeInk: colors.home.ink,
      rows,
    }) +
    `</section>`
  );
}

/**
 * The season comparison.
 *
 * Before the game this is the Matchup Snapshot and it leads the analysis: two
 * teams, the same six metrics, which one is better. After the game it is still
 * true and no longer the question — the result above answered that for these
 * sixty minutes — so it keeps the numbers, takes the name "Season Form", and
 * sits below the game itself. The heading moves; the table does not, because a
 * postgame reader who scrolls this far is asking the pregame question again
 * about next time.
 */
function renderSnapshot(data: MatchupData): string {
  if (!describesNow(data)) return "";
  const { left: a, right: b, leftPage, rightPage } = sides(data);
  const sa = leftPage.stats;
  const sb = rightPage.stats;
  if (!sa && !sb) return "";

  // One colour per team for the whole page, so a reader learns it once.
  const color = matchupColors(data.pair);

  const body = compareTable(
    `${a.nickname} compared with ${b.nickname}`,
    { team: a, name: a.nickname },
    { team: b, name: b.nickname },
    SNAPSHOT_ROWS.map(({ key, label, description }) =>
      key === "record"
        ? { label, description, left: recordRow(leftPage), right: recordRow(rightPage) }
        : { label, description, left: findRow(sa, key), right: findRow(sb, key) },
    ),
    color,
  );

  const note = seasonNote(data, sa, sb);

  if (!body) return "";

  return (
    `<section class="sct-block sct-mu-snapshot">` +
    h2(isPostgame(data) ? "Season Form" : "Matchup Snapshot") +
    `<p class="sct-note">${escapeHtml(note)}</p>` +
    body +
    `</section>`
  );
}

/* -------------------------------------------------------- fantasy matchups */

/** How the FPA table's format id reads in a sentence. */
function formatWord(format: string): string {
  return format === "ppr"
    ? "PPR"
    : format === "standard"
      ? "standard"
      : "half-PPR";
}

/**
 * What each defense gives up, by position.
 *
 * The Snapshot above compares the two units as units. This asks the question a
 * fantasy manager actually arrives with — "is my Seahawks receiver in a good
 * spot this week" — which is a property of the defense opposite him, not of
 * either offense.
 *
 * The bar here reads the OPPOSITE way round to the Snapshot's, and that is
 * deliberate rather than an oversight: there, a full bar is a better unit;
 * here, a full bar is a softer defense, because a soft defense is the good news
 * on a fantasy page. The note under the block says so in words, and each side
 * is labelled "<team> defense" so neither bar can be read as an offense's.
 */
function renderFantasy(data: MatchupData): string {
  if (!describesNow(data)) return "";

  const fpa = data.fpa;
  const { left: a, right: b, leftFpa, rightFpa } = sides(data);
  if (!fpa || (!leftFpa && !rightFpa)) return "";

  // Rank 1 allows the most, so rank 1 is the fullest bar — the softest
  // matchup. See rankDescending() in fpa/fpa-data.ts.
  const softness = (rank: number | null): number | null => {
    if (rank === null) return null;
    const r = Math.min(Math.max(rank, 1), 32);
    return Math.round(((33 - r) / 32) * 100);
  };

  const side = (row: FpaRow | null, position: FantasyPosition, which: "a" | "b"): string => {
    const entry = row?.byPos?.[position];
    if (!entry) return `<span class="sct-mu-cell is-empty">—</span>`;
    const pct = softness(entry.rank);
    // Soft is good news for the offense facing it, so 1st — the most points
    // allowed — is the green chip.
    //
    // This used to invert the rank first, `rankTier(33 - rank)`, which made
    // the softest defense RED and the toughest GREEN: the opposite of what the
    // comment above it claimed, the opposite of the bar on the same row (which
    // fills for a soft defense), and the opposite of the FPA tool's own legend,
    // where 1–6 is green and 27–32 red. The rank goes in as it is.
    const tier = rankTier(entry.rank);
    return (
      `<span class="sct-mu-cell">` +
      `<span class="sct-mu-figure">` +
      `<span class="sct-mu-val">${escapeHtml(entry.fpa.toFixed(1))}</span>` +
      `<span class="sct-stat-rank" data-tier="${tier}">${escapeHtml(ordinal(entry.rank))}` +
      `<span class="sct-visually-hidden">${escapeHtml(
        ` of 32 most points allowed to ${position}s`,
      )}</span></span>` +
      `</span>` +
      (pct === null
        ? ""
        : `<span class="sct-mu-bar" data-side="${which}" aria-hidden="true">` +
          `<span class="sct-mu-bar-fill" style="width:${pct}%"></span>` +
          `</span>`) +
      `</span>`
    );
  };

  const color = matchupColors(data.pair);
  const style = styleAttr([`--mu-cmp-left:${color(a)}`, `--mu-cmp-right:${color(b)}`]);

  const rows = FANTASY_POSITIONS.map(
    (position) =>
      `<tr>` +
      `<td class="sct-mu-td-side">${side(leftFpa, position, "a")}</td>` +
      `<th scope="row" class="sct-mu-td-label">${escapeHtml(position)}</th>` +
      `<td class="sct-mu-td-side">${side(rightFpa, position, "b")}</td>` +
      `</tr>`,
  ).join("");

  return (
    `<section class="sct-block sct-mu-fantasy">` +
    h2("Fantasy Matchups") +
    `<table class="sct-mu-table"${style}>` +
    compareCaption(
      `${a.nickname} defense`,
      "vs",
      `${b.nickname} defense`,
      " — fantasy points allowed per game by position",
    ) +
    `<thead class="sct-visually-hidden"><tr>` +
    `<th scope="col">${escapeHtml(`${a.nickname} defense`)}</th>` +
    `<th scope="col">Position</th>` +
    `<th scope="col">${escapeHtml(`${b.nickname} defense`)}</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<p class="sct-note">${escapeHtml(
      `Fantasy points allowed per game, ${fpa.season} ${fpa.dataMode.toLowerCase()}, ${formatWord(fpa.format)} scoring. ` +
        `1st allows the most — a longer bar is a softer defense and a better matchup for the offense facing it.`,
    )}</p>` +
    `</section>`
  );
}

/**
 * Fantasy Matchups on a recap page, drawn in the same "Why won" design as
 * Season Form. Lower is better, as for any defense: the stingier unit takes
 * the emphasis and the longer bar. League ranks are left to the FPA tool.
 */
function renderRecapFantasy(data: MatchupData): string {
  if (!describesNow(data)) return "";
  const fpa = data.fpa;
  const { left: a, right: b, leftFpa, rightFpa } = sides(data);
  if (!fpa || (!leftFpa && !rightFpa)) return "";

  const rows: CompareRow[] = FANTASY_POSITIONS.map((position) => {
    const l = leftFpa?.byPos?.[position] ?? null;
    const r = rightFpa?.byPos?.[position] ?? null;
    return {
      label: `Points allowed to ${position}s`,
      away: l ? l.fpa : null,
      home: r ? r.fpa : null,
      awayText: l ? l.fpa.toFixed(1) : "—",
      homeText: r ? r.fpa.toFixed(1) : "—",
      better: "lower",
    };
  });

  const colors = heroPairColors(a.abbreviation, b.abbreviation);
  return (
    `<section class="sct-rb-section sct-mu-fantasy" aria-labelledby="sct-rb-fantasy">` +
    `<h2 class="sct-rb-h2" id="sct-rb-fantasy">Fantasy Matchups</h2>` +
    `<p class="sct-rb-sub">${escapeHtml(
      `Fantasy points allowed per game by position, ${fpa.season} ${fpa.dataMode.toLowerCase()}, ` +
        `${formatWord(fpa.format)} scoring.`,
    )}</p>` +
    renderStatCompare({
      caption: `Fantasy points allowed per game, ${a.nickname} defense vs ${b.nickname} defense`,
      awayName: a.nickname,
      homeName: b.nickname,
      awayInk: colors.away.ink,
      homeInk: colors.home.ink,
      rows,
    }) +
    `</section>`
  );
}

/* --------------------------------------------------------------- injuries */

/**
 * One side's injury list.
 *
 * `postgame` changes only the empty sentence. The designations themselves are
 * the CURRENT report either way — that is the only injury data this app holds,
 * and it is genuinely the useful one after a game, because what a manager wants
 * from a recap is who is hurt NOW. What this cannot say is who left this
 * particular game and when: no free source carries an in-game exit, so the
 * section does not claim one.
 */
function injuryList(side: TeamPageData, postgame: boolean): string {
  if (!side.roster) return "";
  const rows = side.injuries;
  return (
    `<div class="sct-mu-col">` +
    `<h3 class="sct-mu-h3">${escapeHtml(side.team.nickname)}</h3>` +
    (rows.length
      ? `<ul class="sct-injuries">` +
        rows
          .map(
            (player) =>
              // Name, then what is wrong, then the designation — reading
              // order and eye order the same way round. The status pill used
              // to sit second, where it was the loudest thing in a list whose
              // point is which players are on it.
              `<li class="sct-injury sct-mu-injury">` +
              `<span class="sct-mu-injury-main">` +
              slotChip(player.slot, true) +
              playerName(player.name, "sct-injury-name") +
              `</span>` +
              ((player.injuryBodyPart ? 1 : 0) + (player.practice ? 1 : 0)
                ? `<span class="sct-injury-detail">` +
                  [player.injuryBodyPart, player.practice]
                    .filter(Boolean)
                    .map((part) => escapeHtml(String(part)))
                    .join(` <span class="sct-injury-dot">·</span> `) +
                  `</span>`
                : "") +
              `<span class="sct-injury-status" data-severity="${injurySeverity(player.injuryStatus)}">` +
              `${escapeHtml(player.injuryStatus ?? "")}</span>` +
              `</li>`,
          )
          .join("") +
        `</ul>`
      : `<p class="sct-panel-empty">${escapeHtml(
          postgame
            ? `No ${side.team.nickname} skill-position player came out of the week with a designation.`
            : `No ${side.team.nickname} skill-position players carry an injury designation right now.`,
        )}</p>`) +
    `</div>`
  );
}

/**
 * Who is hurt before kickoff: the calls still to be made. Pregame only — after
 * the game the current report says nothing about the game being recapped, so
 * recaps leave the section out. Every name links to that player's page, which
 * is where the history behind the designation lives.
 */
function renderInjuries(data: MatchupData): string {
  if (!describesNow(data) || isPostgame(data)) return "";
  const order = sides(data);
  const left = injuryList(order.leftPage, false);
  const right = injuryList(order.rightPage, false);
  if (!left && !right) return "";
  return (
    `<section class="sct-block sct-mu-injuries">` +
    h2("Injury Watch") +
    `<div class="sct-mu-cols">${left}${right}</div>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- meetings */

/**
 * One past meeting, written the way a result is written.
 *
 * "2024 · SEA 23 — NE 20", winner first and emphasised, rather than a fixture
 * line and a verdict in separate columns at the same weight. The loser is still
 * at full opacity — this is a result, not a ranking, and greying a team out
 * reads as missing data.
 */
function meetingRow(
  meeting: Meeting,
  data: MatchupData,
  options: MatchupRenderOptions,
): string {
  const when = gameDateLine(asGame(meeting));
  const final = meeting.status === "final" && meeting.score !== null;
  const isFeatured = data.featured === meeting;

  let result: string;
  if (final && meeting.score) {
    const homeWon = meeting.winner?.abbreviation === meeting.home.abbreviation;
    // Winner on the left when there is one; a tie keeps the away-at-home order
    // every other line on this page uses.
    const [first, second] = meeting.winner
      ? homeWon
        ? [
            { team: meeting.home, points: meeting.score.home },
            { team: meeting.away, points: meeting.score.away },
          ]
        : [
            { team: meeting.away, points: meeting.score.away },
            { team: meeting.home, points: meeting.score.home },
          ]
      : [
          { team: meeting.away, points: meeting.score.away },
          { team: meeting.home, points: meeting.score.home },
        ];
    const part = (
      entry: { team: NflTeam; points: number },
      won: boolean,
    ): string =>
      `<span class="sct-mu-res-side${won ? " is-winner" : ""}">` +
      `<span class="sct-mu-res-team">${escapeHtml(entry.team.code)}</span>` +
      `<span class="sct-mu-res-score">${entry.points}</span>` +
      `</span>`;
    result =
      `<span class="sct-mu-result">` +
      part(first, !!meeting.winner) +
      `<span class="sct-mu-res-dash" aria-hidden="true">—</span>` +
      part(second, false) +
      `</span>`;
  } else {
    result = `<span class="sct-mu-result is-pending">${meeting.status === "live" ? "Live" : "Upcoming"}</span>`;
  }

  return (
    `<li class="sct-srow sct-mu-row${isFeatured ? " is-featured" : ""}">` +
    `<span class="sct-srow-week">${escapeHtml(`${meeting.season} · ${shortWeek(meeting)}`)}</span>` +
    `<span class="sct-mu-teams">${escapeHtml(`${meeting.away.nickname} ${meeting.neutralSite ? "vs" : "at"} ${meeting.home.nickname}`)}</span>` +
    `<span class="sct-srow-when">${escapeHtml(when.date)}</span>` +
    result +
    recapLink(meeting, data, options) +
    `</li>`
  );
}

/**
 * The link from a meeting to its own dated page.
 *
 * On every finished meeting except the one the page is already about. Two jobs,
 * and the second is the one that matters: it is how a reader reaches a Week 1
 * recap in December, and it is the ONLY link to a dated URL anywhere on the
 * site — without it those pages are addressable but undiscoverable, which for a
 * crawler is the same as absent.
 *
 * Suppressed while the pair's own address is still leading with that game,
 * because the dated URL 301s back here until the window closes and a link
 * straight into a redirect is a link that says the wrong thing about which
 * address owns the page.
 */
function recapLink(
  meeting: Meeting,
  data: MatchupData,
  options: MatchupRenderOptions,
): string {
  const empty = `<span class="sct-mu-recap"></span>`;
  if (meeting.status !== "final" || meeting.score === null) return empty;
  if (data.pinned === meeting) return empty;
  if (data.matchupState === "recently_completed" && data.featured === meeting) {
    return empty;
  }

  const prefix = (options.matchupPathPrefix ?? "/nfl/").trim();
  const href = `${gamePath(prefix, data.pair.slug, {
    season: meeting.season,
    week: meeting.week,
    seasonType: meeting.seasonType,
  })}${options.linkQuery ?? ""}`;

  return (
    `<a class="sct-textlink sct-mu-recap" href="${escapeHtml(href)}">` +
    `Recap ${ARROW}</a>`
  );
}

function renderMeetings(data: MatchupData, options: MatchupRenderOptions): string {
  const { a, b } = data.pair;
  const blocks: string[] = [];

  if (data.thisSeason.length) {
    blocks.push(
      `<h3 class="sct-mu-h3">${escapeHtml(`${data.state.season} Meetings`)}</h3>` +
        `<ol class="sct-slist sct-mu-list">${data.thisSeason.map((m) => meetingRow(m, data, options)).join("")}</ol>`,
    );
  }
  if (data.history.length) {
    blocks.push(
      `<h3 class="sct-mu-h3">Recent Meetings</h3>` +
        `<ol class="sct-slist sct-mu-list">${data.history.map((m) => meetingRow(m, data, options)).join("")}</ol>`,
    );
  }
  if (blocks.length === 0) return "";

  const r = data.record;
  // The record is the strongest fact this section has, so it is set as a stat:
  // the numbers at display size with the leader named under them, rather than a
  // sentence carrying the whole thing at body weight.
  const even = r.aWins === r.bWins;
  const leader = r.aWins > r.bWins ? a : b;
  const tally =
    `${Math.max(r.aWins, r.bWins)}–${Math.min(r.aWins, r.bWins)}` +
    (r.ties ? `–${r.ties}` : "");
  const lead =
    r.games > 0
      ? `<div class="sct-mu-h2h"${
          even
            ? ""
            : styleAttr([`--mu-h2h-accent:${leader.primaryColor}`])
        }>` +
        (even
          ? ""
          : `<img class="sct-mu-h2h-logo" src="${escapeHtml(leader.logo)}" alt=""` +
            ` width="44" height="44" loading="lazy" decoding="async" />`) +
        `<p class="sct-mu-h2h-figure">` +
        `<span class="sct-mu-h2h-tally">${escapeHtml(tally)}</span>` +
        `<span class="sct-mu-h2h-who">${escapeHtml(
          even ? "All square" : `${leader.nickname} lead`,
        )}</span>` +
        `</p>` +
        `<p class="sct-mu-h2h-note">${escapeHtml(
          `Meetings${r.fromSeason ? ` since ${r.fromSeason}` : ""} · ${r.games} game${r.games === 1 ? "" : "s"}`,
        )}</p>` +
        `</div>`
      : "";

  return (
    `<section class="sct-block sct-mu-meetings">` +
    h2("Head-to-Head") +
    lead +
    blocks.join("") +
    `</section>`
  );
}

/* ------------------------------------------------------------------ links */

function renderLinks(data: MatchupData, options: MatchupRenderOptions): string {
  const prefix = (options.teamPathPrefix ?? "/team/").trim();
  const query = options.linkQuery ?? "";
  // No `target="_top"` — see renderMatchups() in team-render.ts. These go to
  // the tool's own team hubs, not out to the main site.
  const link = (href: string, label: string): string =>
    `<li><a class="sct-crosslink" href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
  const items = [data.pair.a, data.pair.b]
    .map(
      (team) =>
        link(`${prefix}${team.slug}/${query}`, `${team.fullName} hub`) +
        ((PUBLIC_SECTIONS as readonly string[]).includes("matchups")
          ? link(`${sectionPath(prefix, team.slug, "matchups")}${query}`, `All ${team.nickname} matchups`)
          : ""),
    )
    .join("");
  return (
    `<nav class="sct-pages" aria-label="Team pages">` +
    `<ul class="sct-pages-list">${items}</ul>` +
    `</nav>`
  );
}

/* ------------------------------------------------------------------- page */

/* ------------------------------------------------------------------ tabs */

/* ------------------------------------------------------------ dark mode */

/** WCAG relative luminance, for the contrast check below. */
function relLuminance(hex: string): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The dark-mode card, which a team's text colour has to read against. */
const DARK_CARD = "#12213a";

/**
 * A team colour lightened until it passes AA as text on the dark card: the
 * build spec's "dark variant" (Rams #003594 → a light blue).
 */
export function darkInk(hex: string): string {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixHex(hex, "#ffffff", step * 0.05);
    if (contrast(candidate, DARK_CARD) >= 4.5) return candidate;
  }
  return "#ffffff";
}

/**
 * A recap fragment with each team's TEXT colour routed through a custom
 * property, so the dark theme can swap in the lighter variant. Fills under
 * white text (chips, tiles) keep their colour in both themes.
 */
function themeInks(html: string, game: ScoreboardGame): { html: string; style: string[] } {
  const colors = heroPairColors(game.away.abbr, game.home.abbr);
  const style: string[] = [];
  let out = html;
  for (const side of ["away", "home"] as const) {
    const ink = colors[side].ink;
    style.push(`--mu-ink-${side}-light:${ink}`, `--mu-ink-${side}-dark:${darkInk(ink)}`);
    const esc = ink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(?<=[";\\s])(color|--rb-team|--ls-team|--rb-away|--rb-home|--rb-at-ink|stroke|fill):${esc}(?=[;"])`, "gi"),
      `$1:var(--mu-ink-${side})`,
    );
  }
  return { html: out, style };
}

/** The completed game's tabs, in bar order: the hash, the label, the panel's id. */
const RECAP_TABS = [
  ["recap", "Recap", "recap-tab"],
  ["fantasy", "Fantasy", "fantasy-tab"],
  ["game-flow", "Game flow", "game-flow-tab"],
  ["head-to-head", "Head-to-head", "h2h-tab"],
  ["betting", "Betting", "betting-tab"],
] as const;
type RecapTabId = (typeof RECAP_TABS)[number][0];

/**
 * A completed game's page: the scoreboard across the full width, the sticky
 * tab bar under it, then two columns — the five tab panels and the always-visible
 * sections (fantasy outlook, FAQ, Keep exploring) in the main one, the sidebar
 * beside it.
 *
 * The scoreboard, with the page's one H1, is outside the panels, so it shows
 * on every tab. Every panel is in the HTML. client/team.ts hides the inactive ones; without
 * it nothing is hidden, the bar is not shown, and the panels read top to bottom
 * in tab order. A tab with nothing in it is left out, bar button and all.
 */
function recapTabs(
  data: MatchupData,
  input: RecapBodyInput,
  added: AddedSections,
  options: MatchupRenderOptions,
): { top: string; body: string; style: string[] } {
  const game = input.game;
  const present = new Set<RecapTabId>();
  const panel = (id: RecapTabId, html: string): string => {
    if (!html) return "";
    present.add(id);
    const [, , panelId] = RECAP_TABS.find(([t]) => t === id)!;
    // The tab's own hash is an anchor at the panel's top, so a plain link to
    // #fantasy still lands somewhere with scripting off. Recap's and
    // Betting's hashes are already section ids inside their panels.
    const anchor = id === "recap" || id === "betting" ? "" : `<span class="sct-mu-anchor" id="${id}"></span>`;
    return (
      `<section class="sct-mu-tabpanel${id === "recap" ? " is-active" : ""}" id="${panelId}" role="tabpanel" ` +
      `aria-labelledby="tab-${id}" data-mu-tab="${id}">${anchor}${html}</section>`
    );
  };

  const body = renderRecapBody(input, {
    arrange: (own) => {
      const fantasy = fantasyInput(data);
      const fantasyTab = fantasy
        ? renderFantasySection(fantasy, renderGameMatchups(data, game))
        : renderGameMatchups(data, game);
      return (
        panel(
          "recap",
          renderGameLeadersStrip(data) +
            renderGameRecap(data, options, added.meant) +
            own.why +
            renderGameScoring(data) +
            added.highlights,
        ) +
        // Player stats and usage, restored under the fantasy section.
        panel("fantasy", fantasyTab + renderPlayerStats(data) + renderUsage(data)) +
        panel("game-flow", added.winProbability + added.possessions) +
        panel("head-to-head", own.headToHead + renderSeasonToDate(data, game) + renderSeasonForm(data)) +
        panel("betting", added.betting) +
        // Below the panels, on every tab.
        own.outlook +
        own.faq +
        added.explore
      );
    },
    asideAfter: renderGameBeforeAfter(data, options),
  });

  const top = renderTabBar(game, RECAP_TABS.filter(([id]) => present.has(id)));
  // The scoreboard sits above the tab bar and both columns, on every tab, as
  // the player pages put their header above their tabs.
  const themed = themeInks(renderHero(data, options) + top + body, game);
  return { top: "", body: themed.html, style: themed.style };
}

/**
 * The tab bar: the score line, for a reader on any tab, then the tabs as
 * buttons in the standard tablist pattern. client/team.ts shows the score line
 * only while the scoreboard itself is off screen, and wires the buttons.
 */
function renderTabBar(
  game: ScoreboardGame,
  tabs: ReadonlyArray<readonly [RecapTabId, string, string]>,
): string {
  const result = scoreboardResult(game);
  const status =
    game.status === "in_progress" ? "Live" : game.status === "final" ? (game.away.ot !== null || game.home.ot !== null ? "Final/OT" : "Final") : "";
  const score = result
    ? `<p class="sct-mu-score" data-mu-score>` +
      (["away", "home"] as const)
        .map(
          (k) =>
            `<span class="${result.winner === k ? "is-win" : result.winner === null ? "is-tie" : "is-loss"}">` +
            `${escapeHtml(game[k].abbr)} ${result[k]}</span>`,
        )
        .join(`<span class="sct-mu-score-sep" aria-hidden="true"> · </span>`) +
      (status ? ` <span class="sct-mu-score-status">${status}</span>` : "") +
      `</p>`
    : "";
  return (
    `<div class="sct-mu-tabs" data-mu-tabbar>` +
    `<div class="sct-mu-tabs-inner">` +
    score +
    `<div class="sct-mu-tabs-list" role="tablist" aria-label="${escapeHtml(`${game.away.short} vs ${game.home.short} sections`)}">` +
    tabs
      .map(
        ([id, label, panelId]) =>
          `<button type="button" class="sct-mu-tab${id === "recap" ? " is-active" : ""}" role="tab" id="tab-${id}" ` +
          `aria-selected="${id === "recap"}" aria-controls="${panelId}" tabindex="${id === "recap" ? 0 : -1}" ` +
          `data-mu-tab-link="${id}">${escapeHtml(label)}</button>`,
      )
      .join("") +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

export function renderMatchupPage(data: MatchupData, options: MatchupRenderOptions = {}): string {
  const { a, b } = data.pair;
  const historical = isHistoricalRecap(data);
  const recapInput = isPostgame(data) || historical ? recapBodyInput(data, options) : null;
  // A completed game is tabbed (recapTabs); the other states are one page.
  const tabs = recapInput ? recapTabs(data, recapInput, renderAddedSections(data, recapInput, options), options) : null;
  const rootStyle = styleAttr([
    ...(tabs?.style ?? []),
    `--team-primary:${a.primaryColor}`,
    `--team-secondary:${a.secondaryColor}`,
    `--mu-a-primary:${a.primaryColor}`,
    `--mu-b-primary:${b.primaryColor}`,
    `--mu-a-logo:url('${a.logo}')`,
    `--mu-b-logo:url('${b.logo}')`,
  ]);

  // Two orders, one per state, rather than one order with sections that know
  // where they are. Before the game the reader is deciding something: the
  // fixture, then how the two compare, then who is hurt, then the history.
  // After it they are reading a result, and the questions run score, who did
  // it, what it meant, and only then what it means for the rivalry — so
  // Head-to-Head goes last rather than second. The hero has already carried the
  // score, which is why there is no featured card in the postgame order — and
  // it has already carried the fixture, which is why there is none in the
  // upcoming order either. Only an old meeting still needs a card, because
  // only its scoreboard is somewhere the hero is not.
  const body = tabs
    ? tabs.body
    : isPostgame(data)
    ? // A game just played, with no final the body can be built from.
      renderGameRecap(data, options) +
      renderGlance(data) +
      renderLeaders(data) +
      renderPlayerStats(data) +
      renderUsage(data) +
      renderInjuries(data) +
      renderSnapshot(data) +
      renderMeetings(data, options)
    : hasResult(data)
      ? // No meeting this season and none coming: an evergreen rivalry page.
        // The head-to-head IS the subject here, so it leads rather than
        // closes — the same principle as above, applied to a page whose
        // reader has no current game to ask about. The last meeting's detail
        // follows it, minus the two forward-looking fantasy blocks.
        renderMeetings(data, options) +
        renderGlance(data) +
        renderLeaders(data) +
        renderPlayerStats(data) +
        renderSnapshot(data) +
        renderFantasy(data) +
        renderInjuries(data)
      : renderWatch(data) +
        renderSnapshot(data) +
        renderFantasy(data) +
        renderInjuries(data) +
        renderMeetings(data, options);

  return (
    `<div class="sct sct-mu${options.embed ? " is-embed" : ""}" data-sct-root="1"` +
    ` data-matchup="${escapeHtml(data.pair.slug)}"` +
    ` data-matchup-state="${data.matchupState}"` +
    ` data-postgame="${isPostgame(data) ? "1" : "0"}"` +
    ` data-season="${escapeHtml(String(data.state.season))}"${rootStyle}>` +
    (tabs ? tabs.top : renderHero(data, options)) +
    `<div class="sct-section is-default is-active" data-sct-panel id="matchup">` +
    body +
    `</div>` +
    // The recap body carries its own related pages in the main column.
    (recapInput ? "" : renderLinks(data, options)) +
    (options.embed && recapInput ? recapFaqSchema(recapFaq(recapInput), true) : "") +
    // Embedded only: the standalone page carries the same node as JSON-LD in
    // its <head>, which matchup-ssr.ts writes.
    (options.embed ? matchupEventSchema(data, true) : "") +
    // The highlights' VideoObject, as an island the plugin lifts into its graph.
    (options.embed && recapInput ? matchupVideoIsland(data) : "") +
    `</div>`
  );
}

/** The `data-state` attribute values, for CSS and tests. */
export const MATCHUP_STATES = ["upcoming", "recently_completed", "historical"] as const;

/* ------------------------------------------------------------ sharing */

export interface MatchupShare {
  /** "/og/arizona-cardinals-vs-los-angeles-rams-2021-wild-card.png", on this origin. */
  path: string;
  file: string;
  alt: string;
  input: ShareImageInput;
}

/**
 * The share image for a completed game's recap, or null on any other page.
 * Away before home in the file name, as the scoreboard reads.
 */
export function matchupShare(data: MatchupData): MatchupShare | null {
  if (!isPostgame(data) && !isHistoricalRecap(data)) return null;
  const meeting = data.featured;
  const game = matchupScoreboardGame(data);
  if (!meeting || !game || game.status !== "final") return null;
  const fantasy = fantasyInput(data);
  const top = fantasy ? topScorers(fantasy)[0] ?? null : null;
  const input: ShareImageInput = { game, topScorer: top ? { name: top.name, ppr: top.ppr } : null };
  const file = shareImageFile(
    meeting.away.slug,
    meeting.home.slug,
    gameSegment({ season: meeting.season, week: meeting.week, seasonType: meeting.seasonType }),
  );
  return { path: `/og/${file}`, file, alt: shareImageAlt(input), input };
}

/**
 * A completed game's meta description: the result, where, and what the page
 * holds. Under 160 characters for every pair, the longest names included.
 */
export function recapDescription(data: MatchupData): string | null {
  const meeting = data.featured;
  const game = matchupScoreboardGame(data);
  const result = game ? scoreboardResult(game) : null;
  if (!meeting || !game || !result) return null;
  const at = game.venue?.name ? ` at ${game.venue.name}` : "";
  const high = Math.max(result.away, result.home);
  const low = Math.min(result.away, result.home);
  const lead =
    result.winner === null
      ? `${game.away.short} and ${game.home.short} tie ${high}–${low}${at}`
      : `${game[result.winner].short} beat the ${game[result.winner === "home" ? "away" : "home"].short} ${high}–${low}${at}`;
  const full = `${lead}: scoring summary, fantasy points for every player, team stats and the head-to-head.`;
  return full.length <= 160 ? full : `${lead}: scoring, fantasy points for every player, team stats, head-to-head.`;
}
