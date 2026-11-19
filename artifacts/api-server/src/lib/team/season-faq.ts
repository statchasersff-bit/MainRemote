/**
 * The hub's in-season questions (mak's Team Pages Phase 1 finalization,
 * 2026-11-19): six to eight factual questions built from the same data the
 * Season Overview prints, replacing the draft-season questions while the
 * season is on. The preseason questions move into the archived outlook.
 *
 * Rules, each enforced by the guard in front of its question:
 * - a question exists only when its answer is in the data (no injuries, no
 *   injury question; no next game, no next-game question);
 * - the answer adds something the panel heading does not already say
 *   (points scored and allowed with the record; venue and network with the
 *   date; the per-game figure with the leaders);
 * - nothing is predicted: no return dates, playoff scenarios, tiebreaker
 *   outcomes or depth-chart calls. Ties are said to be ties.
 */

import type { TeamPageData } from "./team-data";
import { currentInjuries } from "./current-injuries";
import type { UsageView } from "./usage";
import type { OutlookFaq } from "./outlook-faq";
import { usageTrends } from "./usage-copy";
import { gameDateLine } from "../team-render";
import {
  backfield,
  contributors,
  divisionRows,
  latestFinal,
  recordText,
  teamLeaders,
  upcoming,
} from "./overview";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

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
};

export function seasonFaq(data: TeamPageData, view: UsageView | null, now: number): OutlookFaq[] {
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
    faq.push({
      question: `What is the ${club}' record in ${season}?`,
      answer:
        `The ${club} are ${recordText(own)} through ${final.weekLabel} of the ${season} season, ` +
        `having scored ${pf} points and allowed ${pa}. ${race}`,
    });
  }

  // 2. Next game: opponent, kickoff, venue and network.
  const next = upcoming(data, now);
  if (next && next.opponent) {
    const when = gameDateLine(next);
    const where = next.site === "home" ? "at home" : next.site === "away" ? "on the road" : "at a neutral site";
    const bits = [when.date, when.time].filter(Boolean).join(" at ");
    const d = data.nextOpponentDefense;
    const defense =
      d && d.abbreviation === next.opponent.abbreviation && d.rankLabel
        ? ` The ${next.opponent.nickname} defense allows ${d.value} points per game, ${d.rankLabel} fewest in the NFL this season.`
        : "";
    faq.push({
      question: `When do the ${nick} play next?`,
      answer:
        `The ${nick} play the ${next.opponent.fullName} ${where} in ${next.weekLabel}` +
        (bits ? `, ${bits}` : "") +
        (next.venue ? ` at ${next.venue}` : "") +
        (next.network ? `, on ${next.network}` : "") +
        `.` +
        defense,
    });
  }

  // 3. Leading fantasy scorers (PPR), the overview's contributors.
  const list3 = contributors(data, view).slice(0, 3);
  if (list3.length >= 2) {
    const [first, ...rest] = list3;
    const ppg = (c: (typeof list3)[number]) => (c.games ? c.ppr / c.games : 0).toFixed(1);
    faq.push({
      question: `Who are the ${nick}' top fantasy football scorers in ${season}?`,
      answer:
        `${first.player.name} leads the ${nick} with ${first.ppr.toFixed(1)} PPR points (${ppg(first)} per game), followed by ` +
        list(rest.map((c) => `${c.player.name} (${c.ppr.toFixed(1)}, ${ppg(c)} per game)`)) +
        `. Points count games played for the ${nick} this season.`,
    });
  }

  // 4. Rushing and receiving leaders.
  const { rushing, receiving } = teamLeaders(data);
  if (rushing && receiving && rushing.yards > 0 && receiving.yards > 0) {
    faq.push({
      question: `Who leads the ${nick} in rushing and receiving yards?`,
      answer:
        `${rushing.name} leads the ${nick} in rushing with ${n0(rushing.yards)} yards and ${rushing.td} ${rushing.td === 1 ? "touchdown" : "touchdowns"} on ${rushing.count} carries. ` +
        `${receiving.name} leads in receiving with ${n0(receiving.yards)} yards and ${receiving.td} ${receiving.td === 1 ? "touchdown" : "touchdowns"} on ${receiving.count} catches.`,
    });
  }

  // 5. Current injuries (skill positions), designations only - this week's,
  // by the player pages' rule (current-injuries.ts), never an expired one.
  const injuries = data.roster ? currentInjuries(data) : [];
  if (data.roster && injuries.length > 0) {
    const named = injuries.slice(0, 6).map((p) => {
      const status = p.injuryStatus ? STATUS_WORDS[p.injuryStatus] ?? p.injuryStatus.toLowerCase() : "listed";
      return `${p.name} (${p.position}, ${status}${p.injuryBodyPart ? `, ${p.injuryBodyPart.toLowerCase()}` : ""})`;
    });
    const more = injuries.length - named.length;
    faq.push({
      question: `Which ${nick} players are injured right now?`,
      answer:
        `On the current injury report: ${list(named)}` +
        (more > 0 ? `, plus ${more} more` : "") +
        `. Designations change through the week; check game-day inactives before kickoff.`,
    });
  }

  // 6. The offense, with league ranks.
  const stats = data.stats;
  if (stats && stats.season === season) {
    const row = (k: string) => stats.offense.find((r) => r.key === k);
    const pts = row("off-points");
    const yds = row("off-total-yards");
    const ypp = row("off-yards-per-play");
    if (pts && yds && pts.rankLabel && yds.rankLabel) {
      const pass = row("off-pass-yards");
      const rush = row("off-rush-yards");
      faq.push({
        question: `How good is the ${nick} offense in ${season}?`,
        answer:
          `The ${nick} score ${pts.value} points per game (${pts.rankLabel} in the NFL) and gain ${yds.value} yards per game (${yds.rankLabel})` +
          (ypp?.rankLabel ? `, ${ypp.value} per play (${ypp.rankLabel})` : "") +
          `.` +
          (pass?.rankLabel && rush?.rankLabel
            ? ` They pass for ${pass.value} yards a game (${pass.rankLabel}) and run for ${rush.value} (${rush.rankLabel}).`
            : ""),
      });
    }
  }

  // 7. The backfield, by the stated measure.
  const b = backfield(data, view);
  if (b && b.rb1.woppShare != null) {
    const share = (v: number | null | undefined) => `${Math.round(v ?? 0)}%`;
    faq.push({
      question: `Who leads the ${nick} backfield?`,
      answer:
        `${b.rb1.name} has ${share(b.rb1.woppShare)} of the ${nick} running backs' opportunities this season (carries plus two times targets)` +
        (b.rb1Status ? ` and is currently ${STATUS_WORDS[b.rb1Status] ?? b.rb1Status.toLowerCase()}` : "") +
        `. ` +
        b.skipped.map((s) => `${s.name} is next by that measure but is ${STATUS_WORDS[s.status] ?? s.status.toLowerCase()}. `).join("") +
        (b.next
          ? `The next available back by the same measure is ${b.next.name} at ${share(b.next.woppShare)}` +
            (b.nextDepth ? `, listed RB${b.nextDepth} on the depth chart.` : `.`) +
            (b.depthNext ? ` The depth chart lists ${b.depthNext} second.` : "")
          : `No other available back has 5% of that work.`),
    });
  }

  // 8. Recent usage changes, the Usage tab's own trend windows.
  const trends = view ? usageTrends(view).slice(0, 2) : [];
  if (trends.length > 0) {
    faq.push({
      question: `How has the ${nick} usage changed recently?`,
      answer:
        `Over the last three games against the three before: ` +
        list(trends.map((t) => `${t.player.name}, ${t.short}`)) +
        `.`,
    });
  }

  return faq;
}
