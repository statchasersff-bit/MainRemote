/**
 * The questions the rankings page gets asked.
 *
 * Fifth sibling to team/outlook-faq.ts, team/stats-faq.ts, team/depth-faq.ts
 * and team/schedule-faq.ts, and it breaks their shape in one way worth stating
 * plainly: those four derive every answer from the rows rendered above them, so
 * an answer cannot contradict the table. These are written copy. There is no
 * fixture behind "how often are the rankings updated" — the honest answer is a
 * sentence somebody wrote, not a field somebody published.
 *
 * So the rule the other four enforce by construction is enforced here by hand,
 * and it is the reason this is a module rather than a blob of HTML: the two
 * answers that CAN be wrong take the board as an argument and are built from
 * it. The scoring answer names the format from `data.scoring` rather than
 * asserting PPR, and the updated answer carries the board's own timestamp. If
 * a Half-PPR file is ever published, the answer changes with the file.
 *
 * The copy is otherwise as supplied, including its rest-of-season framing. That
 * framing is a deliberate editorial choice and not an accident of this module:
 * the page's own title, meta description and CSV all say redraft. See the note
 * in replit.md under "Redraft Rankings" before rewording either side.
 */

import type { RankingsData } from "./rankings-data";

export interface RankingsFaq {
  question: string;
  answer: string;
}

/** The heading the block prints, kept beside the questions it introduces. */
export const RANKINGS_FAQ_HEADING = "Rest of Season Fantasy Football Rankings FAQ";

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
 * Definition first, then the two comparisons a reader arrives with (weekly
 * rankings, trade value), then the mechanics. That is the order they were
 * supplied in and it is also the order they are asked in — somebody who does
 * not know what the board is does not have a question about strength of
 * schedule yet.
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
      question: `How often are the ${data.season} rest of season fantasy football rankings updated?`,
      answer: updatedAnswer(data),
    },
    {
      question:
        "What is the difference between rest of season rankings and weekly rankings?",
      answer:
        "Rest of season rankings evaluate a player's value over the remaining " +
        "fantasy season. Weekly rankings focus only on the player's upcoming " +
        "matchup and expected production for that specific week.",
    },
    {
      question:
        "What is the difference between rest of season rankings and trade value?",
      answer:
        "Rest of season rankings measure expected fantasy production and " +
        "usefulness over the remaining season. Trade value can also reflect " +
        "positional scarcity, roster construction, market demand and the value " +
        "fantasy managers place on acquiring a particular player.",
    },
    {
      question: "Do these rankings support PPR, Half-PPR and Standard scoring?",
      answer: scoringAnswer(data),
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
      question: "How are injured players handled in rest of season rankings?",
      answer:
        "Injuries are considered when estimating a player's remaining-season " +
        "value. Expected missed time, current injury status and the player's " +
        "projected role after returning can all affect where a player ranks.",
    },
    {
      question:
        "Do strength of schedule and upcoming matchups affect rest of season rankings?",
      answer:
        "Yes. Remaining schedule can affect a player's outlook, especially when " +
        "two players have otherwise similar roles and projected workloads. " +
        "Matchup strength is considered alongside usage, talent, team " +
        "environment and expected opportunity.",
    },
    {
      question: "When should I use rest of season rankings?",
      answer:
        "Rest of season rankings are most useful for evaluating trades, " +
        "comparing waiver-wire options, making roster decisions and identifying " +
        "players whose value has changed since draft day.",
    },
  ];
}
