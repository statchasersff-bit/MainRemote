/**
 * The RB handcuff board: its inputs, the engine run over them, and the domain
 * language the renderer reads.
 *
 * Ported from the standalone RB handcuffs app
 * (statchasersff-bit/Redraft-RB-Handcuff-Rankings), which is retired: this app
 * is now where the board is calculated. The engine in ./engine is that app's
 * server pipeline - Player Quality, Backfield Opportunity, Path to
 * Opportunity, the badges, the reasons - as pure functions. Its inputs are
 * files under `data/rb-handcuffs/`:
 *
 *   - `rb_advanced_stats_2025.json`, `rb_injuries.json` - the 2025 season and
 *     the injury history every pillar is scored from. The app's own copies.
 *   - `depth.json` - this week's depth charts (Ourlads) and each back's current
 *     age and injury status (Sleeper). Written by
 *     `scripts/rb-handcuffs/refresh.mjs`; the one file that goes stale.
 *   - `curation.json` - the hand-kept part: team ratings, per-player ratings,
 *     scouting notes and manual overrides.
 *
 * The board is computed on first use and again whenever one of those files
 * changes, so refreshing is: run the script, commit depth.json, deploy.
 *
 * Two things that were client work there are server work here:
 *
 *   - **player links** resolve by name through this app's player dictionary to
 *     its own player pages. The standalone app built `statchasers.com/nfl/
 *     players/<slug>/` from the display name and then switched the links off,
 *     because that path answered 200 for any slug. These pages exist, and a
 *     player without one keeps his name and loses the link;
 *   - **headshots** come from the Sleeper id the refresh records, rather than
 *     from the 749-line name → id table the app bundled.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { logger } from "../logger";
import { getPlayerSlugByName, loadPlayers } from "../player/data";
import { buildBoard, type Curation, type CurrentInfo, type EnginePlayer, type Pairing } from "./engine/build";
import { canonicalTeam, lastGames, mergeStats, normalizeName, parseInjuries, TALENT_GAMES, type GameLog } from "./engine/stats";
import { searchKey } from "../render";
import {
  DEFAULT_WEIGHTS,
  rankOrder,
  recomputeScores,
  type HandcuffWeights,
  type RecomputeInput,
} from "./recompute";

export type { ComponentRank } from "./engine/types";

export {
  barBand,
  handcuffType,
  HANDCUFF_TYPES,
  offenseLabel,
  starterLoadLabel,
  tierFor,
  type HandcuffType,
  type TierInfo,
} from "./model";

/**
 * The stats basis is the newest `rb_stats_<season>.json` (built from nflverse
 * by scripts/rb-handcuffs/buildStats.mjs); the season before it is the
 * statchasers-data file the model was built on. Both are always read: the
 * basis scores the pillars, and the previous season is "games played last
 * year" in the starter's durability. Player Quality reads neither: it reads
 * the two seasons' game logs (`rb_games_<season>.json`, same script).
 */
const BASIS_SEASON = 2026;

const FILES = {
  stats: dataPath("rb-handcuffs", `rb_stats_${BASIS_SEASON}.json`),
  previous: dataPath("rb-handcuffs", "rb_advanced_stats_2025.json"),
  // Game by game, both seasons, for Player Quality's last six games.
  games: dataPath("rb-handcuffs", `rb_games_${BASIS_SEASON}.json`),
  previousGames: dataPath("rb-handcuffs", `rb_games_${BASIS_SEASON - 1}.json`),
  injuries: dataPath("rb-handcuffs", "rb_injuries.json"),
  depth: dataPath("rb-handcuffs", "depth.json"),
  curation: dataPath("rb-handcuffs", "curation.json"),
} as const;

/**
 * How long an injury status counts. The engine folds a starter's status into
 * his durability risk only while it is fresh, as the model always intended; a
 * week-old "Questionable" says nothing about this Sunday. Past this the board
 * scores on history alone and says so on the updated line.
 */
const STATUS_FRESH_MS = 8 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------- shape */

type RawPlayer = EnginePlayer;

/** One backup, as the renderer reads him. */
export interface HandcuffPlayer extends RawPlayer {
  /** Path to Opportunity, preferring the named field over its alias. */
  pathScore: number | null;
  /** This app's player page, when he has one. */
  slug: string | null;
  /** His Sleeper id, for the headshot, when the dictionary knows him. */
  sleeperId: string | null;
  /** The starter's page, when he has one. */
  starterSlug: string | null;
}

export interface HandcuffBoard {
  /** When the depth charts and statuses were last refreshed. */
  updatedAt: string | null;
  /** The NFL season the board is for. */
  season: number;
  /** Whether the injury statuses are recent enough to have counted. */
  statusFresh: boolean;
  /** The season the pillars are scored on, and the last week in it. */
  statsSeason: number;
  statsWeek: number | null;
  /** In rank order at the default weights. */
  players: HandcuffPlayer[];
  /** Changes when the file does - the fragment's ETag. */
  version: string;
}

/* ------------------------------------------------------------- the model */

export interface Pillar {
  key: keyof Omit<HandcuffWeights, "costWeight">;
  /** The slider's category word. */
  category: string;
  title: string;
  /** The slider's one-liner. */
  description: string;
  /** The reference card's one-liner. */
  tagline: string;
  chips: string[];
  intro: string;
  factors: Array<{ name: string; desc: string }>;
  closingNote?: string;
  /** The CSS hook for its accent color. */
  accent: "blue" | "teal" | "gold";
}

/**
 * The three pillars, in slider order. Every string is advanced-settings.tsx's:
 * WEIGHT_FIELDS for the slider copy, PILLARS for the reference cards.
 */
export const PILLARS: Pillar[] = [
  {
    key: "contingentUpsideWeight",
    category: "Offense",
    title: "Backfield Opportunity",
    description: "Total RB opportunity created by the offense.",
    tagline: "How much total RB opportunity the offense creates.",
    chips: ["Carries", "Targets", "Red Zone"],
    intro:
      "Measures the size of the RB opportunity pie in the offense. Each metric combines the starter + backup value and ranks that backfield against the league.",
    factors: [
      { name: "Carries", desc: "Rush attempts per game" },
      { name: "Snaps", desc: "Snap involvement" },
      { name: "Targets", desc: "Targets per game" },
      { name: "Red Zone", desc: "Red-zone opportunities per game" },
      { name: "Goal Line", desc: "Goal-line carries per game" },
      { name: "Routes", desc: "Routes per game" },
    ],
    closingNote:
      "Does not include backup talent, starter durability risk, or individual path to touches.",
    accent: "blue",
  },
  {
    key: "pathToWorkloadWeight",
    category: "Access",
    title: "Path to Opportunity",
    description: "How likely the backup is to gain a bigger role.",
    tagline: "How likely the backup is to gain a bigger role.",
    chips: ["Durability", "Usage", "Age"],
    intro: "Measures how likely the backup is to gain meaningful touches.",
    factors: [
      {
        name: "Starter Durability History",
        desc: "Missed-game rate: this season so far 20%, last season 60%, career before that 20%, plus current status when fresh.",
      },
      {
        name: "Backup Usage Ratio",
        desc: "How much of the two-back workload the backup already controls, ranked against the other backups.",
      },
      {
        name: "Starter Workload Stress",
        desc: "The starter's touches per game, ranked against the other starters.",
      },
      {
        name: "Starter Age Risk",
        desc: "RB-specific age curve where older starters carry more opportunity risk.",
      },
      {
        name: "Starter Quality Vulnerability",
        desc: "Inverted starter Player Quality. Weaker starters are easier to unseat.",
      },
    ],
    accent: "teal",
  },
  {
    key: "playerQualityWeight",
    category: "Talent",
    title: "Player Quality",
    description: "The backup as a player: yards per carry and per catch, contact, and explosiveness.",
    tagline: "How good the backup is independent of role.",
    chips: ["Yards per Carry", "Yards per Reception", "Explosiveness"],
    intro:
      "Per-touch efficiency and big-play ability over the backup's last six games (week 18 excluded), ranked against qualified running backs the way the advanced stats table ranks them. A back with little opportunity is scored toward below average until his touches build up (40 carries, 10 catches).",
    factors: [
      { name: "Yards per Carry (30%)", desc: "Rushing yards per carry." },
      {
        name: "Yards per Reception (30%)",
        desc: "Receiving yards per catch.",
      },
      {
        name: "Contact & Ball Security (20%)",
        desc: "Yards after contact per attempt (10%), elude % (5%), and fumbles per carry, lower is better (5%).",
      },
      {
        name: "Explosiveness (20%)",
        desc: "The advanced stats table's Explosiveness grade: explosive-run rate, breakaway-run rate, 10+/20+/30+ yard runs, longest rush, and longest rushing TD.",
      },
    ],
    accent: "gold",
  },
];

export const METHODOLOGY_NOTE =
  "Scores are relative to the season's pool. A 90 means the player or backfield ranks near the top of the qualified pool, not that it is a 90/100 absolute grade.";

/* --------------------------------------------------------------- the season */

/**
 * The NFL season a snapshot describes: its year, less one in January and
 * February, which still belong to the season that started the autumn before.
 * MIRRORS statchasers_hc_season_year() in the standalone plugin.
 */
export function seasonOf(iso: string | null, now: Date = new Date()): number {
  const date = iso ? new Date(iso) : now;
  const valid = Number.isNaN(date.getTime()) ? now : date;
  const year = valid.getUTCFullYear();
  return valid.getUTCMonth() < 2 ? year - 1 : year;
}

/* ------------------------------------------------------------------- names */

/**
 * A name as the dictionary spells it. The snapshot keeps the suffixes its
 * sources used ("Aaron Jones SR.", "James Cook III"); the dictionary does not,
 * so a suffix is the difference between a link and none.
 */
function lookupName(name: string): string {
  return name.replace(/[\s,]+(jr|sr|ii|iii|iv|v)\.?$/i, "").trim();
}

let sleeperByName: Map<string, string | null> | null = null;

/**
 * Name → Sleeper id, for running backs. An ambiguous name maps to null rather
 * than to a guess: a wrong face is worse than initials.
 */
function sleeperIdFor(name: string): string | null {
  if (!sleeperByName) {
    sleeperByName = new Map();
    for (const player of loadPlayers()) {
      if (player.position !== "RB") continue;
      const key = searchKey(player.name);
      if (!key) continue;
      sleeperByName.set(key, sleeperByName.has(key) ? null : player.id);
    }
  }
  return sleeperByName.get(searchKey(lookupName(name))) ?? null;
}

function slugFor(name: string | null): string | null {
  if (!name) return null;
  return getPlayerSlugByName(lookupName(name)) ?? getPlayerSlugByName(name);
}

/* ------------------------------------------------------------------ loading */

interface DepthFile {
  generated_at?: string;
  teams?: Record<string, { rb1: string | null; rb2: string | null; rb3: string | null }>;
  players?: Record<string, { sleeperId?: string; age?: number | null; injuryStatus?: string | null }>;
}

let cache: { key: string; board: HandcuffBoard } | null = null;

/** Testing seam. */
export function invalidateHandcuffCache(): void {
  cache = null;
  sleeperByName = null;
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function recomputeInput(p: RawPlayer): RecomputeInput {
  return {
    contingentUpside: p.overallInputs.contingentUpside,
    pathToWorkload: p.overallInputs.pathToWorkload,
    playerQuality: p.overallInputs.playerQuality,
    cost: p.overallInputs.cost,
    pinned: p.overallInputs.playerQualityPinned,
    shownContingentUpside: p.contingentUpsideScore,
    shownPathToOpportunity: p.pathToOpportunityScore,
    shownPlayerQuality: p.playerQualityScore,
  };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/**
 * This week's pairings: each team's RB1 and, behind him, the handcuff - RB2 -
 * with any hand correction in curation.json laid over Ourlads.
 */
export function pairingsFrom(depth: DepthFile, curation: Curation): Pairing[] {
  const out: Pairing[] = [];
  for (const [team, chart] of Object.entries(depth.teams ?? {})) {
    const fixed = curation.depth?.[team];
    const starter = fixed?.rb1 ?? chart.rb1;
    const backup = fixed?.rb2 ?? chart.rb2;
    if (backup) out.push({ team, starter: starter ?? null, backup });
  }
  return out;
}

/**
 * The board, computed from the files, cached until one of them changes - or
 * until the statuses go stale, which changes the answer without a file
 * changing.
 *
 * Null when an input is missing or unreadable: an empty board is not a board.
 */
export function getHandcuffBoard(now: Date = new Date()): HandcuffBoard | null {
  let stamps: string;
  try {
    stamps = Object.values(FILES)
      .map((f) => {
        const st = fs.statSync(f);
        return `${Math.round(st.mtimeMs)}:${st.size}`;
      })
      .join("|");
  } catch {
    logger.warn("An RB handcuff input is missing from data/rb-handcuffs; the board will be empty");
    return null;
  }

  let depth: DepthFile;
  try {
    depth = readJson<DepthFile>(FILES.depth);
  } catch (err) {
    logger.error({ err }, "Could not read data/rb-handcuffs/depth.json");
    return null;
  }
  const generated = depth.generated_at ? new Date(depth.generated_at) : null;
  const statusFresh =
    generated != null && !Number.isNaN(generated.getTime()) && now.getTime() - generated.getTime() <= STATUS_FRESH_MS;

  const key = `${stamps}|${statusFresh}`;
  if (cache && cache.key === key) return cache.board;

  let board: HandcuffBoard | null;
  try {
    const curation = readJson<Curation>(FILES.curation);
    const basis = readJson<{ rows?: []; week?: number; team_games?: Record<string, number> }>(FILES.stats);
    const previousRows = readJson<{ rows?: [] }>(FILES.previous).rows ?? [];
    const stats = mergeStats(basis.rows ?? []);
    const previous = mergeStats(previousRows);
    // Role from this season; talent from each back's last six games, week 18
    // excluded, reaching back into last season (see engine/stats lastGames).
    const logs = [FILES.previousGames, FILES.games].map((f) => readJson<{ players?: GameLog[] }>(f).players ?? []);
    const talent = mergeStats(lastGames(logs), TALENT_GAMES / 17);
    const injuries = parseInjuries(readJson<[]>(FILES.injuries), BASIS_SEASON - 1);
    const teamGames = new Map<string, number>();
    for (const [t, g] of Object.entries(basis.team_games ?? {})) teamGames.set(canonicalTeam(t), g);
    const current = new Map<string, CurrentInfo>();
    for (const [name, info] of Object.entries(depth.players ?? {})) {
      current.set(normalizeName(name), { age: info.age ?? null, injuryStatus: info.injuryStatus ?? null });
    }

    const engine = buildBoard({
      stats,
      previous,
      talent,
      teamGames: (t) => teamGames.get(t) ?? basis.week ?? 17,
      injuries,
      pairings: pairingsFrom(depth, curation),
      current,
      statusFresh,
      curation,
    });
    if (engine.length === 0) return null;

    // Rescored through the module the bundle re-ranks with, so the table sent
    // and the table the bundle makes at the default weights cannot disagree.
    // The engine's order is the rank order, and the recompute is stable.
    const scores = recomputeScores(engine.map(recomputeInput), DEFAULT_WEIGHTS);
    const players = rankOrder(scores).map((index, i): HandcuffPlayer => {
      const p = engine[index]!;
      const sleeper = depth.players?.[normalizeName(p.playerName)]?.sleeperId ?? null;
      return {
        ...p,
        rank: i + 1,
        handcuffScore: scores[index]!,
        pathScore: p.pathToOpportunityScore ?? p.pathToWorkloadScore ?? null,
        slug: slugFor(p.playerName),
        sleeperId: sleeper ?? sleeperIdFor(p.playerName),
        starterSlug: slugFor(p.starterName),
      };
    });

    const updatedAt = generated && !Number.isNaN(generated.getTime()) ? generated.toISOString() : null;
    board = {
      updatedAt,
      season: seasonOf(updatedAt),
      statusFresh,
      statsSeason: BASIS_SEASON,
      statsWeek: typeof basis.week === "number" ? basis.week : null,
      players,
      version: hash(key),
    };
  } catch (err) {
    logger.error({ err }, "Could not build the RB handcuff board");
    return null;
  }

  cache = { key, board };
  return board;
}

export function getHandcuffPlayer(id: string): HandcuffPlayer | null {
  return getHandcuffBoard()?.players.find((p) => p.id === id) ?? null;
}

/* ------------------------------------------------- the card's own language */

/**
 * The labels the player card derives from a score. Each MIRRORS the function
 * of the same name in the standalone player-card-drawer.tsx.
 */

export function pqCategoryLabel(v: number): string {
  if (v >= 80) return "Elite";
  if (v >= 60) return "Above Average";
  if (v >= 40) return "Average";
  if (v >= 25) return "Below Average";
  return "Low";
}

/** Green boosts, amber is moderate, red is a concern. categoryTone(). */
export function toneOf(score: number | null | undefined): { key: string; band: string } {
  if (score == null) return { key: "none", band: "No data" };
  if (score >= 80) return { key: "good", band: "Elite" };
  if (score >= 65) return { key: "good", band: "Strong" };
  if (score >= 45) return { key: "warn", band: "Moderate" };
  if (score >= 30) return { key: "warn", band: "Below Avg" };
  return { key: "bad", band: "Concern" };
}

/**
 * The color for a displayed rank, by where it sits in its pool: top third
 * green, middle amber, bottom third red. The card shows ranks, not scores, and
 * the scores sit on different scales per metric (Durability is absolute,
 * Workload is percentiled), so coloring by score put a gold #4 beside a
 * green #10.
 */
export function rankTone(rank: number | null | undefined, poolSize: number | null | undefined): string {
  if (rank == null || !poolSize) return "none";
  const third = poolSize / 3;
  if (rank <= third) return "good";
  if (rank > poolSize - third) return "bad";
  return "warn";
}

/** A driver's score color. scoreToneText(), which has no "Elite" step. */
export function scoreTone(v: number | null | undefined): string {
  if (v == null) return "none";
  if (v >= 65) return "good";
  if (v >= 30) return "warn";
  return "bad";
}

export function statusBadges(p: HandcuffPlayer): Array<{ text: string; tone: "good" | "warn" | "bad" }> {
  const out: Array<{ text: string; tone: "good" | "warn" | "bad" }> = [];
  const path = p.pathScore;
  if (path != null && path >= 75) out.push({ text: "High Opportunity", tone: "good" });
  else if (path != null && path < 35) out.push({ text: "Blocked Path", tone: "bad" });
  if (p.playerQualityScore < 40) out.push({ text: "Player Quality Concern", tone: "warn" });
  else if (p.playerQualityScore >= 70) out.push({ text: "Strong Talent", tone: "good" });
  if (p.committeeRisk) out.push({ text: "Committee", tone: "warn" });
  return out;
}

/** ✓ pushes the score up, ⚠ drags it down. whyBullets(). */
export function whyBullets(p: HandcuffPlayer): Array<{ ok: boolean; text: string }> {
  const bullets: Array<{ ok: boolean; text: string }> = [];
  for (const r of p.topReasons) bullets.push({ ok: true, text: r });
  if (p.playerQualityScore < 40) {
    bullets.push({
      ok: false,
      text: `Player quality (${p.playerQualityScore}) grades below other handcuffs - less standalone-talent confidence`,
    });
  }
  for (const f of p.riskFlags) bullets.push({ ok: false, text: f });
  return bullets.slice(0, 6);
}

const ARCHETYPES: Record<string, string> = {
  "Premium Handcuff": "Premium stash with a clear path to touches",
  "Premium Contingency": "High-end contingency with real standalone upside",
  "Talent Stash": "Talent bet behind an entrenched starter",
  "Opportunity Stash": "Opportunity-driven stash in a soft backfield",
  "Trap Handcuff": "Low-priority handcuff with limited upside",
  "Low-Ceiling Backup": "Depth piece with a capped ceiling",
  "Dead-Zone Handcuff": "Deep stash with little near-term value",
};

export function archetypeLine(p: HandcuffPlayer): string {
  return ARCHETYPES[p.handcuffType ?? ""] ?? "Situational backfield stash to monitor";
}

/**
 * The summary, when the snapshot has no hand-written note. generateSummary():
 * deterministic, built from the player's own scores, so it cannot drift from
 * the numbers beside it.
 */
export function generateSummary(p: HandcuffPlayer): string {
  const sentences: string[] = [];
  const archetype = archetypeLine(p).toLowerCase();
  sentences.push(
    p.starterName
      ? `${p.playerName} backs up ${p.starterName} in ${p.team} - ${archetype}.`
      : `${p.playerName} profiles as ${archetype} in ${p.team}.`,
  );

  const path = p.pathScore;
  if (path != null) {
    const band =
      path >= 75 ? "wide open" : path >= 65 ? "clear" : path >= 45 ? "moderate" : path >= 35 ? "narrow" : "blocked";
    sentences.push(
      `His path to a featured role is ${band} (${path})${
        p.committeeRisk ? ", with the backfield already split in committee" : ""
      }.`,
    );
  } else if (p.committeeRisk) {
    sentences.push("The backfield is already split in committee, muddying his path to touches.");
  }

  const trend =
    p.roleTrend === "Rising Fast" || p.roleTrend === "Trending Up"
      ? ", and his role is trending up"
      : p.roleTrend === "Falling Fast" || p.roleTrend === "Trending Down"
        ? ", though his role is trending down"
        : "";
  sentences.push(
    `Talent grades ${pqCategoryLabel(p.playerQualityScore).toLowerCase()} (${p.playerQualityScore}) for the position${trend}.`,
  );

  if (p.contingentUpsideScore != null) {
    const vol =
      p.contingentUpsideScore >= 70
        ? "elite"
        : p.contingentUpsideScore >= 55
          ? "above-average"
          : p.contingentUpsideScore >= 40
            ? "middling"
            : "thin";
    sentences.push(`The ${p.team} backfield produces ${vol} fantasy volume.`);
  }

  return sentences.join(" ");
}
