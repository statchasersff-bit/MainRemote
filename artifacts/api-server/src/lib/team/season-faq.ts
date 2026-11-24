/**
 * The hub's in-season questions (mak's Team Pages Phase 1 finalization,
 * 2026-11-19), cut to the reader questions the panel cannot answer at a
 * glance (team-page audit, Task 4, 2026-11-24).
 *
 * Kept: the record (the hub's own intent, with points for and against, which
 * no table prints as totals), current injuries with the size of each injured
 * player's role, who is next in line in the backfield, and the confirmed
 * usage moves. Each answer reads the overview's own source and cutoff, and
 * links the tab that carries the detail.
 *
 * Cut, as restatements of a card or of another page's FAQ: the next game
 * (the Next Game card, and /schedule/ asks it), the top fantasy scorers and
 * the rushing/receiving leaders (the Key Offensive Contributors card), and
 * the offense ranks (the Offense & Defense card, and /stats/ asks it).
 *
 * Rules, each enforced by the guard in front of its question:
 * - a question exists only when its answer is in the data (no injuries, no
 *   injury question; no injury feed, no injury question);
 * - nothing is predicted: no return dates, playoff scenarios, tiebreaker
 *   outcomes or depth-chart calls. Ties are said to be ties.
 */

import type { TeamPageData } from "./team-data";
import type { UsageView } from "./usage";
import type { OutlookFaq } from "./outlook-faq";
import { usageTrends } from "./usage-copy";
import { injuryStatusLabel } from "../team-render";
import { backfield, divisionRows, latestFinal, recordText } from "./overview";

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const STATUS_WORDS: Record<string, string> = {
  IR: "on injured reserve",
  PUP: "on the PUP list",
  Out: "ruled out",
  Doubtful: "doubtful",
  Questionable: "questionable",
  Sus: "suspended",
  NFI: "on the non-football injury list",
  // The overview's own term for a player who missed the last game with no
  // report filed since (current-injuries.ts).
  Pending: "pending after missing the last game",
};

/** A designation in words: the map above, else the panel's own label. */
const statusWords = (status: string) => STATUS_WORDS[status] ?? injuryStatusLabel(status).toLowerCase();

/** Where an answer can send a reader for the detail: the overview's own "more" links. */
export interface SeasonFaqLinks {
  usage: string | null;
  depth: string | null;
  schedule: string | null;
}

const NO_LINKS: SeasonFaqLinks = { usage: null, depth: null, schedule: null };

/** Keeps a link only when its phrase is in the answer and it has an address. */
function withLinks(question: string, answer: string, links: Array<[string, string | null]>): OutlookFaq {
  const kept = links
    .filter((l): l is [string, string] => l[1] != null && answer.includes(l[0]))
    .map(([text, href]) => ({ text, href }));
  return kept.length ? { question, answer, links: kept } : { question, answer };
}

/** A share as the overview prints it: whole percent. */
const pct = (v: number) => `${Math.round(v)}%`;

export function seasonFaq(
  data: TeamPageData,
  view: UsageView | null,
  _now: number,
  links: SeasonFaqLinks = NO_LINKS,
): OutlookFaq[] {
  const { team, state } = data;
  const nick = team.nickname;
  const club = team.fullName;
  const season = state.season;
  const faq: OutlookFaq[] = [];
  const final = latestFinal(data);

  // 1. Record and division race, with points for and against.
  const div = divisionRows(data);
  const own = div?.find((r) => r.team.abbreviation === team.abbreviation);
  if (own && final && data.schedule) {
    const played = data.schedule.games.filter((g) => g.status === "final" && g.result);
    const pf = played.reduce((s, g) => s + (g.result?.teamScore ?? 0), 0);
    const pa = played.reduce((s, g) => s + (g.result?.opponentScore ?? 0), 0);
    const leaders = div!.filter((r) => r.gb === 0);
    let race: string;
    if (own.gb === 0 && leaders.length === 1) race = `They lead the ${team.division} by ${div![1].gb} ${div![1].gb === 1 ? "game" : "games"}.`;
    else if (own.gb === 0) {
      const others = leaders.filter((r) => r !== own).map((r) => `the ${r.team.fullName}`);
      race = `They share the best record in the ${team.division} with ${list(others)}; NFL tiebreakers decide the order between them.`;
    } else {
      race = `They are ${own.gb} ${own.gb === 1 ? "game" : "games"} behind ${list(leaders.map((r) => `the ${r.team.fullName} (${recordText(r)})`))} in the ${team.division}.`;
    }
    const through = `through ${final.weekLabel}`;
    faq.push(
      withLinks(
        `What is the ${club}' record in ${season}?`,
        `The ${club} are ${recordText(own)} ${through} of the ${season} season, ` +
          `having scored ${pf} points and allowed ${pa}. ${race}`,
        [[through, links.schedule]],
      ),
    );
  }

  // 2. Current injuries (skill positions), this week's designations by the
  // player pages' rule (current-injuries.ts, applied in team-data.ts), each
  // with the size of the role it touches: the Usage tab's snap share in the
  // games he played, plus target share for a receiver. No answer when the
  // feed is down: the panel itself says nothing there is confirmed.
  const injuries = data.roster ? data.injuries : [];
  const fresh = data.injuryFreshness;
  if (data.roster && injuries.length > 0 && fresh?.state !== "unavailable") {
    const usageOf = (id: string, name: string) =>
      view?.all.find((u) => u.sleeperId === id) ?? view?.all.find((u) => u.name === name) ?? null;
    let roles = 0;
    const named = injuries.slice(0, 6).map((p) => {
      const status = p.injuryStatus ? statusWords(p.injuryStatus) : "listed";
      const who = `${p.name} (${p.position}, ${status}${p.injuryBodyPart ? `, ${p.injuryBodyPart.toLowerCase()}` : ""})`;
      const u = usageOf(p.id, p.name);
      if (!u || !u.snapShare) return `${who}, who has not played an offensive snap for the ${nick} this season`;
      roles += 1;
      const receiver = (u.pos === "WR" || u.pos === "TE") && u.targetShare;
      return `${who}, ${pct(u.snapShare)} of the snaps in his games` + (receiver ? ` and ${u.targetShare!.toFixed(1)}% of the targets` : "");
    });
    const more = injuries.length - named.length;
    const asOf =
      fresh?.state === "stale" && fresh.rosterFetchedAt
        ? `On the injury report as of ${new Date(fresh.rosterFetchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}`
        : fresh?.week != null && !fresh.reportPublished
          ? `No Week ${fresh.week} injury report is out yet. On the current reserve lists and designations`
          : `On the current injury report`;
    const answer =
      `${asOf}: ${named.join("; ")}` +
      (more > 0 ? `; plus ${more} more` : "") +
      `.` +
      (roles > 0 ? ` Shares are this season's, in the games each played. The depth chart lists who is behind each of them.` : "");
    faq.push(withLinks(`Which ${nick} players are injured right now?`, answer, [["depth chart", links.depth]]));
  }

  // 3. Next in line in the backfield, by the overview's one measure.
  const b = backfield(data, view);
  if (b && b.rb1.woppShare != null) {
    const answer =
      `${b.rb1.name} has ${pct(b.rb1.woppShare)} of the ${nick} running backs' opportunities this season (carries plus two times targets)` +
      (b.rb1Status ? ` and is currently ${statusWords(b.rb1Status)}` : "") +
      `. ` +
      b.skipped.map((s) => `${s.name} is next by that measure but is ${statusWords(s.status)}. `).join("") +
      (b.next
        ? `The next available back by the same measure is ${b.next.name} at ${pct(b.next.woppShare ?? 0)}` +
          (b.nextDepth ? `, listed RB${b.nextDepth} on the depth chart.` : `.`) +
          (b.depthNext ? ` The depth chart lists ${b.depthNext} second.` : "")
        : `No other available back has 5% of that work.`);
    faq.push(
      withLinks(`Who is next in line in the ${nick} backfield?`, answer, [
        ["opportunities", links.usage],
        ["depth chart", links.depth],
      ]),
    );
  }

  // 4. Recent usage changes, the Usage tab's own trend windows and bands.
  const trends = view ? usageTrends(view).slice(0, 2) : [];
  if (trends.length > 0) {
    faq.push(
      withLinks(
        `How has the ${nick} usage changed recently?`,
        `Over the last three games against the three before: ` +
          list(trends.map((t) => `${t.player.name}, ${t.short}`)) +
          `. Every confirmed change is on the usage page.`,
        [["usage page", links.usage]],
      ),
    );
  }

  return faq;
}
