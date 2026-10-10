/**
 * The FAQ under the redraft strategy analyzer.
 *
 * mak's questions and answers (2026-10-10), printed as written, with one
 * kind of fill-in: the sentences that quote "the currently selected" sample
 * (its season and format, its league and team counts, the two strategies
 * with the highest playoff rates, Robust RB's rates, and the "vs Average"
 * example) read the view the reader has open, so they move with the filters
 * instead of going stale. The bundle redraws the FAQ with the view.
 *
 * On the page only: no FAQ schema is emitted (SEO additions need mak's OK).
 */

import { escapeHtml } from "../render";
import {
  compareChartRows,
  comboKey,
  fmtInt,
  fmtPct,
  mergeStrategies,
  trendKey,
  type Dataset,
  type Filters,
  type StrategyRow,
} from "./model";

export const RDS_FAQ_HEADING = "Frequently Asked Questions";

/** What the sample-specific sentences quote. */
export interface RdsFaqFacts {
  /** "2025, 12-team, 1QB, PPR" (", TE Premium" when set; "2021-2025" for the comparison). */
  sample: string;
  leagues: number | null;
  teams: number;
  /** The two strategies with the highest playoff rates, best first. */
  top: StrategyRow[];
  robust: StrategyRow | null;
  baseline: number | null;
}

function sampleLabel(f: Filters): string {
  const season = f.season === "compare" ? "2021-2025" : f.season;
  const parts = [season, `${f.size}-team`, f.qb === "superflex" ? "Superflex" : "1QB", f.scoring === "half_ppr" ? "Half PPR" : "PPR"];
  if (f.tep === "tep") parts.push("TE Premium");
  return parts.join(", ");
}

/** The facts for the open view, or null when its data is not loaded. */
export function rdsFaqFacts(data: Dataset, f: Filters): RdsFaqFacts | null {
  let rows: StrategyRow[];
  let leagues: number | null;
  let teams: number;
  let baseline: number | null;
  if (f.season === "compare") {
    const trend = data.trends[trendKey(f)];
    if (!trend) return null;
    const c = compareChartRows(trend);
    rows = c.rows;
    leagues = null;
    teams = ["2021", "2022", "2023", "2024", "2025"].reduce((n, y) => n + ((trend[`sample_${y}`] as number | undefined) ?? 0), 0);
    baseline = c.baseline;
  } else {
    const combo = data.combos[comboKey(f)];
    if (!combo) return null;
    rows = mergeStrategies(combo.best_strategies, combo.worst_strategies);
    leagues = combo.league_count;
    teams = combo.sample_size;
    baseline = combo.baseline.playoff_rate;
  }
  const top = [...rows].sort((a, b) => b.playoff_rate - a.playoff_rate).slice(0, 2);
  return { sample: sampleLabel(f), leagues, teams, top, robust: rows.find((r) => r.strategy === "Robust RB") ?? null, baseline };
}

const e = escapeHtml;
const pct = (v: number) => fmtPct(v, 1);

function strongLift(lift: number): string {
  return `<strong>${lift >= 0 ? "+" : "-"}${Math.abs(lift).toFixed(1)} percentage points</strong>`;
}

interface Faq {
  q: string;
  a: string[];
}

function questions(facts: RdsFaqFacts | null): Faq[] {
  const [first, second] = facts?.top ?? [];
  const bestSentence =
    facts && first && second
      ? [
          `For the currently selected ${e(facts.sample)} sample, ${e(first.strategy)} and ${e(second.strategy)} produced the highest playoff rates among the major strategies analyzed. ` +
            `${e(first.strategy)} teams made the playoffs ${pct(first.playoff_rate)} of the time, while ${e(second.strategy)} teams reached the playoffs at a ${pct(second.playoff_rate)} rate.`,
        ]
      : [];
  const sampleSentence = facts
    ? facts.leagues !== null
      ? `For example, the current ${e(facts.sample)} sample includes ${fmtInt(facts.leagues)} leagues and ${fmtInt(facts.teams)} drafted teams.`
      : `For example, the current ${e(facts.sample)} comparison includes ${fmtInt(facts.teams)} drafted teams across the five seasons.`
    : "Each sample is named above the results with its league and team counts.";
  const liftExample =
    facts && first && facts.baseline !== null
      ? `For example, if the league-average playoff rate is ${pct(facts.baseline)} and a strategy has a ${pct(first.playoff_rate)} playoff rate, it is shown as ${strongLift((first.playoff_rate - facts.baseline) * 100)}.`
      : `For example, if the league-average playoff rate is 50% and a strategy has a 54.2% playoff rate, it is shown as <strong>+4.2 percentage points</strong>.`;
  const robustSentence =
    facts?.robust
      ? [`In the current ${e(facts.sample)} sample, Robust RB teams posted a ${pct(facts.robust.playoff_rate)} playoff rate and a ${pct(facts.robust.championship_rate)} championship rate.`]
      : [];

  return [
    {
      q: "What is the best fantasy football draft strategy?",
      a: [
        "There is no single draft strategy that is best in every league format or season. This study uses real fantasy football draft results to compare how different roster-building strategies performed after the draft.",
        ...bestSentence,
        "Those results should be viewed within the selected league settings rather than as a universal rule. Change the scoring system, league size, quarterback format, or season and the strongest draft strategies may change.",
      ],
    },
    {
      q: "How does the fantasy football draft strategy study work?",
      a: [
        "The Redraft Draft Strategy Analysis groups real fantasy football teams based on how they constructed their rosters during the draft. It then compares those strategies using outcomes such as playoff rate, championship rate, and top-three regular-season points finishes.",
        "You can filter the research by season, league size, quarterback format, scoring format, and tight end premium settings to see how draft strategy performance changes across different types of leagues.",
      ],
    },
    {
      q: "How much data is included in the study?",
      a: [
        "Sample size depends on the filters selected.",
        sampleSentence,
        "Each table also displays the sample size for the specific strategy or draft sequence being analyzed. Larger samples generally provide more confidence than strategies that occurred only a small number of times.",
      ],
    },
    {
      q: "What does playoff rate mean?",
      a: [
        "Playoff rate is the percentage of teams using a particular draft strategy that qualified for their fantasy playoffs.",
        "If a strategy has a 54% playoff rate, approximately 54 out of every 100 teams classified under that strategy reached the playoffs in the analyzed sample.",
        "The league-average playoff rate is displayed alongside each strategy so you can see whether the strategy performed above or below the baseline.",
      ],
    },
    {
      q: "What does “vs Average” mean?",
      a: [
        "“Vs Average” shows how many percentage points a strategy's playoff rate finished above or below the league average.",
        liftExample,
        "Percentage points are different from percent change. A move from 50% to 54% is an increase of four percentage points.",
      ],
    },
    {
      q: "What does Top-3 Points mean?",
      a: [
        "Top-3 Points measures how often teams using a particular strategy finished among the top three teams in their league in regular-season points scored.",
        "This gives another way to evaluate draft success beyond simply making the playoffs. A strategy may produce an average playoff rate while still generating an unusually high or low number of elite scoring teams.",
      ],
    },
    {
      q: "What is Zero RB in fantasy football?",
      a: [
        "Zero RB is a draft strategy that intentionally avoids spending early-round picks on running backs, instead prioritizing positions such as wide receiver, tight end, or quarterback before building the running back room later.",
        "The goal is typically to accumulate strength at more stable positions while finding running back production later through depth, breakouts, injuries, or the waiver wire.",
        "The effectiveness of Zero RB can vary significantly by season and league format, which is why this tool evaluates it using actual draft outcomes rather than assuming the strategy is always good or bad.",
      ],
    },
    {
      q: "What is Hero RB?",
      a: [
        "Hero RB is a fantasy football draft strategy in which a manager selects one high-end running back early and then waits before investing heavily in additional running backs.",
        "The remaining early-round draft capital is usually spent on wide receivers, quarterbacks, or tight ends.",
        "Hero RB attempts to combine the advantage of having an elite starting running back with the depth benefits of targeting other positions through the middle rounds.",
      ],
    },
    {
      q: "What is Robust RB?",
      a: [
        "Robust RB is a strategy that invests heavily in running backs during the early rounds of a fantasy football draft.",
        "Rather than relying on one anchor running back, Robust RB teams typically build significant early-round RB strength before filling out wide receiver and other positions later.",
        ...robustSentence,
      ],
    },
    {
      q: "What is the difference between Hero RB and Double Hero RB?",
      a: [
        "Hero RB is built around one early premium running back followed by greater investment at other positions.",
        "Double Hero RB starts with two high-value running backs before shifting draft capital toward wide receiver, quarterback, tight end, or other roster needs.",
        "The study tracks them separately because selecting one early running back and selecting two can create meaningfully different roster constructions.",
      ],
    },
    {
      q: "What does Late QB mean?",
      a: [
        "Late QB refers to waiting on the quarterback position rather than selecting one of the earliest quarterbacks available.",
        "The strategy attempts to use premium early-round draft capital on running backs, wide receivers, or tight ends while finding sufficient quarterback production later in the draft.",
        "Whether Late QB is effective depends heavily on league format. It may behave very differently in traditional 1QB leagues than in Superflex formats, where quarterbacks are substantially more valuable.",
      ],
    },
    {
      q: "What does Elite QB mean?",
      a: [
        "Elite QB describes teams that spend significant early-round draft capital on one of the highest-drafted quarterbacks.",
        "The strategy sacrifices an early pick at another position in exchange for a potential weekly advantage at quarterback.",
        "Because quarterback value changes dramatically between 1QB and Superflex leagues, Elite QB results should always be evaluated using the appropriate league-format filter.",
      ],
    },
    {
      q: "What does Late TE mean?",
      a: [
        "Late TE describes teams that wait beyond the early tight end tier before selecting their primary tight end.",
        "Instead of paying an early-round opportunity cost for an elite tight end, these teams use their premium draft picks at running back, wide receiver, or quarterback and search for tight end value later.",
        "The effectiveness of this strategy may change considerably in Tight End Premium leagues.",
      ],
    },
    {
      q: "What does Elite TE mean?",
      a: [
        "Elite TE refers to teams that spend an early draft pick on one of the highest-valued tight ends.",
        "The strategy is designed to create a positional advantage at a position where elite fantasy production can sometimes separate significantly from the rest of the field.",
        "Use the Tight End Premium filters when evaluating Elite TE because additional points for tight end receptions can materially change the value of the position.",
      ],
    },
    {
      q: "What is Fragile RB?",
      a: [
        "Fragile RB is a roster construction that invests heavily enough at running back early to establish strong starters but carries relatively little running back depth later in the draft.",
        "The strategy relies on the early running backs staying healthy and maintaining their roles while allocating more later-round picks to other positions.",
        "It differs from Robust RB, which generally continues investing more heavily in running back depth.",
      ],
    },
    {
      q: "What is a Balanced Start?",
      a: [
        "Balanced Start refers to draft builds that spread early-round capital across multiple positions rather than following a highly concentrated strategy such as Zero RB, Robust RB, or an early quarterback-heavy build.",
        "Balanced teams typically leave the opening rounds with a mix of running back, wide receiver, quarterback, and/or tight end talent.",
        "Because Balanced Start encompasses a broader range of roster constructions, it also tends to have a much larger sample than highly specific strategies.",
      ],
    },
    {
      q: "What can the Round Value section tell me?",
      a: [
        "Round Value shows how teams performed depending on which position they drafted in a particular round.",
        "For example, you can compare the playoff rate, championship rate, and top-three scoring rate of teams that selected an RB versus WR in Round 1.",
        "This helps answer questions such as whether running backs, wide receivers, quarterbacks, or tight ends provided the strongest historical outcomes at different points of the draft.",
      ],
    },
    {
      q: "What does the First Two Picks analysis show?",
      a: [
        "The First Two Picks section compares teams based on the positions selected with their first two draft picks.",
        "Examples include RB/RB, RB/WR, WR/RB, WR/WR, or WR/QB.",
        "Because early picks represent a large portion of a fantasy team's draft capital, this analysis helps show which opening roster constructions were associated with stronger playoff and scoring results in the selected sample.",
      ],
    },
    {
      q: "What does the First Five Rounds analysis show?",
      a: [
        "The First Five Rounds section looks at more specific draft builds based on the positional sequence of a team's first five selections.",
        "For example, a build such as RB/RB/WR/WR/WR can be compared with other five-round combinations.",
        "These combinations can provide useful directional insight, but highly specific sequences naturally have smaller samples. Sample size should therefore be considered carefully before drawing strong conclusions.",
      ],
    },
    {
      q: "Why are some strategies or positions hidden?",
      a: [
        "Very small samples can produce extreme results that are not necessarily repeatable.",
        "For certain analyses, StatChasers hides results that fall below the minimum sample requirement. For example, the Round Value table may hide positions with fewer than 250 qualifying teams.",
        "Low-sample five-round builds can still be displayed separately as directional results, but they should not be treated with the same confidence as strategies represented by thousands of teams.",
      ],
    },
    {
      q: "Does a higher playoff rate prove that a draft strategy is better?",
      a: [
        "No. The study identifies relationships between draft construction and fantasy outcomes, but it does not prove that the strategy itself caused those results.",
        "Player quality, draft position, injuries, waiver-wire moves, trades, lineup decisions, schedule luck, league activity, and many other factors influence fantasy success.",
        "The strongest use of this research is to identify patterns across large numbers of real drafts and determine which roster constructions have historically been associated with better results.",
      ],
    },
    {
      q: "Does draft slot affect which strategy works best?",
      a: [
        "Yes. Draft position can significantly affect which strategies are available.",
        "A manager selecting early in Round 1 may have access to a completely different group of running backs, wide receivers, quarterbacks, and tight ends than someone drafting near the end of the round.",
        "The Real Draft Examples section helps show what these strategies actually looked like from different draft slots rather than treating every roster construction as if it were equally available from every position.",
      ],
    },
    {
      q: "Are these simulated drafts or real fantasy football drafts?",
      a: [
        "The analysis is built from real draft and league results rather than hypothetical mock-draft recommendations.",
        "The Real Draft Examples section also allows you to inspect actual draft boards and see how different strategies developed round by round.",
        "That distinction is important: the goal of the study is to analyze what fantasy managers actually drafted and how those teams subsequently performed.",
      ],
    },
    {
      q: "Should I copy the highest-ranked draft strategy exactly?",
      a: [
        "No. The rankings are better used as evidence to guide draft decisions than as a rigid script.",
        "A strong fantasy draft still requires reacting to player value, positional runs, league settings, draft slot, and what your opponents are doing.",
        "If a historically successful strategy requires reaching several rounds ahead of market value to maintain the build, forcing the strategy can erase the advantage the historical data suggests.",
      ],
    },
    {
      q: "Why do the results change when I change the league settings?",
      a: [
        "Player and positional values change depending on league structure.",
        "Quarterbacks become more valuable in Superflex leagues. Tight ends gain value in Tight End Premium formats. League size affects positional scarcity. PPR versus Half PPR changes the relative value of high-volume pass catchers and receiving running backs.",
        "For that reason, StatChasers analyzes draft strategies within specific league environments rather than assuming one set of results applies to every fantasy league.",
      ],
    },
    {
      q: "Can I use this study to prepare for my fantasy football draft?",
      a: [
        "Yes. The research can help you identify historically successful roster constructions, determine which positions have produced stronger outcomes in certain rounds, compare early-round combinations, and understand how league settings affect optimal draft strategy.",
        "The goal is not to predict exactly what will happen in your league. It is to give you a data-driven framework for deciding where to allocate your draft capital.",
      ],
    },
  ];
}

/** The questions and plain-text answers, for tests and any future schema. */
export function rdsFaqEntries(facts: RdsFaqFacts | null): { question: string; answer: string }[] {
  return questions(facts).map((f) => ({ question: f.q, answer: f.a.map((p) => p.replace(/<[^>]+>/g, "")).join(" ") }));
}

/**
 * One fold per question, shut by default, the SOS FAQ's arrangement: every
 * question shows, the answer opens under the one the reader came for.
 */
export function renderRdsFaq(facts: RdsFaqFacts | null): string {
  const items = questions(facts)
    .map(
      (f) =>
        `<details class="scds-faq-item">` +
        `<summary class="scds-faq-q-row"><h3 class="scds-faq-q">${e(f.q)}</h3></summary>` +
        `<div class="scds-faq-a">${f.a.map((p) => `<p>${p}</p>`).join("")}</div>` +
        `</details>`,
    )
    .join("");
  return (
    `<section class="scds-faq" data-scds-faq aria-labelledby="scds-faq-title">` +
    `<h2 id="scds-faq-title" class="scds-faq-title">${e(RDS_FAQ_HEADING)}</h2>` +
    `<div class="scds-faq-list">${items}</div>` +
    `</section>`
  );
}
