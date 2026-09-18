/**
 * The Injury & Health tab's data.
 *
 * Built from `data/player/player_injuries.json`, which is a per-player history
 * of logged injuries with a body part, a severity, and how many games each one
 * actually cost. The grade and score on each record come from the build script;
 * everything else on this page is derived here so the reasoning is visible
 * rather than baked into a number nobody can check.
 *
 * The point of the whole tab is the distinction between an injury that cost
 * games and an injury that appeared on a report and was played through. A count
 * of "injuries" mixes the two and makes every veteran look fragile, so games
 * missed is what drives the risk rows, and the played-through issues are
 * summarised separately in the insight line.
 *
 * Nothing here is a medical claim or a prediction. Every output is a
 * restatement of the record with a label attached, and where there is no record
 * the section is omitted rather than reported as a clean bill of health.
 */

import { loadInjuries } from "./data";

export type InjurySeverity = "minor" | "moderate" | "major";

export interface NflInjuryEntry {
  season: number;
  week?: number;
  type: string;
  bodyPart?: string;
  side?: string;
  severity?: InjurySeverity;
  gamesMissed?: number;
  description?: string;
}

export interface PlayerInjuryHistory {
  grade: string | null;
  score: number | null;
  gradeColor: string | null;
  nfl: NflInjuryEntry[];
  college: NflInjuryEntry[];
}

export function getInjuryHistory(playerId: string): PlayerInjuryHistory | null {
  const raw = (loadInjuries() as Record<string, unknown>)[playerId];
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<PlayerInjuryHistory>;
  const nfl = Array.isArray(record.nfl) ? record.nfl : [];
  const college = Array.isArray(record.college) ? record.college : [];
  if (nfl.length === 0 && college.length === 0) return null;
  return {
    grade: typeof record.grade === "string" ? record.grade : null,
    score: typeof record.score === "number" ? record.score : null,
    gradeColor: typeof record.gradeColor === "string" ? record.gradeColor : null,
    nfl,
    college,
  };
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Group an injury into a body region.
 *
 * Coarser than the raw body part on purpose: "hamstring", "quad" and "thigh"
 * are the same recurring problem as far as a reader deciding whether to draft
 * somebody is concerned, and three separate one-entry rows hide that.
 */
const BODY_REGIONS: { region: string; keywords: string[] }[] = [
  { region: "Head/Neck", keywords: ["head", "neck", "concussion", "face", "jaw", "skull", "nose", "eye"] },
  { region: "Back/Spine", keywords: ["back", "spine", "spinal", "lumbar", "disc", "vertebra"] },
  { region: "Shoulder", keywords: ["shoulder", "clavicle", "collarbone", "ac joint", "rotator"] },
  { region: "Arm/Elbow", keywords: ["arm", "elbow", "bicep", "tricep", "forearm"] },
  { region: "Hand/Wrist", keywords: ["hand", "wrist", "thumb", "finger"] },
  { region: "Chest/Ribs", keywords: ["chest", "rib", "pec", "sternum", "abdomen", "oblique", "core"] },
  { region: "Hip/Groin", keywords: ["hip", "groin", "pelvis", "glute"] },
  { region: "Upper Leg", keywords: ["hamstring", "quad", "thigh", "femur"] },
  { region: "Knee", keywords: ["knee", "acl", "mcl", "pcl", "patella", "meniscus"] },
  { region: "Lower Leg/Foot", keywords: ["calf", "shin", "ankle", "foot", "achilles", "toe", "heel", "tibia", "fibula"] },
];

export function classifyRegion(entry: NflInjuryEntry): string {
  const hay = `${entry.bodyPart ?? ""} ${entry.type ?? ""}`.toLowerCase();
  for (const region of BODY_REGIONS) {
    if (region.keywords.some((k) => hay.includes(k))) return region.region;
  }
  return entry.bodyPart ? titleCase(entry.bodyPart) : "Other";
}

const SEVERITY_RANK: Record<InjurySeverity, number> = {
  major: 3,
  moderate: 2,
  minor: 1,
};

export interface InjurySummary {
  totalMissed: number;
  injuriesLogged: number;
  affectedRegions: number;
  lastSeason: number | null;
  /** The single injury that cost the most, for the "what happened" line. */
  primaryDriver: { label: string; missed: number } | null;
}

export function summarizeInjuries(history: PlayerInjuryHistory): InjurySummary {
  const totalMissed = history.nfl.reduce((sum, e) => sum + (e.gamesMissed ?? 0), 0);
  const regions = new Set(history.nfl.map(classifyRegion));

  let lastSeason: number | null = null;
  for (const e of history.nfl) {
    if (lastSeason === null || e.season > lastSeason) lastSeason = e.season;
  }

  let primaryDriver: InjurySummary["primaryDriver"] = null;
  let bestScore = -1;
  for (const e of history.nfl) {
    const missed = e.gamesMissed ?? 0;
    // Games missed dominates; severity only breaks ties between injuries that
    // cost the same amount of football.
    const score = missed * 100 + (e.severity ? SEVERITY_RANK[e.severity] : 0);
    if (score > bestScore) {
      bestScore = score;
      primaryDriver = { label: `${e.season} ${e.type}`, missed };
    }
  }

  return {
    totalMissed,
    injuriesLogged: history.nfl.length + history.college.length,
    affectedRegions: regions.size,
    lastSeason,
    primaryDriver,
  };
}

export type RiskLevel = "low" | "moderate" | "high";

export interface RiskRow {
  label: string;
  level: RiskLevel;
}

/**
 * The four risk rows, each from one explicit rule.
 *
 * They are separate rather than blended into one score because they can
 * disagree in ways that matter: a player with one severe injury three seasons
 * ago and a player with five niggles last season are both "risky" for opposite
 * reasons, and averaging them into a single number loses exactly the part a
 * reader would act on.
 */
export function computeRiskBreakdown(history: PlayerInjuryHistory): RiskRow[] {
  const nfl = history.nfl;
  const rows: RiskRow[] = [];

  const latest = nfl.reduce((max, e) => Math.max(max, e.season), 0);
  const recent = latest > 0 ? nfl.filter((e) => e.season >= latest - 1).length : 0;
  rows.push({
    label: "Recent Injury Risk",
    level: recent >= 3 ? "high" : recent >= 1 ? "moderate" : "low",
  });

  const byBodyPart = new Map<string, number>();
  for (const e of nfl) {
    if (e.bodyPart) byBodyPart.set(e.bodyPart, (byBodyPart.get(e.bodyPart) ?? 0) + 1);
  }
  const maxRepeat = byBodyPart.size > 0 ? Math.max(...byBodyPart.values()) : 0;
  rows.push({
    label: "Recurring Injury Risk",
    level: maxRepeat >= 3 ? "high" : maxRepeat >= 2 ? "moderate" : "low",
  });

  const totalMissed = nfl.reduce((sum, e) => sum + (e.gamesMissed ?? 0), 0);
  rows.push({
    label: "Games Missed Impact",
    level: totalMissed >= 10 ? "high" : totalMissed >= 4 ? "moderate" : "low",
  });

  const withBodyPart = nfl.filter((e) => e.bodyPart).length;
  const share = withBodyPart > 0 ? maxRepeat / withBodyPart : 0;
  rows.push({
    label: "Body Part Concentration",
    level: share >= 0.5 ? "high" : share >= 0.34 ? "moderate" : "low",
  });

  return rows;
}

/**
 * One sentence about the shape of the history.
 *
 * Says what cost time AND what did not, because the second half is the part
 * that stops a long list of report appearances reading as a long list of
 * absences. Empty when there is nothing worth saying — never a filler line.
 */
export function buildTimelineInsight(nfl: NflInjuryEntry[]): string {
  const joinAnd = (parts: string[]) =>
    parts.length <= 1
      ? (parts[0] ?? "")
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  const shortDesc = (e: NflInjuryEntry) =>
    e.bodyPart ? `${e.bodyPart.toLowerCase()} injury` : e.type.toLowerCase();

  const topMissed = nfl
    .filter((e) => (e.gamesMissed ?? 0) > 0)
    .sort((a, b) => (b.gamesMissed ?? 0) - (a.gamesMissed ?? 0))
    .slice(0, 2)
    .map((e) => `${e.season} ${shortDesc(e)}`);

  const playedThrough = Array.from(
    new Set(
      nfl
        .filter((e) => (e.gamesMissed ?? 0) === 0)
        .map((e) => classifyRegion(e).toLowerCase()),
    ),
  ).slice(0, 3);

  let sentence = "";
  if (topMissed.length > 0) {
    sentence = `Most missed time came from the ${joinAnd(topMissed)}`;
  }
  if (playedThrough.length > 0) {
    // Singular and plural are spelled out rather than sharing a quantifier:
    // "several shoulder issue was played through" is what one shared branch
    // produces, and it reads as a bug in the page rather than in the sentence.
    const plural = playedThrough.length > 1;
    const quantifier = plural ? "several" : "a";
    sentence += sentence
      ? `, while ${quantifier} `
      : `${quantifier.charAt(0).toUpperCase()}${quantifier.slice(1)} `;
    sentence += `${joinAnd(playedThrough)} ${plural ? "issues were" : "issue was"} played through`;
  }
  return sentence ? `${sentence}.` : "";
}

export function durabilityRiskLabel(score: number): {
  word: string;
  level: RiskLevel;
} {
  if (score >= 80) return { word: "Low", level: "low" };
  if (score >= 60) return { word: "Moderate", level: "moderate" };
  if (score >= 40) return { word: "Elevated", level: "moderate" };
  return { word: "High", level: "high" };
}

export interface InjurySeasonRow {
  season: number;
  entries: NflInjuryEntry[];
  gamesMissed: number;
}

/** The history grouped by season, newest first — the timeline's rows. */
export function injuriesBySeason(nfl: NflInjuryEntry[]): InjurySeasonRow[] {
  const bySeason = new Map<number, NflInjuryEntry[]>();
  for (const entry of nfl) {
    const list = bySeason.get(entry.season);
    if (list) list.push(entry);
    else bySeason.set(entry.season, [entry]);
  }
  return Array.from(bySeason.entries())
    .map(([season, entries]) => ({
      season,
      entries: entries.slice().sort((a, b) => (a.week ?? 0) - (b.week ?? 0)),
      gamesMissed: entries.reduce((sum, e) => sum + (e.gamesMissed ?? 0), 0),
    }))
    .sort((a, b) => b.season - a.season);
}

export interface RegionTally {
  region: string;
  count: number;
  gamesMissed: number;
}

/** Injuries tallied by body region, worst first — the body-map's data. */
export function regionTallies(nfl: NflInjuryEntry[]): RegionTally[] {
  const byRegion = new Map<string, RegionTally>();
  for (const entry of nfl) {
    const region = classifyRegion(entry);
    const row = byRegion.get(region);
    if (row) {
      row.count += 1;
      row.gamesMissed += entry.gamesMissed ?? 0;
    } else {
      byRegion.set(region, {
        region,
        count: 1,
        gamesMissed: entry.gamesMissed ?? 0,
      });
    }
  }
  return Array.from(byRegion.values()).sort(
    (a, b) => b.gamesMissed - a.gamesMissed || b.count - a.count,
  );
}
