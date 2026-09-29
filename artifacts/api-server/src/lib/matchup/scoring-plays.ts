/**
 * A game's scoring plays, as structure rather than sentences.
 *
 * ESPN's summary lists every scoring play with a line of feed text —
 * "Cooper Kupp 7 Yd pass from Matthew Stafford (Matt Gay Kick)" — and a type.
 * The page never prints that text. It is read here into who scored, how, from
 * how far and what the try after it did, and scoring-summary.ts writes its own
 * sentence from the result. That is what lets the summary say "Beckham Jr."
 * without a doubled full stop, link every name, and add the score up itself.
 *
 * Pure: nothing here fetches. boxscore.ts hands each raw play to
 * parseEspnScoringPlay().
 */

export type ScoringPlayType =
  | "pass_td"
  | "rush_td"
  | "field_goal"
  | "int_return_td"
  | "fumble_return_td"
  | "punt_return_td"
  | "kickoff_return_td"
  /** A touchdown the text did not say how: a blocked kick returned, a lateral. */
  | "other_td"
  | "safety";

export interface PointAfter {
  type: "kick" | "two_point_pass" | "two_point_run";
  result: "good" | "failed";
  /** The kicker, the runner or the receiver; absent when the feed names nobody. */
  player?: string;
  /** Two-point passes only. */
  passer?: string;
}

export interface ScoringPlay {
  /** 1–4, then 5 for overtime (6 for a second overtime in the playoffs). */
  quarter: number;
  /** Game clock when it happened: "3:50". */
  clock: string;
  /** Display code of the side that scored, upper case. */
  team: string;
  type: ScoringPlayType;
  yards: number | null;
  /** The scorer by name: runner, receiver, returner, kicker. */
  scorer?: string;
  passer?: string;
  /** On a safety, the player tackled in the end zone, when the feed names one. */
  tackled?: string;
  pat?: PointAfter;
}

/** Points the play itself is worth, try included. */
export function playPoints(play: ScoringPlay): number {
  if (play.type === "field_goal") return 3;
  if (play.type === "safety") return 2;
  const pat = play.pat;
  const after =
    pat && pat.result === "good" ? (pat.type === "kick" ? 1 : 2) : 0;
  return 6 + after;
}

export function isTouchdown(play: ScoringPlay): boolean {
  return play.type !== "field_goal" && play.type !== "safety";
}

/* ------------------------------------------------------------------ ESPN */

export interface EspnScoringPlay {
  text?: string;
  type?: { text?: string; abbreviation?: string };
  scoringType?: { name?: string; abbreviation?: string };
  period?: { number?: number };
  clock?: { displayValue?: string };
  team?: { abbreviation?: string };
}

const NAME = "([A-Z][\\w.'’ -]*?)";

/** The try, from the parenthesised tail of a touchdown's text. */
function pointAfter(tail: string): PointAfter | undefined {
  const t = tail.trim();
  if (!t) return undefined;
  let m = t.match(new RegExp(`^${NAME}\\s+Pass to\\s+${NAME}\\s+for Two-Point Conversion$`, "i"));
  if (m) return { type: "two_point_pass", result: "good", passer: m[1]!.trim(), player: m[2]!.trim() };
  m = t.match(new RegExp(`^${NAME}\\s+(?:Run|Rush)\\s+for Two-Point Conversion$`, "i"));
  if (m) return { type: "two_point_run", result: "good", player: m[1]!.trim() };
  if (/two-point pass/i.test(t) && /fail/i.test(t)) return { type: "two_point_pass", result: "failed" };
  if (/two-point/i.test(t) && /fail/i.test(t)) return { type: "two_point_run", result: "failed" };
  m = t.match(new RegExp(`^${NAME}\\s+(?:PAT|Kick)\\s+(?:failed|blocked|missed|no good)`, "i"));
  if (m) return { type: "kick", result: "failed", player: m[1]!.trim() };
  if (/(PAT|Kick)\b.*\b(failed|blocked|missed|no good)/i.test(t)) return { type: "kick", result: "failed" };
  m = t.match(new RegExp(`^${NAME}\\s+(?:Kick|PAT)$`, "i"));
  if (m) return { type: "kick", result: "good", player: m[1]!.trim() };
  return undefined;
}

const RETURNS: Array<[RegExp, ScoringPlayType]> = [
  [/Interception Return/i, "int_return_td"],
  [/Fumble (?:Return|Recovery)/i, "fumble_return_td"],
  [/Punt Return/i, "punt_return_td"],
  [/Kickoff Return/i, "kickoff_return_td"],
];

/**
 * One raw play, or null when it is not a scoring play this page can place
 * (no team, no quarter). An unreadable TOUCHDOWN still counts as one, typed
 * other_td with no names, so the running score stays right even when the
 * sentence has to be plain.
 */
export function parseEspnScoringPlay(raw: EspnScoringPlay): ScoringPlay | null {
  const team = raw.team?.abbreviation?.trim().toUpperCase();
  const quarter = raw.period?.number;
  if (!team || typeof quarter !== "number" || quarter < 1) return null;
  const clock = raw.clock?.displayValue?.trim() ?? "";
  const text = (raw.text ?? "").replace(/\s+/g, " ").trim();
  const kind = `${raw.scoringType?.name ?? ""} ${raw.scoringType?.abbreviation ?? ""} ${raw.type?.text ?? ""} ${raw.type?.abbreviation ?? ""}`;
  const base = { quarter, clock, team };

  // "Matt Gay 25 Yd Field Goal"
  const fg = text.match(new RegExp(`^${NAME}\\s+(\\d+)\\s+Yd\\s+Field Goal`, "i"));
  if (fg || /field.?goal|\bFG\b/i.test(kind)) {
    return { ...base, type: "field_goal", yards: fg ? Number(fg[2]) : null, scorer: fg?.[1]?.trim() };
  }

  if (/safety|\bSF\b/i.test(kind) || /\bsafety\b/i.test(text)) {
    // "Kyler Murray sacked in end zone by Aaron Donald for a SAFETY" or a team safety.
    const tackled = text.match(new RegExp(`^${NAME}\\s+(?:sacked|tackled|ran out)\\b.*end zone`, "i"));
    return { ...base, type: "safety", yards: null, tackled: tackled?.[1]?.trim() };
  }

  // Split the try off the end: "... (Matt Gay Kick)".
  const tailMatch = text.match(/\(([^()]*)\)\s*$/);
  const pat = tailMatch ? pointAfter(tailMatch[1]!) : undefined;
  const body = tailMatch ? text.slice(0, tailMatch.index).trim() : text;

  const pass = body.match(new RegExp(`^${NAME}\\s+(\\d+)\\s+Yd\\s+pass from\\s+${NAME}$`, "i"));
  if (pass) {
    return { ...base, type: "pass_td", yards: Number(pass[2]), scorer: pass[1]!.trim(), passer: pass[3]!.trim(), pat };
  }
  const rush = body.match(new RegExp(`^${NAME}\\s+(\\d+)\\s+Yd\\s+(?:Run|Rush)$`, "i"));
  if (rush) return { ...base, type: "rush_td", yards: Number(rush[2]), scorer: rush[1]!.trim(), pat };

  const ret = body.match(new RegExp(`^${NAME}\\s+(\\d+)\\s+Yd\\s+(.+)$`, "i"));
  if (ret) {
    const how = RETURNS.find(([re]) => re.test(ret[3]!));
    return {
      ...base,
      type: how ? how[1] : "other_td",
      yards: Number(ret[2]),
      scorer: ret[1]!.trim(),
      pat,
    };
  }
  return { ...base, type: "other_td", yards: null, pat };
}
