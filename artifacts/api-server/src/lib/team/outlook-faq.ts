/**
 * The questions a team's draft take gets asked, answered from the take itself.
 *
 * Derived, not written. Every other block on the Outlook tab is generated from
 * something - a rank, a snap count, a designation - and outlook.ts is the one
 * exception, a hand-written opinion kept in source. This module exists so that
 * the exception stays exactly one file: an outlook written for a team is the
 * only thing anybody has to author, and the FAQ under it follows. Thirty-two
 * hand-written FAQs would be thirty-two more chances for the answer to disagree
 * with the card two inches above it, and a contradiction is worse here than
 * anywhere else on the page - this is the block a search engine quotes without
 * the card beside it.
 *
 * So the rule is the one player/game-log-faq.ts runs on, and it has no
 * exceptions: every answer restates something the outlook already printed. The
 * tier, the thesis, the bottom line. Nothing is inferred from them - an answer
 * saying who leads the team in targets would be a new claim, made in the voice
 * of the section that is supposed to be quoting.
 *
 * The questions are the searched forms rather than the section's own language:
 * "Who is the Patriots WR2", "Is X worth drafting". That is the whole reason a
 * block like this exists, and it is why the generated text says "offense" while
 * the hand-written notes above it say "offence" - the query is spelled the
 * American way and the FAQ is answering the query.
 *
 * Entries are skipped rather than padded. A team whose outlook names one
 * running back gets no "is the backup worth drafting" question, because there
 * is no second card to answer it from.
 */

import type { NflTeam } from "./teams";
import type { OutlookPlayer, TeamOutlook } from "./outlook";

export interface OutlookFaq {
  question: string;
  answer: string;
}

/**
 * The surname, suffixes dropped.
 *
 * A local copy of player/bio.ts's helper rather than an import: player/ already
 * depends on team/ (bio.ts reads team/teams.ts), and reaching back the other way
 * for six lines would make the two directories mutually dependent for the sake
 * of a string split. If a third caller ever appears, this is the pair to move
 * down into lib/render.ts.
 */
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

function surname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  while (parts.length > 1) {
    const last = (parts[parts.length - 1] ?? "").toLowerCase();
    if (!NAME_SUFFIXES.has(last)) break;
    parts.pop();
  }
  return parts[parts.length - 1] ?? fullName;
}

/** Openers that are already an article, and must not be given a second one. */
const DETERMINERS = new Set(["a", "an", "the", "his", "its", "their", "one"]);

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * Letters whose NAME opens on a vowel: "an RB2", "an FLEX", "a WR3", "a TE1".
 *
 * Needed because a tier is as likely to start with an initialism as with a
 * word, and the two take opposite articles from the same letter - "a receiver"
 * but "an RB2".
 */
const VOWEL_INITIALS = new Set([
  "A", "E", "F", "H", "I", "L", "M", "N", "O", "R", "S", "X",
]);

/**
 * A tier as it reads mid-sentence: "an elite QB1", "an RB2 / FLEX".
 *
 * The card prints the tier as a label, capitalised and standing alone. A
 * sentence needs it lowercased and behind an article - but only when it is a
 * word. "RB2 / FLEX" is a position code and lowercasing it produces "rB2",
 * so the capitals survive whenever the first token carries none of its own.
 *
 * The article is a guess on a hand-written string, and it can be wrong on a
 * tier nobody has written yet ("a unique role" would come out "an"). That is a
 * cosmetic slip in one sentence, which is the right thing to risk here; the
 * alternative was a vocabulary of allowed tiers, and outlook.ts is deliberately
 * free of one so a team can be described in its own terms.
 *
 * Nothing may be appended after a tier by a caller. A tier is a written phrase
 * and some of them end in a clause - "Top-five QB1, health permitting" - so a
 * trailing " for 2026" lands inside the qualifier instead of after it and the
 * sentence comes apart. Every season, team and "behind X" qualifier in this
 * module is therefore in FRONT of the tier, which is also why several of these
 * answers open on a clause rather than a name.
 *
 * A tier that already opens on a determiner keeps it and gets none of its own.
 * "The first pick" is a real tier in the table below, and "a the first pick" is
 * the one failure of this function that a reader would actually stop on.
 */
function tierPhrase(tier: string): string {
  const trimmed = tier.trim();
  if (!trimmed) return "";

  const first = trimmed.split(/\s+/)[0] ?? "";
  if (DETERMINERS.has(first.toLowerCase())) return trimmed;
  const initialism = !/[a-z]/.test(first);
  const body = initialism
    ? trimmed
    : trimmed.charAt(0).toLowerCase() + trimmed.slice(1);

  const head = body.charAt(0);
  const an = initialism
    ? VOWEL_INITIALS.has(head.toUpperCase())
    : VOWELS.has(head.toLowerCase());

  return `${an ? "an" : "a"} ${body}`;
}

/**
 * A quoted line, punctuated.
 *
 * The theses and bottom lines in outlook.ts all end in a full stop today, and
 * this is what stops the first one that does not from running into the next
 * sentence of a generated answer.
 */
function stop(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function atPosition(players: OutlookPlayer[], position: string): OutlookPlayer[] {
  return players.filter((p) => p.position.trim().toUpperCase() === position);
}

/**
 * The FAQ for a team's outlook, in the order it is read.
 *
 * Group order carries the ranking: outlook.ts puts the core band first and the
 * players inside a band in the order they matter, so "the first RB in the list"
 * is the lead back without this module having to judge it. That is the same
 * assumption the section's own layout makes, which is why a derived FAQ can be
 * trusted to agree with the cards.
 */
export function outlookFaq(team: NflTeam, outlook: TeamOutlook): OutlookFaq[] {
  const players = outlook.groups.flatMap((group) => group.players);
  if (players.length === 0) return [];

  const { season } = outlook;
  const club = team.fullName;
  const nick = team.nickname;
  const faq: OutlookFaq[] = [];

  // The core band if there is one, and the whole list if the outlook was
  // written as a single group - "the best two players" is a question every
  // team can answer, and the band labels are per-team by design.
  const core = outlook.groups[0]?.players ?? [];
  const headline = (core.length >= 2 ? core : players).slice(0, 2);

  if (headline.length === 2) {
    const [first, second] = headline as [OutlookPlayer, OutlookPlayer];
    faq.push({
      question: `Who are the best ${club} players to draft in fantasy football in ${season}?`,
      answer:
        `${first.name} and ${second.name} are the top fantasy options for the ` +
        `${nick} in ${season}. ${first.name} projects as ${tierPhrase(first.tier)}. ` +
        `${second.name} projects as ${tierPhrase(second.tier)}.`,
    });
  }

  const qb = atPosition(players, "QB")[0];
  if (qb) {
    // "Is he a QB1" only when the outlook says he is one. Asked of a tier that
    // does not mention QB1, the question invites a "no" the section never
    // wrote, so the neutral form is used instead.
    const qb1 = /QB1/i.test(qb.tier);
    faq.push({
      question: qb1
        ? `Is ${qb.name} a QB1 in fantasy football in ${season}?`
        : `What is ${qb.name}'s fantasy outlook in ${season}?`,
      answer:
        (qb1 ? "Yes. " : "") +
        `In ${season}, ${surname(qb.name)} projects as ${tierPhrase(qb.tier)}. ` +
        stop(qb.thesis),
    });
  }

  const wrs = atPosition(players, "WR");
  const [wr1, wr2] = wrs;
  if (wr1) {
    faq.push({
      question: `What is ${wr1.name}'s fantasy outlook with the ${nick}?`,
      answer:
        `In ${season}, ${surname(wr1.name)} projects as ${tierPhrase(wr1.tier)}. ` +
        stop(wr1.thesis),
    });
  }

  const rbs = atPosition(players, "RB");
  const [rb1, rb2] = rbs;
  if (rb1) {
    faq.push({
      question: `Who is the ${club} starting running back in ${season}?`,
      answer:
        // The thesis is left off this one: a lead back's one-line claim is
        // usually that he is the lead back, and the sentence before it has
        // just said so.
        `${rb1.name} leads the ${nick} backfield in ${season} and projects as ` +
        `${tierPhrase(rb1.tier)}.` +
        (rb2
          ? ` ${rb2.name} is the other half of the backfield, ${tierPhrase(rb2.tier)}.`
          : ""),
    });
  }

  if (rb1 && rb2) {
    faq.push({
      question: `Is ${rb2.name} worth drafting in fantasy football in ${season}?`,
      answer:
        `Behind ${rb1.name}, ${surname(rb2.name)} projects as ` +
        `${tierPhrase(rb2.tier)}. ${stop(rb2.thesis)}`,
    });
  }

  if (wr1 && wr2) {
    faq.push({
      question: `Who is the ${nick} WR2 behind ${wr1.name}?`,
      answer:
        `Behind ${wr1.name}, ${wr2.name} projects as ${tierPhrase(wr2.tier)}. ` +
        stop(wr2.thesis),
    });
  }

  const te = atPosition(players, "TE")[0];
  if (te) {
    faq.push({
      question: `Is ${te.name} a good fantasy tight end in ${season}?`,
      answer:
        `In ${season}, ${surname(te.name)} projects as ${tierPhrase(te.tier)}. ` +
        stop(te.thesis),
    });
  }

  // The sleeper is whichever card the outlook filed as one. There is no
  // fallback to "the last player listed": a team whose outlook names nobody
  // speculative does not have a sleeper, and inventing one out of list order
  // would be this module's first original claim.
  const sleeper = players.find((p) => /sleeper|late[-\s]round|deep/i.test(p.tier));
  if (sleeper) {
    faq.push({
      question: `Who is the ${club} fantasy football sleeper for ${season}?`,
      answer:
        `${sleeper.name} is the ${nick} sleeper to watch in ${season}. ` +
        stop(sleeper.thesis),
    });
  }

  if (outlook.bottomLine.trim()) {
    faq.push({
      question: `Is the ${club} offense good for fantasy football in ${season}?`,
      answer:
        (headline.length === 2
          ? `${headline[0]?.name} and ${headline[1]?.name} headline the ${nick} ` +
            `in ${season}. `
          : "") + stop(outlook.bottomLine),
    });
  }

  return faq;
}
