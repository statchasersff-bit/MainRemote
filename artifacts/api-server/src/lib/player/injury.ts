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
 * summarized separately in the insight line.
 *
 * Nothing here is a medical claim or a prediction. Every output is a
 * restatement of the record with a label attached, and where there is no record
 * the section is omitted rather than reported as a clean bill of health.
 */

import { surname } from "./bio";
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
  /**
   * What the row actually says.
   *
   * A level word for the three rows that ARE a judgment, and a count for
   * career time lost, where the number is the fact and a word would only hide
   * it. The row is not a score with a gloss; it is a reading with the record
   * printed beside it.
   */
  value: string;
  /** The record the reading came from, in one line. */
  detail: string;
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
const LEVEL_WORD: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
};

export function computeRiskBreakdown(history: PlayerInjuryHistory): RiskRow[] {
  const nfl = history.nfl;
  const rows: RiskRow[] = [];

  const latest = nfl.reduce((max, e) => Math.max(max, e.season), 0);
  const recent = latest > 0 ? nfl.filter((e) => e.season >= latest - 1).length : 0;
  const recentLevel: RiskLevel =
    recent >= 3 ? "high" : recent >= 1 ? "moderate" : "low";
  rows.push({
    label: "Recent history",
    level: recentLevel,
    value: LEVEL_WORD[recentLevel],
    detail: latest > 0 ? `Last logged injury: ${latest}` : "No logged injuries",
  });

  const byBodyPart = new Map<string, number>();
  for (const e of nfl) {
    if (e.bodyPart) byBodyPart.set(e.bodyPart, (byBodyPart.get(e.bodyPart) ?? 0) + 1);
  }
  const maxRepeat = byBodyPart.size > 0 ? Math.max(...byBodyPart.values()) : 0;
  const repeatLevel: RiskLevel =
    maxRepeat >= 3 ? "high" : maxRepeat >= 2 ? "moderate" : "low";
  rows.push({
    label: "Repeat injuries",
    level: repeatLevel,
    value: LEVEL_WORD[repeatLevel],
    detail:
      maxRepeat >= 2
        ? `${maxRepeat} injuries to the same body region`
        : "No recurring body-region pattern",
  });

  const totalMissed = nfl.reduce((sum, e) => sum + (e.gamesMissed ?? 0), 0);
  const biggest = nfl.reduce((max, e) => Math.max(max, e.gamesMissed ?? 0), 0);
  const missedLevel: RiskLevel =
    totalMissed >= 10 ? "high" : totalMissed >= 4 ? "moderate" : "low";
  rows.push({
    label: "Career time lost",
    level: missedLevel,
    // The count, not a word. "High" over eleven games missed tells a reader
    // less than "11 games" does, and the eleven is the thing they came for.
    value: `${totalMissed} game${totalMissed === 1 ? "" : "s"}`,
    detail:
      biggest > 0
        ? `Largest absence: ${biggest} game${biggest === 1 ? "" : "s"}`
        : "No games missed",
  });

  const withBodyPart = nfl.filter((e) => e.bodyPart).length;
  const share = withBodyPart > 0 ? maxRepeat / withBodyPart : 0;
  const concentrationLevel: RiskLevel =
    share >= 0.5 ? "high" : share >= 0.34 ? "moderate" : "low";
  const regions = byBodyPart.size;
  rows.push({
    label: "Injury concentration",
    level: concentrationLevel,
    value: LEVEL_WORD[concentrationLevel],
    detail:
      regions > 0
        ? `${nfl.length} injur${nfl.length === 1 ? "y" : "ies"} across ${regions} body region${regions === 1 ? "" : "s"}`
        : "No body region recorded",
  });

  return rows;
}

/** The most recent logged injury - the one a status block leads with. */
export function latestInjury(nfl: NflInjuryEntry[]): NflInjuryEntry | null {
  let best: NflInjuryEntry | null = null;
  for (const entry of nfl) {
    if (
      !best ||
      entry.season > best.season ||
      (entry.season === best.season && (entry.week ?? 0) > (best.week ?? 0))
    ) {
      best = entry;
    }
  }
  return best;
}

/**
 * "Week 17", or "Preseason" for the week-0 entries.
 *
 * Week 0 is how the record files a preseason injury, and it was previously
 * rendered as nothing at all - the entry lost the one piece of timing it had.
 */
export function injuryWhen(entry: NflInjuryEntry): string {
  if (entry.week === undefined || entry.week === null) return "";
  return entry.week === 0 ? "Preseason" : `Week ${entry.week}`;
}

export interface InjuryFaq {
  question: string;
  answer: string;
}

/**
 * The words that already name an injury rather than a place on the body.
 *
 * The record's `type` is sometimes the injury ("Thumb Fracture", "MCL Sprain")
 * and sometimes just the part ("Shoulder", "Hamstring"). Without this the
 * second kind produces "the latest recorded injury was a shoulder in 2024",
 * which is a sentence about anatomy rather than about football.
 */
/** Injury names that are somebody's surname and keep their capital. */
const PROPER_NOUNS = new Set(["achilles", "jones", "lisfranc", "bennett"]);

const INJURY_NOUNS =
  /(fracture|sprain|strain|tear|torn|rupture|surgery|concussion|contusion|dislocat|tendin|bruis|inflammation|injur|illness|soreness|stinger|laceration|break|separation)/i;

/** An injury named the way a sentence names one: "thumb fracture", "MCL sprain". */
function injuryName(entry: NflInjuryEntry): string {
  const type = (entry.type ?? "").trim();
  if (!type) {
    return entry.bodyPart ? `${entry.bodyPart.toLowerCase()} injury` : "injury";
  }
  // Word by word: an initialism keeps its capitals and a proper noun keeps its
  // one, everything else is lowercased for the middle of a sentence. Applying
  // toLowerCase() to the whole string turns "PCL Sprain" into "pcl sprain", and
  // leaving it alone turns it into "the 2022 PCL Sprain caused..." - a database
  // row in the middle of a paragraph.
  const name = type
    .split(/\s+/)
    .map((word) => {
      if (/^[A-Z]{2,}$/.test(word)) return word;
      const lower = word.toLowerCase();
      return PROPER_NOUNS.has(lower) ? word : lower;
    })
    .join(" ");
  return INJURY_NOUNS.test(type) ? name : `${name} injury`;
}

/** "8 games", "1 game" - the unit this whole tab is counted in. */
function games(n: number): string {
  return `${n} game${n === 1 ? "" : "s"}`;
}

/**
 * "a", or "an" - by how the next word is SAID, not how it is spelled.
 *
 * "an MCL sprain" is right and "a MCL sprain" is wrong, because the letter M is
 * pronounced "em". The second test covers the initialisms this record actually
 * contains; everything else falls back to the vowel rule.
 */
function article(word: string): string {
  if (/^[aeiou]/i.test(word)) return "an";
  // An initialism starting with a letter whose NAME begins with a vowel.
  if (/^[A-Z]{2,}/.test(word) && /^[AEFHILMNORSX]/.test(word)) return "an";
  return "a";
}

/** The distinct body parts in a record, most-injured first. */
/** Body parts an injury's type can name more precisely than its filed body part. */
const PART_WORDS = [
  "thumb", "finger", "hand", "wrist", "elbow", "forearm", "shoulder", "neck", "back", "rib", "chest",
  "hip", "groin", "hamstring", "quad", "thigh", "knee", "calf", "shin", "ankle", "achilles", "foot", "heel", "toe",
];

function bodyParts(nfl: NflInjuryEntry[]): { label: string; count: number; missed: number }[] {
  const byPart = new Map<string, { label: string; count: number; missed: number }>();

  for (const entry of nfl) {
    // The recorded body part where there is one, and the region otherwise:
    // "hamstring" is what somebody searches, and "Upper Leg" is a filing
    // category that nobody has ever typed into a search box.
    // The injury's own word first when it names a part: the record files a
    // thumb fracture under "wrist", and the answer said "affecting the
    // wrist" for one (fixed 2026-09-30).
    const named = PART_WORDS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(entry.type ?? ""));
    const recorded = (entry.bodyPart ?? "").trim().toLowerCase();
    const label = named ?? (recorded && recorded !== "unknown" ? recorded : classifyRegion(entry).toLowerCase());

    const row = byPart.get(label);
    if (row) {
      row.count += 1;
      row.missed += entry.gamesMissed ?? 0;
    } else {
      byPart.set(label, { label, count: 1, missed: entry.gamesMissed ?? 0 });
    }
  }

  return [...byPart.values()].sort(
    (a, b) => b.count - a.count || b.missed - a.missed || a.label.localeCompare(b.label),
  );
}

/** "the a, b and c". */
function listWords(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The questions people actually type, answered from the record.
 *
 * Five to seven, and every one of them literal: this tab already carries the
 * deep history - the timeline, the body map, the risk rows - and the job here
 * is to answer the sentence somebody typed into Google, in the first line,
 * using facts that are already on the page.
 *
 * The two rules that shape every answer:
 *
 * 1. **Nothing predicts.** "Is he playing this week" is the highest-volume
 *    query on this page and the one this server has no business answering: a
 *    designation is a status the league report assigns, not a ruling on Sunday,
 *    and no amount of history tells you whether somebody suits up. So the
 *    answer states the designation, states when he last played, and points at
 *    the status block - which is where the freshest fact lives. That is rule 3
 *    in player-render.ts applied where it is most tempting to break.
 *
 * 2. **A question with no record behind it is not asked.** A player with no
 *    logged injuries gets the first two questions and nothing else, rather than
 *    five answers saying "no data".
 *
 * Written without pronouns, using the surname after the first mention - partly
 * because it reads like a sports desk rather than a mail merge, and partly
 * because the record this is generated from does not carry anybody's pronouns.
 */
export function injuryFaq(input: {
  name: string;
  designation: { injuryStatus: string; injuryBodyPart?: string | null } | null;
  summary: InjurySummary;
  nfl: NflInjuryEntry[];
  /** Games missed in the season the page is showing, and that season. */
  seasonMissed: number | null;
  season: number;
  /** The most recent week the player actually played, if any. */
  lastPlayedWeek: number | null;
}): InjuryFaq[] {
  const { name, designation, summary, nfl, seasonMissed, season, lastPlayedWeek } =
    input;

  const last = surname(name);
  const faq: InjuryFaq[] = [];

  // Newest first, which is the order every answer below reads them in.
  const history = nfl
    .slice()
    .sort((a, b) => b.season - a.season || (b.week ?? 0) - (a.week ?? 0));
  const latest = history[0] ?? null;

  /* ---- 1. is he injured ---- */

  const latestClause = latest
    ? ` The latest recorded injury was ${article(injuryName(latest))} ` +
      `${injuryName(latest)} in ${latest.season}, ` +
      ((latest.gamesMissed ?? 0) > 0
        ? `which cost ${games(latest.gamesMissed ?? 0)}.`
        : `which ${last} played through without missing a regular-season game.`)
    : "";

  faq.push({
    question: `Is ${name} injured?`,
    answer: designation
      ? `${name} is listed as ${designation.injuryStatus}` +
        (designation.injuryBodyPart
          ? ` with ${article(designation.injuryBodyPart)} ` +
            `${designation.injuryBodyPart.toLowerCase()} injury`
          : "") +
        ` on the most recent league injury report.`
      : `${name} does not currently carry an injury designation on the league ` +
        `injury report.${latestClause}`,
  });

  /* ---- 2. is he playing this week ---- */

  const playedClause =
    lastPlayedWeek !== null
      ? ` ${last} last played in Week ${lastPlayedWeek} of the ${season} season.`
      : ` ${last} has not played a game in the ${season} season.`;

  faq.push({
    question: `Is ${name} playing this week?`,
    answer:
      (designation
        ? `${name} is listed as ${designation.injuryStatus}, which is a status ` +
          `the league injury report assigns rather than a ruling on any one game.`
        : `${name} carries no injury designation on the most recent league ` +
          `injury report.`) +
      playedClause +
      ` The status and practice participation above are the most up-to-date ` +
      `information on this page.`,
  });

  if (history.length === 0) return faq;

  /* ---- 3. the history ---- */

  const parts = bodyParts(history);

  /*
   * The injury that cost the most, found here rather than taken from
   * `summary.primaryDriver`.
   *
   * That field carries a pre-joined "2022 PCL Sprain" label, and lowercasing it
   * for the middle of a sentence turns it into "2022 pcl sprain". Re-deriving
   * from the entry lets injuryName() keep the initialism and drop the rest of
   * the capitals, which is the difference between a written sentence and a
   * database row with a CSS transform on it.
   */
  const worst = history.reduce<NflInjuryEntry | null>((pick, entry) => {
    if (!pick) return entry;
    const score = (e: NflInjuryEntry) =>
      (e.gamesMissed ?? 0) * 100 + (e.severity ? SEVERITY_RANK[e.severity] : 0);
    return score(entry) > score(pick) ? entry : pick;
  }, null);
  const worstName = worst ? `${worst.season} ${injuryName(worst)}` : "";
  const worstMissed = worst?.gamesMissed ?? 0;

  faq.push({
    question: `What is ${name}'s injury history?`,
    answer:
      `${last} has ${history.length} logged NFL ` +
      `injur${history.length === 1 ? "y" : "ies"}, affecting the ` +
      // Five is where a list stops being readable and starts being a dump.
      `${listWords(parts.slice(0, 5).map((part) => part.label))}` +
      `${parts.length > 5 ? ", among others" : ""}.` +
      (worst && worstMissed > 0
        ? ` The longest absence came from the ${worstName}, ` +
          `which cost ${games(worstMissed)}.`
        : history.length === 1
          ? ` It did not cost a regular-season game.`
          : ` None of them has cost a regular-season game.`),
  });

  /* ---- 4. the most recent one ---- */

  if (latest) {
    const when = latest.week === 0 ? `in the ${latest.season} preseason` : `in ${latest.season}`;
    faq.push({
      question: `What was ${name}'s most recent injury?`,
      answer:
        `${last}'s most recent recorded injury was ${article(injuryName(latest))} ` +
        `${injuryName(latest)} ${when}.` +
        ((latest.gamesMissed ?? 0) > 0
          ? ` It cost ${games(latest.gamesMissed ?? 0)}.`
          : ` ${last} played through it and did not miss a regular-season game.`),
    });
  }

  /* ---- 5. games missed ---- */

  faq.push({
    question: `How many games has ${name} missed due to injury?`,
    answer:
      // A zero is the good answer to this question, and "has missed 0 games" is
      // the worst way to give it: it reads as a counter that failed to fill in
      // rather than as a clean record.
      (summary.totalMissed === 0
        ? `${last} has not missed a regular-season game through ` +
          (history.length === 1
            ? `the one injury in this record.`
            : `any of the ${history.length} injuries in this record.`)
        : `${last} has missed ${games(summary.totalMissed)} across the ` +
          `injuries tracked in this career history.`) +
      // Only when it is actually some: "0 games of those fall in 2026" is a
      // sentence that exists to fill a slot.
      (seasonMissed !== null && seasonMissed > 0
        ? ` ${games(seasonMissed)} of those fall in ${season}.`
        : ""),
  });

  /* ---- 6. recurrence ---- */

  const repeated = parts.filter((part) => part.count > 1);
  if (repeated.length > 0) {
    const top = repeated[0] as { label: string; count: number; missed: number };
    faq.push({
      question: `Has ${name} had any recurring injuries?`,
      answer:
        `Yes. ${last} has ${top.count} logged injuries to the ${top.label}` +
        (top.missed > 0 ? `, costing ${games(top.missed)}` : "") +
        `.` +
        (repeated.length > 1
          ? ` The record also repeats at the ` +
            `${listWords(repeated.slice(1).map((part) => part.label))}.`
          : ""),
    });
  } else if (parts.length > 1) {
    faq.push({
      question: `Has ${name} had any recurring injuries?`,
      answer:
        `No. ${last}'s logged injuries have affected ${parts.length} different ` +
        `areas of the body rather than the same one repeatedly, so the record ` +
        `shows no recurring pattern.`,
    });
  }

  /* ---- 7. the worst one ---- */

  if (worst) {
    faq.push({
      question: `What was ${name}'s worst injury?`,
      answer:
        worstMissed > 0
          ? `The ${worstName} caused the longest absence in ${last}'s record, ` +
            `costing ${games(worstMissed)}.`
          : `No logged injury has cost ${last} a regular-season game. The most ` +
            `serious on record is the ${worstName}.`,
    });
  }

  return faq;
}

/**
 * One sentence about the shape of the history.
 *
 * Says what cost time AND what did not, because the second half is the part
 * that stops a long list of report appearances reading as a long list of
 * absences. Empty when there is nothing worth saying - never a filler line.
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

/** The history grouped by season, newest first - the timeline's rows. */
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

/** Injuries tallied by body region, worst first - the body-map's data. */
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
