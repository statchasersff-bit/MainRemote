/**
 * The questions the RB handcuff page gets asked, and the list of the best
 * handcuffs printed above them.
 *
 * The copy is mak's, written against the searches the page is found by ("best
 * RB handcuffs", "RB handcuff rankings", "RB handcuffs 2026"). It follows
 * rankings-faq.ts in one rule: an answer that CAN go stale or contradict the
 * board is built from the board. Four of them are:
 *
 * - the two "best/top" answers name the backups the board ranks first, and
 *   the backups carrying the Premium Handcuff badge, rather than a list of
 *   names that is a week out of date by the time it is read;
 * - "what are RB handcuff rankings" names the three pillars and their default
 *   weights from PILLARS and DEFAULT_WEIGHTS, so moving a weight moves the
 *   answer;
 * - "how often are they updated" carries the board's own date and stats week.
 *
 * The rest is the supplied copy as written. Reword it here, and only here: the
 * visible questions and the FAQPage node are both built from this list.
 */

import type { HandcuffBoard, HandcuffPlayer } from "./handcuffs-data";
import { PILLARS } from "./handcuffs-data";
import { DEFAULT_WEIGHTS } from "./recompute";

export interface HandcuffFaq {
  question: string;
  answer: string;
}

/** The heading the FAQ prints, kept beside the questions it introduces. */
export const HANDCUFF_FAQ_HEADING = "Fantasy Football RB Handcuff Rankings FAQ";

/** How many backups the "best" list shows. */
export const BEST_COUNT = 10;

/** The heading of the list of the best handcuffs. */
export function bestHeading(board: HandcuffBoard): string {
  return `Best RB Handcuffs for ${board.season}`;
}

/** The backups the board ranks first, at the default weights. */
export function bestHandcuffs(board: HandcuffBoard, count = BEST_COUNT): HandcuffPlayer[] {
  return board.players.slice(0, count);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

/** "September 23, 2026", in UTC. Null for a missing or unreadable date. */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** "A", "A and B", "A, B and C" — the form the rankings FAQ uses. */
function listOf(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Emmett Johnson (KC, behind Kenneth Walker)". */
function named(p: HandcuffPlayer): string {
  return p.starterName
    ? `${p.playerName} (${p.team}, behind ${p.starterName})`
    : `${p.playerName} (${p.team})`;
}

function pct(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

export function handcuffFaq(board: HandcuffBoard): HandcuffFaq[] {
  const updated = formatDate(board.updatedAt);
  const top5 = bestHandcuffs(board, 5);
  const top3 = bestHandcuffs(board, 3);
  const premium = board.players.filter((p) => p.handcuffType === "Premium Handcuff");

  const pillarLine = listOf(
    PILLARS.map((p) => `${p.title} (${p.tagline.replace(/\.$/, "").replace(/^How/, "how")})`),
  );
  const weightLine = listOf(PILLARS.map((p) => pct(DEFAULT_WEIGHTS[p.key])));

  const best =
    "The best RB handcuffs are backup running backs who could inherit a large workload " +
    "if the starter ahead of them misses time." +
    (top5.length > 0
      ? ` On the current StatChasers RB Handcuff Rankings, the top ${top5.length} are ` +
        `${listOf(top5.map(named))}.`
      : "") +
    " The rankings compare every backup on backfield opportunity, path to opportunity " +
    "and player quality.";

  const best2026 =
    `The best fantasy RB handcuffs for ${board.season} are running backs with a realistic ` +
    "path to significant touches if the starter ahead of them becomes unavailable." +
    (top3.length > 0
      ? ` ${updated ? `As of ${updated}, the` : "The"} StatChasers board is led by ` +
        `${listOf(top3.map((p) => p.playerName))}.`
      : "") +
    " Situations can change quickly during the season, so handcuff rankings should be " +
    "updated as injuries, depth charts and backfield roles change.";

  const top =
    "The top RB handcuffs are usually backups with a clear No. 2 role, strong rushing or " +
    "receiving ability and a realistic chance to handle a large share of the backfield if " +
    "the starter is unavailable." +
    (premium.length > 0
      ? ` The StatChasers rankings mark the backups with the best overall profile as ` +
        `Premium Handcuffs; right now ${premium.length === 1 ? "that is" : "those are"} ` +
        `${listOf(premium.map((p) => p.playerName))}.`
      : " Use the StatChasers rankings to compare the top handcuffs across the NFL.");

  const updatedAnswer =
    "The rankings change as injuries, depth charts, usage and backfield roles change " +
    "throughout the season." +
    (updated
      ? ` This board reflects depth charts and injuries as of ${updated}` +
        (board.statsWeek != null
          ? `, with ${board.statsSeason} stats through week ${board.statsWeek}.`
          : ".")
      : "") +
    ` Check back regularly for the latest ${board.season} fantasy football RB handcuff rankings.`;

  return [
    { question: "Who are the best RB handcuffs in fantasy football?", answer: best },
    { question: `What are the best fantasy RB handcuffs for ${board.season}?`, answer: best2026 },
    {
      question: "What are RB handcuff rankings?",
      answer:
        "RB handcuff rankings order backup running backs based on how valuable they could " +
        "become if the starting running back on their team misses time. Higher-ranked " +
        "handcuffs usually have a clearer path to touches and a stronger potential fantasy " +
        `role. The StatChasers rankings score each backup on ${pillarLine}, weighted ` +
        `${weightLine} by default.`,
    },
    {
      question: "Should I handcuff my starting running back?",
      answer:
        "Sometimes. Handcuffing your own RB can protect against losing a major part of your " +
        "lineup if that starter gets injured. However, rostering another manager's " +
        "high-upside handcuff can sometimes provide more upside because an injury could " +
        "create an entirely new starting running back for your roster.",
    },
    {
      question: "Is it better to roster my own RB handcuff or someone else's?",
      answer:
        "It depends on your roster and risk tolerance. Your own handcuff provides insurance " +
        "for a starter you already rely on. Another team's handcuff may provide more upside " +
        "because, if that starter gets injured, you could suddenly gain an additional fantasy " +
        "starter rather than simply replacing one you lost.",
    },
    {
      question: "What does handcuff mean in fantasy football?",
      answer:
        "A handcuff is a backup player, usually a running back, who could take over a " +
        "significant role if the starter ahead of him gets injured or misses time. Fantasy " +
        "managers often roster handcuffs as insurance or as high-upside bench stashes.",
    },
    { question: "Who are the top RB handcuffs in fantasy football?", answer: top },
    {
      question: "When should I draft an RB handcuff?",
      answer:
        "Handcuffs are usually more valuable later in fantasy drafts after your core starting " +
        "lineup has been built. Backups with standalone roles or especially strong upside can " +
        "be worth drafting earlier than pure injury-only handcuffs.",
    },
    {
      question: "Are RB handcuffs worth rostering during the season?",
      answer:
        "Yes, especially when bench space is available. High-upside handcuffs can become some " +
        "of the most valuable waiver-wire players in fantasy football when injuries change a " +
        "backfield. Their value increases as the season progresses and every starting lineup " +
        "decision becomes more important.",
    },
    {
      question: "What makes a good fantasy football RB handcuff?",
      answer:
        "A strong RB handcuff usually has a clear role behind the starter, a path to " +
        "significant carries or targets, limited competition from other backups, an offense " +
        "capable of supporting fantasy production and enough talent to handle an expanded " +
        "workload. The most valuable handcuffs are players who could become immediate " +
        "fantasy starters if opportunity opens up.",
    },
    {
      question: "What is the difference between an RB handcuff and a committee back?",
      answer:
        "A handcuff is usually valued because of what could happen if the starter misses " +
        "time. A committee back may already have weekly standalone value because he regularly " +
        "shares touches with another running back. Some players can be both.",
    },
    {
      question: "Do RB handcuff rankings change during the season?",
      answer:
        "Yes. Injuries, depth-chart changes, workload shifts and coaching decisions can " +
        "quickly change which backup running backs have the most fantasy upside. Handcuff " +
        "rankings should be updated throughout the season rather than treated as static " +
        "preseason rankings.",
    },
    {
      question: "Should I drop a handcuff if the starter stays healthy?",
      answer:
        "Not automatically. A high-upside handcuff can still be worth rostering if he has a " +
        "clear path to a major role later in the season. Whether to keep him depends on bench " +
        "size, available waiver options and how valuable that potential role would be.",
    },
    {
      question: "Are handcuffs only for running backs?",
      answer:
        "The term can technically apply to other positions, but in fantasy football it is " +
        "used most often for running backs because injuries can quickly transfer a large " +
        "workload from one player to another.",
    },
    { question: "How often are the StatChasers RB Handcuff Rankings updated?", answer: updatedAnswer },
  ];
}
