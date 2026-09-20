/**
 * The questions the rankings page gets asked.
 *
 * Fifth sibling to team/outlook-faq.ts, team/stats-faq.ts, team/depth-faq.ts
 * and team/schedule-faq.ts, and it breaks their shape in one way worth stating
 * plainly: those four derive every answer from the rows rendered above them, so
 * an answer cannot contradict the table. Several of these are written copy.
 * There is no fixture behind "how often are the rankings updated" — the honest
 * answer is a sentence somebody wrote, not a field somebody published.
 *
 * So the rule the other four enforce by construction is enforced here by hand,
 * and it is the reason this is a module rather than a blob of HTML: every
 * answer that CAN be wrong takes the board as an argument and is built from it.
 * Four of them do. The scoring answer names the format from `data.scoring`
 * rather than asserting PPR; the updated answer carries the board's own
 * timestamp; the two "who" answers name players by reading the tiers rather
 * than by holding a list of names that would be a week stale by publication.
 * If a Half-PPR file is ever published, or the board moves, the answers change
 * with the file.
 *
 * The copy is otherwise as supplied, including its rest-of-season framing. That
 * framing is a deliberate editorial choice and not an accident of this module:
 * the page's own title, meta description and CSV all say redraft. See the note
 * in replit.md under "Redraft Rankings" before rewording either side.
 */

import {
  POSITION_PLURALS,
  STAT_POSITIONS,
  type RankingsData,
  type StatPosition,
} from "./rankings-data";

export interface RankingsFaq {
  question: string;
  answer: string;
}

/** The heading the block prints, kept beside the questions it introduces. */
export const RANKINGS_FAQ_HEADING = "Rest of Season Fantasy Football Rankings FAQ";

/** "A", "A and B", "A, B and C" — the Oxford-less form the rest of the page uses. */
function listOf(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The names in one tier of one board, in published order.
 *
 * Reads the same `byPosition` the panels are drawn from, so a tier boundary
 * moved in TIER_RULES moves these answers too. A tier the file does not reach
 * comes back empty rather than short, and the answers below drop the position
 * entirely rather than printing a clause with nothing in it.
 */
function tierNames(
  data: RankingsData,
  position: StatPosition,
  tier: number,
  limit?: number,
): string[] {
  const group = data.byPosition[position]?.find((entry) => entry.tier === tier);
  const names = (group?.players ?? []).map((player) => player.name);
  return limit === undefined ? names : names.slice(0, limit);
}

/**
 * One clause per position, for the answers that name players.
 *
 * "Josh Allen and Lamar Jackson at quarterback" — the position last, because
 * the reader is scanning for the name and the position is what tells them
 * which name they just read.
 */
function byPositionClauses(
  data: RankingsData,
  tier: number,
  limit?: number,
): string {
  const clauses = STAT_POSITIONS.map((position) => {
    const names = tierNames(data, position, tier, limit);
    return names.length === 0
      ? ""
      : `${listOf(names)} at ${POSITION_PLURALS[position].replace(/s$/, "")}`;
  }).filter((clause) => clause !== "");

  return listOf(clauses);
}

/**
 * The top-tier answer.
 *
 * "Who are the best players" has a real answer on a tiered board and it is the
 * top tier, so that is what this prints — read from the board rather than typed
 * out here, because a hand-written list of names is wrong the first time an
 * injury moves one. It also has to say what the board does not claim: ranks are
 * positional, so there is no overall No. 1 and the side-by-side view is not
 * asserting one. That is the same sentence the All board's caption carries.
 */
function bestPlayersAnswer(data: RankingsData): string {
  const clauses = byPositionClauses(data, 1);
  const asOf = data.updatedAt === "" ? "" : ` as of ${data.updatedAt}`;

  if (clauses === "") {
    return (
      `The top tier of each position board is the board's answer to that ` +
      `question. Ranks here are positional rather than overall, so QB1 and RB1 ` +
      `are both rank 1 and there is no single best player across positions.`
    );
  }

  return (
    `The top tier of each position board is the board's answer, and${asOf} ` +
    `that tier is ${clauses}. Ranks here are positional rather than overall, ` +
    `so QB1 and RB1 are both rank 1 and the side-by-side view is not claiming ` +
    `the two are worth the same. Within a tier the players are close enough ` +
    `that the gap to the tier below matters more than the order inside it.`
  );
}

/**
 * The trade-target answer.
 *
 * The rankings publish no buy list and this answer does not invent one. What a
 * tiered board actually supports is the tier argument — the players at the top
 * of the second tier are the ones most often priced like the tier below and
 * ranked with the tier above — so the answer explains that and names the top of
 * tier 2 as the worked example. Two per position, because the point is the
 * method and a 29-name paragraph is not read by anybody.
 */
function tradeTargetsAnswer(data: RankingsData): string {
  const clauses = byPositionClauses(data, 2, 2);
  const base =
    `These rankings do not publish a buy list, but the tiers point at one. ` +
    `The most useful targets are usually the players at the top of a tier, ` +
    `who are often priced like the tier beneath them and ranked with the group ` +
    `above, and players whose role has grown since draft day so that their ` +
    `current rank sits well above where they were drafted.`;

  const worked =
    clauses === ""
      ? ""
      : ` On this board that means the top of tier 2 — ${clauses} — where the ` +
        `distance to tier 1 is smaller than the difference in what the two ` +
        `tiers cost.`;

  return (
    `${base}${worked} Roster needs, depth, league size and scoring settings ` +
    `still decide whether a given trade is worth making.`
  );
}

/**
 * The waiver and drop answer.
 *
 * The claim that makes rankings useful on the wire is depth: a board that
 * stopped at startable players would have nothing to say about the free agent
 * you are considering. This one runs past that, so the answer counts the rows
 * rather than asserting "deep" — the numbers come from the boards as rendered,
 * which is POSITION_LIMITS as far as the published file reaches.
 */
function waiverAnswer(data: RankingsData): string {
  const counts = STAT_POSITIONS.map((position) => {
    const total = (data.byPosition[position] ?? []).reduce(
      (sum, group) => sum + group.players.length,
      0,
    );
    return total === 0 ? "" : `${total} ${POSITION_PLURALS[position]}`;
  }).filter((entry) => entry !== "");

  const depth =
    counts.length === 0
      ? ""
      : ` The boards run past starter depth — ${listOf(counts)} — so a free ` +
        `agent and the player he would replace usually both appear on the ` +
        `same board, and the tier each sits in is the comparison.`;

  return (
    `Yes.${depth} A player who has lost his role falls down the board or off ` +
    `it entirely, which is the drop case; a player whose usage has grown is ` +
    `ranked where that usage puts him rather than where he was drafted, which ` +
    `is the add case. Bye weeks, injuries and the rest of your roster still ` +
    `decide which move is right for your team.`
  );
}

/**
 * The formats the board offers, as the format row draws them.
 *
 * renderScoring() prints three options and makes one of them live — the one the
 * published file is scored in. The other two are marked unavailable rather than
 * offered as buttons that would not change the order, and this answer says the
 * same thing in a sentence. Both read `data.scoring`, so the page and the FAQ
 * cannot disagree about which format is the live one.
 */
function scoringAnswer(data: RankingsData): string {
  const scoring = data.scoring;
  const others = ["Standard", "Half PPR", "PPR"].filter(
    (format) => format.toLowerCase() !== scoring.toLowerCase(),
  );

  return (
    `These rankings are published in ${scoring} only, so ${scoring} is the one ` +
    `live option in the format row. ` +
    `${others.join(" and ")} are shown there as unavailable rather than as ` +
    `controls that would not change the order, because there is no separate ` +
    `board behind them. Receptions are worth the same on every row of this ` +
    `page, and a ${others.join(" or ")} board would appear in that row if one ` +
    `were published.`
  );
}

/**
 * The refresh answer, carrying the board's own "updated" line.
 *
 * The page prints that line twice already — once under the controls and once in
 * the All board's caption — and an FAQ that says "updated throughout the
 * season" beside a date three weeks old is the kind of thing that makes a
 * reader stop trusting the date. So the date comes along.
 */
function updatedAnswer(data: RankingsData): string {
  const base =
    "The rankings are updated throughout the NFL season as player roles, " +
    "injuries, usage, performance and team situations change.";

  return data.updatedAt === ""
    ? base
    : `${base} This board was last updated ${data.updatedAt}.`;
}

/**
 * The questions, in the order they are printed.
 *
 * Definition first, then the names — "who is best" is the question the page is
 * found on and the one the board answers most directly — then the mechanics of
 * the board, then the two comparisons a reader arrives with (weekly rankings,
 * trade value), then what the rankings are used for: trades, waivers, drops.
 * Scoring last, because it qualifies everything above it rather than being
 * asked on its own.
 */
export function rankingsFaq(data: RankingsData): RankingsFaq[] {
  return [
    {
      question: "What are rest of season fantasy football rankings?",
      answer:
        "Rest of season rankings rank players based on their expected fantasy " +
        "value from the current week through the end of the fantasy season. " +
        "Unlike draft rankings, they account for what has already happened " +
        "during the season, including current roles, injuries, usage and team " +
        "situations.",
    },
    {
      question: `Who are the best fantasy football players for the rest of the ${data.season} season?`,
      answer: bestPlayersAnswer(data),
    },
    {
      question: `How often are the ${data.season} rest of season fantasy football rankings updated?`,
      answer: updatedAnswer(data),
    },
    {
      question:
        "What is the difference between rest of season rankings and weekly fantasy football rankings?",
      answer:
        "Rest of season rankings evaluate a player's value over the remaining " +
        "fantasy season. Weekly rankings focus only on the player's upcoming " +
        "matchup and expected production for that specific week.",
    },
    {
      question:
        "What is the difference between rest of season rankings and fantasy football trade values?",
      answer:
        "Rest of season rankings measure expected fantasy production and " +
        "usefulness over the remaining season. Trade value can also reflect " +
        "positional scarcity, roster construction, market demand and the value " +
        "fantasy managers place on acquiring a particular player.",
    },
    {
      question: "Should I use rest of season rankings for fantasy football trades?",
      answer:
        "Rest of season rankings are useful for comparing how players are " +
        "expected to perform over the remainder of the year, making them a " +
        "helpful starting point for trade decisions. League settings, roster " +
        "needs, depth and positional scarcity should also be considered before " +
        "making a trade.",
    },
    {
      question:
        "Who should I trade for in fantasy football for the rest of the season?",
      answer: tradeTargetsAnswer(data),
    },
    {
      question:
        "Can rest of season rankings help with waiver wire and drop decisions?",
      answer: waiverAnswer(data),
    },
    {
      question:
        "How are injured players handled in rest of season fantasy football rankings?",
      answer:
        "Injuries are considered when estimating a player's remaining-season " +
        "value. Expected missed time, current injury status and the player's " +
        "projected role after returning can all affect where a player ranks.",
    },
    {
      question: "Are these rest of season rankings PPR, Half-PPR, or Standard?",
      answer: scoringAnswer(data),
    },
  ];
}
