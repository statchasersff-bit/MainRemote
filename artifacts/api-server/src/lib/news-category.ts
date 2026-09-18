/**
 * What kind of news an item is: injury, transaction, practice, and so on.
 *
 * DERIVED at read time, never stored. That is the same call the archive already
 * makes about a wire row's team (see the team_abbr comment in the schema): this
 * is a keyword judgement about a headline, not a fact the provider told us, and
 * a guess written into a column becomes indistinguishable from a fact the
 * moment it is stored. Deriving it also means the rules can be improved in one
 * place and every row in the archive — including the ones ingested before the
 * rule existed — is re-read under the new ones, with no backfill and nothing to
 * migrate.
 *
 * Pure and dependency-free, like lib/render.ts, so the same function can run on
 * the server, in the browser bundle, or in a test without a database.
 */

export const NEWS_CATEGORIES = [
  "injury",
  "transaction",
  "practice",
  "depth-chart",
  "rumor",
  "fantasy",
  "other",
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/** Display labels for the filter menu. */
export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  injury: "Injury",
  transaction: "Transaction",
  practice: "Practice",
  "depth-chart": "Depth Chart",
  rumor: "Rumor",
  fantasy: "Fantasy",
  other: "Other",
};

/**
 * Ordered rules: the first pattern that matches wins.
 *
 * The order is the judgement, and it is deliberate. "Limited in practice with a
 * hamstring" is an injury note that happens to mention practice, so injury is
 * tested first; "signed off the practice squad" is a transaction that happens
 * to mention practice, so transaction is tested before practice too. Fantasy
 * and rumor sit last because their vocabulary ("start", "value", "could") shows
 * up inside stories that are really about something more specific.
 */
const RULES: Array<{ category: NewsCategory; pattern: RegExp }> = [
  {
    category: "injury",
    pattern:
      /\b(injur\w*|acl|mcl|ucl|achilles|hamstring|concussion|protocol|quad|groin|ankle|knee|shoulder|hip|calf|foot|wrist|elbow|back|rib|oblique|thumb|finger|toe|surgery|mri|x-?ray|sprain\w*|strain\w*|fracture\w*|torn|tear|ruptur\w*|questionable|doubtful|inactive|ruled out|out for|miss(?:ed|ing|es)? (?:the )?(?:game|season|week|practice)|ir\b|injured reserve|pup list|carted|limping|day-to-day|week-to-week|placed on)\b/i,
  },
  {
    category: "transaction",
    pattern:
      // `waiv\w*\b(?! wire)`: a waiver claim is a transaction, but the "waiver
      // wire" is a fantasy fixture and belongs to that rule further down. The
      // trailing \b is what stops the match backtracking to "waive" and
      // sneaking past the lookahead.
      /\b(sign\w*|re-sign\w*|agree\w* to (?:terms|a deal)|contract|extension|trade[ds]?|trading|traded|acquir\w*|waiv\w*\b(?! wire)|releas\w*|cut\b|claim\w*|activat\w*|promot\w*|elevat\w*|designat\w* to return|restructur\w*|franchise tag|tender\w*|deal worth|per source|draft(?:ed|ing)?|roster move|practice squad|added to the roster)\b/i,
  },
  {
    category: "practice",
    pattern:
      /\b(practice|walkthrough|walk-through|training camp|otas?|minicamp|did not participate|dnp\b|full participant|limited participant|on the field|padded)\b/i,
  },
  {
    category: "depth-chart",
    pattern:
      /\b(depth chart|starter|starting (?:job|role|quarterback|qb|rb|wr|te|lineup)|named the starter|first team|1st team|second string|backup (?:role|job)|snap (?:count|share)|committee|rotation|benched?|demot\w*|promoted to (?:starter|the starting))\b/i,
  },
  {
    category: "rumor",
    pattern:
      /\b(rumor\w*|speculat\w*|could be|expected to|believed to|hearing that|buzz|market for|interest in|shopping|linked to|likely to|monitoring|discussions?)\b/i,
  },
  {
    category: "fantasy",
    pattern:
      /\b(fantasy|start\/sit|sit\/start|waiver wire|sleeper|bust|adp\b|dynasty|ppr\b|target share|red zone (?:looks|role)|must-start|streamer|flex play)\b/i,
  },
];

/**
 * Categorise an item from whatever text describes it.
 *
 * Takes several strings rather than one because the useful words are spread
 * across them: a wire headline carries the whole story, while an X post's
 * headline is only its first line and the detail is in the body.
 */
export function categorize(
  ...parts: Array<string | null | undefined>
): NewsCategory {
  const text = parts.filter(Boolean).join(" ");
  if (!text.trim()) return "other";
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return "other";
}

/** Label for a category code, for display. */
export function categoryLabel(category: string | null | undefined): string {
  return CATEGORY_LABELS[(category ?? "other") as NewsCategory] ?? "Other";
}
