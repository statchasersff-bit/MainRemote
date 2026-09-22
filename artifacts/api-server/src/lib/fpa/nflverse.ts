/**
 * The nflverse data source for Fantasy Points Allowed.
 *
 * Fetches the weekly player-stats CSV nflverse publishes per season and scores
 * every player-row in Standard, Half-PPR and PPR.
 *
 * The CSV already ships `fantasy_points` (standard) and `fantasy_points_ppr`,
 * and this computes all three formats from the raw stat columns anyway. That is
 * deliberate on two counts: Half-PPR is not published at all, and a scoring
 * rule written out here is one a reader can check against the page, whereas a
 * column taken on trust is not. `scoreRow` is pure, so the test suite checks
 * the formula against upstream's own two columns directly.
 *
 * Ported from the standalone FPA app. The one change: its own 37-entry table of
 * team names is gone, because `lib/team/teams.ts` is the only thing in this
 * codebase allowed to carry a team mapping — and it already resolves every
 * alias nflverse emits (LA, OAK, SD, STL, WSH).
 */

import { logger } from "../logger";

export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type FantasyPosition = (typeof FANTASY_POSITIONS)[number];

export type ScoringFormat = "standard" | "half" | "ppr";
export const SCORING_FORMATS: ScoringFormat[] = ["standard", "half", "ppr"];

const FANTASY_POSITION_SET = new Set<string>(FANTASY_POSITIONS);

/**
 * nflverse has published the weekly stats under two release tags over time.
 * The current one is `stats_player`; `player_stats` is the legacy tag. Both are
 * tried in order, because a release being renamed upstream should degrade to
 * one extra 404 rather than to an empty page.
 */
export const NFLVERSE_RELEASE_TAGS = ["stats_player", "player_stats"] as const;
export type NflverseReleaseTag = (typeof NFLVERSE_RELEASE_TAGS)[number];

export const NFLVERSE_RELEASES =
  "https://github.com/nflverse/nflverse-data/releases/download";

/**
 * Where the releases are read from.
 *
 * `NFLVERSE_BASE_URL` overrides it, for the two situations that come up with
 * every ingest in this app: an egress that upstream refuses (the news feed's
 * whole story — see docs/INGEST-FIX-CHECKLIST.md), which a mirror answers, and
 * a test that needs the ingest to run without fetching 14MB from GitHub.
 * Unset — the normal case — it is nflverse itself.
 */
export function nflverseBaseUrl(): string {
  const override = (process.env["NFLVERSE_BASE_URL"] ?? "").trim();
  return (override || NFLVERSE_RELEASES).replace(/\/+$/, "");
}

export function nflverseWeeklyUrl(
  season: number,
  releaseTag: NflverseReleaseTag,
): string {
  return `${nflverseBaseUrl()}/${releaseTag}/stats_player_week_${season}.csv`;
}

export function nflverseWeeklyUrlCandidates(
  season: number,
): { tag: NflverseReleaseTag; url: string }[] {
  return NFLVERSE_RELEASE_TAGS.map((tag) => ({
    tag,
    url: nflverseWeeklyUrl(season, tag),
  }));
}

/* ------------------------------------------------------------------- CSV */

/**
 * RFC-4180 CSV: quoted fields, escaped quotes, CRLF.
 *
 * Hand-written rather than a dependency because it is thirty lines and the
 * input is one well-formed file from one publisher. A split on commas would be
 * wrong the first time a player's name contains one.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // The file may not end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function num(value: string | undefined): number {
  if (value === undefined || value === "" || value === "NA") return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

/* --------------------------------------------------------------- scoring */

/**
 * Standard scoring:
 *   passing 0.04/yd, 4/TD, -1/INT
 *   rushing 0.1/yd, 6/TD
 *   receiving 0.1/yd, 6/TD
 *   two-point conversions 2 each
 *   fumbles lost -2 each
 *   special-teams TD 6
 *
 * Half-PPR adds 0.5 a reception, PPR adds 1.
 */
const RECEPTION_POINTS: Record<ScoringFormat, number> = {
  standard: 0,
  half: 0.5,
  ppr: 1,
};

export interface ScoredPlayerWeek {
  season: number;
  week: number;
  seasonType: string;
  position: FantasyPosition;
  /** The offense the player belongs to. */
  team: string;
  /** `opponent_team` — the defense that allowed these points. */
  defenseTeam: string;
  receptions: number;
  points: Record<ScoringFormat, number>;
}

/** Score one raw stat row in all three formats. Pure. */
export function scoreRow(get: (col: string) => string | undefined): {
  receptions: number;
  points: Record<ScoringFormat, number>;
} {
  const g = (c: string) => num(get(c));

  const base =
    g("passing_yards") * 0.04 +
    g("passing_tds") * 4 +
    g("passing_interceptions") * -1 +
    (g("sack_fumbles_lost") +
      g("rushing_fumbles_lost") +
      g("receiving_fumbles_lost")) *
      -2 +
    g("rushing_yards") * 0.1 +
    g("rushing_tds") * 6 +
    g("receiving_yards") * 0.1 +
    g("receiving_tds") * 6 +
    (g("passing_2pt_conversions") +
      g("rushing_2pt_conversions") +
      g("receiving_2pt_conversions")) *
      2 +
    g("special_teams_tds") * 6;

  const receptions = g("receptions");

  return {
    receptions,
    points: {
      standard: base + receptions * RECEPTION_POINTS.standard,
      half: base + receptions * RECEPTION_POINTS.half,
      ppr: base + receptions * RECEPTION_POINTS.ppr,
    },
  };
}

/* ----------------------------------------------------------------- fetch */

export class NflverseSeasonUnavailableError extends Error {
  constructor(public season: number) {
    super(`nflverse weekly stats not available for season ${season}`);
    this.name = "NflverseSeasonUnavailableError";
  }
}

/**
 * Fetch and score one season's weekly player stats.
 *
 * Throws `NflverseSeasonUnavailableError` when every candidate URL 404s, which
 * is the normal state of a season that has not started. The ingest treats that
 * as "preseason", not as a failure — see fpa/ingest.ts.
 */
export async function fetchScoredWeeklyStats(
  season: number,
  opts: { seasonType?: string | null } = {},
): Promise<ScoredPlayerWeek[]> {
  const seasonType = opts.seasonType === undefined ? "REG" : opts.seasonType;

  let text: string | null = null;
  const candidates = nflverseWeeklyUrlCandidates(season);

  for (const { tag, url } of candidates) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      logger.warn({ season, tag, err }, "nflverse request failed — trying next tag");
      continue;
    }
    if (!res.ok) {
      logger.warn(
        { season, tag, status: res.status },
        "nflverse release did not return OK — trying next tag",
      );
      continue;
    }
    text = await res.text();
    logger.info(
      { season, tag, bytes: text.length },
      "fetched nflverse weekly stats",
    );
    break;
  }

  if (text === null) throw new NflverseSeasonUnavailableError(season);

  const matrix = parseCsv(text);
  if (matrix.length < 2) {
    throw new Error(`nflverse weekly stats for ${season} were empty`);
  }

  const header = matrix[0]!;
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h, i));

  // Fail loudly on a shape change rather than silently scoring zeroes: a
  // renamed column would otherwise produce a full table of plausible-looking
  // numbers that are all wrong.
  for (const col of [
    "position",
    "season",
    "week",
    "season_type",
    "team",
    "opponent_team",
  ]) {
    if (!colIndex.has(col)) {
      throw new Error(`nflverse CSV for ${season} is missing column "${col}"`);
    }
  }

  const out: ScoredPlayerWeek[] = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const cells = matrix[r]!;
    if (cells.length !== header.length) continue; // malformed row

    const position = cells[colIndex.get("position")!]!;
    if (!FANTASY_POSITION_SET.has(position)) continue;

    const rowSeasonType = cells[colIndex.get("season_type")!]!;
    if (seasonType !== null && rowSeasonType !== seasonType) continue;

    const defenseTeam = cells[colIndex.get("opponent_team")!]!;
    if (!defenseTeam) continue;

    const get = (col: string): string | undefined => {
      const idx = colIndex.get(col);
      return idx === undefined ? undefined : cells[idx];
    };

    const { receptions, points } = scoreRow(get);

    out.push({
      season: num(cells[colIndex.get("season")!]),
      week: num(cells[colIndex.get("week")!]),
      seasonType: rowSeasonType,
      position: position as FantasyPosition,
      team: cells[colIndex.get("team")!]!,
      defenseTeam,
      receptions,
      points,
    });
  }

  logger.info({ season, rows: out.length }, "scored nflverse weekly stats");
  return out;
}
