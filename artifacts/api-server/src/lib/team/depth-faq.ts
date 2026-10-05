/**
 * The questions a depth chart gets asked, answered from the same rows.
 *
 * Third sibling to outlook-faq.ts and stats-faq.ts, on the same rule as both:
 * every answer restates something the tab already printed. The names and the
 * order here are the ones the chart renders - the depth-charts tool's Fantasy
 * view, with its own rank as the slot - so an answer cannot name a WR2 the
 * chart above it has at WR3.
 *
 * Two things separate it from its siblings.
 *
 * First, no season. An outlook is written for a year and a stat line averages
 * one, so both say which; a depth chart is the roster as it stands this
 * morning. "In 2026" on an answer that a trade invalidates at lunchtime reads
 * as a claim about the year, so these are present tense throughout, and the
 * last question says outright that the chart moves.
 *
 * Second, no pronouns. "Tommy DeVito is listed behind him" needs the previous
 * sentence to be parsed; "behind Drake Maye" does not, and a reader arriving
 * from a search for the backup quarterback gets both names in the answer they
 * landed on.
 *
 * On overlap with the outlook's FAQ: that one asks about draft value in a named
 * season ("Who is the Patriots starting running back in 2026?") and answers
 * from hand-written copy; this one asks what the chart says today. The seasoned
 * phrasing there and the present tense here are what keep two questions from
 * reading as the same question - see the note in outlook-faq.ts.
 */

import type { NflTeam } from "./teams";
import { sidelinedBehind } from "./roster";
import type { DepthChartEntry, SkillPosition } from "./roster";

/** What an answer reads from a chart row. */
export type FaqEntry = Pick<DepthChartEntry, "name" | "slot" | "position" | "injuryStatus">;

export interface DepthFaq {
  question: string;
  answer: string;
}

/**
 * "the Patriots'", "the Rams'".
 *
 * Every current nickname ends in s, so this is the apostrophe-only form in
 * practice; the other branch is there so a relocation that renames a club does
 * not need this file edited to read correctly.
 */
function possessive(nickname: string): string {
  return nickname.endsWith("s") ? `${nickname}'` : `${nickname}'s`;
}

/** "A", "A and B", "A, B and C" - the Oxford-less form the rest of the page uses. */
function listOf(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A designation, as a sentence says it.
 *
 * Falls back to "out" rather than printing the raw code: "with A.J. Brown DNR"
 * is not a sentence, and the distinction between the codes this does not name
 * is not one a fantasy reader needs from a depth chart answer.
 */
function designation(status: string | null | undefined): string {
  switch ((status ?? "").trim().toLowerCase()) {
    case "ir":
      return "on injured reserve";
    case "pup":
      return "on the PUP list";
    case "nfi":
      return "on the non-football injury list";
    case "sus":
      return "suspended";
    default:
      return "out";
  }
}

export function depthFaq(input: {
  team: NflTeam;
  /** The chart's rows that are available, in order. */
  depthChart: Record<SkillPosition, FaqEntry[]>;
  /**
   * The chart's rows carrying an out designation (IR, Out, PUP...).
   *
   * Kept out of `depthChart` so "X leads the backfield" names somebody who is
   * playing, and named separately so the answer says why the order skips a
   * player - a reader who knows the roster reads a silent gap as a wrong page.
   */
  injuries: FaqEntry[];
}): DepthFaq[] {
  const { team, depthChart, injuries } = input;
  const club = team.fullName;
  const nick = team.nickname;
  const city = team.city;

  const at = (position: SkillPosition): FaqEntry[] =>
    depthChart[position] ?? [];
  const qb = at("QB");
  const rb = at("RB");
  const wr = at("WR");
  const te = at("TE");

  // Nothing to answer from. A chart that rendered no groups renders no
  // questions either, rather than a block of sentences naming nobody.
  if (!qb.length && !rb.length && !wr.length && !te.length) return [];

  const faq: DepthFaq[] = [];
  const name = (entry: FaqEntry | undefined): string => entry?.name ?? "";

  /**
   * "with A.J. Brown on injured reserve", or "" when nobody at this position is.
   *
   * The chart's own out rows, so the prose and the columns name the same
   * absences - see sidelinedBehind() in roster.ts.
   */
  const missing = (position: SkillPosition, shown: FaqEntry[]): FaqEntry[] =>
    sidelinedBehind(injuries, position, shown);

  // One name takes its own designation; several share the general word, because
  // "A and B on injured reserve and C suspended" is a list a reader has to
  // unpick rather than a qualifier they can absorb.
  const who = (out: FaqEntry[]): string =>
    out.length === 1 && out[0]
      ? `${out[0].name} ${designation(out[0].injuryStatus)}`
      : `${listOf(out.map((entry) => entry.name))} out`;

  /** " with A.J. Brown on injured reserve" - only where it ends the sentence. */
  const sidelinedClause = (position: SkillPosition, shown: FaqEntry[]): string => {
    const out = missing(position, shown);
    return out.length ? ` with ${who(out)}` : "";
  };

  /**
   * " A.J. Brown is on injured reserve." - for the answers that carry a second
   * clause of their own. Stacking two "with" phrases on one sentence ("the
   * starting tight end with X out, with Y listed behind") is a sentence nobody
   * finishes.
   */
  const sidelinedSentence = (position: SkillPosition, shown: FaqEntry[]): string => {
    const out = missing(position, shown);
    if (out.length === 0) return "";
    return out.length === 1 && out[0]
      ? ` ${out[0].name} is ${designation(out[0].injuryStatus)}.`
      : ` ${listOf(out.map((entry) => entry.name))} are out.`;
  };

  /* ------------------------------------------------------------- quarterback */

  if (qb[0]) {
    faq.push({
      question: `Who is the ${club} starting quarterback?`,
      answer:
        `${name(qb[0])} is the ${possessive(nick)} starting quarterback.` +
        (qb[1]
          ? ` ${name(qb[1])} is listed behind ${name(qb[0])} on the fantasy depth chart.`
          : "") +
        sidelinedSentence("QB", qb),
    });
  }

  /* ------------------------------------------------------------ running back */

  if (rb[0]) {
    const rest = rb.slice(1).map((entry) => entry.name);
    faq.push({
      question: `Who is the ${club} starting running back?`,
      answer:
        `${name(rb[0])} leads the ${nick} running back depth chart` +
        (rest.length ? `, followed by ${listOf(rest)}.` : ".") +
        sidelinedSentence("RB", rb),
    });
  }

  /* ------------------------------------------------------------ wide receiver */

  if (wr[0]) {
    const rest = wr.slice(1).map((entry) => entry.name);
    faq.push({
      question: `Who is the ${nick} WR1?`,
      answer:
        `${name(wr[0])} is listed as the ${possessive(nick)} WR1 on the current fantasy depth chart${sidelinedClause("WR", wr)}.` +
        (rest.length
          ? ` ${listOf(rest)} follow ${name(wr[0])} in the wide receiver rotation.`
          : ""),
    });
  }

  // The whole room, in slot order. Distinct from the WR1 question above rather
  // than a longer version of it: one is looking up a player, the other is
  // looking up an ordering, and they are different searches.
  if (wr.length > 1) {
    faq.push({
      question: `What is the ${club} wide receiver depth chart?`,
      answer:
        `${city}'s fantasy wide receiver depth chart currently lists ` +
        // The chart's own slot labels, not a count: if it ran out of "WR4" and
        // called someone else something different, the sentence says that.
        `${listOf(wr.map((entry) => `${entry.name} as ${entry.slot}`))}.` +
        sidelinedSentence("WR", wr),
    });
  }

  /* -------------------------------------------------------------- tight end */

  if (te[0]) {
    faq.push({
      question: `Who is the ${club} starting tight end?`,
      answer:
        `${name(te[0])} is the ${possessive(nick)} starting tight end` +
        (te[1]
          ? `, with ${name(te[1])} listed behind ${name(te[0])} at ${te[1].slot}.`
          : ".") +
        sidelinedSentence("TE", te),
    });
  }

  /* --------------------------------------------------------- backup QB, last */

  // After the starters, because it is the follow-up question: a reader asking
  // who the backup is has usually just been told who the starter is.
  if (qb[1] && qb[0]) {
    faq.push({
      question: `Who is the ${club} backup quarterback?`,
      answer:
        `${name(qb[1])} is the backup quarterback behind ${name(qb[0])} ` +
        `on the current ${nick} fantasy depth chart.`,
    });
  }

  faq.push({
    question: `How often is the ${nick} depth chart updated?`,
    answer:
      `The ${nick} fantasy depth chart is updated as roster moves, injuries ` +
      `and role changes affect the team's offensive hierarchy.`,
  });

  return faq;
}
