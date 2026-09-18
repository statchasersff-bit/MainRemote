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
import { itemTimestamp, searchKey, type NewsItem } from "../render";
import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import { ensureTeams } from "../teams";
import {
  getTeamRoster,
  rosterFetchedAt,
  type RosterPlayer,
} from "../team/roster";
import {
  dataStamp,
  getAvailableSeasons,
  getPlayerBySlug,
  loadBios,
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
  regionTallies,
  summarizeInjuries,
  type InjurySeasonRow,
  type InjurySummary,
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
export interface ProductionSeason {
  season: number;
  position: string;
  gamesPlayed: number;
  ppg: number;
  total: number;
  posFinishTotal: number | null;
  posFinishPpg: number | null;
}

export interface InjuryProfile {
  history: PlayerInjuryHistory;
  summary: InjurySummary;
  risks: RiskRow[];
  seasons: InjurySeasonRow[];
  regions: RegionTally[];
  insight: string;
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
  fantasyOutlook2026: FantasyOutlook2026 | null;

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

  // 17-game seasons from 2021, 16 before — the denominator for availability.
  const maxGames = tiers.reduce(
    (sum, t) => sum + (t.season >= 2021 ? 17 : 16),
    0,
  );

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

function buildInjuryProfile(playerId: string): InjuryProfile | null {
  const history = getInjuryHistory(playerId);
  if (!history) return null;
  return {
    history,
    summary: summarizeInjuries(history),
    risks: computeRiskBreakdown(history),
    seasons: injuriesBySeason(history.nfl),
    regions: regionTallies(history.nfl),
    insight: buildTimelineInsight(history.nfl),
  };
}

export interface PlayerDataOptions {
  format?: ScoringFormat;
  /** Which season's advanced table to show. Defaults to the active season. */
  advancedSeason?: number;
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

  let season = seasons[0] ?? new Date().getFullYear();
  let gameLog: GameLogEntry[] = [];

  for (const candidate of seasons) {
    const logs = loadGameLogs(candidate);
    const raw = logs[player.id] ?? [];
    if (!raw.some((e) => hasParticipation(e.stats, player.position))) continue;

    season = candidate;
    const ranks = buildWeeklyRanks(candidate, logs, allPlayers, format);
    const oppRanks = buildOppRanks(candidate, logs, allPlayers, format);

    gameLog = fillMissingWeeks(
      enrichWithTeamMetrics(
        attachOppRanks(
          attachRanks(raw, player.id, ranks),
          player.position,
          oppRanks,
        ),
        player.team,
        candidate,
        logs,
        allPlayers,
      ),
      candidate,
      resolveSeasonTeam(player.team, raw, logs, allPlayers),
    );
    break;
  }

  const played = gameLog.filter((e) => e.game_status === "active");
  const maxWeek = played.length > 0 ? Math.max(...played.map((e) => e.week)) : 0;
  const seasonLabel =
    played.length > 0
      ? maxWeek >= 17
        ? `${season} Season Final`
        : `${season} Season (Through Week ${maxWeek})`
      : null;

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

  const advSeason = options.advancedSeason ?? season;
  const advPositions =
    player.position && ADVANCED_POSITIONS.has(player.position)
      ? advancedSeasons(player.position, seasons)
      : [];

  const news = await newsForPlayer(player.name);
  const teamNews = await teamNewsFor(team, news);

  return {
    player,
    team,
    seasonTeam: getTeamByAbbreviation(seasonTeamCode),
    format,

    season,
    seasonLabel,
    seasonRank: positionalFinish(
      player.id,
      player.position,
      season,
      format,
      allPlayers,
    ),
    availableSeasons: seasons,

    gameLog,
    stats,
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
    production: productionSeasons(player.id, format),

    benchmarks,
    rates: efficiency?.rates ?? null,
    dynasty: loadDynastyRankings()[player.slug] ?? null,
    bio: loadBios()[player.slug] ?? null,
    fantasyOutlook2026: loadFantasyOutlook2026()[player.id] ?? null,

    advanced:
      player.position && ADVANCED_POSITIONS.has(player.position)
        ? advancedProfile(player.id, player.position, advSeason)
        : null,
    advancedSeasons: advPositions,
    injury: buildInjuryProfile(player.id),

    news,
    newsUpdatedAtMs: news.reduce<number | null>((newest, item) => {
      const ts = itemTimestamp(item);
      return ts !== null && (newest === null || ts > newest) ? ts : newest;
    }, null),
    teamNews,
    designation: currentDesignation(player, team),
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

/** The canonical team code for a player's current team, or "". */
export function currentTeamCode(player: Player): string {
  return teamCode(player.team);
}
