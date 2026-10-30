/**
 * The words a completed game's page wears: title, H1, the context line under
 * it, the intro sentence and the meta description.
 *
 * One module, pure, fed a small fact sheet (gameSeoFacts() in
 * scoreboard-hero.ts builds it from the hero's game object) so that the pair's
 * page and the dated game page under it cannot disagree, and so that the
 * strings can be tested without a server. The WordPress plugin MIRRORS the
 * title and description ladders in statchasers_matchup_meta() and
 * statchasers_matchup_game_meta() for an API that sends no header; change one
 * and change the other.
 *
 * Why these words (Search Console, 2026-10-16 to 10-30): the pair pages earn
 * their impressions for "{team} vs {team} match player stats", "{team} vs
 * {team} player stats", "... stats", "... box score", "... score" - 170k
 * impressions and two clicks for one game under a title that led with
 * "Fantasy Points". So the page now reads as an NFL game and player-stat page
 * first, in the order the searches say the teams (away, then home), with the
 * fantasy analytics named as what sets it apart rather than as the subject.
 * Nothing fantasy was removed; the title no longer leads with it.
 */

export interface GameSeoTeam {
  /** "Tennessee Titans" */
  name: string;
  /** "Titans" */
  short: string;
}

export interface GameSeoFacts {
  away: GameSeoTeam;
  home: GameSeoTeam;
  /** "Week 6", "Wild Card", "Super Bowl"; null when the schedule has none. */
  round: string | null;
  postseason: boolean;
  /** The season the game belongs to; null when unknown. */
  season: number | null;
  /** "October 18, 2026", the kickoff in the Eastern calendar; null when undated. */
  date: string | null;
  /** The final, by side; null before the game is over or when it is unknown. */
  score: { away: number; home: number } | null;
  overtime: boolean;
}

/** "Titans vs Colts" - away then home, as the searches and the scoreboard read. */
export function gameSeoPair(f: GameSeoFacts): string {
  return `${f.away.short} vs ${f.home.short}`;
}

/** "Tennessee Titans vs Indianapolis Colts". */
export function gameSeoNames(f: GameSeoFacts): string {
  return `${f.away.name} vs ${f.home.name}`;
}

interface Outcome {
  winner: GameSeoTeam | null;
  loser: GameSeoTeam | null;
  high: number;
  low: number;
  tie: boolean;
}

function outcome(f: GameSeoFacts): Outcome | null {
  if (!f.score) return null;
  const { away, home } = f.score;
  if (away === home) return { winner: null, loser: null, high: away, low: home, tie: true };
  const awayWon = away > home;
  return {
    winner: awayWon ? f.away : f.home,
    loser: awayWon ? f.home : f.away,
    high: Math.max(away, home),
    low: Math.min(away, home),
    tie: false,
  };
}

/** "Titans'" for a plural nickname, "Jazz's" for the one that is not. */
function possessive(short: string): string {
  return short.endsWith("s") ? `${short}'` : `${short}'s`;
}

/** "(Week 6, 2026)", "(Week 6)", "(2026)" or "" - whatever is known. */
function when(f: GameSeoFacts): string {
  if (f.round && f.season !== null) return `(${f.round}, ${f.season})`;
  if (f.round) return `(${f.round})`;
  if (f.season !== null) return `(${f.season})`;
  return "";
}

function join(...parts: string[]): string {
  return parts.filter((p) => p !== "").join(" ");
}

/**
 * The <title> ladder for a completed game, most descriptive first; the caller
 * takes the first that fits its budget (fitMatchupTitle, sixty characters).
 *
 * "Titans vs Colts Match Player Stats & Box Score (Week 6, 2026)" is the
 * target. The year goes first when it does not fit, then "& Box Score", then
 * the year again; the last rung fits every pair and every round. Nicknames
 * throughout: two full names spend up to 45 of the 60 on their own.
 */
export function completedGameTitleCandidates(f: GameSeoFacts): string[] {
  const pair = gameSeoPair(f);
  const full = when(f);
  const roundOnly = f.round ? `(${f.round})` : "";
  const candidates = [
    join(pair, "Match Player Stats & Box Score", full),
    join(pair, "Match Player Stats & Box Score", roundOnly),
    join(pair, "Match Player Stats", full),
    join(pair, "Match Player Stats", roundOnly),
    // "Buccaneers vs Commanders Stats, Conference Championship": the longest
    // nicknames with the longest round, still under sixty.
    f.round ? `${pair} Stats, ${f.round}` : "",
    join(pair, "Match Player Stats"),
  ].filter((c) => c !== "");
  // One of each; a missing round or year collapses rungs into duplicates.
  return [...new Set(candidates)];
}

/**
 * The H1: "Tennessee Titans vs Indianapolis Colts Match Player Stats". Full
 * names, away then home. With `round`, the week follows after a colon - the
 * dated game page's heading, so two meetings of one pair in one season do not
 * share a heading with each other or with the pair's own page.
 */
export function completedGameHeading(f: GameSeoFacts, options: { round?: boolean } = {}): string {
  const base = `${gameSeoNames(f)} Match Player Stats`;
  if (!options.round) return base;
  if (f.round && f.season !== null) return `${base}: ${f.round}, ${f.season}`;
  if (f.round) return `${base}: ${f.round}`;
  if (f.season !== null) return `${base}: ${f.season}`;
  return base;
}

/**
 * "Titans 26, Colts 20" - winner first, the loser after; "Titans 20, Colts
 * 20 (tie)" for a tie; "(OT)" after an overtime final. Null without a score.
 */
export function completedGameScoreText(f: GameSeoFacts): string | null {
  const o = outcome(f);
  if (!o) return null;
  const first = o.winner ?? f.away;
  const second = o.loser ?? f.home;
  return `${first.short} ${o.high}, ${second.short} ${o.low}${o.tie ? " (tie)" : ""}${f.overtime ? " (OT)" : ""}`;
}

/**
 * The line under the H1: "Week 6 · October 18, 2026 · Titans 26, Colts 20".
 * The reader confirms the game in one glance; nothing here is a sentence.
 * A postseason round carries its season ("2025 Wild Card") since the date
 * alone puts it in the following calendar year. Empty when nothing is known.
 */
export function completedGameContext(f: GameSeoFacts): string {
  const roundText = f.round
    ? f.postseason && f.season !== null
      ? `${f.season} ${f.round}`
      : f.round
    : f.season !== null
      ? `${f.season} season`
      : "";
  return [roundText, f.date ?? "", completedGameScoreText(f) ?? ""].filter((p) => p !== "").join(" · ");
}

/** "Week 6 of the 2026 NFL season", "the Wild Card round of the 2025 NFL playoffs", ... or "". */
function fromPhrase(f: GameSeoFacts): string {
  if (f.round && f.season !== null) {
    if (!f.postseason) return `${f.round} of the ${f.season} NFL season`;
    const named = /round|championship|bowl/i.test(f.round) ? f.round : `${f.round} round`;
    return `the ${named} of the ${f.season} NFL playoffs`;
  }
  if (f.round) return f.postseason ? `the ${f.round}` : f.round;
  if (f.season !== null) return `the ${f.season} NFL season`;
  return "";
}

/**
 * The visible sentence or two near the top of the page.
 *
 * "Tennessee Titans vs Indianapolis Colts match player stats from Week 6 of
 * the 2026 NFL season. The Titans defeated the Colts 26–20 on October 18,
 * 2026." Nicknames in the result, not cities: two New York clubs share one.
 * A tie reads as a tie; a game without a score has one sentence.
 */
export function completedGameIntro(f: GameSeoFacts): string {
  const from = fromPhrase(f);
  const first = `${gameSeoNames(f)} match player stats${from ? ` from ${from}` : ""}.`;
  const o = outcome(f);
  if (!o) return first;
  const on = f.date ? ` on ${f.date}` : "";
  const ot = f.overtime ? " in overtime" : "";
  const second = o.tie
    ? `The ${f.away.short} and the ${f.home.short} tied ${o.high}–${o.low}${ot}${on}.`
    : `The ${o.winner!.short} defeated the ${o.loser!.short} ${o.high}–${o.low}${ot}${on}.`;
  return `${first} ${second}`;
}

/** The longest description a results page shows whole. */
export const DESCRIPTION_MAX = 165;

/**
 * The meta description: both teams, "match player stats", the week and
 * year, what the page holds, and the final.
 *
 * "Titans vs Colts match player stats from Week 6, 2026: passing, rushing and
 * receiving, box score, fantasy points, snaps, targets and usage from the
 * Titans' 26–20 win." A ladder, longest first, and the first within 165
 * characters is used: full names give way to nicknames, then the list of
 * what the page holds shortens, and the result clause goes last. The final
 * rung fits every pair and every round.
 */
export function completedGameDescription(f: GameSeoFacts): string {
  const whenText =
    f.round && f.season !== null
      ? `${f.round}, ${f.season}`
      : f.round
        ? f.round
        : f.season !== null
          ? `the ${f.season} season`
          : f.date;
  const from = whenText ? ` from ${whenText}` : "";
  const o = outcome(f);
  const result = o
    ? o.tie
      ? ` from the ${o.high}–${o.low} tie`
      : ` from the ${possessive(o.winner!.short)} ${o.high}–${o.low}${f.overtime ? " overtime" : ""} win`
    : "";
  const long = "passing, rushing and receiving stats, box score, fantasy points, snaps, targets and usage";
  const mid = "passing, rushing and receiving, box score, fantasy points, snaps, targets and usage";
  const short = "passing, rushing and receiving, box score, fantasy points and usage";
  // The longest nicknames with the longest round ("Buccaneers vs Commanders
  // ... Conference Championship") keep the final only on this rung.
  const tiny = "passing, rushing, receiving and fantasy points";
  const sentence = (names: string, tail: string, withResult: boolean): string =>
    `${names} match player stats${from}: ${tail}${withResult ? result : ""}.`;
  const candidates = [
    sentence(gameSeoNames(f), long, true),
    sentence(gameSeoPair(f), long, true),
    sentence(gameSeoPair(f), mid, true),
    sentence(gameSeoPair(f), short, true),
    sentence(gameSeoPair(f), tiny, true),
    sentence(gameSeoPair(f), short, false),
  ];
  return candidates.find((c) => c.length <= DESCRIPTION_MAX) ?? candidates[candidates.length - 1]!;
}
