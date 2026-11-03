/**
 * The questions a depth chart gets asked, answered from the same rows.
 *
 * Third sibling to outlook-faq.ts and stats-faq.ts, on the same rule as both:
 * every answer restates something the tab already printed. Two charts feed it
 * since 2026-11-03 and the answers keep them apart, because they answer
 * different searches:
 *
 *   - the FOOTBALL chart (offense slots as the club lists them, three WR slots
 *     and all) answers "who starts": starting quarterback, running back, the
 *     starting wide receivers, tight end, backup quarterback;
 *   - the FANTASY chart (StatChasers' hierarchy, WR1 / WR2 / WR3) answers
 *     "who is the WR1", and says in as many words that it is a fantasy order.
 *
 * Two things carried over from the first version.
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
 */

import type { NflTeam } from "./teams";
import { isOutDesignation } from "./roster";
import type { SkillPosition } from "./roster";

/** What an answer reads from a chart row. */
export interface FaqEntry {
  name: string;
  /** The chart's own label for the row: "WR2" on the fantasy chart, "WR" on the football one. */
  slot: string;
  position: SkillPosition | string;
  injuryStatus: string | null;
}

/** One football slot as the FAQ reads it: the row label and its depth string. */
export interface FaqSlot {
  pos: string;
  rows: FaqEntry[];
}

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

const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six"];

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

const out = (entry: FaqEntry | undefined): boolean => !!entry && isOutDesignation(entry.injuryStatus);

export function depthFaq(input: {
  team: NflTeam;
  /**
   * The football chart's offensive slots, in the chart's order, every row
   * kept (a starter on injured reserve is still the listed starter, and the
   * answer says both things).
   */
  offense: FaqSlot[];
  /**
   * True when the football chart is folded from the column views (an older
   * document): one WR row holding every receiver, so "three starting slots"
   * cannot be claimed from it.
   */
  folded: boolean;
  /** The fantasy chart's available rows per position, in order. */
  fantasy: Record<SkillPosition, FaqEntry[]>;
  /** The fantasy chart's rows carrying an out designation. */
  fantasyInjuries: FaqEntry[];
}): DepthFaq[] {
  const { team, offense, folded, fantasy, fantasyInjuries } = input;
  const club = team.fullName;
  const nick = team.nickname;

  const slotsAt = (pos: string): FaqSlot[] => offense.filter((slot) => slot.pos === pos && slot.rows.length);
  const qbSlot = slotsAt("QB")[0];
  const rbSlot = slotsAt("RB")[0];
  const teSlot = slotsAt("TE")[0];
  const wrSlots = slotsAt("WR");

  const fan = (position: SkillPosition): FaqEntry[] => fantasy[position] ?? [];
  const fanWr = fan("WR");
  const fanRb = fan("RB");

  // Nothing to answer from. A chart that rendered no groups renders no
  // questions either, rather than a block of sentences naming nobody.
  if (!qbSlot && !rbSlot && !teSlot && wrSlots.length === 0 && !fanWr.length && !fanRb.length) return [];

  const faq: DepthFaq[] = [];
  const name = (entry: FaqEntry | undefined): string => entry?.name ?? "";

  /**
   * " Josh Allen is on injured reserve." for a listed starter who is not
   * playing: the chart still lists him first, and the answer says both.
   */
  const starterOut = (entry: FaqEntry | undefined): string =>
    out(entry) ? ` ${name(entry)} is ${designation(entry!.injuryStatus)}.` : "";

  /* ------------------------------------------------------------- quarterback */

  if (qbSlot?.rows[0]) {
    const [qb1, qb2] = qbSlot.rows;
    faq.push({
      question: `Who is the ${club} starting quarterback?`,
      answer:
        `${name(qb1)} is the ${possessive(nick)} starting quarterback on the team depth chart` +
        (qb2 ? `, with ${name(qb2)} listed as the backup.` : ".") +
        starterOut(qb1),
    });
  }

  /* ------------------------------------------------------------ running back */

  if (rbSlot?.rows[0]) {
    const [rb1, ...rest] = rbSlot.rows;
    faq.push({
      question: `Who is the ${club} starting running back?`,
      answer:
        `${name(rb1)} is listed as the ${possessive(nick)} starting running back` +
        (rest.length ? `, with ${listOf(rest.map((r) => r.name))} behind ${name(rb1)} on the depth chart.` : ".") +
        starterOut(rb1) +
        (fanRb.length > 1 && fanRb[0]
          ? ` For fantasy, StatChasers ranks ${name(fanRb[0])} as the ${nick} RB1 and ${name(fanRb[1])} as RB2.`
          : ""),
    });
  }

  /* ------------------------------------------------------------ wide receiver */

  if (wrSlots.length > 0) {
    const starters = wrSlots.map((slot) => slot.rows[0]).filter((r): r is FaqEntry => !!r);
    const backups = wrSlots.flatMap((slot) => slot.rows.slice(1)).map((r) => r.name);
    if (!folded && wrSlots.length > 1) {
      const count = COUNT_WORDS[starters.length] ?? String(starters.length);
      faq.push({
        question: `Who are the ${club} starting wide receivers?`,
        answer:
          `The ${nick} list ${count} starting wide receivers on the team depth chart: ${listOf(starters.map((s) => s.name))}.` +
          (backups.length ? ` ${listOf(backups)} are the receivers behind them.` : "") +
          starters.filter(out).map((s) => ` ${s.name} is ${designation(s.injuryStatus)}.`).join(""),
      });
    } else {
      // One folded WR row: the chart does not say how many slots start, so
      // the answer lists the order and claims nothing about slot counts.
      const rows = wrSlots[0]?.rows ?? [];
      faq.push({
        question: `Who are the ${club} starting wide receivers?`,
        answer:
          `The ${nick} wide receiver depth chart lists ${listOf(rows.slice(0, 3).map((r) => r.name))} first` +
          (rows.length > 3 ? `, with ${listOf(rows.slice(3).map((r) => r.name))} behind them.` : ".") +
          rows.slice(0, 3).filter(out).map((s) => ` ${s.name} is ${designation(s.injuryStatus)}.`).join(""),
      });
    }
  }

  // The fantasy order, named as such. Distinct from the question above rather
  // than a longer version of it: one asks who starts, the other who to start.
  if (fanWr[0]) {
    const rest = fanWr.slice(1, 4).map((entry) => entry.name);
    const sidelined = fantasyInjuries.filter((entry) => entry.position === "WR");
    faq.push({
      question: `Who is the ${nick} WR1 for fantasy football?`,
      answer:
        `${name(fanWr[0])} is the ${possessive(nick)} WR1 on StatChasers' fantasy depth chart` +
        (rest.length ? `, followed by ${listOf(rest)}.` : ".") +
        ` The fantasy order ranks receivers by fantasy value and can differ from the starting slots on the team depth chart.` +
        (sidelined.length === 1 && sidelined[0]
          ? ` ${sidelined[0].name} is ${designation(sidelined[0].injuryStatus)}.`
          : sidelined.length > 1
            ? ` ${listOf(sidelined.map((entry) => entry.name))} are out.`
            : ""),
    });
  }

  /* -------------------------------------------------------------- tight end */

  if (teSlot?.rows[0]) {
    const [te1, te2] = teSlot.rows;
    faq.push({
      question: `Who is the ${club} starting tight end?`,
      answer:
        `${name(te1)} is the ${possessive(nick)} starting tight end` +
        (te2 ? `, with ${name(te2)} listed behind ${name(te1)} on the depth chart.` : ".") +
        starterOut(te1),
    });
  }

  /* --------------------------------------------------------- backup QB, last */

  // After the starters, because it is the follow-up question: a reader asking
  // who the backup is has usually just been told who the starter is.
  if (qbSlot?.rows[1] && qbSlot.rows[0]) {
    const [qb1, qb2, qb3] = qbSlot.rows;
    faq.push({
      question: `Who is the ${club} backup quarterback?`,
      answer:
        `${name(qb2)} is the ${nick} backup quarterback behind ${name(qb1)} on the team depth chart` +
        (qb3 ? `, with ${name(qb3)} listed third.` : "."),
    });
  }

  faq.push({
    question: `How often is the ${nick} depth chart updated?`,
    answer:
      `The ${nick} depth chart on StatChasers is refreshed as the club's published depth chart, ` +
      `injury designations and roster moves change; the last update time is shown at the top of the page. ` +
      `The fantasy hierarchy beneath it moves with roles and performance, not only with the team's listing.`,
  });

  return faq;
}
