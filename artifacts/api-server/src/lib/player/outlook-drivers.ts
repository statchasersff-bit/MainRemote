/**
 * The four things driving a player's outlook, measured rather than written.
 *
 * The Outlook tab's decision layer is authored — a rest-of-season rank, a floor,
 * a buy/hold call are judgements, and they live in fantasy_outlook_2026.json.
 * This strip is the opposite: four numbers off the player's own advanced line,
 * each read against the distribution every other player at that position
 * produced in the same season. Nobody has to rewrite it for it to stay true.
 *
 * **The categories adapt by position, and that is the point.** A running back's
 * outlook turns on touches, pass-game work and goal-line carries; a receiver's
 * turns on how often he is on the field, how often the ball comes his way, and
 * how much of his team's downfield volume he owns. Four identical cards on
 * every player is the shape a page takes when nobody decided what the position
 * actually depends on, and this is that decision written down:
 *
 *   QB   Role · Passing Volume · Rushing · Efficiency
 *   RB   Role · Touches · Receiving · Goal-Line
 *   WR   Routes · Targets · Air Yards · Competition
 *   TE   Routes · Targets · Red Zone · Role Security
 *
 * One substitution from the obvious set is worth naming. The natural fourth QB
 * card is "Environment" — how good the offence around him is — and this server
 * has no measure of that which is about the quarterback rather than about his
 * team. Efficiency (EPA per play, against the position) is a real number about
 * the player, so that is the card. A card the data cannot fill is not rendered
 * as a shrug; it is replaced by one the data can.
 *
 * Two honesty rules, both borrowed from lib/player/benchmarks.ts:
 *
 *   - A **games threshold** decides who is in the distribution. Without one, a
 *     back with four carries for 60 yards is the most efficient runner in
 *     football, which is true and useless.
 *   - The same threshold decides whether the PLAYER is ranked. Below it the
 *     measurement still renders — it is his real number — but the tier word and
 *     the "8th of 192" line are withheld rather than computed from a sample too
 *     small to carry them. `ranked` says which case the reader is looking at.
 *
 * The line these read is last season's, because that is what an advanced table
 * can contain in the spring. The renderer stamps the season on the section so
 * the strip is never mistaken for a measurement of a year nobody has played.
 */

import { loadFantasyOutlook2026 } from "./data";
import { percentileOf } from "./metrics";
import type { FantasyOutlook2026, OutlookKeyStats, Player } from "./types";

/** Below this many games a player is neither in the distribution nor ranked. */
const MIN_GAMES = 6;

export interface OutlookDriver {
  /** "Passing Volume". */
  label: string;
  /** The tier word — "Heavy" — or the bare number when the player is unranked. */
  value: string;
  /** "35.4 pass attempts per game". Always the real measurement. */
  detail: string;
  /** "6th of 64 QBs", or why there is no rank. */
  context: string;
  /** Drives the accent only. "" when the player is unranked. */
  level: "high" | "mid" | "low" | "";
  ranked: boolean;
}

type Words = [string, string, string, string];

interface DriverSpec {
  label: string;
  /** The metric, per game or as a season total. Null when it cannot be read. */
  read: (stats: OutlookKeyStats, games: number) => number | null;
  /** How the number reads on the card, without the unit. */
  format: (value: number) => string;
  /** " pass attempts per game" — appended to the formatted number. */
  unit: string;
  /**
   * Tier words from the BEST end of the distribution to the worst.
   *
   * Written so that words[0] always describes the top quartile of the metric,
   * whatever that means for the card. Competition is the one where those come
   * apart: the top quartile of target share is the LEAST contested situation, so
   * its words run "Low" to "Crowded" rather than the other way round.
   */
  words: Words;
}

/* ------------------------------------------------------------- the metrics */

const perGame =
  (key: string) =>
  (stats: OutlookKeyStats, games: number): number | null => {
    const value = num(stats[key]);
    return value === null || games <= 0 ? null : value / games;
  };

const total =
  (key: string) =>
  (stats: OutlookKeyStats): number | null =>
    num(stats[key]);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const one = (value: number): string => value.toFixed(1);
const whole = (value: number): string => String(Math.round(value));
const pct = (value: number): string => `${value.toFixed(1)}%`;
/*
 * EPA runs small. Two decimals turns a real 0.004 into "0.00", which reads as
 * "we did not measure this" rather than as "replacement level", so the near-zero
 * range keeps a third place and the rest does not carry a pointless one.
 */
const epa = (value: number): string =>
  Math.abs(value) < 0.1 ? value.toFixed(3) : value.toFixed(2);

const SPECS: Record<string, DriverSpec[]> = {
  QB: [
    {
      label: "Passing Volume",
      read: perGame("attempts"),
      format: one,
      unit: " pass attempts per game",
      words: ["Heavy", "Strong", "Moderate", "Light"],
    },
    {
      label: "Rushing",
      read: perGame("rushYards"),
      format: one,
      unit: " rush yards per game",
      words: ["Major", "Real", "Limited", "Minimal"],
    },
    {
      label: "Efficiency",
      read: total("epaPerPlay"),
      format: epa,
      unit: " EPA per play",
      words: ["Strong", "Solid", "Average", "Below Average"],
    },
  ],
  RB: [
    {
      label: "Touches",
      read: (stats, games) => {
        const rush = num(stats.rushAttempts);
        const rec = num(stats.receptions);
        if (rush === null && rec === null) return null;
        return games > 0 ? ((rush ?? 0) + (rec ?? 0)) / games : null;
      },
      format: one,
      unit: " touches per game",
      words: ["Heavy", "Strong", "Moderate", "Light"],
    },
    {
      label: "Receiving",
      read: perGame("targets"),
      format: one,
      unit: " targets per game",
      words: ["Featured", "Involved", "Occasional", "Minimal"],
    },
    {
      label: "Goal-Line",
      read: total("goalLineCarries"),
      format: whole,
      unit: " goal-line carries",
      words: ["Primary", "Shared", "Minimal", "Rare"],
    },
  ],
  WR: [
    {
      label: "Targets",
      read: perGame("targets"),
      format: one,
      unit: " targets per game",
      words: ["Featured", "Strong", "Moderate", "Light"],
    },
    {
      label: "Air Yards",
      read: total("airYardsSharePct"),
      format: pct,
      unit: " of the team's air yards",
      words: ["Downfield", "Real", "Modest", "Minimal"],
    },
    {
      label: "Competition",
      read: total("targetSharePct"),
      format: pct,
      unit: " of the team's targets",
      words: ["Low", "Moderate", "High", "Crowded"],
    },
  ],
  TE: [
    {
      label: "Targets",
      read: perGame("targets"),
      format: one,
      unit: " targets per game",
      words: ["Featured", "Strong", "Moderate", "Light"],
    },
    {
      label: "Red Zone",
      read: total("redZoneTargets"),
      format: whole,
      unit: " red-zone targets",
      words: ["Frequent", "Regular", "Occasional", "Rare"],
    },
    {
      label: "Role Security",
      read: total("snapPct"),
      format: pct,
      unit: " of the team's snaps",
      words: ["Locked In", "Secure", "Contested", "At Risk"],
    },
  ],
};

/** The second card for WR and TE, whose first question is how often they play. */
const ROUTES: DriverSpec = {
  label: "Routes",
  read: total("routePct"),
  format: pct,
  unit: " of the team's routes run",
  words: ["Every Down", "Full-Time", "Rotational", "Situational"],
};

/* --------------------------------------------------------- distributions */

interface Distribution {
  /** Ascending, for the percentile lookup. */
  values: number[];
  /** Descending, for the "6th of 64" rank. */
  ranked: number[];
}

const cache = new Map<string, Distribution>();

/**
 * Everyone at this position who cleared the games threshold, on one metric.
 *
 * Built from the outlook file rather than the advanced tables because that file
 * is already the one carrying each player's line, keyed the way this page reads
 * it. Cached per position and metric: it is the same 400-odd rows for every
 * player page the server renders.
 */
function distribution(position: string, label: string, spec: DriverSpec): Distribution {
  const key = `${position}:${label}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const values: number[] = [];
  for (const record of Object.values(loadFantasyOutlook2026())) {
    if (record.position !== position) continue;
    const stats = record.keyStats;
    if (!stats) continue;
    const games = num(stats.games) ?? 0;
    if (games < MIN_GAMES) continue;
    const value = spec.read(stats, games);
    if (value !== null) values.push(value);
  }

  const built: Distribution = {
    values: values.slice().sort((a, b) => a - b),
    ranked: values.slice().sort((a, b) => b - a),
  };
  cache.set(key, built);
  return built;
}

/** Cleared between test runs, and whenever the data files are reloaded. */
export function resetDriverCache(): void {
  cache.clear();
}

/* ---------------------------------------------------------------- assembly */

/**
 * The player's role, which is the one card that is not a rate.
 *
 * Read off the depth chart rather than off last season, because it is the only
 * card here that should describe 2026: a back who changed teams in March has a
 * new role and an unchanged stat line. The snap share underneath it is last
 * season's and is labelled as the supporting number, not as the claim.
 */
function roleDriver(
  player: Player,
  stats: OutlookKeyStats | null,
  seasonLabel: string,
): OutlookDriver | null {
  const order = player.depth_chart_order;
  const position = player.position ?? "";
  const snaps = stats ? num(stats.snapPct) : null;

  const words: Record<string, string[]> = {
    QB: ["Starter", "Backup", "Depth"],
    RB: ["Lead Back", "Committee", "Depth"],
    WR: ["WR1", "WR2", "WR3", "Depth"],
    TE: ["Starter", "TE2", "Depth"],
  };
  const ladder = words[position];

  if (!ladder || order === null || order === undefined || order < 1) {
    // No depth chart to read. The snap share alone still answers the question
    // the card asks, so it becomes the card rather than leaving a hole.
    if (snaps === null) return null;
    return {
      label: "Role",
      value: snaps >= 70 ? "Full-Time" : snaps >= 45 ? "Rotational" : "Situational",
      detail: `${pct(snaps)} of the team's snaps`,
      context: seasonLabel,
      level: snaps >= 70 ? "high" : snaps >= 45 ? "mid" : "low",
      ranked: false,
    };
  }

  const value = ladder[Math.min(order, ladder.length) - 1] ?? ladder[ladder.length - 1];
  return {
    label: "Role",
    value,
    detail: `${position}${order} on the depth chart`,
    context: snaps === null ? "" : `${pct(snaps)} of snaps in ${seasonLabel}`,
    level: order === 1 ? "high" : order === 2 ? "mid" : "low",
    ranked: false,
  };
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function measuredDriver(
  spec: DriverSpec,
  position: string,
  stats: OutlookKeyStats,
  games: number,
): OutlookDriver | null {
  const value = spec.read(stats, games);
  if (value === null) return null;

  const detail = `${spec.format(value)}${spec.unit}`;

  if (games < MIN_GAMES) {
    return {
      label: spec.label,
      value: spec.format(value),
      detail: spec.unit.replace(/^ /, ""),
      context: `${games} ${games === 1 ? "game" : "games"} — too few to rank`,
      level: "",
      ranked: false,
    };
  }

  const dist = distribution(position, spec.label, spec);
  const percentile = percentileOf(dist.values, value);
  if (percentile === null) {
    return {
      label: spec.label,
      value: spec.format(value),
      detail: spec.unit.replace(/^ /, ""),
      context: "",
      level: "",
      ranked: false,
    };
  }

  const rank = dist.ranked.findIndex((v) => v <= value) + 1;
  const tier =
    percentile >= 75 ? 0 : percentile >= 50 ? 1 : percentile >= 25 ? 2 : 3;

  return {
    label: spec.label,
    value: spec.words[tier],
    detail,
    context: rank > 0 ? `${ordinal(rank)} of ${dist.ranked.length} ${position}s` : "",
    level: tier === 0 ? "high" : tier === 1 ? "mid" : "low",
    ranked: true,
  };
}

/**
 * The four cards, or fewer.
 *
 * A card whose metric is missing from this player's line is dropped rather than
 * dashed out — the same rule the rest of the page follows. An outlook with no
 * advanced line behind it produces the role card alone, or nothing.
 */
export function outlookDrivers(
  player: Player,
  outlook: FantasyOutlook2026 | null,
): OutlookDriver[] {
  const position = player.position ?? "";
  const specs = SPECS[position];
  if (!specs) return [];

  const stats = outlook?.keyStats ?? null;
  const games = stats ? (num(stats.games) ?? 0) : 0;
  const season = stats ? num(stats.season) : null;
  const seasonLabel = season === null ? "last season" : String(season);

  const drivers: OutlookDriver[] = [];

  // What leads differs by position, and it is the first thing the set gets
  // right. A quarterback's and a back's outlook starts with whether they have
  // the job; a receiver's and a tight end's starts with how often they are on
  // the field for a passing down, which is the question BEFORE "how many
  // targets" — a full route share on six targets a game is a different player
  // from a half share on the same six.
  const leadWithRoutes = position === "WR" || position === "TE";
  const routes =
    leadWithRoutes && stats ? measuredDriver(ROUTES, position, stats, games) : null;

  if (routes) drivers.push(routes);
  else {
    // Either a QB/RB, or a receiver whose line carries no route share. The
    // depth chart answers the same question a rung coarser.
    const role = roleDriver(player, stats, seasonLabel);
    if (role) drivers.push(role);
  }

  if (stats) {
    for (const spec of specs) {
      const driver = measuredDriver(spec, position, stats, games);
      if (driver) drivers.push(driver);
    }
  }

  return drivers.slice(0, 4);
}

/** The season the strip was measured from, for the section's stamp. */
export function driverSeason(outlook: FantasyOutlook2026 | null): number | null {
  const value = outlook?.keyStats?.season;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
