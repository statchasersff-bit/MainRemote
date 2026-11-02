/**
 * The Draft tab's FAQ (mak's spec, 2026-11-02): sixteen club-specific
 * questions aimed at "<club> draft picks <year>", "draft history", "first-
 * round picks", "future draft picks" and "draft classes" searches, every
 * figure written in from the draft view so the 32 pages differ in substance
 * and not just in the club's name. A question the view cannot answer for a
 * club is left out.
 */

import type { NflTeam } from "./teams";
import { getTeamByAbbreviation } from "./teams";
import type { DraftCapitalView, DraftHistoryView, DraftPick, DraftView } from "./draft";
import { pickCategory } from "./draft";
import type { FaqItem } from "./faq-block";

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

const ROUND_WORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
const COUNT_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** "nine", "10": words under ten, numerals from there. */
const count = (n: number): string => COUNT_WORD[n] ?? String(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const POSITION_WORD: Record<string, string> = {
  QB: "quarterback", RB: "running back", FB: "fullback", WR: "wide receiver", TE: "tight end",
  OT: "offensive tackle", T: "offensive tackle", OL: "offensive lineman", G: "guard", OG: "guard", C: "center",
  DE: "defensive end", DT: "defensive tackle", NT: "nose tackle", DL: "defensive lineman", EDGE: "edge rusher",
  LB: "linebacker", ILB: "linebacker", OLB: "linebacker", CB: "cornerback", S: "safety", FS: "safety", SS: "safety",
  DB: "defensive back", K: "kicker", P: "punter", LS: "long snapper",
};
const positionWord = (p: DraftPick) => POSITION_WORD[p.position] ?? POSITION_WORD[p.category] ?? p.position.toLowerCase();

const CATEGORY_WORD: Record<string, string> = {
  QB: "quarterbacks", RB: "running backs", WR: "wide receivers", TE: "tight ends", OL: "offensive linemen",
  DL: "defensive linemen", LB: "linebackers", DB: "defensive backs", ST: "specialists",
};
const CATEGORY_GROUP: Record<string, string> = {
  QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end", OL: "offensive line",
  DL: "defensive line", LB: "linebacker", DB: "defensive back", ST: "specialist",
};

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

const nick = (abbr: string): string => getTeamByAbbreviation(abbr)?.nickname ?? abbr.toUpperCase();

/** "Rounds 1 through 4", "Rounds 1, 2 and 4", "Round 3". */
function roundRange(rounds: number[]): string {
  if (rounds.length === 0) return "";
  if (rounds.length === 1) return `Round ${rounds[0]}`;
  const first = rounds[0] as number;
  const last = rounds[rounds.length - 1] as number;
  if (last - first === rounds.length - 1) return `Rounds ${first} through ${last}`;
  return `Rounds ${rounds.slice(0, -1).join(", ")} and ${last}`;
}

interface Names {
  nick: string;
  poss: string;
  place: string;
  placePoss: string;
  /** "carries" / "carry" etc.: whether `place` is plural ("the Giants"). */
  plural: boolean;
}

function names(team: NflTeam): Names {
  const nick = team.nickname;
  const poss = /s$/.test(nick) ? `${nick}'` : `${nick}'s`;
  const ambiguous = /^(New York|Los Angeles)$/.test(team.city);
  return {
    nick,
    poss,
    place: ambiguous ? `the ${nick}` : team.city,
    placePoss: ambiguous ? `the ${poss}` : `${team.city}'s`,
    plural: ambiguous,
  };
}

/* ------------------------------------------------------------ capital */

function capitalFaq(team: NflTeam, c: DraftCapitalView, n: Names): FaqItem[] {
  const out: FaqItem[] = [];
  const yr = c.draftYear;
  const held = c.rounds.filter((r) => r.holds.length > 0);

  // "their own picks in Rounds 1 through 4, an acquired fifth-round pick,
  // four sixth-round selections, and one seventh-round pick"
  const ownOnly = held.filter((r) => r.holds.length === 1 && r.holds[0]?.from === null).map((r) => r.round);
  const parts: string[] = [];
  if (ownOnly.length) parts.push(`their own ${ownOnly.length === 1 ? "pick" : "picks"} in ${roundRange(ownOnly)}`);
  for (const r of held) {
    if (ownOnly.includes(r.round)) continue;
    const word = ROUND_WORD[r.round] ?? ordinal(r.round);
    if (r.holds.length === 1) parts.push(`an acquired ${word}-round pick`);
    else parts.push(`${count(r.holds.length)} ${word}-round selections`);
  }
  out.push({
    question: `How many picks do the ${n.nick} have in the ${yr} NFL Draft?`,
    answer: [
      `The ${team.fullName} currently hold ${c.total} ${c.total === 1 ? "pick" : "picks"} in the ${yr} NFL Draft.` +
        (parts.length ? ` That includes ${list(parts)}.` : ""),
      `Compensatory selections can still be added after they are officially awarded by the NFL.`,
    ],
  });

  const lines = c.rounds
    .filter((r) => r.holds.length > 0)
    .map((r) => {
      const own = r.holds.some((h) => h.from === null);
      const from = r.holds.filter((h) => h.from !== null).map((h) => nick(h.from as string));
      let text: string;
      if (own && from.length === 0) text = `${n.poss} own pick`;
      else if (own) text = `${n.poss} own pick plus ${from.length === 1 ? "a pick" : "picks"} from the ${list(from)}`;
      else if (from.length === 1) text = `pick acquired from the ${from[0]}`;
      else text = `picks acquired from the ${list(from)}`;
      return `Round ${r.round}: ${text}`;
    });
  const sentAway = c.sent.map((s) => `${ROUND_WORD[s.round] ?? ordinal(s.round)}-round pick was traded to the ${nick(s.to)}`);
  out.push({
    question: `What draft picks do the ${n.nick} have in ${yr}?`,
    answer: [
      `${cap(n.place)} currently ${n.plural ? "own" : "owns"} ${c.total} ${c.total === 1 ? "selection" : "selections"} in the ${yr} NFL Draft:`,
      { list: lines },
      ...(sentAway.length
        ? [
            sentAway.length === 1
              ? `The ${n.poss} original ${sentAway[0]}.`
              : `The ${n.poss} original ${sentAway.slice(0, -1).join(", ")}, while their original ${sentAway[sentAway.length - 1]}.`,
          ]
        : []),
    ],
  });

  const r1 = c.rounds[0];
  const ownR1 = r1?.holds.some((h) => h.from === null) ?? false;
  const r1From = r1?.holds.filter((h) => h.from !== null).map((h) => nick(h.from as string)) ?? [];
  const r1To = c.sent.find((s) => s.round === 1);
  out.push({
    question: `Do the ${n.nick} have a first-round pick in the ${yr} NFL Draft?`,
    answer: [
      ownR1
        ? `Yes. The ${n.nick} currently own their ${yr} first-round pick` +
          (r1From.length ? `, plus ${r1From.length === 1 ? "a first-round pick" : "first-round picks"} acquired from the ${list(r1From)}` : "") +
          `. The exact selection ${r1From.length ? "numbers" : "number"} will not be determined until the ${yr - 1} NFL season and postseason are completed.`
        : r1From.length
          ? `Yes, but not their own. The ${n.poss} original ${yr} first-round pick ${r1To ? `is held by the ${nick(r1To.to)}` : "has been traded"}, and ${n.place} currently ${n.plural ? "hold" : "holds"} ${r1From.length === 1 ? "a first-round pick" : "first-round picks"} acquired from the ${list(r1From)}.`
          : `No. The ${n.poss} ${yr} first-round pick ${r1To ? `is held by the ${nick(r1To.to)}` : "is not currently in their possession"}.`,
    ],
  });

  const fromClubs = [...new Set(c.holds.filter((h) => h.from !== null).map((h) => nick(h.from as string)))];
  const stacked = [...c.rounds].sort((a, b) => b.holds.length - a.holds.length)[0];
  out.push({
    question: `How many extra draft picks do the ${n.nick} have in ${yr}?`,
    answer: c.acquired
      ? [
          `${cap(n.place)} currently ${n.plural ? "have" : "has"} ${count(c.acquired)} acquired ${c.acquired === 1 ? "draft pick" : "draft picks"} in the ${yr} NFL Draft. The ${n.nick} have added ${c.acquired === 1 ? "a selection" : "selections"} from the ${list(fromClubs)}.`,
          ...(stacked && stacked.holds.length > 1
            ? [
                `Their largest concentration of extra draft capital is in Round ${stacked.round}, where ${n.place} currently ${n.plural ? "own" : "owns"} ${count(stacked.holds.length)} picks.`,
              ]
            : []),
        ]
      : [`None at the moment. Every ${yr} selection the ${n.nick} hold is one of their own original picks.`],
  });

  out.push({
    question: `Have the ${n.nick} traded away any ${yr} draft picks?`,
    answer: [
      c.sent.length
        ? `Yes. ${cap(n.place)} ${n.plural ? "have" : "has"} traded away ${count(c.sent.length)} of ${n.plural ? "their" : "its"} original ${yr} ${c.sent.length === 1 ? "selection" : "selections"}. ` +
          list(c.sent.map((s, i) => `${i === 0 ? `The ${n.poss} own` : "their original"} ${ROUND_WORD[s.round] ?? ordinal(s.round)}-round pick is held by the ${nick(s.to)}`)) +
          `.`
        : `No. ${cap(n.place)} currently ${n.plural ? "hold" : "holds"} every one of ${n.plural ? "their" : "its"} original ${yr} selections.`,
    ],
  });

  const day2 = c.rounds.filter((r) => r.round === 2 || r.round === 3);
  const day2Acquired = day2.flatMap((r) => r.holds.filter((h) => h.from !== null));
  const day2Own = day2.filter((r) => r.holds.some((h) => h.from === null)).length;
  const day3Acquired = c.rounds.filter((r) => r.round >= 4).reduce((s, r) => s + r.holds.filter((h) => h.from !== null).length, 0);
  out.push({
    question: `Do the ${n.nick} have any extra Day 2 picks in ${yr}?`,
    answer: day2Acquired.length
      ? [
          `Yes. The ${n.nick} currently hold ${count(day2Acquired.length)} acquired Day 2 ${day2Acquired.length === 1 ? "pick" : "picks"} (Rounds 2 and 3), from the ${list([...new Set(day2Acquired.map((h) => nick(h.from as string)))])}.`,
        ]
      : [
          day2Own === 2
            ? `No. The ${n.nick} currently hold only their own selections in Rounds 2 and 3, which make up Day 2 of the NFL Draft.`
            : `No. The ${n.nick} currently hold ${count(day2.reduce((s, r) => s + r.holds.length, 0))} Day 2 ${day2.reduce((s, r) => s + r.holds.length, 0) === 1 ? "selection" : "selections"} (Rounds 2 and 3), none of them acquired.`,
          ...(day3Acquired ? [`Most of ${n.placePoss} additional ${yr} draft capital is currently concentrated on Day 3.`] : []),
        ],
  });

  return out;
}

/* ------------------------------------------------------------ history */

function historyFaq(team: NflTeam, h: DraftHistoryView, n: Names): FaqItem[] {
  const out: FaqItem[] = [];
  const span = `${h.firstSeason} through ${h.lastSeason}`;
  const years = h.seasons.length;
  const all = h.seasons.flatMap((s) => s.picks);

  out.push({
    question: `How many players have the ${n.nick} drafted over the last ${count(years)} years?`,
    answer: [
      `The ${n.nick} selected ${h.total} players from the ${span} NFL Drafts.`,
      `${cap(n.place)} made ${list([...h.seasons].sort((a, b) => a.season - b.season).map((s, i) => `${count(s.picks.length)} ${i === 0 ? "selections " : ""}in ${s.season}`))}.`,
    ],
  });

  const firsts = [...h.roundOnePicks].sort((a, b) => b.season - a.season || a.pick - b.pick);
  if (firsts.length) {
    const missing = h.seasons.filter((s) => !s.picks.some((p) => p.round === 1)).map((s) => s.season);
    const groups = new Map<string, number>();
    for (const p of firsts) groups.set(pickCategory(p), (groups.get(pickCategory(p)) ?? 0) + 1);
    const top = [...groups].sort((a, b) => b[1] - a[1])[0];
    out.push({
      question: `Who were the ${n.poss} last ${firsts.length === 1 ? "" : `${count(firsts.length)} `}first-round draft ${firsts.length === 1 ? "pick" : "picks"}?`,
      answer: [
        `${n.placePoss.charAt(0).toUpperCase() + n.placePoss.slice(1)} first-round ${firsts.length === 1 ? "selection" : "selections"} from ${span} ${firsts.length === 1 ? "was" : "were"}:`,
        { list: firsts.map((p) => `${p.season}: ${p.name}, ${positionWord(p)}, Pick No. ${p.pick}`) },
        ...(missing.length ? [`${cap(n.place)} did not make a first-round pick in ${list(missing.map(String))}.`] : []),
        ...(top && top[1] >= 2 && firsts.length >= 3
          ? [`${cap(count(top[1]))} of the ${n.poss} last ${count(firsts.length)} first-round picks were ${CATEGORY_WORD[top[0]] ?? top[0]}.`]
          : []),
      ],
    });
  }

  if (h.allPicks.length >= 2 && h.total >= 10) {
    const [a, b, c] = h.allPicks;
    const top3 = h.allPicks.slice(0, 3);
    const top3Pct = Math.round(top3.reduce((s, x) => s + x.pct, 0));
    out.push({
      question: `Which positions have the ${n.nick} drafted most often recently?`,
      answer: [
        `The ${CATEGORY_GROUP[a!.category] ?? a!.label} has been ${n.placePoss} most frequently drafted position group over the last ${count(years)} drafts.`,
        `From ${span}, the ${n.nick} used ${a!.count} picks on ${CATEGORY_WORD[a!.category] ?? a!.label}, representing ${Math.round(a!.pct)}% of their selections` +
          (b ? `, and ${b.count} picks on ${CATEGORY_WORD[b.category] ?? b.label}, representing another ${Math.round(b.pct)}%` : "") +
          `.`,
        ...(c ? [`Overall, ${top3Pct}% of ${n.placePoss} draft picks went toward ${list(top3.map((x) => CATEGORY_GROUP[x.category] ?? x.label))}.`] : []),
      ],
    });
  }

  if (firsts.length) {
    const oldestFirst = [...firsts].sort((a, b) => a.season - b.season);
    out.push({
      question: `How many first-round picks have the ${n.nick} made since ${h.firstSeason}?`,
      answer: [
        `The ${n.nick} made ${count(firsts.length)} first-round ${firsts.length === 1 ? "selection" : "selections"} from ${span}` +
          (firsts.length === years ? ", one in each draft." : "."),
        `${firsts.length === 1 ? "That pick was" : "Those picks were"} ${list(oldestFirst.map((p) => p.name))}.`,
      ],
    });
  }

  // The two most recent classes, newest first.
  for (const s of [...h.seasons].sort((a, b) => b.season - a.season).slice(0, 2)) {
    if (!s.picks.length) continue;
    const lead = [...s.picks].sort((a, b) => a.pick - b.pick)[0] as DraftPick;
    const rest = s.picks.filter((p) => p !== lead).sort((a, b) => a.pick - b.pick);
    out.push({
      question: `Who did the ${n.nick} draft in ${s.season}?`,
      answer: [
        `${cap(n.place)} made ${count(s.picks.length)} ${s.picks.length === 1 ? "selection" : "selections"} in the ${s.season} NFL Draft, led by ${lead.round === 1 ? "first-round " : ""}${positionWord(lead)} ${lead.name} ${lead.round === 1 ? "at Pick No." : "with the No."} ${lead.pick}${lead.round === 1 ? "" : " overall pick"}.`,
        ...(rest.length ? [`The ${n.nick} also selected ${list(rest.map((p) => p.name))}.`] : []),
      ],
    });
  }

  // The two highest selections of the period.
  const best = [...all].sort((a, b) => a.pick - b.pick).slice(0, 2);
  best.forEach((p, i) => {
    const surname = p.name.split(" ").filter((w) => !/^(Jr\.|Sr\.|II|III|IV)$/.test(w)).pop() ?? p.name;
    out.push({
      question: `When did the ${n.nick} draft ${p.name}?`,
      answer: [
        `${i === 0 ? `The ${n.nick}` : cap(n.place)} selected ${positionWord(p)} ${p.name} with the No. ${p.pick} overall pick in the ${p.season} NFL Draft out of ${p.college}.`,
        i === 0
          ? `He was ${n.placePoss} highest draft selection during the ${h.firstSeason}-${h.lastSeason} period covered on this page.`
          : p.round === 1
            ? `${surname} is one of ${count(firsts.length)} ${n.nick} first-round ${firsts.length === 1 ? "selection" : "selections"} shown in the club's most recent ${count(years)} draft classes.`
            : `${surname} was a Round ${p.round} selection, the ${n.poss} second-highest pick of the ${h.firstSeason}-${h.lastSeason} period.`,
      ],
    });
  });

  out.push({
    question: `How successful have recent ${n.nick} draft picks been?`,
    answer: [
      `The tables above track each ${n.nick} draft pick by year, round, overall selection, position, college, current roster status, and Pro Bowl selections where available.`,
      `That makes it possible to follow not only who ${n.place} drafted, but also which players remain with the ${n.nick}, which have moved to other NFL teams, and which selections have developed into notable contributors.`,
    ],
  });

  return out;
}

export function draftFaq(team: NflTeam, view: DraftView): FaqItem[] {
  const n = names(team);
  const out: FaqItem[] = [];
  if (view.capital) out.push(...capitalFaq(team, view.capital, n));
  if (view.history) out.push(...historyFaq(team, view.history, n));
  if (!out.length) return out;
  const h = view.history;
  const c = view.capital;
  out.push({
    question: `Where can I see the complete ${n.nick} draft history?`,
    answer: [
      `The draft tables above show ` +
        (h ? `every ${team.fullName} pick from the ${h.firstSeason} through ${h.lastSeason} NFL Drafts` : `the ${n.poss} recent draft classes`) +
        (c ? `, along with the team's current ${c.draftYear} draft pick inventory.` : "."),
      `Each draft class includes the round, overall pick, player, position, college, roster status, and additional career information where available.`,
    ],
  });
  return out;
}
