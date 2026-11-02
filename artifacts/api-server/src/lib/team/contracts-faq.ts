/**
 * The Contracts tab's FAQ (mak's spec, 2026-11-02): fourteen club-specific
 * questions aimed at "<club> salary cap", "cap space", "contracts", "dead
 * money", "highest paid" and "cut candidates" searches. One question
 * structure for all 32 clubs, with the club's own figures written in from
 * the contracts view, so every page carries genuinely team-specific copy
 * rather than a generic cap explainer. A question whose figures the view
 * does not have for this club is left out rather than written around.
 *
 * On the page and in the hub's FAQPage node (mak approved the schema entry
 * 2026-11-02).
 */

import type { NflTeam } from "./teams";
import type { ContractLine, ContractsView } from "./contracts";
import type { FaqItem } from "./faq-block";

/** "$4.8 million", "$919,000", "$347.5 million"; input in millions. */
function dollars(m: number): string {
  const abs = Math.abs(m);
  const sign = m < 0 ? "-" : "";
  if (abs >= 1) return `${sign}$${abs.toFixed(1)} million`;
  return `${sign}$${Math.round(abs * 1000).toLocaleString("en-US")},000`.replace(",000,000", ",000");
}

/** "$28.5M", for a figure in parentheses. */
function short(m: number): string {
  const abs = Math.abs(m);
  const sign = m < 0 ? "-" : "";
  return abs >= 1 ? `${sign}$${abs.toFixed(1)}M` : `${sign}$${Math.round(abs * 1000)}K`;
}

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

const WORDS = ["", "", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
/** "fourth-highest" for a small rank, "14th-highest" past ten. */
const nthHighest = (rank: number) => `${rank === 1 ? "the highest" : `${WORDS[rank] ?? ordinal(rank)}-highest`}`;

/** "Milton Williams ($28.5M), Carlton Davis ($22.0M), and Michael Onwenu ($17.5M)". */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function contractsFaq(team: NflTeam, v: ContractsView): FaqItem[] {
  const nick = team.nickname;
  const poss = /s$/.test(nick) ? `${nick}'` : `${nick}'s`;
  // "New England" reads as the club; "New York" and "Los Angeles" do not.
  const place = /^(New York|Los Angeles)$/.test(team.city) ? `the ${nick}` : team.city;
  const placePoss = /^(New York|Los Angeles)$/.test(team.city) ? `the ${poss}` : `${team.city}'s`;
  const season = v.season;
  const out: FaqItem[] = [];

  const byCap = [...v.players].sort((a, b) => b.capNumber - a.capNumber);
  const top5 = byCap.slice(0, 5);
  const positive = v.players.filter((p) => p.cutSave > 0.0005);
  const negative = v.players.filter((p) => p.cutSave < -0.0005);
  const savers = [...positive].sort((a, b) => b.cutSave - a.cutSave).slice(0, 6);
  const totalSavings = positive.reduce((s, p) => s + p.cutSave, 0);
  const dead = [...v.dead].sort((a, b) => b.amount - a.amount);

  if (v.capSpace !== null) {
    out.push({
      question: `How much salary cap space do the ${nick} have in ${season}?`,
      answer: [
        `The ${team.fullName} currently have approximately ${dollars(v.capSpace)} in ${season} salary cap space` +
          (v.capSpaceRank ? `, ranking ${ordinal(v.capSpaceRank)} among NFL teams` : "") +
          `. Their cap position can change as players are signed, released, traded, restructured, or moved between roster designations.`,
      ],
    });
  }

  if (top5.length >= 2) {
    const [first, ...rest] = top5;
    out.push({
      question: `Who has the biggest salary cap hit on the ${nick} in ${season}?`,
      answer: [
        `${first.name} has the largest ${nick} cap hit in ${season} at ${dollars(first.capNumber)}. ` +
          `${rest[0].name} is next at ${dollars(rest[0].capNumber)}` +
          (rest.length > 1 ? `, followed by ${list(rest.slice(1).map((p) => `${p.name} at ${dollars(p.capNumber)}`))}` : "") +
          `.`,
      ],
    });
  }

  if (v.liabilities !== null || v.top51) {
    const parts: string[] = [];
    if (v.liabilities !== null) {
      parts.push(
        `The ${nick} currently carry approximately ${dollars(v.liabilities)} in total cap liabilities across ${v.players.length} contracts and existing dead money.`,
      );
    }
    if (v.top51) {
      parts.push(
        `Their current Top-51 cap total is approximately ${dollars(v.top51)}` +
          (v.top51Rank ? `, ${nthHighest(v.top51Rank)} in the NFL` : "") +
          `.`,
      );
    }
    out.push({ question: `How much are the ${nick} spending against the ${season} salary cap?`, answer: [parts.join(" ")] });
  }

  if (savers.length >= 2) {
    const [first, ...rest] = savers;
    out.push({
      question: `Which ${nick} players could create the most cap space if released?`,
      answer: [
        `Among standard pre-June 1 releases, ${first.name} currently provides the most ${nick} cap savings at approximately ${dollars(first.cutSave)}. ` +
          `Other notable potential savings include ${list(rest.map((p) => `${p.name} at ${dollars(p.cutSave)}`))}.`,
        `These figures describe the contracts themselves and should not be interpreted as predictions that the ${nick} will release those players.`,
      ],
    });
  }

  if (v.deadTotal !== null) {
    out.push({
      question: `How much dead money do the ${nick} have in ${season}?`,
      answer: [
        `${place.replace(/^the /, "The ")} currently ${/^the /.test(place) ? "carry" : "carries"} approximately ${dollars(v.deadTotal)} in ${season} dead money` +
          (v.deadRank ? `, ranking ${ordinal(v.deadRank)} among NFL teams` : "") +
          `.` +
          (dead[0]
            ? ` ${dead[0].name} accounts for the largest individual dead-cap charge at approximately ${dollars(dead[0].amount)}` +
              (dead[1] ? `, followed by ${dead[1].name} at ${dollars(dead[1].amount)}` : "") +
              `.`
            : ""),
      ],
    });
  }

  out.push({
    question: `What is dead money on the ${nick} salary cap?`,
    answer: [
      `Dead money is salary-cap space charged to the ${nick} for a player who is no longer on the roster or for guaranteed and prorated money that remains after a contract is terminated. ` +
        `Releasing or trading a player does not always eliminate his cap charge because previously guaranteed bonuses can still count against ${placePoss} salary cap.`,
    ],
  });

  out.push({
    question: `What happens to the ${nick} salary cap when a player is cut?`,
    answer: [
      `The effect depends on the structure of the player's contract. A release can create cap space when the salary removed is greater than the remaining dead money, but some ${nick} contracts would actually cost additional cap space to terminate.`,
      ...(positive.length || negative.length
        ? [
            `The ${nick} currently have ${positive.length} contracts where a release would create some cap space and ${negative.length} where a standard pre-June 1 release would result in a negative net cap change.`,
          ]
        : []),
    ],
  });

  out.push({
    question: `What is the difference between a pre-June 1 and post-June 1 ${nick} release?`,
    answer: [
      `A pre-June 1 release generally accelerates the remaining prorated bonus money onto the current year's salary cap. A post-June 1 release can spread portions of that dead money between the current season and the following season.`,
      `Use the ${nick} cut scenario tool above to compare how releasing individual players before or after June 1 could change ${placePoss} cap space.`,
    ],
  });

  if (top5.length >= 2) {
    out.push({
      question: `Who are the highest-paid ${nick} in ${season}?`,
      answer: [
        `By ${season} cap hit, the largest ${nick} contracts belong to ${list(top5.map((p) => `${p.name} (${short(p.capNumber)})`))}.`,
        `Cap hit is different from average annual salary, so the order of the ${poss} highest-paid players can change depending on whether contracts are ranked by cap number, APY, cash paid, or guaranteed money.`,
      ],
    });
  }

  if (positive.length) {
    out.push({
      question: `How much could the ${nick} save by cutting players in ${season}?`,
      answer: [
        `Across contracts that currently produce positive pre-June 1 savings, the ${nick} have approximately ${dollars(totalSavings)} in potential cut savings. ` +
          `That does not mean ${place} can simply add ${dollars(totalSavings)} to ${/^the /.test(place) ? "their" : "its"} cap space, since replacing released players, roster rules, dead money, and individual contract structures all affect the final cap calculation.`,
      ],
    });
  }

  out.push({
    question: `What does "Net if cut" mean for a ${nick} contract?`,
    answer: [
      `Net if cut shows the estimated change to the ${poss} ${season} salary cap following a standard pre-June 1 release. A positive number means ${place} would create cap space. A negative number means releasing the player would create more dead money than the cap charge being removed.`,
    ],
  });

  if (v.worth) {
    // The two examples a fantasy reader knows: skill positions first, then
    // the widest gap between Worth and the deal.
    const skill = (p: ContractLine) => (/^(QB|RB|WR|TE)$/.test(p.worth?.group ?? "") ? 1 : 0);
    const under = v.players
      .filter((p): p is ContractLine & { worth: NonNullable<ContractLine["worth"]> } => p.worth?.tag === "under")
      .sort((a, b) => skill(b) - skill(a) || b.worth.worth - b.apy - (a.worth.worth - a.apy))
      .slice(0, 2);
    const over = v.tagged.over;
    out.push({
      question: `Which ${nick} contracts provide the best value?`,
      answer: [
        `StatChasers compares a player's contract with an estimated market value based on comparable player production. Players whose estimated value significantly exceeds their contract cost can be labeled Underpaid, while contracts priced well above estimated production value can be labeled Overpaid.`,
        ...(under.length
          ? [
              `For example, ${list(under.map((p) => p.name))} currently ${under.length === 1 ? "shows" : "show"} substantial positive value relative to ${under.length === 1 ? "his" : "their"} contract cost` +
                (over ? `, while ${over === 1 ? "one larger veteran contract carries a higher cost" : "several larger veteran contracts carry higher costs"} relative to estimated production value.` : "."),
            ]
          : []),
      ],
    });
  }

  out.push({
    question: `How many players do the ${nick} have under contract for ${season}?`,
    answer: [
      `The ${nick} currently have ${v.players.length} contracts represented in the ${season} cap ledger. This includes active-roster players as well as players on injured reserve, PUP, the practice squad, and other roster designations that may affect the team's cap accounting.`,
    ],
  });

  out.push({
    question: `Where can I see every ${nick} contract and salary cap hit?`,
    answer: [
      `The table above tracks the ${team.fullName}' ${season} contracts, cap hits, average annual salary, guarantees, contract length, estimated player value, release savings, and dead money. ` +
        `It is ordered by cap hit so you can quickly see which contracts have the largest impact on ${placePoss} salary cap.`,
    ],
  });

  return out;
}
