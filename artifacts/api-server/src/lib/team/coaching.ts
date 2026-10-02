/**
 * The Coaching Profile & Tendencies data: read, typed, and the reliability
 * rule applied.
 *
 * Every team's entry in `data/team/coaching_<season>.json` is the evergreen
 * layer: generated per team each offseason and hand-reviewed, per the build
 * spec. The weekly-refresh surface is deliberately small — the play-caller
 * ledger line, the current-season tendency column, the current backfield bar
 * and the finishes "pace" row — and the parts of it our own feed carries
 * (pass rate, PROE, pace, red-zone pass rate, the lead back's weighted-opp
 * share) are read live from the usage file rather than stored, so they move
 * with the daily chain. The rest of the ledger is sourced from beat reporting
 * and stays editorial.
 *
 * A team with no entry renders no section — same contract as the usage tab.
 */

import fs from "node:fs";
import { dataPath } from "../data-dir";
import { readDataJson } from "./read-json";

/* ------------------------------------------------------------------ types */

export type ChangeDir = "up" | "down" | "flat";

export interface TendencyRow {
  label: string;
  sub?: string;
  prior: string;
  /** Numeric prior, present on feed-backed rows so the delta can be computed. */
  priorNum?: number;
  /** Read the current value from the usage file's env block instead. */
  feed?: "passRate" | "proe" | "pace" | "rzPassRate";
  /** Lower is "up": pace, where fewer seconds is faster. */
  invert?: boolean;
  current: string;
  change: { dir: ChangeDir; text: string };
  nflAvg: string;
}

export interface FinishCell {
  text: string;
  tone: "good" | "bad" | "plain";
}

export interface BarRow {
  label: string;
  /** Bar width, as a share %. */
  share?: number;
  pct?: number;
  nfl?: number;
  result?: string;
  gold?: boolean;
}

export interface TeamCoaching {
  /** False until mak's verification pass signs the numbers off. */
  verified: boolean;
  /**
   * True on an entry written by hand rather than by buildCoaching.mjs. The
   * builder's weekly `--force all` pass regenerates every entry except these.
   */
  handWritten?: boolean;
  playCaller: {
    name: string;
    kicker: string;
    tree: string | null;
    subline: string;
    careerPath: Array<{ role: string; years: string }>;
  };
  reliability: {
    priorSeasonsAsCaller: number;
    sameSchemeFamily: boolean;
    explanation: string;
    ledger: string;
  };
  introAnswer: string;
  tendencies: {
    priorLabel: string;
    currentLabel: string;
    rows: TendencyRow[];
  };
  shifts: Array<{ stat: string; unit: string; heading: string; body: string }>;
  staff: {
    oc: { name: string; sub: string; hasCalledPlays: boolean; body: string };
    dc: { name: string; sub: string; body: string };
    continuity: { stat: string; sub: string; body: string };
  };
  dossier: Array<{
    stop: string;
    years: string;
    scoring: string;
    scoringContext: string;
    current?: boolean;
    thesis: string;
    fingerprint: string;
  }>;
  finishes: {
    heading: string;
    rows: Array<{
      stop: string;
      context: string;
      current?: boolean;
      cells: FinishCell[];
    }>;
    note: string;
  };
  /** Optional: needs per-coach rookie-ramp history, which only hand-written entries carry. */
  rookieNote?: { label: string; body: string };
  distribution: { sub: string; rows: BarRow[]; note: string };
  backfield: {
    sub: string;
    bars: Array<{ label: string; value: number; current?: boolean; feed?: boolean }>;
    note: string;
  };
  /**
   * Optional: personnel groupings have no free in-season source (SumerSports
   * holds them behind SumerPass; nflverse participation lands post-season),
   * so generated entries omit the panel rather than estimate it.
   */
  personnel?: { sub: string; rows: BarRow[]; note: string };
  scoreState: { sub: string; rows: BarRow[]; note: string };
  bottomLine: string;
  faq: { question: string; answer: string };
}

export interface CoachingDoc {
  season: number;
  builtAt: string;
  sources: string[];
  teams: Record<string, TeamCoaching>;
}

/* ------------------------------------------------------------------- read */

export function getCoachingDoc(season: number): CoachingDoc | null {
  return readDataJson<CoachingDoc>(dataPath("team", `coaching_${season}.json`));
}

/** One club's dossier, by lowercase abbreviation. Null = no section. */
export function getTeamCoaching(
  abbreviation: string,
  season: number,
): TeamCoaching | null {
  return getCoachingDoc(season)?.teams[abbreviation.toLowerCase()] ?? null;
}

/**
 * A fingerprint for the render cache: changes whenever the file does.
 *
 * The file's mtime rather than its builtAt, because this file is hand-edited
 * (a verification pass, a new club's entry) and an editor will not reliably
 * bump a stamp inside it. The usage file's builtAt works there because only
 * its build script writes it.
 */
export function coachingVersion(season: number): string {
  try {
    return String(
      fs.statSync(dataPath("team", `coaching_${season}.json`)).mtimeMs,
    );
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------ reliability */

export type Reliability = "HIGH" | "MEDIUM" | "LOW";

/**
 * The rule, not vibes, per the spec: HIGH = same primary play-caller for two
 * or more prior seasons with this team; MEDIUM = one prior season, or a new
 * caller from the same scheme family; LOW = a new play-caller. A LOW rating
 * is the caveat the rest of the team's page must carry wherever it projects
 * from last season's data — see coachingCaveat() in coaching-render.ts.
 */
export function reliabilityRating(c: TeamCoaching): Reliability {
  const prior = c.reliability.priorSeasonsAsCaller;
  if (prior >= 2) return "HIGH";
  if (prior === 1 || c.reliability.sameSchemeFamily) return "MEDIUM";
  return "LOW";
}

/** How full the meter draws, per rating. */
export const RELIABILITY_PCT: Record<Reliability, number> = {
  HIGH: 88,
  MEDIUM: 55,
  LOW: 22,
};

/**
 * The hook for the rest of the page: a team whose play-caller is new gets its
 * LOW rating surfaced as a caveat beside anything projecting from last
 * season. Null when the team has no coaching entry at all.
 */
export function getCoachingReliability(
  abbreviation: string,
  season: number,
): Reliability | null {
  const c = getTeamCoaching(abbreviation, season);
  return c ? reliabilityRating(c) : null;
}
