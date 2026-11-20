/**
 * Target share and snap share: the one definition player pages use (Phase 2,
 * 2026-11-19, after the Overview meter printed Brock Bowers at 25.6% and the
 * team hub at 21.0% for the same season).
 *
 *   target share = his targets / his club's targets, summed over the games he
 *                  played (never an average of per-game shares)
 *   snap share   = his offensive snaps / his club's offensive snaps, summed
 *                  over the games he played
 *
 * "Games he played" are the games in which he took a snap or was involved in
 * a play. Games he missed and byes count on neither side. A traded player's
 * games at every club are summed, which is a like-for-like season figure:
 * each game's numerator and denominator come from the same club and source.
 *
 * Source: the usage report (data/team/usage_<season>.json, built by
 * scripts/team/buildUsage.mjs from the league's play-by-play and snap
 * counts). Its per-game rows (`weekly`: tgt, teamTgt, snapN) carry exactly
 * these counts; team snaps per week are `snapsByWeek` on the club. Targets
 * are pass attempts with a receiver, sacks, two-point tries, spikes and
 * no-plays excluded.
 *
 * Why the two numbers differed: the usage report's own `targetShare` divides
 * by the club's WHOLE season, missed games included (Bowers 71/338 = 21.0%,
 * the Raiders' weeks 1-2 without him in the denominator). The Overview meter
 * divided by the club's targets in his games, but counted from Sleeper's game
 * logs (72/281 = 25.6%), which credit a target here and there that the
 * play-by-play does not. Under this definition he is 71/280 = 25.4%. The
 * report's whole-season share is a different statistic (his share of the
 * club's season) and is labeled as such where it is shown.
 */
import { getUsageDoc, type UsagePlayer } from "./usage";

export interface PlayedShare {
  /** Games he played, across every club. */
  games: number;
  targets: number;
  teamTargets: number;
  /** Percent, one decimal; null without a team target in his games. */
  targetShare: number | null;
  snaps: number;
  teamSnaps: number;
  /** Percent, whole number; null without snap counts. */
  snapShare: number | null;
  /** Each club he played for this season, in the order of his first game there. */
  clubs: Array<{ club: string; games: number }>;
  /** Season counts summed across his clubs (the report's per-club totals). */
  passAttempts: number;
  carries: number;
  rzTouches: number;
  /** Weighted opportunities: carries + 2 x targets. */
  wopp: number;
  /** Average depth of target over all his targets; null without targets. */
  adot: number | null;
}

type WeeklyRow = { week: number; tgt: number | null; teamTgt: number | null; snapN: number | null };
type Row = UsagePlayer & { weekly?: WeeklyRow[] };
type Doc = NonNullable<ReturnType<typeof getUsageDoc>> & {
  teams: Record<string, { players: Row[]; snapsByWeek?: Record<string, number> }>;
};

const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

function rowsFor(doc: Doc, match: (r: Row) => boolean): Array<{ club: string; row: Row }> {
  const out: Array<{ club: string; row: Row }> = [];
  for (const [club, team] of Object.entries(doc.teams)) {
    for (const row of team.players ?? []) if (match(row)) out.push({ club, row });
  }
  return out;
}

function sumRows(doc: Doc, rows: Array<{ club: string; row: Row }>): PlayedShare | null {
  let games = 0, targets = 0, teamTargets = 0, snaps = 0, teamSnaps = 0;
  let passAttempts = 0, carries = 0, rzTouches = 0, wopp = 0, airYards = 0, rowTargets = 0;
  const clubs: Array<{ club: string; games: number; first: number }> = [];
  for (const { club, row } of rows) {
    const byWeek = doc.teams[club]?.snapsByWeek ?? {};
    let clubGames = 0;
    let first = Infinity;
    for (const w of row.weekly ?? []) {
      // A game he played: the report keeps a row with counts (missed games are nulls).
      if (w.tgt === null && w.snapN === null) continue;
      clubGames += 1;
      first = Math.min(first, w.week);
      targets += w.tgt ?? 0;
      teamTargets += w.teamTgt ?? 0;
      if (w.snapN !== null && typeof byWeek[String(w.week)] === "number") {
        snaps += w.snapN;
        teamSnaps += byWeek[String(w.week)]!;
      }
    }
    if (clubGames) clubs.push({ club, games: clubGames, first });
    passAttempts += row.passAttempts ?? 0;
    carries += row.carries ?? 0;
    rzTouches += row.rzTouches ?? 0;
    wopp += row.wopp ?? 0;
    // aDOT is air yards / targets per club, so the club's air yards are
    // aDOT x targets and the season aDOT is their sum over all targets.
    if (typeof row.adot === "number" && row.targets) {
      airYards += row.adot * row.targets;
      rowTargets += row.targets;
    }
    games += clubGames;
  }
  if (!games) return null;
  clubs.sort((a, b) => a.first - b.first);
  return {
    games,
    targets,
    teamTargets,
    targetShare: teamTargets > 0 ? round((targets / teamTargets) * 100, 1) : null,
    snaps,
    teamSnaps,
    snapShare: teamSnaps > 0 ? Math.round((snaps / teamSnaps) * 100) : null,
    clubs: clubs.map(({ club, games: g }) => ({ club, games: g })),
    passAttempts,
    carries,
    rzTouches,
    wopp,
    adot: rowTargets > 0 ? round(airYards / rowTargets, 1) : null,
  };
}

/** His shares under the definition above, by Sleeper id (or slug), or null. */
export function playedShare(season: number, player: { id?: string | null; slug?: string | null }): PlayedShare | null {
  const doc = getUsageDoc(season) as Doc | null;
  if (!doc?.teams) return null;
  const rows = rowsFor(doc, (r) => (player.id ? r.sleeperId === player.id : false) || (player.slug ? r.slug === player.slug : false));
  return rows.length ? sumRows(doc, rows) : null;
}

const poolCache = new Map<string, Array<{ key: string; share: PlayedShare }>>();

/** Every player at a position, one entry per player (clubs summed). */
function pool(season: number, pos: string): Array<{ key: string; share: PlayedShare }> {
  const doc = getUsageDoc(season) as Doc | null;
  const cacheKey = `${season}|${pos}|${doc?.builtAt ?? ""}`;
  const hit = poolCache.get(cacheKey);
  if (hit) return hit;
  const byPlayer = new Map<string, Array<{ club: string; row: Row }>>();
  for (const { club, row } of doc?.teams ? rowsFor(doc, (r) => r.pos === pos) : []) {
    const key = row.sleeperId ?? row.id;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), { club, row }]);
  }
  const out: Array<{ key: string; share: PlayedShare }> = [];
  for (const [key, rows] of byPlayer) {
    const share = doc ? sumRows(doc, rows) : null;
    if (share) out.push({ key, share });
  }
  poolCache.set(cacheKey, out);
  return out;
}

/** Who a share is ranked among: at least this many games played. */
export const SHARE_RANK_MIN_GAMES = 4;

/**
 * His rank in a share among every player at his position with at least
 * SHARE_RANK_MIN_GAMES games, 1 = the highest. Null when he is below the line.
 */
export function playedShareRank(
  season: number,
  pos: string,
  player: { id?: string | null },
  metric: "targetShare" | "snapShare",
): { rank: number; of: number } | null {
  const field = pool(season, pos).filter((p) => p.share.games >= SHARE_RANK_MIN_GAMES && p.share[metric] !== null);
  const mine = field.find((p) => p.key === player.id);
  if (!mine) return null;
  const value = mine.share[metric]!;
  const rank = field.filter((p) => p.share[metric]! > value).length + 1;
  return { rank, of: field.length };
}

/** The percentile pool for the Overview meter: every qualified player's target share. */
export function targetShareById(season: number, pos: string): Map<string, PlayedShare> {
  return new Map(pool(season, pos).map((p) => [p.key, p.share]));
}

/** His shares and their ranks, for the player page data. */
export interface UsageShareSummary {
  share: PlayedShare;
  ranks: { targetShare: { rank: number; of: number } | null; snapShare: { rank: number; of: number } | null };
  /** Ranked among players at his position with at least this many games. */
  minGames: number;
}

export function usageShareSummary(
  season: number,
  player: { id?: string | null; slug?: string | null; position?: string | null },
): UsageShareSummary | null {
  const share = playedShare(season, player);
  if (!share || !player.position) return null;
  return {
    share,
    ranks: {
      targetShare: playedShareRank(season, player.position, player, "targetShare"),
      snapShare: playedShareRank(season, player.position, player, "snapShare"),
    },
    minGames: SHARE_RANK_MIN_GAMES,
  };
}

/**
 * Team Pages Phase 4 (2026-11-20, mak: "yes"): the same definition for ONE
 * club, which is how the team hub reports a traded player (his games for this
 * club only). Same games-played rule and rounding as playedShare(); also the
 * carry share over the same games (his carries / the club's carries), which
 * the hub's running-back rows need. Append-only; the rest of this file is the
 * player pages' (phase2-player-redesign @8a86ce4).
 */
export interface PlayedShareAt extends PlayedShare {
  teamCarries: number;
  /** Percent, one decimal; null without a team carry in his games. */
  carryShare: number | null;
}

export function playedShareAt(
  season: number,
  player: { id?: string | null; slug?: string | null },
  club: string,
): PlayedShareAt | null {
  const doc = getUsageDoc(season) as Doc | null;
  if (!doc?.teams) return null;
  const rows = rowsFor(
    doc,
    (r) => (player.id ? r.sleeperId === player.id : false) || (player.slug ? r.slug === player.slug : false),
  ).filter((x) => x.club === club);
  const base = rows.length ? sumRows(doc, rows) : null;
  if (!base) return null;
  let carries = 0;
  let teamCarries = 0;
  for (const { row } of rows) {
    for (const w of (row.weekly ?? []) as Array<WeeklyRow & { car?: number | null; teamCar?: number | null }>) {
      if (w.tgt === null && w.snapN === null) continue;
      carries += w.car ?? 0;
      teamCarries += w.teamCar ?? 0;
    }
  }
  return { ...base, teamCarries, carryShare: teamCarries > 0 ? round((carries / teamCarries) * 100, 1) : null };
}

/**
 * Target-share fix B (mak, 2026-11-20: "Overview, Stats and Outlook use ONE
 * definition"): a player's season as ONE usage row, every club summed, for
 * the Outlook tab's tiles, read, drivers and ranks. Append-only, like the
 * block above.
 *
 *   - targetShare and snapShare are playedShare()'s: his count over his
 *     clubs' count in the games he played. snapShare keeps one decimal here
 *     (the Stats card's precision) so ranks do not tie on a whole percent;
 *     the Outlook tile still prints it whole.
 *   - counts (targets, carries, dropbacks, wopp, ...) are summed over his
 *     clubs, and games is his games played at every club;
 *   - per-game and rate fields the report keeps only per club (xFP, FPOE,
 *     first-read share, air-yards share, the backfield shares, the QB rates)
 *     are averaged over his clubs weighted by his games at each, so a traded
 *     player is never read off his one-game new-club row;
 *   - weekly is his games at every club in week order, for the trends;
 *   - qualified is the report's own rule (buildUsage.mjs qualifies) applied
 *     to the summed counts against the season's club games to date.
 */
export interface PlayedSeasonRow {
  key: string;
  row: UsagePlayer;
  share: PlayedShare;
  qualified: boolean;
}

const WEIGHTED = [
  "xfpPerGame",
  "fpoePerGame",
  "fpPerGame",
  "firstReadShare",
  "airYardsShare",
  "wopr",
  "touchShare",
  "woppShare",
  "rzOppShare",
  "designedRunRate",
  "scrambleRate",
  "sackRate",
  "passAdot",
  "yacPerAtt",
] as const;
const SUMMED = [
  "targets",
  "receptions",
  "recYards",
  "carries",
  "kneels",
  "kneelYards",
  "passAttempts",
  "snaps",
  "ezTargets",
  "deepTargets",
  "rzTouches",
  "rushYards",
  "gzCarries",
  "wopp",
  "hvt",
  "dropbacks",
] as const;

function mergeRows(doc: Doc, key: string, rows: Array<{ club: string; row: Row }>, share: PlayedShare): PlayedSeasonRow {
  // The row he is on now (his last club) carries the fields that are not
  // season figures (ids, name, the report's percentiles).
  const lastClub = share.clubs[share.clubs.length - 1]?.club;
  const base = (rows.find((r) => r.club === lastClub) ?? rows[rows.length - 1]!).row;
  const merged: Record<string, unknown> = { ...base };
  for (const k of SUMMED) {
    const vals = rows.map((r) => (r.row as unknown as Record<string, unknown>)[k]).filter((v): v is number => typeof v === "number");
    if (vals.length) merged[k] = vals.reduce((s, v) => s + v, 0);
  }
  for (const k of WEIGHTED) {
    let sum = 0;
    let weight = 0;
    for (const { row } of rows) {
      const v = (row as unknown as Record<string, unknown>)[k];
      if (typeof v !== "number" || !Number.isFinite(v) || !row.games) continue;
      sum += v * row.games;
      weight += row.games;
    }
    if (rows.length > 1) merged[k] = weight ? round(sum / weight, 1) : null;
  }
  merged.games = share.games;
  merged.targetShare = share.targetShare;
  merged.snapShare = share.teamSnaps > 0 ? round((share.snaps / share.teamSnaps) * 100, 1) : null;
  merged.woppPerGame = share.games ? round(((merged.wopp as number) ?? 0) / share.games, 1) : null;
  merged.adot = share.adot;
  // His games at every club, one entry a week: the played one where a week
  // appears on two clubs' rows (the club he was not with that week is null).
  const byWeek = new Map<number, UsagePlayer["weekly"][number]>();
  for (const { row } of rows) {
    for (const w of row.weekly ?? []) {
      const had = byWeek.get(w.week);
      const plays = w.ts != null || w.snap != null || w.snapN != null;
      if (!had || plays) byWeek.set(w.week, w);
    }
  }
  merged.weekly = [...byWeek.values()].sort((a, b) => a.week - b.week);
  const row = merged as unknown as UsagePlayer;
  const g = Math.max(1, ...rows.map((r) => doc.teams[r.club]?.games?.length ?? 0));
  const qualified =
    row.pos === "QB" ? row.dropbacks >= 12 * g : row.pos === "RB" ? row.wopp >= 5 * g : row.targets >= 1.5 * g;
  return { key, row: { ...row, qualified }, share, qualified };
}

const seasonRowCache = new Map<string, PlayedSeasonRow[]>();

/** Every player's season row at a position (all positions with pos null), one per player. */
export function playedSeasonRows(season: number, pos: string | null = null): PlayedSeasonRow[] {
  const doc = getUsageDoc(season) as (Doc & { teams: Record<string, { games?: number[] }> }) | null;
  if (!doc?.teams) return [];
  const cacheKey = `${season}|${pos ?? "*"}|${doc.builtAt ?? ""}`;
  const hit = seasonRowCache.get(cacheKey);
  if (hit) return hit;
  const byPlayer = new Map<string, Array<{ club: string; row: Row }>>();
  for (const x of rowsFor(doc, (r) => pos === null || r.pos === pos)) {
    const key = x.row.sleeperId ?? x.row.id;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), x]);
  }
  const out: PlayedSeasonRow[] = [];
  for (const [key, rows] of byPlayer) {
    const share = sumRows(doc, rows);
    if (share) out.push(mergeRows(doc, key, rows, share));
  }
  seasonRowCache.set(cacheKey, out);
  return out;
}

/** One player's season row, by Sleeper id (or slug), or null. */
export function playedSeasonRow(
  season: number,
  player: { id?: string | null; slug?: string | null; position?: string | null },
): PlayedSeasonRow | null {
  const rows = playedSeasonRows(season, null);
  return (
    rows.find((r) => player.id != null && r.row.sleeperId === player.id) ??
    rows.find((r) => player.slug != null && r.row.slug === player.slug) ??
    null
  );
}
