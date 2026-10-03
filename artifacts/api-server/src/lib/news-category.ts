/**
 * What kind of news an item is: injury, transaction, practice, and so on.
 *
 * DERIVED at read time, never stored. That is the same call the archive already
 * makes about a wire row's team (see the team_abbr comment in the schema): this
 * is a keyword judgement about a headline, not a fact the provider told us, and
 * a guess written into a column becomes indistinguishable from a fact the
 * moment it is stored. Deriving it also means the rules can be improved in one
 * place and every row in the archive - including the ones ingested before the
 * rule existed - is re-read under the new ones, with no backfill and nothing to
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
  "status",
  "recap",
  "preview",
  "analysis",
  "media",
  "club",
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
  status: "Status",
  recap: "Recap",
  preview: "Preview",
  analysis: "Analysis",
  media: "Media",
  club: "Club",
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
    // Two of these are narrower than they look, and deliberately.
    //
    // `back` is a body part, a direction and a position, and as a bare word it
    // claimed "Back for Year 2 with Steelers" and "Viewed as three-down back"
    // as injuries. It now needs an injury noun beside it, or one of the
    // return-to-play phrasings ("working back", "eased back").
    //
    // `out for` likewise matched "works out for Rams again". It now has to be
    // followed by a duration.
    category: "injury",
    pattern:
      /\b(injur\w*|acl|mcl|ucl|achilles|hamstring|concussion|protocol|quad|groin|ankle|knee|shoulder|hip|calf|foot|wrist|elbow|(?:lower |upper )?back (?:injury|issue|spasm\w*|tightness|soreness|strain|surgery)|(?:eased|works?|working) back|rib|oblique|thumb|finger|toe|surgery|mri|x-?ray|sprain\w*|strain\w*|fracture\w*|torn|tear|ruptur\w*|questionable|doubtful|inactive|rules? out|out for (?:at least |the |a )?(?:\d|season|year|week|month|game|remainder|now)|miss(?:ed|ing|es)? (?:the )?(?:game|season|week|practice)|ir\b|injured reserve|pup\b|carted|limping|day-to-day|week-to-week|placed on|setback|health\w*)\b/i,
  },
  {
    category: "transaction",
    pattern:
      // `waiv\w*\b(?! wire)`: a waiver claim is a transaction, but the "waiver
      // wire" is a fantasy fixture and belongs to that rule further down. The
      // trailing \b is what stops the match backtracking to "waive" and
      // sneaking past the lookahead.
      /\b(sign\w*|re-sign\w*|agree\w* to (?:terms|a deal)|contract|extension|trade[ds]?|trading|traded|acquir\w*|waiv\w*\b(?! wire)|releas\w*|cut\b|claim\w*|activat\w*|promot\w*|elevat\w*|designat\w* to return|restructur\w*|franchise tag|tender\w*|(?:on|reach\w+|agree\w+ to|close to)(?: an?| the| his)? deal\b|deal worth|per source|draft(?:ed|ing)?|roster move|transactions?\b|practice squad|added to the roster|visit\w* with|(?:draws?|drawing) interest|interest from|reach\w* (?:an )?understanding|ineligible|open to playing for)\b/i,
  },
  {
    category: "practice",
    pattern:
      // `practic\w*`, not `practice`: "Not practicing Wednesday" is the single
      // most common shape the wire files a participation note in, and a bare
      // `practice` misses every one of them - the \b lands on the "i".
      /\b(practic\w*|walkthrough|walk-through|training camp|otas?|minicamp|did not participate|dnp\b|full participant|limited participant|on the field|side field|padded|drills?|\breps?\b|session|scrimmage|rest day|spring|7-on-7|11-on-11|takes? part)\b/i,
  },
  {
    category: "depth-chart",
    pattern:
      /\b(depth chart|starter|starting (?:job|role|quarterback|qb|rb|wr|te|lineup)|named the starter|(?:poised|set|in line) to start|to start for|captains?\b|first team|1st team|second string|backup (?:role|job)|snaps?|committee|rotation|benched?|demot\w*|promoted to (?:starter|the starting)|role\b|(?:qb|rb|wr|te|k)\d\b|no\.? ?\d\b|competition|top target|workload|opportunit\w*|formation|three-wide|three-down|two-tight)\b/i,
  },
  {
    // Availability: whether he is playing, not what is wrong with him.
    //
    // This is the largest single thing the wire files and the rules used to
    // have no home for it - "Won't play in Saturday's preseason game" names no
    // body part, no transaction and no practice, so it fell through to "other"
    // along with a third of the feed. It is deliberately NOT folded into
    // injury: a rested starter and a hamstring are the same fact to a fantasy
    // manager setting a lineup, but labelling the first one "Injury" is simply
    // false.
    //
    // It sits below practice and depth-chart so a participation note and a
    // role note keep their own labels, and above rumor so "expected to play"
    // reads as availability rather than as speculation.
    category: "status",
    pattern:
      /\b(won['\u2019]?t play|will not play|will play|to play\b|could play|plans? to play|cleared to play|good chance|game-?time decision|inactives?\b|game-?day decision|done for (?:the )?season|available|unavailable|suit up|sits? out|sitting out|on track|hopeful for|ready for|returns? (?:to|for))\b/i,
  },
  /*
   * The five below are the CLUB lane's genres, not the player wire's.
   *
   * A club feed is a newsroom: previews, recaps, film pieces, press-conference
   * transcripts?s and community announcements. None of that vocabulary overlaps
   * with "Dealing with a hamstring", so before these rules existed the whole
   * lane fell through to "other" - 411 of 600 stored club rows, which on a team
   * page meant half the cards carried a label that said nothing.
   *
   * They sit BELOW every player rule on purpose. "Colts rule out WR Ashton
   * Dulin for Week 2" is an injury note that happens to be published by a club
   * and happens to name a game; the fact about the player wins over the genre
   * of the page it appeared on. They sit above rumor and fantasy for the reason
   * those two have always been last: their vocabulary is the vaguest here.
   */
  {
    // Recap is tested before preview because it is the more specific of the
    // two: a game that has been played is described in past tense and settled
    // numbers, where a preview is speculation with the same nouns in it.
    category: "recap",
    pattern:
      /\b(recap\w*|final score|rapid reaction|takeaways?|(?:things|what) we learned|observations|post-?game|highlights|instant analysis|(?:fall|falls|fell) to|box scores?|game (?:story|report))\b/i,
  },
  {
    category: "preview",
    pattern:
      /\b(how to watch|ways? to watch|where to watch|how,? when|watch,? listen|listen,? (?:live )?stream|live ?streams?|previews?|pregame|what to watch|things to watch|(?:players?|\d+) to watch\b|know your foe|tale of the tape|scouting reports?|need to know|key matchups?|top storylines?|keys? to the game|must do to beat|game picks?|expert picks?|pundit picks?|predictions?|betting|odds\b|heavy favorites?|storylines? to follow|know before you go|prepare[sd]? (?:for|to face)|things to know about|in advance of)\b/i,
  },
  {
    category: "analysis",
    pattern:
      /\b(power rankings?|highest-graded|grades?\b|by the numbers|numbers to know|film (?:room|study|review)|data crunch|breakdowns?|deep dives?|snap counts?|advanced stats)\b/i,
  },
  {
    category: "media",
    pattern:
      /\b(transcript|press conference|mailbags?|inbox|podcasts?|notebooks?|q&a|roundups?|what the \w+ are saying|radio show|pressers?|news &? notes|from the podium|\bblog\b)\b/i,
  },
  {
    category: "club",
    pattern:
      /\b(community|foundations?|blood drives?|volunteers?|high school|fan information|season tickets?|capsule collections?|experience centers?|charit\w*|coach of the (?:week|year)|player of the (?:week|month|year)|myra kraft|walk to defeat|clinics?\b|impact grants?|fan events?|fan choices?|gym class|school uniform|distinguished)\b/i,
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
