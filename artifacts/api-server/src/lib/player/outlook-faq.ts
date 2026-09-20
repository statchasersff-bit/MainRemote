/**
 * The questions a fantasy outlook gets asked, answered from the tab above them.
 *
 * Fifth sibling to bio.ts, injury.ts, stats-profile.ts and game-log-faq.ts, and
 * the only one allowed to face forwards. Rule 3 in player-render.ts — this page
 * says what happened, never what happens next — is quarantined to the Outlook
 * tab, and this block lives inside that quarantine. It is also where the rule
 * is easiest to break badly, because "is he worth drafting" is a question about
 * the future and the honest answer is a set of measurements about the past.
 *
 * So the discipline here is narrower than the tab's. Every sentence below is
 * built from something this server actually holds:
 *
 *   - the measured driver strip (outlook-drivers.ts), which already carries the
 *     position's own distribution — "34.6 pass attempts per game, 5th of 64 QBs"
 *   - last season's positional finish and points, off `keyStats`
 *   - KeepTradeCut's dynasty ranks, which are the one place on this server with
 *     a one-quarterback value AND a Superflex value for the same player
 *   - Sleeper's roster percentage, as of the week it was ingested
 *
 * What is NOT here is a rest-of-season call. `restOfSeason`, `weeklyRole` and
 * `confidence` are fields on the outlook record and every one of them is empty
 * in the published file, so an answer that said "projects as a QB2" would be
 * this module's opinion wearing the site's voice. The draft and start/sit
 * questions are answered with the numbers a reader can check instead, and the
 * starter question names the league size that makes the line mean anything —
 * "QB14" is not a verdict until somebody says how many quarterbacks start.
 *
 * Pronoun-free, for the reason game-log-faq.ts gives: the generated prose names
 * the player in full once and by surname after, and a pronoun is a fact about a
 * person that none of these files carry. The question text is the exception it
 * has to be — a reader types "his fantasy outlook" — and those strings are the
 * search, not the answer.
 *
 * Every question is pushed only when its inputs exist. A player with no
 * advanced line and no dynasty row produces a short FAQ or none at all, which
 * is the failure mode the rest of the page uses — shorter, never wrong.
 */

import { TEAM_NAMES } from "../render";
import { surname } from "./bio";
import type { OutlookDriver } from "./outlook-drivers";
import type { DynastyData, OutlookKeyStats } from "./types";

export interface OutlookFaq {
  question: string;
  answer: string;
}

/** The heading the block prints, kept beside the questions it introduces. */
export function outlookFaqHeading(name: string): string {
  return `${name} Fantasy Outlook FAQ`;
}

/**
 * How many at this position a 12-team league starts each week.
 *
 * The line that turns a positional finish into an answer. One flex is assumed
 * and given to the two positions that usually fill it, which is why RB and WR
 * are not 24 and 36 exactly — a 12-team league starting 2RB/3WR/1FLEX plays
 * about 30 backs and about 42 receivers in a given week. Deliberately round:
 * these are the shape of a starting lineup, not a measurement, and quoting them
 * to the man would claim a precision nobody has. The answers say "about".
 */
const STARTER_LINE: Record<string, number> = {
  QB: 12,
  RB: 30,
  WR: 42,
  TE: 12,
};

/** "the Arizona Cardinals" — spelled out, because an FAQ answer gets read aloud. */
function teamName(code: string | null): string | null {
  if (!code) return null;
  return TEAM_NAMES[code.toLowerCase()] ?? null;
}

/**
 * "Arizona" — the city half, for a sentence that needs a short club name.
 *
 * "the Arizona Cardinals' starting quarterback" is correct and reads like a
 * press release. Every club in TEAM_NAMES is "<place> <nickname>", so dropping
 * the last word leaves the half a sentence wants; the two-word places (Los
 * Angeles, New England, Kansas City) survive it because only the nickname
 * comes off.
 */
function teamPlace(code: string | null): string | null {
  const full = teamName(code);
  if (!full) return null;
  const words = full.split(" ");
  return words.length > 1 ? words.slice(0, -1).join(" ") : full;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function one(value: number): string {
  return value.toFixed(1);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "passing volume", from the card's "Passing Volume". */
function lower(label: string): string {
  return label.toLowerCase();
}

/**
 * One driver as a clause: "passing volume is heavy (34.6 pass attempts per
 * game, 5th of 64 QBs)".
 *
 * The context is dropped when the strip withheld it — a player under the games
 * threshold has a real measurement and no rank, and this must not invent one.
 */
function clause(driver: OutlookDriver): string {
  const head = `${lower(driver.label)} is ${lower(driver.value)}`;
  const inner = driver.context
    ? `${driver.detail}, ${driver.context}`
    : driver.detail;
  return inner ? `${head} (${inner})` : head;
}

/** "a, b and c" — the form a sentence reads. */
function list(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] as string;
  const head = parts.slice(0, -1).join(", ");
  return `${head} and ${parts[parts.length - 1]}`;
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

/**
 * "QB1", off the Role card — or null when that card is not the depth chart.
 *
 * roleDriver() in outlook-drivers.ts emits the Role card in two shapes: a depth
 * slot ("QB1 on the depth chart") when there is a chart to read, and a snap
 * share ("72.0% of the team's snaps") when there is not. They do not fit the
 * same sentence, so every answer that wants the slot asks for it here and gets
 * null rather than a percentage it would have read as a rank.
 */
function depthSlot(role: OutlookDriver | undefined): string | null {
  if (!role || role.label !== "Role") return null;
  const match = /^(\S+) on the depth chart$/.exec(role.detail);
  return match ? (match[1] as string) : null;
}

/**
 * The second card each position's outlook turns on, and the question it answers.
 *
 * outlook-drivers.ts already decided what matters per position; this is the
 * same decision phrased as a search. A quarterback's is rushing, a back's is
 * pass-game work, a receiver's is downfield share, a tight end's is the red
 * zone — which is exactly the card list in that file, in that order.
 */
const SECOND_DRIVER: Record<string, { label: string; ask: (n: string) => string }> = {
  QB: {
    label: "Rushing",
    ask: (n) => `How does rushing affect ${n}'s fantasy outlook?`,
  },
  RB: {
    label: "Receiving",
    ask: (n) => `How much does ${n} contribute in the passing game?`,
  },
  WR: {
    label: "Air Yards",
    ask: (n) => `How much of the team's downfield work does ${n} get?`,
  },
  TE: {
    label: "Red Zone",
    ask: (n) => `How often is ${n} targeted in the red zone?`,
  },
};

export function outlookFaq(input: {
  name: string;
  position: string | null;
  /** The club code, e.g. "ARI". */
  team: string | null;
  /** The season the outlook is for — the one the questions are asked about. */
  season: number;
  /** The measured strip the tab renders above this block. */
  drivers: OutlookDriver[];
  /** Last season's line, which is what every measurement here came from. */
  keyStats: OutlookKeyStats | null;
  dynasty: DynastyData | null;
  rosterPct: {
    owned: number;
    started: number | null;
    season: number;
    week: number;
  } | null;
}): OutlookFaq[] {
  const { name, position, team, season, drivers, keyStats, dynasty, rosterPct } =
    input;

  const pos = position ?? "";
  if (!pos) return [];
  if (drivers.length === 0 && !dynasty) return [];

  const last = surname(name);
  const place = teamPlace(team);
  const faq: OutlookFaq[] = [];

  /* ------------------------------------------------------- the strip ---- */

  const role = drivers.find((d) => d.label === "Role" || d.label === "Routes");
  const measured = drivers.filter((d) => d !== role);
  const strong = measured.filter((d) => d.level === "high");
  const weak = measured.filter((d) => d.level === "low");
  const slot = depthSlot(role);
  const second = SECOND_DRIVER[pos];
  const secondDriver = second
    ? measured.find((d) => d.label === second.label)
    : undefined;

  /* --------------------------------------------------- last season's ---- */

  // The finish is the spine of half these answers, so it is built once. It is
  // last season's and it says so every time it appears: the whole point of the
  // tab is that the season in the heading has not been played, and a bare
  // "QB14" a paragraph under a 2026 heading is the one sentence here that a
  // reader could take for a projection.
  const statSeason = keyStats ? num(keyStats.season) : null;
  const rank = keyStats ? num(keyStats.rank) : null;
  const points = keyStats ? num(keyStats.fantasyPoints) : null;
  const played = keyStats ? num(keyStats.games) : null;
  const measuredFrom = statSeason === null ? "last season" : String(statSeason);

  const finish =
    rank !== null && statSeason !== null
      ? `${last} finished ${pos}${rank} in ${statSeason}` +
        (points !== null && played !== null
          ? `, on ${one(points)} fantasy points across ${count(played, "game")}`
          : "")
      : "";

  /*
   * The role, in whichever of its three shapes this player has one.
   *
   * A depth slot and a snap share are different facts and a route share is a
   * third, so each gets its own sentence rather than one template with a hole
   * in it. Nothing is said when the strip had no role card at all.
   */
  let roleSentence = "";
  if (slot && role) {
    roleSentence = `${last} is ${slot} on ${place ? `${place}'s` : "the"} depth chart entering ${season}`;
  } else if (role?.label === "Role") {
    roleSentence = `${last} played ${role.detail} in ${measuredFrom}`;
  } else if (role?.label === "Routes") {
    // The card's unit is "of the team's routes run", which already contains the
    // verb this sentence supplies.
    const share = role.detail.replace(/ run$/, "");
    roleSentence = `${last} ran ${share} in ${measuredFrom}`;
  }

  /* ---------------------------------------------------- 1. the outlook -- */

  const opening = [roleSentence, finish].filter(Boolean);
  if (opening.length) {
    const inputs = [
      strong.length
        ? `the strongest measured input is ${clause(strong[0] as OutlookDriver)}`
        : "",
      weak.length ? `the weakest is ${clause(weak[0] as OutlookDriver)}` : "",
    ].filter(Boolean);

    faq.push({
      question: `What is ${name}'s fantasy outlook for ${season}?`,
      answer:
        `${opening.join(". ")}.` +
        (inputs.length
          ? ` Of the inputs this page measures, ${list(inputs)}.`
          : "") +
        ` Every number here is measured from ${measuredFrom}; this page ` +
        `publishes no ${season} projection.`,
    });
  }

  /* ------------------------------------------------------ 2. drafting --- */

  const market: string[] = [];
  if (dynasty) {
    market.push(
      `KeepTradeCut has ${last} at ${pos}${dynasty.positionalRank} in ` +
        `one-quarterback dynasty formats` +
        (dynasty.sf ? ` and ${pos}${dynasty.sf.positionalRank} in Superflex` : ""),
    );
    const startup = num(dynasty.startupAdp);
    if (startup !== null) {
      market.push(`startup drafts have been taking ${last} around pick ${startup}`);
    }
  }
  if (rosterPct) {
    market.push(
      `Sleeper leagues roster ${last} in ${one(rosterPct.owned)}% of leagues ` +
        `as of Week ${rosterPct.week} of ${rosterPct.season}`,
    );
  }
  if (market.length) {
    faq.push({
      question: `Is ${name} worth drafting in fantasy football?`,
      answer:
        `${list(market)}. Those are readings off the market rather than a ` +
        `recommendation — this page publishes no draft ranking. What it can ` +
        `add is the measured side above: the strip ranks ${last} against ` +
        `every other ${pos} who played ${measuredFrom}.`,
    });
  }

  /* ------------------------------------------------------- 3. starting -- */

  const line = STARTER_LINE[pos];
  if (finish && rank !== null && line !== undefined) {
    const inside = rank <= line;
    const forward = slot
      ? `${last} is ${slot} on the depth chart entering ${season}, which is ` +
        `the half of the question ${measuredFrom} cannot answer.`
      : `Whether that repeats turns on a role ${measuredFrom} cannot answer ` +
        `for ${season}.`;

    faq.push({
      question: `Is ${name} a fantasy starter in ${season}?`,
      answer:
        `${finish}. A 12-team league starts about ${line} ${pos}s in a given ` +
        `week, so that finish was ${inside ? "inside" : "outside"} the ` +
        `starting line` +
        (inside ? "" : ` by ${count(rank - line, "place")}`) +
        `. ${forward}`,
    });
  }

  /* -------------------------------------------------- 4. format shape --- */

  if (pos === "QB" && dynasty?.sf) {
    const gap = dynasty.sf.value - dynasty.value;
    faq.push({
      question: `Is ${name} a good Superflex option?`,
      answer:
        `Superflex is where a starting quarterback's value lives, and the ` +
        `market prices ${last} that way: KeepTradeCut has him at ` +
        `${dynasty.sf.value.toLocaleString("en-US")} in Superflex against ` +
        `${dynasty.value.toLocaleString("en-US")} in one-quarterback leagues` +
        (gap > 0 ? `, a gap of ${gap.toLocaleString("en-US")}` : "") +
        `. That is ${pos}${dynasty.sf.positionalRank} rather than ` +
        `${pos}${dynasty.positionalRank} at the position, and ` +
        `${ordinal(dynasty.sf.rank)} rather than ${ordinal(dynasty.rank)} overall.`,
    });
  } else if (dynasty) {
    const trend = num(dynasty.posTrend30);
    faq.push({
      question: `Where does ${name} rank among ${pos}s?`,
      answer:
        `KeepTradeCut has ${last} at ${pos}${dynasty.positionalRank}, ` +
        `${ordinal(dynasty.rank)} overall, in positional tier ` +
        `${dynasty.positionalTier}` +
        (trend
          ? `. That position rank has moved ${trend > 0 ? "up" : "down"} ` +
            `${count(Math.abs(trend), "place")} over the last 30 days`
          : "") +
        `.` +
        (finish ? ` ${finish}.` : ""),
    });
  }

  /* --------------------------------------------------------- 5. upside -- */

  if (strong.length) {
    faq.push({
      question: `What gives ${name} fantasy upside?`,
      answer:
        `The measured strip puts ${list(strong.map(clause))} in the top ` +
        `quarter of the position. That is what the profile has the most of, ` +
        `read off ${measuredFrom} against every other ${pos} who played it.`,
    });
  }

  /* ---------------------------------------------------------- 6. risks -- */

  const risks = weak.map(clause);
  const ageTier = dynasty?.ageCurveTier ?? "";
  if (ageTier && /aging|decline|cliff/i.test(ageTier)) {
    risks.push(
      `KeepTradeCut's age curve puts ${last} in its ${ageTier} band at ` +
        `${one(dynasty?.age ?? 0)}`,
    );
  }
  if (slot && role && role.level !== "high") {
    risks.push(`the depth chart has ${last} at ${slot}`);
  }
  if (risks.length) {
    faq.push({
      question: `What are the biggest risks to ${name}'s fantasy value?`,
      answer:
        `${list(risks)}. Those are the readings in the bottom half of the ` +
        `position rather than a forecast: what they say is where the profile ` +
        `is thin, and a thin input is the one that costs weeks first.`,
    });
  }

  /* -------------------------------------------- 7. the position's own --- */

  if (second && secondDriver) {
    faq.push({
      question: second.ask(name),
      answer:
        `${secondDriver.detail}${
          secondDriver.context ? ` — ${secondDriver.context}` : ""
        }, which the strip reads as ${lower(secondDriver.value)}. It is one of ` +
        `the four inputs the Outlook tab measures for a ${pos}, because it is ` +
        `what separates two ${pos}s carrying the same headline volume.`,
    });
  }

  /* ------------------------------------------------------ 8. what moves - */

  const couldMove = measured.filter((d) => d.level === "low" || d.level === "mid");
  if (couldMove.length) {
    faq.push({
      question: `What could improve ${name}'s fantasy outlook?`,
      answer:
        `The inputs with the most distance left in them are ` +
        `${list(couldMove.map((d) => lower(d.label)))}. ` +
        `${couldMove
          .slice(0, 2)
          .map(
            (d) =>
              `${u(lower(d.label))} sits at ${d.detail}` +
              (d.context ? ` (${d.context})` : ""),
          )
          .join(", and ")}. ` +
        `The strip re-measures from the advanced line each season, so it ` +
        `answers this on its own rather than waiting for somebody to rewrite it.`,
    });
  }

  return faq;
}

/** First letter up, for a clause that starts a sentence. */
function u(text: string): string {
  return text ? text[0]?.toUpperCase() + text.slice(1) : text;
}
