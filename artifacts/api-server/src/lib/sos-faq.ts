/**
 * The FAQ under the strength-of-schedule board.
 *
 * mak's questions and answers (2026-11-03, replacing the 2026-10-08 set),
 * printed as written with the fill-ins the brief asked for: the position
 * and the scoring format are the board's own, so the WR + Half-PPR view asks
 * "Which team has the easiest WR schedule for the rest of the 2026 season?"
 * and answers it in Half-PPR, rather than talking about running backs. The
 * four team answers (easiest and toughest rest-of-season and fantasy playoff
 * schedules) read the board's rows, so they move with the board instead of
 * going stale, and the season is filled wherever the copy names a year.
 *
 * The overview swaps the FAQ with the view (client/sos.ts), and each position
 * page prints its own position's FAQ, which is what makes the five addresses
 * answer five different sets of searches.
 *
 * On the page only: no FAQ schema is emitted here (the SOS page prints title,
 * H1 and description and nothing else, by mak's 2026-09-30 decision).
 */
import { escapeHtml } from "./render";
import type { FantasyPosition } from "./fpa/nflverse";
import { SCORING_LABELS, SOS_SCORINGS, type SosBoard, type SosScoring } from "./sos/sos-model";

export interface SosFaqTeamFact {
  fullName: string;
  /** Average opponent aFPA over the span, one decimal when printed. */
  afpa: number;
  /** The team's rank on the span's ranking, 1 = easiest. */
  rank: number;
}

export interface SosFaqFacts {
  /**
   * Easiest and toughest remaining schedule. Once the regular fantasy season
   * is over there is no rest of it, and the pair is the full season's
   * instead (`span` says which), as the position pages' answer sentence does.
   */
  ros: { span: "ros" | "full"; easiest: SosFaqTeamFact; toughest: SosFaqTeamFact } | null;
  /** Easiest and toughest Weeks 15-17. */
  playoff: { easiest: SosFaqTeamFact; toughest: SosFaqTeamFact } | null;
}

/** The four team answers' numbers, from the board's own rows; null without a board. */
export function sosFaqFacts(board: SosBoard | null): SosFaqFacts | null {
  if (!board) return null;
  const pair = <T>(
    rows: T[],
    rank: (row: T) => number,
    afpa: (row: T) => number,
    name: (row: T) => string,
  ): { easiest: SosFaqTeamFact; toughest: SosFaqTeamFact } | null => {
    if (rows.length < 2) return null;
    const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
    const fact = (row: T): SosFaqTeamFact => ({ fullName: name(row), afpa: afpa(row), rank: rank(row) });
    return { easiest: fact(sorted[0]!), toughest: fact(sorted[sorted.length - 1]!) };
  };
  const name = (t: SosBoard["teams"][number]) => t.team.fullName;

  const rosRows = board.teams.filter((t) => t.ros !== null);
  const rosPair = pair(rosRows, (t) => t.rosRank, (t) => t.ros!.afpa, name);
  let ros: SosFaqFacts["ros"] = rosPair ? { span: "ros", ...rosPair } : null;
  if (!ros) {
    const fullRows = board.teams.filter((t) => t.fullAfpa !== null);
    const fullPair = pair(fullRows, (t) => t.overallRank, (t) => t.fullAfpa!, name);
    ros = fullPair ? { span: "full", ...fullPair } : null;
  }

  const poRows = board.teams.filter((t) => t.po3 !== null);
  const playoff = pair(poRows, (t) => t.playoffRank, (t) => t.po3!.afpa, name);

  return { ros, playoff };
}

const one = (n: number): string => n.toFixed(1);

/** "running backs" and "a running back", the long forms the answers use. */
const POSITION_WORDS: Record<FantasyPosition, { plural: string; singular: string }> = {
  QB: { plural: "quarterbacks", singular: "a quarterback" },
  RB: { plural: "running backs", singular: "a running back" },
  WR: { plural: "wide receivers", singular: "a wide receiver" },
  TE: { plural: "tight ends", singular: "a tight end" },
};

interface Faq {
  q: string;
  /**
   * Blocks, already HTML: a paragraph's text (wrapped in <p> when printed),
   * or a block element of its own when it starts with "<".
   */
  a: string[];
}

const e = escapeHtml;

/** "Half-PPR and Standard": the two formats the board is not showing. */
function otherScorings(scoring: SosScoring): string {
  const others = SOS_SCORINGS.filter((s) => s !== scoring).map((s) => SCORING_LABELS[s]);
  return others.join(" and ");
}

function questions(board: SosBoard, facts: SosFaqFacts | null): Faq[] {
  const season = board.season;
  const prior = season - 1;
  const pos = board.position;
  const { plural, singular } = POSITION_WORDS[pos];
  const scoring = SCORING_LABELS[board.scoring];
  const ros = facts?.ros ?? null;
  const po = facts?.playoff ?? null;
  // The rest-of-season pair reads the full season once nothing is left to play.
  const remaining = ros?.span === "full" ? "full-season" : "rest-of-season";
  const opponents = ros?.span === "full" ? "opponents" : "remaining opponents";

  return [
    {
      q: "What is fantasy football strength of schedule?",
      a: [
        "Fantasy football strength of schedule measures how favorable or difficult a team's upcoming opponents are for fantasy production.",
        `This page ranks every NFL team's schedule using adjusted fantasy points allowed (aFPA) to the selected position, ${e(plural)} on this view. A higher aFPA generally indicates an easier fantasy matchup, while a lower aFPA indicates a tougher matchup.`,
      ],
    },
    {
      q:
        ros?.span === "full"
          ? `Which team had the easiest ${pos} schedule in the ${season} season?`
          : `Which team has the easiest ${pos} schedule for the rest of the ${season} season?`,
      a: [
        ros
          ? `The ${e(ros.easiest.fullName)} currently have the easiest ${remaining} schedule for ${e(plural)} in ${e(scoring)} scoring, based on the average adjusted fantasy points allowed by their ${opponents} (${one(ros.easiest.afpa)} per game).`
          : `The team ranked No. 1 in the ROS column above currently has the easiest rest-of-season schedule for ${e(plural)} in ${e(scoring)} scoring, based on the average adjusted fantasy points allowed by its remaining opponents.`,
        "Strength of schedule changes throughout the season as defensive performance and remaining opponents change.",
      ],
    },
    {
      q:
        ros?.span === "full"
          ? `Which team had the hardest ${pos} schedule in the ${season} season?`
          : `Which team has the hardest ${pos} schedule for the rest of the season?`,
      a: [
        ros
          ? `The ${e(ros.toughest.fullName)} currently have the toughest ${remaining} schedule for ${e(plural)} based on opponent aFPA in ${e(scoring)} scoring (${one(ros.toughest.afpa)} adjusted fantasy points allowed per game by their ${opponents}).`
          : `The team ranked No. 32 in the ROS column above currently has the toughest remaining schedule for ${e(plural)} based on opponent aFPA in ${e(scoring)} scoring.`,
        `A difficult schedule does not automatically make ${e(singular)} a sit, but it can be useful when comparing similarly valued fantasy players.`,
      ],
    },
    {
      q: "What does aFPA mean in fantasy football?",
      a: [
        "aFPA stands for adjusted fantasy points allowed. It measures how many fantasy points a defense allows to a specific position while accounting for the quality of the players and offenses it has faced.",
        "On this board, higher aFPA means an easier matchup and lower aFPA means a more difficult matchup.",
      ],
    },
    {
      q: "How do I read the fantasy strength of schedule rankings?",
      a: [
        "Each team receives separate rankings for its full-season schedule, rest-of-season schedule, and fantasy playoff schedule.",
        `A schedule rank of 1 means the easiest schedule for the selected position. Individual defensive matchup rankings work in the opposite context: the strongest defenses allow the fewest adjusted fantasy points to ${e(plural)}.`,
      ],
    },
    {
      q: "Can I see strength of schedule by fantasy position?",
      a: [
        "Yes. You can view fantasy strength of schedule separately for:",
        `<ul class="scsos-faq-list-items">` +
          `<li>Quarterbacks (QB)</li>` +
          `<li>Running backs (RB)</li>` +
          `<li>Wide receivers (WR)</li>` +
          `<li>Tight ends (TE)</li>` +
          `</ul>`,
        "Because defenses perform differently against each position, a team can have an easy schedule for running backs but a difficult schedule for wide receivers or quarterbacks.",
      ],
    },
    {
      q: "Can I change the scoring format for strength of schedule?",
      a: [
        `Yes. This board is showing ${e(scoring)} scoring, and the strength of schedule rankings can also be viewed in ${e(otherScorings(board.scoring))}.`,
        "Changing the scoring format can affect matchup values and schedule rankings, especially for running backs, wide receivers, and tight ends whose receiving production varies significantly.",
      ],
    },
    {
      q: "What is rest-of-season strength of schedule?",
      a: [
        "Rest-of-season strength of schedule, or ROS SOS, looks only at games remaining on a team's schedule.",
        "It is particularly useful during the fantasy season when evaluating trades, waiver-wire pickups, and players whose upcoming schedule may be easier or harder than their season-long schedule suggests.",
      ],
    },
    {
      q: "What is fantasy playoff strength of schedule?",
      a: [
        "Fantasy playoff strength of schedule focuses specifically on the weeks most commonly used for fantasy football playoffs.",
        "The Playoff ranking helps identify players and teams with favorable or difficult matchups during the most important weeks of the fantasy season.",
      ],
    },
    {
      q: `Which team has the easiest ${pos} fantasy playoff schedule?`,
      a: [
        po
          ? `The ${e(po.easiest.fullName)} currently have the easiest fantasy playoff schedule for ${e(plural)}, with their playoff opponents allowing approximately ${one(po.easiest.afpa)} adjusted fantasy points per game to the position in ${e(scoring)} scoring.`
          : `The team ranked No. 1 in the Playoff column above currently has the easiest fantasy playoff schedule for ${e(plural)} in ${e(scoring)} scoring.`,
        "Fantasy playoff rankings can change as defensive performance is updated throughout the season.",
      ],
    },
    {
      q: `Which team has the hardest ${pos} fantasy playoff schedule?`,
      a: [
        po
          ? `The ${e(po.toughest.fullName)} currently have the toughest fantasy playoff schedule for ${e(plural)}, with their playoff opponents allowing approximately ${one(po.toughest.afpa)} adjusted fantasy points per game to the position in ${e(scoring)} scoring.`
          : `The team ranked No. 32 in the Playoff column above currently has the toughest fantasy playoff schedule for ${e(plural)} in ${e(scoring)} scoring.`,
        "This can be useful when comparing players with similar fantasy value before the trade deadline or fantasy playoffs.",
      ],
    },
    {
      q: "How should I use strength of schedule for fantasy football?",
      a: [
        "Strength of schedule works best as a tiebreaker rather than a standalone player-ranking system.",
        "Player talent, workload, targets, snap share, red-zone usage, injuries, and offensive environment usually matter more than schedule. SOS becomes especially useful when comparing two similarly valued players or planning several weeks ahead.",
      ],
    },
    {
      q: "Should I trade for players with an easy rest-of-season schedule?",
      a: [
        "An easy schedule can increase a player's upside, particularly when the player's role is already secure.",
        "Fantasy managers can use ROS strength of schedule to identify potential trade targets, buy-low players, waiver additions, and playoff stashes, but matchup quality should be considered alongside usage and player performance.",
      ],
    },
    {
      q: "Does strength of schedule matter more for some positions?",
      a: [
        "Yes. Matchups can affect positions differently.",
        "Running backs may be influenced by a defense's ability to stop rushing production and receiving work out of the backfield, while wide receivers and quarterbacks are more affected by coverage, pass defense, and game environment. That is why this page calculates SOS separately for QB, RB, WR, and TE.",
      ],
    },
    {
      q: "What do Smash, Favorable, Neutral, Tough, and Avoid mean?",
      a: [
        `These labels group individual weekly matchups based on the opponent's adjusted fantasy points allowed to ${e(plural)}.`,
        "Smash and Favorable indicate above-average fantasy environments, while Tough and Avoid indicate opponents that have been more difficult for that position to score against. Neutral matchups fall closer to the league average.",
      ],
    },
    {
      q: "Why does fantasy strength of schedule change during the season?",
      a: [
        "Strength of schedule is dynamic because defensive performance changes as more games are played.",
        `Early-season results can also be distorted by opponent quality and small samples, which is why the StatChasers SOS model can incorporate data from both ${prior} and ${season} rather than treating every raw fantasy point allowed equally.`,
      ],
    },
    {
      q: "What is the difference between Team SOS and Player SOS?",
      a: [
        "Team SOS ranks the schedule faced by each NFL team at the selected position.",
        `Player SOS applies that team's schedule directly to relevant fantasy players, making it easier to see which ${e(plural)} have the most favorable upcoming schedules.`,
      ],
    },
    {
      q: "Can two players on the same team have the same strength of schedule?",
      a: [
        "Yes. Players at the same position on the same NFL team face the same scheduled opponents, so their underlying schedule strength can be identical.",
        "Their actual fantasy outlook can still be very different because workload, role, talent, injuries, and competition for touches or targets are player-specific.",
      ],
    },
    {
      q: "Where can I find fantasy football strength of schedule for every NFL team?",
      a: [
        `The table above shows ${season} fantasy football strength of schedule for all 32 NFL teams, including weekly opponents, matchup aFPA, overall schedule ranking, rest-of-season ranking, and fantasy playoff ranking.`,
        "Use the position and scoring controls to compare schedules for QB, RB, WR, and TE in PPR, Half-PPR, or Standard scoring.",
      ],
    },
  ];
}

export const SOS_FAQ_HEADING = "Fantasy Football Strength of Schedule FAQ";

/** The questions, for anything that needs the list without the markup (tests, a future schema). */
export function sosFaqEntries(board: SosBoard): { question: string; answer: string }[] {
  return questions(board, sosFaqFacts(board)).map((f) => ({
    question: f.q,
    answer: f.a
      .map((p) => p.replace(/<\/li>/g, ", ").replace(/<[^>]+>/g, "").replace(/,\s*$/, "."))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
}

/**
 * One fold per question, shut by default, the team hubs' arrangement
 * (usage-render.ts): every question shows, the answer opens under the one the
 * reader came for. The section is swapped whole with the view (client/sos.ts),
 * so the board's position and scoring are the FAQ's.
 */
export function renderSosFaq(board: SosBoard): string {
  const items = questions(board, sosFaqFacts(board))
    .map(
      (f) =>
        `<details class="scsos-faq-item">` +
        `<summary class="scsos-faq-q-row"><h3 class="scsos-faq-q">${e(f.q)}</h3></summary>` +
        `<div class="scsos-faq-a">${f.a.map((p) => (p.startsWith("<") ? p : `<p>${p}</p>`)).join("")}</div>` +
        `</details>`,
    )
    .join("");
  return (
    `<section class="scsos-faq" aria-labelledby="scsos-faq-title"` +
    ` data-pos="${board.position.toLowerCase()}" data-scoring="${board.scoring}">` +
    `<h2 id="scsos-faq-title" class="scsos-faq-title">${e(SOS_FAQ_HEADING)}</h2>` +
    `<div class="scsos-faq-list">${items}</div>` +
    `</section>`
  );
}
