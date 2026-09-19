/**
 * Assembles everything one player page needs.
 *
 * The counterpart to `team/team-data.ts`, and it follows the same two rules:
 * a missing source leaves its field null and the renderer omits that section,
 * and nothing is invented to fill a gap. What differs is where the work is.
 *
 * A team page is slow because it waits on four strangers' servers. A player
 * page waits on nobody — every number below is arithmetic over JSON already in
 * memory — but the arithmetic is genuinely large: a weekly positional rank is a
 * statement about every player in the league that week, so the first profile
 * rendered for a season builds the whole league's rank table. Those tables are
 * cached per (season, format) in `ranks.ts`, which is what keeps the second
 * profile cheap.
 *
 * The one asynchronous source is this app's own news archive. The player pages
 * used to scrape eight club websites for a News tab; here the tool that already
 * ingests that news answers instead, so a player's news comes from the same
 * pipeline, with the same categories and the same dedupe, as the news tool and
 * the team hubs.
 */

import { listNews, listNewsForTeam } from "../news-query";
import { outlookDrivers, type OutlookDriver } from "./outlook-drivers";
import {
  careerHighs,
  careerStatRows,
  careerTotals,
  seasonGames,
  statsFaq,
  type CareerHigh,
  type CareerStatRow,
  type CareerTotalsRow,
  type StatsFaq,
} from "./stats-profile";
import { itemTimestamp, searchKey, type NewsItem } from "../render";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import { buildBioProfile, type BioProfile } from "./bio";
import {
  buildUpcoming,
  matchupTable,
  upcomingStamp,
  type UpcomingGame,
} from "./upcoming";
import { getTeamSchedule } from "../team/schedule";
import { logger } from "../logger";
import { ensureTeams } from "../teams";
import {
  getTeamRoster,
  rosterFetchedAt,
  type RosterPlayer,
} from "../team/roster";
import {
  dataStamp,
  getAvailableSeasons,
  loadIndexedSlugs,
  getPlayerBySlug,
  loadBioFacts,
  loadBios,
  loadDraft,
  loadDynastyRankings,
  loadFantasyOutlook2026,
  loadGameLogs,
  loadPlayers,
  loadProduction,
} from "./data";
import {
  attachOppRanks,
  attachRanks,
  buildOppRanks,
  buildWeeklyRanks,
  enrichWithTeamMetrics,
  fillMissingWeeks,
  hasParticipation,
  resolveSeasonTeam,
  teamCode,
} from "./ranks";
import {
  careerSeasonTotals,
  computeGameLogStats,
  fpts,
  seasonTierStats,
  structuredOutlook,
  tdDependency,
  type GameLogSummary,
  type Outlook,
  type TdDependency,
} from "./metrics";
import { playerBenchmarks } from "./benchmarks";
import {
  ADVANCED_POSITIONS,
  advancedProfile,
  advancedSeasons,
  type AdvancedProfile,
} from "./advanced";
import {
  buildTimelineInsight,
  computeRiskBreakdown,
  getInjuryHistory,
  injuriesBySeason,
  injuryFaq,
  latestInjury,
  regionTallies,
  summarizeInjuries,
  type InjuryFaq,
  type InjurySeasonRow,
  type InjurySummary,
  type NflInjuryEntry,
  type PlayerInjuryHistory,
  type RegionTally,
  type RiskRow,
} from "./injury";
import { type ScoringFormat } from "./scoring";
import type {
  CareerProfile,
  CareerSeasonStat,
  DynastyData,
  FantasyOutlook2026,
  GameLogEntry,
  Player,
  PlayerBenchmarks,
  PlayerBio,
  SeasonTierStat,
} from "./types";

/** Wire items about this player, for the News & Analysis tab. */
const PLAYER_NEWS_LIMIT = 12;

/**
 * Stories about the player's TEAM, shown beneath their own.
 *
 * The standalone app scraped eight club websites for this section and showed
 * nothing at all for the other twenty-four teams. Here it comes from the club
 * feeds this app already ingests for the team hubs, so every team has one.
 */
const TEAM_NEWS_LIMIT = 8;

/** Seasons of production history shown on the finish timeline. */
/**
 * One season's counting stats, as the production snapshot files them.
 *
 * Carried through rather than dropped because this file reaches back further
 * than the game logs do — ten seasons against four — and it is the only place a
 * career passing or receiving line exists at all. Every field is optional in
 * spirit: a quarterback's row has no targets and a receiver's no attempts.
 */
export interface ProductionTotals {
  passCmp: number;
  passAtt: number;
  passYd: number;
  passTd: number;
  passInt: number;
  rushAtt: number;
  rushYd: number;
  rushTd: number;
  tgt: number;
  rec: number;
  recYd: number;
  recTd: number;
}

export interface ProductionSeason {
  season: number;
  position: string;
  gamesPlayed: number;
  ppg: number;
  total: number;
  posFinishTotal: number | null;
  posFinishPpg: number | null;
  /** The counting stats behind the fantasy points. */
  totals: ProductionTotals;
}

export interface StatsProfile {
  /** Every season with a game in it, newest first. */
  career: CareerStatRow[];
  totals: CareerTotalsRow;
  /** The row for the season the page is showing, when he has played in it. */
  current: CareerStatRow | null;
  highs: CareerHigh[];
  faq: StatsFaq[];
}

export interface InjuryProfile {
  history: PlayerInjuryHistory;
  summary: InjurySummary;
  risks: RiskRow[];
  seasons: InjurySeasonRow[];
  regions: RegionTally[];
  insight: string;
  /** The most recent logged injury, for the status block. */
  latest: NflInjuryEntry | null;
  /**
   * Games the player missed in the season the page is showing.
   *
   * Counted off the game log, which is padded to the TEAM's own schedule — so
   * a week the team has not played yet is not counted as a game missed. Null
   * when there is no log to count from.
   */
  seasonMissed: number | null;
  /** The most recent week he actually played, for the FAQ. */
  lastPlayedWeek: number | null;
  faq: InjuryFaq[];
}

export interface EfficiencyRates {
  /** Yards per catch, or per attempt for a quarterback. */
  yardsPerCatch: number;
  /** Catch rate, or completion percentage for a quarterback. */
  catchPct: number;
  /** Touchdowns per target, or per attempt for a quarterback. */
  tdPerTarget: number;
  /** Fantasy points per unit of usage. Quarterbacks only. */
  fpPerUsage?: number;
}

export interface PlayerPageData {
  player: Player;
  /** The canonical team row for the player's CURRENT team, when known. */
  team: NflTeam | null;
  /** The team they actually played for in `season` — used for recap copy. */
  seasonTeam: NflTeam | null;
  format: ScoringFormat;

  /** The most recent season with real participation. */
  season: number;
  seasonLabel: string | null;
  /** Their positional finish that season, by points per game. */
  seasonRank: number | null;
  availableSeasons: number[];

  /** Every week of `season`, padded, ranked and enriched. */
  gameLog: GameLogEntry[];
  stats: GameLogSummary | null;

  /**
   * The Game Log tab's season, and the log behind it.
   *
   * `logSeason` is `season` unless the reader pinned another one, in which case
   * `seasonLog` is that season's weeks and `gameLog` is still the active
   * season's. Everything else on the page — the outlook, the injury history,
   * the benchmarks — stays on `season`, because the tab is what was re-scoped
   * and not the profile.
   */
  logSeason: number;
  logSeasonLabel: string | null;

  /**
   * The next few fixtures, with each opponent's difficulty at this position.
   *
   * Schedule and matchup context only — never statistics. It sits under the
   * completed game log and is kept rigorously apart from it: see
   * lib/player/upcoming.ts on why a fixture must not become a table row with
   * dashes in its stat columns.
   */
  upcoming: UpcomingGame[];
  /** "Week 3", "Preseason baseline" — what the matchup ranks are measured over. */
  upcomingMatchupMode: string | null;
  /** Fingerprint of the fixtures and their ranks, for the render cache. */
  upcomingStamp: string;
  seasonLog: GameLogEntry[];
  seasonLogStats: GameLogSummary | null;
  /** Seasons this player actually appeared in, newest first. */
  logSeasons: number[];
  outlook: Outlook;
  tdDependency: TdDependency;

  seasonTiers: SeasonTierStat[];
  careerSeasons: CareerSeasonStat[];
  careerProfile: CareerProfile | null;
  production: ProductionSeason[];

  benchmarks: PlayerBenchmarks | null;
  /**
   * The player's own efficiency rates, in the same order the benchmarks rank
   * them. Carried separately because `PlayerBenchmarks` holds the position's
   * distribution and the player's percentile within it, but not the value the
   * percentile describes — and a bar with no number beside it is exactly the
   * chart this page is not allowed to draw.
   */
  rates: EfficiencyRates | null;
  dynasty: DynastyData | null;
  bio: PlayerBio | null;

  /**
   * The Bio tab: identity facts, career timeline, draft, story and questions.
   *
   * Derived in lib/player/bio.ts from players.json, draft.json and
   * bio_facts.json — never from anything fantasy. Bio is the one tab on this
   * page that answers "who is he?" rather than a lineup question, and keeping
   * its inputs disjoint from the rest is what keeps it that way.
   */
  bioProfile: BioProfile;
  fantasyOutlook2026: FantasyOutlook2026 | null;

  /**
   * The four measured cards on the Outlook tab, adapted to the position.
   *
   * Beside `fantasyOutlook2026` rather than inside it because the two have
   * different authors: that record is written, this is read off the player's
   * advanced line against the position's own distribution. See
   * lib/player/outlook-drivers.ts.
   */
  outlookDrivers: OutlookDriver[];

  /**
   * The Stats tab's aggregates: the career table, its totals, the records and
   * the questions they answer. See lib/player/stats-profile.ts — Stats is
   * totals, Game Log is games, and this is the totals side.
   */
  statsProfile: StatsProfile;

  /** Null when the player is not in the advanced table — the tab is hidden. */
  advanced: AdvancedProfile | null;
  advancedSeasons: number[];
  injury: InjuryProfile | null;

  news: NewsItem[];
  newsUpdatedAtMs: number | null;

  /**
   * The player's team's own reporting, minus anything already listed above.
   *
   * Their team's news is the context their own news sits in — a running back's
   * week is partly the story of who else is hurt — and it is the section the
   * standalone app's News tab was mostly made of.
   */
  teamNews: NewsItem[];

  /**
   * The current injury designation, straight off the roster snapshot.
   *
   * Null when the player carries none, and that is the ONLY thing null means
   * here: it is not a clean bill of health, because this snapshot can only
   * report what a club has filed. The renderer omits the card rather than
   * printing "Healthy" — see the note on it.
   */
  designation: RosterPlayer | null;

  /** Epoch ms the roster snapshot was pulled. 0 when there is none. */
  rosterFetchedAt: number;

  /** Changes whenever any input changes — used as the render cache key. */
  version: string;
}

/**
 * The player's own news, from this app's archive.
 *
 * Matched on the normalised player name rather than a substring, because the
 * wire tags each item with the player it is about and a substring match on a
 * common surname turns one player's page into another's. Items with no player
 * tag are dropped rather than guessed at.
 */
async function newsForPlayer(name: string): Promise<NewsItem[]> {
  const wanted = searchKey(name);
  if (!wanted) return [];
  try {
    const rows = await listNews({ search: name, limit: 60 });
    return rows
      .filter((item) => searchKey(item.playerName) === wanted)
      .slice(0, PLAYER_NEWS_LIMIT);
  } catch {
    // The archive being unavailable costs this page its News tab and nothing
    // else. Every other section is served from disk.
    return [];
  }
}

/**
 * The player's team's news, minus the stories already shown as their own.
 *
 * Deduped by id rather than by headline: the same row genuinely appears in both
 * reads (the wire item about this player IS one of their team's items), and
 * printing it twice under two headings makes the page look like it has more
 * news than it does.
 */
async function teamNewsFor(
  team: NflTeam | null,
  exclude: NewsItem[],
): Promise<NewsItem[]> {
  if (!team) return [];
  try {
    const seen = new Set(exclude.map((item) => item.id));
    const rows = await listNewsForTeam(team.abbreviation, {
      limit: TEAM_NEWS_LIMIT + exclude.length,
    });
    return rows.filter((item) => !seen.has(item.id)).slice(0, TEAM_NEWS_LIMIT);
  } catch {
    // The archive being unavailable costs this page its team news and nothing
    // else. Every other section is served from disk.
    return [];
  }
}

/**
 * The player's current injury designation, or null.
 *
 * Matched on the Sleeper id, which both sides are keyed by, rather than on the
 * name — two players share a name often enough that a name match would
 * eventually put somebody else's hamstring on this page.
 *
 * The roster only indexes skill positions, so a lineman resolves to null. That
 * is correct: null here means "no designation on file", never "fit".
 */
function currentDesignation(
  player: Player,
  team: NflTeam | null,
): RosterPlayer | null {
  if (!team) return null;
  const roster = getTeamRoster(team.abbreviation);
  if (!roster) return null;
  const match = roster.players.find((row) => row.id === player.id);
  return match?.injuryStatus ? match : null;
}

/** Sleeper-backed season production, for the finish timeline. */
/** The counting stats off one production row, with every absence read as zero. */
function readTotals(raw: unknown): ProductionTotals {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (key: string): number => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  return {
    passCmp: n("passCmp"),
    passAtt: n("passAtt"),
    passYd: n("passYd"),
    passTd: n("passTd"),
    passInt: n("passInt"),
    rushAtt: n("rushAtt"),
    rushYd: n("rushYd"),
    rushTd: n("rushTd"),
    tgt: n("tgt"),
    rec: n("rec"),
    recYd: n("recYd"),
    recTd: n("recTd"),
  };
}

function productionSeasons(
  playerId: string,
  format: ScoringFormat,
): ProductionSeason[] {
  const raw = (loadProduction() as Record<string, unknown>)[playerId];
  if (!Array.isArray(raw)) return [];

  const key = format === "standard" ? "std" : format;

  return raw
    .map((entry): ProductionSeason | null => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const scoring = row[key] as Record<string, unknown> | undefined;
      if (!scoring) return null;
      return {
        season: Number(row["season"]),
        position: String(row["position"] ?? ""),
        gamesPlayed: Number(row["gamesPlayed"] ?? 0),
        ppg: Number(scoring["ppg"] ?? 0),
        total: Number(scoring["total"] ?? 0),
        posFinishTotal:
          typeof scoring["posFinishTotal"] === "number"
            ? (scoring["posFinishTotal"] as number)
            : null,
        posFinishPpg:
          typeof scoring["posFinishPpg"] === "number"
            ? (scoring["posFinishPpg"] as number)
            : null,
        totals: readTotals(row["totals"]),
      };
    })
    .filter((row): row is ProductionSeason => row !== null && Number.isFinite(row.season))
    .sort((a, b) => b.season - a.season);
}

/**
 * Their positional finish for one season, by points per game.
 *
 * The four-game minimum is the whole reason this is not simply a sort: without
 * it, a player who caught two touchdowns in his only appearance finishes as the
 * WR1 for the season, which is arithmetically true and a lie about football.
 */
function positionalFinish(
  playerId: string,
  position: string | null,
  season: number,
  format: ScoringFormat,
  allPlayers: Player[],
): number | null {
  if (!position) return null;
  const logs = loadGameLogs(season);
  const positionById = new Map(allPlayers.map((p) => [p.id, p.position]));

  const ppgs: { id: string; ppg: number }[] = [];
  for (const [id, entries] of Object.entries(logs)) {
    if (positionById.get(id) !== position) continue;
    const played = entries.filter((e) => hasParticipation(e.stats, position));
    if (played.length < 4) continue;
    const total = played.reduce(
      (sum, e) => sum + fpts(e, format),
      0,
    );
    ppgs.push({ id, ppg: total / played.length });
  }

  ppgs.sort((a, b) => b.ppg - a.ppg);
  const index = ppgs.findIndex((row) => row.id === playerId);
  return index >= 0 ? index + 1 : null;
}

/**
 * The efficiency rates this player is benchmarked on.
 *
 * A quarterback's "targets" are attempts and his "catches" are completions, so
 * one set of three rates covers both cases — see benchmarks.ts.
 */
function efficiencyRates(
  played: GameLogEntry[],
  position: string,
  format: ScoringFormat,
) {
  const isQB = position === "QB";
  let yards = 0;
  let caught = 0;
  let volume = 0;
  let tds = 0;
  let usage = 0;

  for (const e of played) {
    const s = e.stats;
    if (isQB) {
      volume += s.pass_att ?? 0;
      caught += s.pass_cmp ?? 0;
      yards += s.pass_yd ?? 0;
      tds += s.pass_td ?? 0;
      usage += (s.pass_att ?? 0) + 2 * (s.rush_att ?? 0);
    } else {
      volume += s.rec_tgt ?? 0;
      caught += s.rec ?? 0;
      yards += s.rec_yd ?? 0;
      tds += s.rec_td ?? 0;
    }
  }

  const totalFp = played.reduce((sum, e) => sum + fpts(e, format), 0);

  return {
    volume,
    rates: {
      yardsPerCatch: isQB
        ? volume > 0
          ? yards / volume
          : 0
        : caught > 0
          ? yards / caught
          : 0,
      catchPct: volume > 0 ? (caught / volume) * 100 : 0,
      tdPerTarget: volume > 0 ? (tds / volume) * 100 : 0,
      fpPerUsage: isQB && usage > 0 ? totalFp / usage : undefined,
    },
  };
}

/** The career aggregate card. Null for a player with a single season. */
function buildCareerProfile(
  tiers: SeasonTierStat[],
  playerId: string,
  position: string | null,
  format: ScoringFormat,
): CareerProfile | null {
  if (tiers.length <= 1) return null;

  const points: number[] = [];
  let pos1 = 0;
  let pos2 = 0;
  let pos3 = 0;
  let bust = 0;

  for (const tier of tiers) {
    const entries = loadGameLogs(tier.season)[playerId] ?? [];
    const played = entries.filter((e) => hasParticipation(e.stats, position));
    for (const e of played) points.push(fpts(e, format));
    pos1 += Math.round((tier.pos1Pct / 100) * tier.gamesPlayed);
    pos2 += Math.round((tier.pos2Pct / 100) * tier.gamesPlayed);
    pos3 += Math.round((tier.pos3Pct / 100) * tier.gamesPlayed);
    bust += Math.round((tier.bustPct / 100) * tier.gamesPlayed);
  }

  const games = points.length;
  if (games === 0) return null;

  const maxGames = tiers.reduce((sum, t) => sum + seasonGames(t.season), 0);

  const total = points.reduce((a, b) => a + b, 0);
  const ppg = total / games;
  const variance =
    games > 1
      ? points.reduce((sum, v) => sum + (v - ppg) ** 2, 0) / (games - 1)
      : 0;
  const volatility = Math.sqrt(variance);

  const pct = (n: number) => (games > 0 ? (n / games) * 100 : 0);

  return {
    ppg,
    gamesPlayed: games,
    maxGames,
    durabilityPct: maxGames > 0 ? (games / maxGames) * 100 : 0,
    pos1Pct: pct(pos1),
    pos2Pct: pct(pos2),
    pos3Pct: pct(pos3),
    bustPct: pct(bust),
    volatility,
    volatilityLabel: volatility < 6 ? "Low" : volatility < 9 ? "Moderate" : "High",
    seasons: tiers.length,
    seasonPpgs: tiers.map((t) => ({ season: t.season, ppg: t.ppg })),
    smallSample: games < 8,
  };
}

function buildInjuryProfile(
  playerId: string,
  name: string,
  season: number,
  gameLog: GameLogEntry[],
  designation: RosterPlayer | null,
): InjuryProfile | null {
  const history = getInjuryHistory(playerId);
  if (!history) return null;

  const summary = summarizeInjuries(history);

  // Absences in the season on the page. "out" and not "bye", off a log that
  // stops at the team's last played game — so this counts games that happened
  // without him, never games that have not kicked off.
  const seasonMissed =
    gameLog.length > 0
      ? gameLog.filter((entry) => entry.game_status === "out").length
      : null;
  const played = gameLog.filter((entry) => entry.game_status === "active");
  const lastPlayedWeek =
    played.length > 0 ? Math.max(...played.map((entry) => entry.week)) : null;

  return {
    history,
    summary,
    risks: computeRiskBreakdown(history),
    seasons: injuriesBySeason(history.nfl),
    regions: regionTallies(history.nfl),
    insight: buildTimelineInsight(history.nfl),
    latest: latestInjury(history.nfl),
    seasonMissed,
    lastPlayedWeek,
    faq: injuryFaq({
      name,
      // Only a designation with a status on it counts. A roster row exists for
      // every player; the injury status is the part that may be absent.
      designation: designation?.injuryStatus
        ? {
            injuryStatus: designation.injuryStatus,
            injuryBodyPart: designation.injuryBodyPart,
          }
        : null,
      summary,
      nfl: history.nfl,
      seasonMissed,
      season,
      lastPlayedWeek,
    }),
  };
}

export interface PlayerDataOptions {
  format?: ScoringFormat;
  /** Which season's advanced table to show. Defaults to the active season. */
  advancedSeason?: number;
  /**
   * Which season the Game Log tab shows. Defaults to the active season.
   *
   * Scoped to that one tab rather than to the page. A reader on the Game Log
   * looking at 2023 has not asked for a 2023 injury history or a 2023 outlook,
   * and re-pointing the whole profile at an old season would be a different
   * page wearing this one's URL. Ignored unless the player actually played it.
   */
  logSeason?: number;
}

export async function getPlayerPageData(
  slug: string,
  options: PlayerDataOptions = {},
): Promise<PlayerPageData | null> {
  const player = getPlayerBySlug(slug);
  if (!player) return null;

  const format = options.format ?? "ppr";
  const allPlayers = loadPlayers();
  const seasons = getAvailableSeasons();

  // The roster index carries the injury designations and rides on the news
  // tool's own Sleeper fetch, so this is usually already warm. Awaited here for
  // the same reason team-data.ts awaits it: on a cold process the designation
  // would otherwise be missing from the first render of every player and
  // present on the second.
  const team = getTeamByAbbreviation(player.team);
  await ensureTeams();

  /* ---- the active season: the newest one they actually played in ---- */

  /**
   * One season's log, ranked, enriched and padded.
   *
   * Extracted because it is now called twice. The Game Log tab can be pinned to
   * a season other than the active one, and a reader asking for 2023 has to get
   * 2023's weekly ranks and 2023's opponent ranks with it — the alternative,
   * re-labelling the active season's log, is the kind of bug that produces a
   * page that is wrong rather than empty.
   */
  const buildLog = (candidate: number): GameLogEntry[] => {
    const logs = loadGameLogs(candidate);
    const raw = logs[player.id] ?? [];
    if (raw.length === 0) return [];

    return fillMissingWeeks(
      enrichWithTeamMetrics(
        attachOppRanks(
          attachRanks(
            raw,
            player.id,
            buildWeeklyRanks(candidate, logs, allPlayers, format),
          ),
          player.position,
          buildOppRanks(candidate, logs, allPlayers, format),
        ),
        player.team,
        candidate,
        logs,
        allPlayers,
      ),
      candidate,
      resolveSeasonTeam(player.team, raw, logs, allPlayers),
      player.position,
    );
  };

  /** "2024 Season Final", or how far into an unfinished one the log runs. */
  const labelFor = (log: GameLogEntry[], year: number): string | null => {
    const active = log.filter((e) => e.game_status === "active");
    if (active.length === 0) return null;
    const last = Math.max(...active.map((e) => e.week));
    return last >= 17 ? `${year} Season Final` : `${year} Season (Through Week ${last})`;
  };

  let season = seasons[0] ?? new Date().getFullYear();
  let gameLog: GameLogEntry[] = [];

  // Every season this player actually appeared in, newest first. The Game Log's
  // season selector is built from it, so a season nobody played is never
  // offered — an empty table behind a chip is worse than no chip.
  const logSeasons: number[] = [];

  for (const candidate of seasons) {
    const logs = loadGameLogs(candidate);
    const raw = logs[player.id] ?? [];
    if (!raw.some((e) => hasParticipation(e.stats, player.position))) continue;

    logSeasons.push(candidate);
    // The first one found is the newest, and it is the page's active season.
    if (gameLog.length === 0) {
      season = candidate;
      gameLog = buildLog(candidate);
    }
  }

  const played = gameLog.filter((e) => e.game_status === "active");
  const seasonLabel = labelFor(gameLog, season);

  /* ---- the Game Log's own season, which need not be the active one ---- */

  const requested = options.logSeason;
  const logSeason =
    requested !== undefined && logSeasons.includes(requested) ? requested : season;
  // Reference-equal when they agree, so the common case builds one log.
  const seasonLog = logSeason === season ? gameLog : buildLog(logSeason);

  /* ---- career: every season with a log, on the position-specific scale ---- */

  const seasonTiers: SeasonTierStat[] = [];
  const careerSeasons: CareerSeasonStat[] = [];

  for (const candidate of seasons) {
    const logs = loadGameLogs(candidate);
    const raw = logs[player.id] ?? [];
    if (!raw.some((e) => hasParticipation(e.stats, player.position))) continue;

    const ranked = attachRanks(
      raw,
      player.id,
      buildWeeklyRanks(candidate, logs, allPlayers, format),
    );

    const tier = seasonTierStats(candidate, ranked, player.position, format);
    if (tier) seasonTiers.push(tier);

    const totals = careerSeasonTotals(
      candidate,
      ranked,
      player.position,
      format,
      positionalFinish(player.id, player.position, candidate, format, allPlayers),
    );
    if (totals) careerSeasons.push(totals);
  }

  seasonTiers.sort((a, b) => b.season - a.season);
  careerSeasons.sort((a, b) => b.season - a.season);

  /* ---- the rest ---- */

  const stats = computeGameLogStats(gameLog, player.position, format);

  const efficiency =
    player.position && played.length > 0
      ? efficiencyRates(played, player.position, format)
      : null;

  const benchmarks =
    efficiency && player.position
      ? playerBenchmarks(
          season,
          player.position,
          allPlayers,
          efficiency.rates,
          efficiency.volume,
        )
      : null;

  const seasonTeamCode = resolveSeasonTeam(
    player.team,
    gameLog.filter((e) => e.team),
    loadGameLogs(season),
    allPlayers,
  );

  const advPositions =
    player.position && ADVANCED_POSITIONS.has(player.position)
      ? advancedSeasons(player.position, seasons)
      : [];

  /*
   * Which advanced table to show.
   *
   * NOT simply the season the rest of the page is on. The advanced tables
   * arrive from a separate pipeline and land after a season is filed, so in
   * September the page is on a season that has no table at all — and defaulting
   * to it made the whole Advanced section vanish from every player the moment
   * the game log rolled over to the new year.
   *
   * So: the reader's choice if they made one and it exists, otherwise the
   * current season if it has a table, otherwise the newest one that does.
   */
  const advSeason =
    options.advancedSeason ??
    (advPositions.includes(season) ? season : (advPositions[0] ?? season));

  /* ---- what is next: the schedule, and the matchup it walks into ---- */

  // Both upstreams are allowed to fail. The schedule is a network fetch and the
  // points-allowed table is a database query, and neither is worth a 500 on a
  // page whose other nine blocks are arithmetic over JSON already in memory.
  const leagueSeason = seasons[0] ?? season;
  const schedule = team
    ? await getTeamSchedule(team, leagueSeason).catch((err: unknown) => {
        logger.warn({ err, team: team.code }, "No schedule for the upcoming-games block");
        return null;
      })
    : null;
  const fpaTable = await matchupTable(format);
  const upcoming = buildUpcoming({
    position: player.position,
    schedule,
    fpa: fpaTable,
    now: Date.now(),
  });

  const news = await newsForPlayer(player.name);
  const teamNews = await teamNewsFor(team, news);

  const outlook2026 = loadFantasyOutlook2026()[player.id] ?? null;
  const designation = currentDesignation(player, team);

  const production = productionSeasons(player.id, format);
  const careerRows = careerStatRows(production, careerSeasons, season);
  const rowTotals = careerTotals(careerRows);
  const currentRow = careerRows.find((row) => row.season === season) ?? null;
  const rank = positionalFinish(player.id, player.position, season, format, allPlayers);

  return {
    player,
    team,
    seasonTeam: getTeamByAbbreviation(seasonTeamCode),
    format,

    season,
    seasonLabel,
    seasonRank: rank,
    availableSeasons: seasons,

    gameLog,
    stats,

    logSeason,
    logSeasonLabel: labelFor(seasonLog, logSeason),
    upcoming,
    upcomingMatchupMode: fpaTable?.dataMode ?? null,
    upcomingStamp: upcomingStamp(upcoming),
    seasonLog,
    seasonLogStats:
      logSeason === season
        ? stats
        : computeGameLogStats(seasonLog, player.position, format),
    logSeasons,

    outlook: structuredOutlook(player.name, player.position, stats, format),
    tdDependency: tdDependency(played, player.position, format),

    seasonTiers,
    careerSeasons,
    careerProfile: buildCareerProfile(
      seasonTiers,
      player.id,
      player.position,
      format,
    ),
    production,

    benchmarks,
    rates: efficiency?.rates ?? null,
    dynasty: loadDynastyRankings()[player.slug] ?? null,
    bio: loadBios()[player.slug] ?? null,
    bioProfile: buildBioProfile({
      player,
      team,
      facts: loadBioFacts()[player.slug] ?? null,
      draft: loadDraft()[player.slug] ?? null,
      // The LEAGUE's current season, not the player's newest played one: a
      // timeline is about where he is, and a player who has not taken a snap
      // this year has not left the league.
      currentSeason: seasons[0] ?? season,
      now: new Date(),
    }),
    fantasyOutlook2026: outlook2026,
    outlookDrivers: outlookDrivers(player, outlook2026),

    statsProfile: {
      career: careerRows,
      totals: rowTotals,
      current: currentRow,
      highs: careerHighs(careerRows, player.position),
      faq: statsFaq({
        name: player.name,
        position: player.position,
        season,
        seasonRow: currentRow,
        totals: rowTotals,
        seasonRank: rank,
      }),
    },

    advanced:
      player.position && ADVANCED_POSITIONS.has(player.position)
        ? advancedProfile(player.id, player.position, advSeason)
        : null,
    advancedSeasons: advPositions,
    injury: buildInjuryProfile(
      player.id,
      player.name,
      season,
      gameLog,
      designation,
    ),

    news,
    newsUpdatedAtMs: news.reduce<number | null>((newest, item) => {
      const ts = itemTimestamp(item);
      return ts !== null && (newest === null || ts > newest) ? ts : newest;
    }, null),
    teamNews,
    designation,
    rosterFetchedAt: rosterFetchedAt(),

    version: "",
  };
}

/**
 * A fingerprint of everything rendered, for the page cache.
 *
 * The data files are static, so their stamp covers almost all of it; the news
 * count and newest timestamp are the only parts that move under a running
 * process, and the format is in the key because every number on the page
 * depends on it.
 */
export function playerDataVersion(
  data: PlayerPageData,
  contentVersion: string,
): string {
  return [
    data.player.slug,
    data.format,
    dataStamp(),
    contentVersion,
    data.season,
    // The Game Log's own season, which the cache key must separate: two
    // requests for the same player in the same format render different tables.
    data.logSeason,
    // The fixtures and their matchup ranks. Neither is a data file, so neither
    // is covered by dataStamp() — a finished game and a fresh FPA ingest both
    // have to invalidate this page and nothing else would notice.
    data.upcomingStamp,
    data.news.length,
    data.newsUpdatedAtMs ?? 0,
    data.teamNews.length,
    // The designation and the snapshot it came from: a player going from
    // Questionable to Out has to invalidate this page, and the stamp covers the
    // case where a refresh clears a designation entirely.
    data.designation?.injuryStatus ?? "",
    data.designation?.practice ?? "",
    data.rosterFetchedAt,
    data.advanced?.season ?? "",
  ].join("-");
}

/**
 * One row per player that has a page, resolved against the team table.
 *
 * The single answer to "which players exist" for every consumer that needs the
 * list rather than one profile: the `/player` index, the `/embed/players.json`
 * manifest the WordPress page script builds from, and the development
 * switcher's player picker. It was the same fifteen-line loop in all three, and
 * the exclusion rule below is exactly the kind of thing that gets fixed in one
 * of three copies.
 *
 * **Team defences are excluded.** They are in the indexed list because the news
 * tool ranks them, but nothing a player page renders applies to one — no game
 * log, no efficiency percentiles, no injury history, no bio. A defence's page
 * already exists and it is the team hub.
 */
export interface IndexedPlayer {
  /** Sleeper's id — what its headshot CDN is keyed by. */
  id: string;
  slug: string;
  name: string;
  position: string | null;
  team: NflTeam | null;
  headshot: string | null;
}

export function indexedPlayers(): IndexedPlayer[] {
  const rows: IndexedPlayer[] = [];
  for (const slug of loadIndexedSlugs()) {
    const player = getPlayerBySlug(slug);
    if (!player) continue;
    if (player.position === "DEF") continue;
    rows.push({
      id: player.id,
      slug: player.slug,
      name: player.name,
      position: player.position,
      team: getTeamByAbbreviation(player.team),
      headshot: player.headshotUrl ?? null,
    });
  }
  return rows;
}

/** The canonical team code for a player's current team, or "". */
export function currentTeamCode(player: Player): string {
  return teamCode(player.team);
}
