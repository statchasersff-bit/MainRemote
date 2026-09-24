/**
 * The Bio tab's facts, timeline, prose and questions.
 *
 * Bio answers "who is he?" and nothing else. Every other tab on this page
 * answers a fantasy question — what are his numbers, what did he do each game,
 * what should I expect, is he hurt — and the single most valuable property of
 * this one is that it does NOT. A page that mixes "6 feet 4 inches" with
 * "TD-dependent, volume-driven ceiling" is topically two pages, and it ranks
 * for neither set of queries as well as either would alone.
 *
 * So: measured identity facts, a career timeline, the draft, a short factual
 * story and direct answers. No points per game, no efficiency, no start/sit,
 * no injury risk. If a number here would help somebody set a lineup, it is in
 * the wrong file.
 *
 * Everything is derived — from players.json, draft.json and bio_facts.json —
 * rather than written, so it stays true as a player is traded, ages a year or
 * starts a season without anybody rewriting a paragraph. The one thing that
 * cannot be derived is what is simply not in the data, and rule 1 applies with
 * full force: there is no hometown row, because there is no hometown.
 *
 * Pure: no clock beyond the `now` it is handed, no I/O, no DOM.
 */

import { getTeamByAbbreviation, type NflTeam } from "../team/teams";
import type { BioFacts, DraftRecord, Player } from "./types";

/** One labelled fact in the identity block. */
export interface BioFact {
  label: string;
  value: string;
  /** A second line under the value, e.g. the draft's team. */
  detail?: string;
}

/**
 * One stop in the career timeline.
 *
 * A stint, not a season: four years in Indianapolis is one entry reading
 * "2017–20", because the timeline is a career and a list of identical rows is
 * a table pretending to be one.
 */
export interface CareerStint {
  kind: "college" | "nfl";
  /** "2017–20", "2016", or "" for the college entry, which has no years. */
  years: string;
  name: string;
  team: NflTeam | null;
  /** "Drafted · Round 3, Pick 91", when this is where the career started. */
  note: string | null;
  /**
   * The second line of the stop, when the stint has something to say that the
   * years and the club name do not: "2nd stint" for a player who left and came
   * back. Null is the common case and renders as nothing rather than as an
   * empty line.
   */
  detail: string | null;
  /**
   * How many seasons the stint ran. The rendered years are a range and a range
   * is not a count — "2017–20" is four seasons and a reader should not have to
   * do the subtraction.
   */
  seasons: number;
  /** The stint the player is on now. */
  current: boolean;
}

export interface BioDraft {
  year: number;
  round: number | null;
  pick: number | null;
  team: NflTeam | null;
  teamCode: string | null;
  college: string | null;
}

export interface BioQuestion {
  question: string;
  answer: string;
}

export interface BioProfile {
  facts: BioFact[];
  /**
   * The draft, when it is actually known.
   *
   * Null covers two different situations that this data cannot tell apart, and
   * that is exactly why nothing here claims to: `draft.json` writes a row with
   * `year: null` both for a player who went undrafted and for one whose draft
   * simply could not be resolved upstream. Marvin Harrison Jr. went fourth
   * overall in 2024 and carries a null row, so "Undrafted" inferred from a null
   * would be printed, confidently, over the top of a top-five pick.
   *
   * So a missing draft renders nothing at all. The day the builder records the
   * difference, an `undrafted` flag can render "Undrafted" and mean it.
   */
  draft: BioDraft | null;
  stints: CareerStint[];
  college: string | null;
  narrative: string[];
  faq: BioQuestion[];
  /** Nothing to say. The tab is dropped rather than rendered empty. */
  empty: boolean;
}

/* ------------------------------------------------------------------ atoms */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "1992-12-11" -> "December 11, 1992". Null for anything that is not a date. */
export function birthDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return null;
  return `${name} ${Number(day)}, ${year}`;
}

/**
 * Age on a given day, from a birth date.
 *
 * Computed rather than read off players.json, because that field is a snapshot
 * taken whenever the index was last rebuilt and this is the number the page is
 * most often asked for outright. A birth date is a fixed fact; an age is an
 * arithmetic result that should not be months out of date.
 */
export function ageFrom(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  let age = now.getUTCFullYear() - year;
  const monthNow = now.getUTCMonth() + 1;
  const dayNow = now.getUTCDate();
  if (monthNow < month || (monthNow === month && dayNow < day)) age -= 1;

  return age >= 0 && age < 100 ? age : null;
}

/** Total inches ("76") as feet and inches. "" when there is nothing to show. */
export function heightLabel(height: string | null | undefined): string {
  if (!height) return "";
  const trimmed = String(height).trim();
  if (trimmed.includes("'") || trimmed.includes("-")) return trimmed;
  const inches = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(inches) || inches <= 0) return trimmed;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** The same height written out, for an answer that has to read as a sentence. */
export function heightWords(height: string | null | undefined): string {
  if (!height) return "";
  const inches = Number.parseInt(String(height).trim(), 10);
  if (!Number.isFinite(inches) || inches <= 0) return "";
  const feet = Math.floor(inches / 12);
  const rest = inches % 12;
  const feetWord = `${feet} ${feet === 1 ? "foot" : "feet"}`;
  if (rest === 0) return `${feetWord} tall`;
  return `${feetWord} ${rest} ${rest === 1 ? "inch" : "inches"} tall`;
}

const ROUND_WORDS = [
  "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
];

function roundWord(round: number | null): string {
  return ROUND_WORDS[round ?? 0] ?? `${round}th`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * The name to use after the first mention.
 *
 * Repeating "Jacoby Brissett" six times in one paragraph is how a generated
 * bio announces that nobody wrote it. A surname is what a sports desk would
 * use — and what a reader expects — so the generated prose says the full name
 * once and the surname after.
 *
 * Generational suffixes are dropped first: the last token of "Odell Beckham
 * Jr." is "Jr.", and a paragraph about what Jr. did in 2016 is worse than one
 * that simply repeated the name.
 */
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

export function surname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  while (parts.length > 1) {
    const last = (parts[parts.length - 1] ?? "").toLowerCase();
    if (!NAME_SUFFIXES.has(last)) break;
    parts.pop();
  }
  return parts[parts.length - 1] ?? fullName;
}

/** "the A, B and C" — an Oxford-free list, which is how a sentence reads it. */
function listWords(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Each stint's club name once, in the order first reached. */
function uniqueNames(stints: CareerStint[]): string[] {
  return [...new Set(stints.map((stint) => stint.name))];
}

const SPELL_WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four" };

/** A season range: "2016", or "2017–20" with an en dash and a short end. */
function seasonRange(from: number, to: number, current: boolean): string {
  if (current) return `${from}–`;
  if (from === to) return String(from);
  // "2017–20" rather than "2017–2020": the century is not in doubt and the
  // short form is how a career is written everywhere else.
  const short = to % 100;
  return `${from}–${String(short).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- the timeline */

/**
 * Consecutive seasons on one team, collapsed into one stint.
 *
 * A player who leaves and returns gets two entries for that team, in career
 * order, which is the honest shape: Brissett's two spells in New England are
 * eight years apart and are not one stint.
 */
export function careerStints(
  facts: BioFacts | null,
  draft: DraftRecord | null,
  currentSeason: number,
  currentTeamCode: string | null,
): CareerStint[] {
  const rows = (facts?.teams ?? [])
    .filter((row) => row && Number.isFinite(row.season) && row.team)
    .slice()
    .sort((a, b) => a.season - b.season);
  if (rows.length === 0) return [];

  const groups: { team: string; from: number; to: number }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    // Only CONSECUTIVE seasons merge. A gap year — injured, out of the league,
    // on a practice squad — ends the stint, because "2019–23" over a season he
    // spent somewhere else is a claim the data does not make.
    if (last && last.team === row.team && row.season === last.to + 1) {
      last.to = row.season;
      continue;
    }
    groups.push({ team: row.team, from: row.season, to: row.season });
  }

  const draftYear = draft?.year ?? null;
  const draftTeam = draft?.draft_team ?? null;

  const currentTeam = getTeamByAbbreviation(currentTeamCode);

  return groups.map((group, index) => {
    const team = getTeamByAbbreviation(group.team);

    /*
     * When a stint is still running.
     *
     * The obvious test — does it reach the current season — is wrong for four
     * months of every year: this file is built from stat lines, so between
     * February and a player's first snap of September his newest stint ends
     * last season and the timeline reads as though he had left the league.
     *
     * So the last stint also counts as current when it is on the team the
     * roster says he is on now. A player traded in the offseason fails that
     * test, and correctly: the timeline then ends where the evidence ends, and
     * the identity block above it is what names the new club. Inventing a
     * stint for a team he has not yet played a down for is exactly the kind of
     * claim rule 1 exists to prevent.
     */
    const last = index === groups.length - 1;
    const current =
      group.to >= currentSeason ||
      (last && currentTeam !== null && team?.code === currentTeam.code);
    const drafted =
      index === 0 &&
      draftYear !== null &&
      group.from === draftYear &&
      (!draftTeam || getTeamByAbbreviation(draftTeam)?.code === team?.code);

    /*
     * Which spell this is with the club.
     *
     * A player who leaves and returns gets two entries for the same team, and
     * without saying so the timeline reads as a duplicate row rather than as
     * the career event it is. Counted over the groups already emitted, so the
     * first spell is silent and only a return announces itself.
     */
    const spell = groups
      .slice(0, index)
      .filter((earlier) => earlier.team === group.team).length + 1;

    return {
      kind: "nfl" as const,
      years: seasonRange(group.from, group.to, current),
      name: team?.fullName ?? group.team,
      team,
      note:
        drafted && draft
          ? `Drafted · Round ${draft.round} · Pick ${draft.pick}`
          : null,
      detail: spell > 1 ? `${ordinal(spell)} stint` : null,
      seasons: group.to - group.from + 1,
      current,
    };
  });
}

/* --------------------------------------------------------------- the profile */

export interface BioProfileInput {
  player: Player;
  team: NflTeam | null;
  facts: BioFacts | null;
  draft: DraftRecord | null;
  currentSeason: number;
  now: Date;
}

export function buildBioProfile(input: BioProfileInput): BioProfile {
  const { player, team, facts, draft, currentSeason, now } = input;

  const born = birthDateLabel(facts?.birthDate);
  const age = ageFrom(facts?.birthDate, now) ?? player.age ?? null;
  const height = heightLabel(player.height);
  const weight = player.weight ? `${player.weight} lb` : "";
  // draft.json's college is the one a drafted player was taken out of;
  // bio_facts covers everybody, drafted or not.
  const college = draft?.college ?? facts?.college ?? null;
  const highSchool = facts?.highSchool ?? null;

  /* ---- the identity block ---- */

  const facts_: BioFact[] = [];
  if (age !== null) facts_.push({ label: "Age", value: String(age) });
  if (height) facts_.push({ label: "Height", value: height });
  if (weight) facts_.push({ label: "Weight", value: weight });
  if (born) facts_.push({ label: "Born", value: born });
  if (college) facts_.push({ label: "College", value: college });
  if (highSchool) facts_.push({ label: "High school", value: highSchool });

  if (player.years_exp !== null && player.years_exp !== undefined) {
    facts_.push({
      label: "NFL experience",
      value:
        player.years_exp === 0
          ? "Rookie"
          : `${ordinal(player.years_exp + 1)} season`,
    });
  }

  const draftTeam = draft?.draft_team ? getTeamByAbbreviation(draft.draft_team) : null;
  const draftYear = draft?.year ?? null;

  if (draftYear && draft?.round && draft?.pick) {
    facts_.push({
      label: "Draft",
      value: `${draftYear} · Round ${draft.round} · Pick ${draft.pick}`,
      detail: draftTeam?.fullName ?? draft.draft_team ?? undefined,
    });
  }

  const stints = careerStints(facts, draft, currentSeason, player.team);

  /* ---- the story ---- */

  const name = player.name;
  const last = surname(name);
  const position = POSITION_WORDS[player.position ?? ""] ?? null;
  const narrative: string[] = [];
  const clubNames = stints.map((stint) => stint.name);

  const identity = position
    ? `${name} is a ${position}${team ? ` for the ${team.fullName}` : ""}` +
      `${player.number ? `, wearing number ${player.number}` : ""}.`
    : null;
  if (identity) narrative.push(identity);

  // Born, schooled and drafted, in that order — the shape of every bio ever
  // written, and the order the questions get asked in.
  const origin: string[] = [];
  if (highSchool) origin.push(`attended ${highSchool}`);
  if (college) origin.push(`played college football at ${college}`);
  if (origin.length > 0) {
    narrative.push(
      born
        ? `Born on ${born}, ${last} ${listWords(origin)}.`
        : `${last} ${listWords(origin)}.`,
    );
  } else if (born) {
    narrative.push(`${last} was born on ${born}.`);
  }

  const drafting = draftTeam ? `The ${draftTeam.fullName}` : "An NFL team";
  if (draftYear && draft?.round && draft?.pick) {
    narrative.push(
      `${drafting} selected ${identity ? last : name} in the ` +
        `${roundWord(draft.round)} round of the ${draftYear} NFL Draft with the ` +
        `${ordinal(draft.pick)} overall pick.`,
    );
  }

  /*
   * Where the career has been since.
   *
   * "Since" is load-bearing: the first stint is the team that drafted him and
   * the sentence above just said so, so listing it again would have the
   * paragraph name the Patriots twice in two sentences for one event. When
   * there was no draft to say it, the list is the whole career instead.
   */
  const drafted = draftYear !== null && stints[0]?.note !== null;
  const since = stints.slice(drafted ? 1 : 0);
  // A club he had already played for is a return, and says so. Listed flat,
  // "has since played for the Commanders and 49ers" under a sentence saying
  // the 49ers drafted him reads as though the first spell never happened.
  const isReturn = (stint: CareerStint): boolean =>
    stints.slice(0, stints.indexOf(stint)).some((s) => s.name === stint.name);
  const joined = uniqueNames(since.filter((stint) => !isReturn(stint)));
  const returned = uniqueNames(since.filter(isReturn));
  if (joined.length > 0 || returned.length > 0) {
    const verbs: string[] = [];
    if (joined.length > 0) verbs.push(`played for the ${listWords(joined)}`);
    if (returned.length > 0) verbs.push(`returned to the ${listWords(returned)}`);
    narrative.push(
      `${last} has ${drafted ? "since " : ""}` +
        verbs.join(joined.length > 1 ? ", and " : " and ") +
        ".",
    );
  }

  if (player.years_exp) {
    narrative.push(
      `${currentSeason} is ${last}'s ${ordinal(player.years_exp + 1)} NFL season.`,
    );
  }

  /* ---- the questions ---- */

  const faq: BioQuestion[] = [];

  if (age !== null) {
    faq.push({
      question: `How old is ${name}?`,
      answer: born
        ? `${name} is ${age} years old. ${name} was born on ${born}.`
        : `${name} is ${age} years old.`,
    });
  }

  const words = heightWords(player.height);
  if (words) {
    faq.push({
      question: `How tall is ${name}?`,
      answer: `${name} is ${words}${height ? ` (${height})` : ""}.`,
    });
  }

  if (player.weight) {
    faq.push({
      question: `How much does ${name} weigh?`,
      answer: `${name} is listed at ${player.weight} pounds.`,
    });
  }

  if (college) {
    faq.push({
      question: `Where did ${name} go to college?`,
      answer:
        `${name} played college football at ${college}` +
        `${highSchool ? `, after attending ${highSchool}` : ""}.`,
    });
  }

  if (draftYear && draft?.round && draft?.pick) {
    faq.push({
      question: `When was ${name} drafted?`,
      answer:
        `The ${draftTeam?.fullName ?? "drafting team"} selected ${name} in the ` +
        `${roundWord(draft.round)} round of the ${draftYear} NFL Draft with the ` +
        `${ordinal(draft.pick)} overall pick.`,
    });
  }

  if (clubNames.length > 0) {
    // Each club once, in the order he first joined it; a club he had two
    // spells with says so rather than being named twice.
    const clubs = uniqueNames(stints).map((clubName) => {
      const spells = clubNames.filter((n) => n === clubName).length;
      return spells > 1 ? `${clubName} (${SPELL_WORDS[spells] ?? spells} stints)` : clubName;
    });
    faq.push({
      question: `What teams has ${name} played for?`,
      answer: `${name} has played for the ${listWords(clubs)}.`,
    });
  }

  if (player.number && team) {
    faq.push({
      question: `What number does ${name} wear?`,
      answer: `${name} wears number ${player.number} for the ${team.fullName}.`,
    });
  }

  return {
    facts: facts_,
    draft:
      draftYear !== null && draft?.round && draft?.pick
        ? {
            year: draftYear,
            round: draft?.round ?? null,
            pick: draft?.pick ?? null,
            team: draftTeam,
            teamCode: draft?.draft_team ?? null,
            college,
          }
        : null,
    stints,

    college,
    narrative,
    faq,
    empty: facts_.length === 0 && stints.length === 0,
  };
}

/** The position, spelled out, for prose that should not read as a stat sheet. */
const POSITION_WORDS: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
};
