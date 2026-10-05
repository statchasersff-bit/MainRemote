/**
 * The Usage tab's Common questions - mak's list (2026-10-05), in his order.
 *
 * Every answer is written from the same view the report draws, by rule, so an
 * answer cannot quote a number the tab above it does not show. A question that
 * names a player (the TE1, the buy-low, the RB1, the passer) is asked only when
 * the view has that player, and a question the data cannot answer is left out
 * rather than answered with a guess. The questions are in the page's FAQPage
 * too, so every answer is plain text; a link (mak, 2026-10-05) is a phrase of
 * that text the renderer wraps, so the schema's answer and the visible answer
 * stay the same words. A tool whose address is not set yet (null in
 * matchup/recap.ts) drops its sentence, not just its link.
 */

import {
  art,
  bestZone,
  handcuffProjection,
  list,
  signed,
  situationShare,
  TIER_LABEL,
  woprCaption,
  ZONE_LABEL,
} from "./usage-copy";
import { getTargetShareCliff, surname, type UsagePlayer, type UsageRow, type UsageView, type Zone } from "./usage";
import type { NflTeam } from "./teams";
import {
  BUY_LOW_SELL_HIGH_URL,
  RB_HANDCUFF_RANKINGS_URL,
  REDRAFT_COMMAND_URL,
  START_SIT_URL,
  TRADE_CALCULATOR_URL,
} from "../matchup/recap";

export interface FaqLink {
  /** A phrase that appears in the answer exactly once. */
  text: string;
  href: string;
  cta: string;
}

export interface UsageFaq {
  question: string;
  answer: string;
  links?: FaqLink[];
}

const f1 = (v: number) => v.toFixed(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function usageFaq(view: UsageView, team: NflTeam): UsageFaq[] {
  const nick = team.nickname;
  // Every club's nickname is a plural ending in s: "Bills'", "49ers'".
  const poss = `${nick}'`;
  const wk = `through Week ${view.throughWeek}`;
  const out: UsageFaq[] = [];
  const ask = (question: string, answer: string | null, links: Array<FaqLink | null> = []) => {
    if (!answer) return;
    const kept = links.filter((l): l is FaqLink => l != null && answer.includes(l.text));
    out.push(kept.length ? { question, answer, links: kept } : { question, answer });
  };
  const link = (href: string | null, text: string, cta: string): FaqLink | null => (href ? { text, href, cta } : null);

  const rows = view.rows;
  const skill = rows.filter((r) => r.player.pos !== "QB" && r.tier !== "stash");
  const receivers = rows
    .filter((r) => r.player.pos !== "QB" && r.player.targetShare != null)
    .sort((a, b) => (b.player.targetShare ?? 0) - (a.player.targetShare ?? 0));
  const passCatchers = receivers.filter((r) => r.player.pos === "WR" || r.player.pos === "TE");
  const [rb1, rb2, rb3] = view.rbs;
  const rb1Row = rows.find((r) => r.player === rb1);
  const byXfp = [...skill]
    .filter((r) => r.player.xfpPerGame != null)
    .sort((a, b) => (b.player.xfpPerGame ?? 0) - (a.player.xfpPerGame ?? 0))[0];
  const buy = view.signals.find((s) => s.kind === "buy");
  const sell = view.signals.find((s) => s.kind === "sell");
  const cuff = handcuffProjection(view);
  const totals = view.team.rbSituationTotals;
  // The backfield bar's own math, so "88.1%" here is the 88.1% on the bar.
  const roomWopp = view.rbs.reduce((sum, p) => sum + Math.max(0, p.wopp), 0);
  const woppPct = (p: UsagePlayer) => (roomWopp > 0 && p.wopp > 0 ? `${f1((100 * p.wopp) / roomWopp)}%` : null);

  // 1. Target-share leader.
  {
    const [lead, second] = receivers;
    ask(
      `Who leads the ${nick} in target share?`,
      lead
        ? `${lead.player.name} leads the ${nick} with ${art(f1(lead.player.targetShare!))} ${f1(lead.player.targetShare!)}% target share ${wk}${trendClause(lead)}.` +
            (second ? ` ${second.player.name} is second at ${f1(second.player.targetShare!)}%.` : "")
        : null,
    );
  }

  // 2. WR1.
  {
    const wr1 = rows.find((r) => r.player.pos === "WR" && r.depth === 1);
    const wr2 = rows.find((r) => r.player.pos === "WR" && r.depth === 2);
    const p = wr1?.player;
    ask(
      `Who is the ${poss} WR1 for fantasy football?`,
      wr1 && p && p.targetShare != null
        ? `${p.name} is the ${poss} WR1 by usage ${wk}: ${art(f1(p.targetShare))} ${f1(p.targetShare)}% target share` +
            (p.leagueRank.rank ? ` (WR${p.leagueRank.rank} in the NFL)` : "") +
            (p.wopr != null ? `, a ${p.wopr.toFixed(2)} WOPR (${woprCaption(p)})` : "") +
            (p.snapShare != null ? ` and ${art(p.snapShare)} ${p.snapShare}% snap share` : "") +
            `. His usage tier is ${TIER_LABEL[wr1.tier]}.` +
            (wr2?.player.targetShare != null ? ` ${wr2.player.name} is the WR2 at ${f1(wr2.player.targetShare)}%.` : "")
        : null,
    );
  }

  // 3. Lead back.
  ask(
    `Who is the ${poss} lead running back by usage?`,
    rb1
      ? `${rb1.name} is the ${poss} lead back ${wk}` +
          (woppPct(rb1) ? `, with ${woppPct(rb1)} of the backfield's weighted opportunities` : "") +
          (rb1.touchShare != null ? ` and ${rb1.touchShare}% of RB touches` : "") +
          `.` +
          (rb1.woppPerGame != null
            ? ` His ${f1(rb1.woppPerGame)} weighted opportunities per active game ` +
              (rb1.qualified && rb1.leagueRank.rank ? `rank RB${rb1.leagueRank.rank} in the NFL.` : `are his weekly workload.`)
            : "") +
          ` Weighted opportunities count a target as two carries, a better view of RB opportunity than raw touches alone.`
      : null,
  );

  // 4. Backfield split.
  if (rb1 && rb2) {
    const pair = (key: keyof UsagePlayer["situation"]) => {
      const a = situationShare(view, rb1, key);
      const b = situationShare(view, rb2, key);
      return a == null || b == null ? null : `${a}% to ${b}%`;
    };
    const splits = [
      totals.early >= 10 && pair("early") ? `on early downs it is ${pair("early")}` : null,
      totals.third >= 5 && pair("third") ? `on third down ${pair("third")} (${plural(totals.third, "opportunity", "opportunities")})` : null,
      totals.rz >= 5 && pair("rz") ? `in the red zone ${pair("rz")}` : null,
    ].filter((s): s is string => s != null);
    ask(
      `What is the ${poss} backfield split between ${rb1.name} and ${rb2.name}?`,
      woppPct(rb1) && woppPct(rb2)
        ? `${rb1.name} has ${woppPct(rb1)} of the ${poss} running back weighted opportunities ${wk} and ${rb2.name} has ${woppPct(rb2)}` +
            (rb3 && (rb3.woppShare ?? 0) >= 5 && woppPct(rb3) ? `, with ${rb3.name} at ${woppPct(rb3)}` : "") +
            `.` +
            (splits.length
              ? ` By situation, counting the backs' carries + targets, ${list(splits)}.`
              : "")
        : null,
    );
  }

  // 5. Red-zone opportunities.
  {
    const pool = [...new Set([...rows.map((r) => r.player), ...view.rbs])]
      .filter((p) => p.rzTouches > 0)
      .sort((a, b) => b.rzTouches - a.rzTouches);
    const [lead, second, third] = pool;
    const goal = (p: UsagePlayer) =>
      (p.pos === "RB" || p.pos === "QB") && p.gzCarries > 0 ? `, including ${plural(p.gzCarries, "carry", "carries")} inside the 10` : "";
    ask(
      `Who gets the most red-zone opportunities for the ${nick}?`,
      lead
        ? (second && second.rzTouches === lead.rzTouches
            ? `${lead.name} and ${second.name} share the ${nick} lead with ${lead.rzTouches} red-zone opportunities each (carries + targets inside the 20) ${wk}.` +
              (third ? ` ${third.name} is next with ${third.rzTouches}.` : "")
            : `${lead.name} leads the ${nick} with ${lead.rzTouches} red-zone opportunities (carries + targets inside the 20) ${wk}${goal(lead)}.` +
              (second ? ` ${second.name} is next with ${second.rzTouches}${third ? `, then ${third.name} with ${third.rzTouches}` : ""}.` : ""))
        : null,
    );
  }

  // 6. Best usage profile.
  if (byXfp) {
    const p = byXfp.player;
    const source =
      p.pos === "RB"
        ? woppPct(p)
          ? ` It comes from ${woppPct(p)} of the backfield's weighted opportunities${p.qualified && p.leagueRank.rank ? ` (RB${p.leagueRank.rank} per active game in the NFL)` : ""}.`
          : ""
        : p.targetShare != null
          ? ` It comes from ${art(f1(p.targetShare))} ${f1(p.targetShare)}% target share${p.wopr != null ? ` and a ${p.wopr.toFixed(2)} WOPR` : ""}.`
          : "";
    ask(
      `Which ${nick} player has the best fantasy football usage profile?`,
      `${p.name} has the ${poss} strongest usage profile ${wk}: ${f1(p.xfpPerGame!)} expected fantasy points (xFP) per game, the most of any ${nick} ${view.qb ? "skill player outside the quarterback" : "skill player"}.` +
        source +
        fpoeClause(p),
    );
  }

  // 7. The TE1's targets.
  {
    const te1 = rows.find((r) => r.player.pos === "TE" && r.depth === 1);
    const p = te1?.player;
    if (te1 && p && p.targetShare != null) {
      const rank = p.leagueRank.rank;
      const ts = p.targetShare;
      const verdict =
        ts >= 17 || (rank != null && rank <= 8)
          ? ["Yes.", "That is a starting tight end's share of the targets."]
          : rank != null && rank <= 14
            ? ["Borderline.", "That is streaming range at tight end: startable in the right matchup, not every week."]
            : ["Not yet.", "That is below a weekly starter's share at tight end; he needs a bigger role first."];
      ask(
        `Is ${p.name} getting enough targets to be a fantasy starter?`,
        `${verdict[0]} ${p.name} has ${art(f1(ts))} ${f1(ts)}% target share ${wk}` +
          (rank ? `, TE${rank} in the NFL` : "") +
          (p.wopr != null ? `, and a ${p.wopr.toFixed(2)} WOPR (${woprCaption(p)})` : "") +
          `.` +
          (te1.ts.direction !== "flat" && te1.ts.delta != null && te1.ts.baseWeek != null
            ? ` His share is ${te1.ts.direction} ${Math.abs(te1.ts.delta).toFixed(1)} points since Week ${te1.ts.baseWeek}.`
            : "") +
          ` ${verdict[1]}`,
      );
    }
  }

  // 8. The buy-low card's player.
  if (buy) {
    const p = buy.row.player;
    const r = buy.row;
    const gains = [
      r.ts.delta != null && r.ts.delta > 0 ? `target share up ${f1(r.ts.delta)} points since Week ${r.ts.baseWeek}` : null,
      r.snap.delta != null && r.snap.delta > 0 ? `snap share up ${Math.round(r.snap.delta)} points since Week ${r.snap.baseWeek}` : null,
    ].filter((s): s is string => s != null);
    const blsh = BUY_LOW_SELL_HIGH_URL ? ` See every current riser and faller league-wide on our Buy Low, Sell High board.` : "";
    ask(
      `Is ${p.name} a buy-low fantasy football target?`,
      buy.reason === "points" && p.xfpPerGame != null && p.fpPerGame != null && p.fpoePerGame != null
        ? `Yes, he is our current ${nick} buy-low. ${p.name} is averaging ${f1(p.xfpPerGame)} expected fantasy points per game but only ${f1(p.fpPerGame)} actual ${wk}, ${f1(Math.abs(p.fpoePerGame))} a game below the value of his opportunities. If the role holds, that gap is a potential regression signal, so check why before you trade for him.${blsh}`
        : gains.length
          ? `Yes, he is our current ${nick} buy-low because his role is growing: ${list(gains)}. The role is arriving before the box score does, so the time to trade for him is before a big game makes it obvious to your league.${blsh}`
          : null,
      [link(BUY_LOW_SELL_HIGH_URL, "Buy Low, Sell High board", "blsh-usage-faq")],
    );
  }

  // 9. The RB1 as a set-and-forget starter.
  if (rb1 && rb1Row && woppPct(rb1)) {
    const share = `${woppPct(rb1)} of the backfield's weighted opportunities`;
    const rank = rb1.qualified && rb1.leagueRank.rank ? ` (RB${rb1.leagueRank.rank} per active game in the NFL)` : "";
    const rz = rb1.rzOppShare != null ? ` and ${rb1.rzOppShare}% of the backs' red-zone carries + targets` : "";
    const answers: Record<string, string> = {
      set: `Yes. ${rb1.name} has ${share}${rank}${rz} ${wk}. That is a workhorse share, and it grades Set & forget in our usage table.`,
      starter: `Not quite. ${rb1.name} has ${share}${rank}${rz} ${wk}: enough volume to start most weeks, but another back takes a real cut, so he grades Starter rather than Set & forget.`,
      flex: `No. ${rb1.name} has ${share}${rank} ${wk}, a shared backfield that grades Flex: his weekly volume depends on how the split breaks.`,
      volatile: `No. ${rb1.name} has only ${share} ${wk}, a split that grades Volatile in our usage table.`,
    };
    ask(`Is ${rb1.name} a set-and-forget fantasy football starter?`, answers[rb1Row.tier] ?? null);
  }

  // 10. The handcuff.
  if (rb1) {
    ask(
      `Who is the ${poss} top running back handcuff?`,
      cuff
        ? `${cuff.rb2.name} is the ${poss} top handcuff: he is next in line behind ${rb1.name} by weighted opportunities` +
            (cuff.rb2.woppPerGame != null ? `, with ${f1(cuff.rb2.woppPerGame)} per active game ${wk}` : ` ${wk}`) +
            `. If ${surname(rb1.name)} misses time, our contingency model projects ${surname(cuff.rb2.name)} for ` +
            (cuff.projShare != null ? `~${cuff.projShare}% of the backfield's weighted opportunities (~${f1(cuff.projected)} per active game)` : `~${f1(cuff.projected)} weighted opportunities per active game`) +
            `, ${cuff.grade}. See where ${cuff.rb2.name} ranks among every team's backups in our RB Handcuff Rankings.`
        : `The ${nick} have no clear handcuff: no back behind ${rb1.name} has 5% of the backfield's weighted opportunities, so a ${surname(rb1.name)} absence would be settled on the waiver wire, not by a stash on your bench. Our RB Handcuff Rankings show which backups elsewhere carry that value.`,
      [link(RB_HANDCUFF_RANKINGS_URL, "RB Handcuff Rankings", "rb-handcuffs-usage-faq")],
    );
  }

  // 11. How the passer spreads it.
  if (view.qb && view.team.targets) {
    const tgt = view.team.targets;
    const top = view.all
      .filter((p) => p.pos !== "QB" && p.targets > 0)
      .sort((a, b) => b.targets - a.targets)
      .slice(0, 3);
    if (top.length) {
      const share = (p: UsagePlayer) => (100 * p.targets) / tgt;
      const topShare = Math.round(top.reduce((s, p) => s + share(p), 0));
      const shape = topShare >= 65 ? "a concentrated tree" : topShare <= 50 ? "a spread-out tree" : null;
      const zones = view.team.zones;
      const deep = (["DL", "DM", "DR"] as Zone[]).reduce((s, k) => s + (zones[k]?.att ?? 0), 0);
      const all = (Object.values(zones) as Array<{ att: number }>).reduce((s, z) => s + z.att, 0);
      const best = bestZone(view);
      const qbName = surname(view.qb.name);
      ask(
        `How is ${view.qb.name} distributing targets in the ${nick} offense?`,
        `${list(top.map((p) => `${p.name} (${f1(share(p))}%)`))} lead the ${tgt} ${nick} targets ${wk}, so the top ${top.length === 1 ? "one takes" : `${top.length} take`} ${topShare}% of the looks${shape ? `, ${shape}` : ""}.` +
          (all
            ? ` ${qbName} keeps ${Math.round((100 * (all - deep)) / all)}% of his throws under 20 air yards` +
              (best && zones[best]?.ypa != null
                ? `, and the ${ZONE_LABEL[best].toLowerCase()} has been his most efficient high-volume zone at ${f1(zones[best]!.ypa!)} yards per attempt`
                : "") +
              `.`
            : ""),
      );
    }
  }

  // 12. Who is gaining and losing.
  {
    // One verdict per player: a pass-catcher's target share decides it when
    // it has a confirmed move, a back's (or a flat share's) snap share
    // otherwise, and a snap move the other way is named as the caveat.
    const tsMove = (r: UsageRow) =>
      (r.player.pos === "WR" || r.player.pos === "TE") && r.ts.direction !== "flat" && r.ts.confirmed && r.ts.delta != null
        ? r.ts.direction
        : null;
    const snapMove = (r: UsageRow) =>
      r.snap.direction !== "flat" && r.snap.confirmed && r.snap.delta != null && Math.abs(r.snap.delta) >= 10
        ? r.snap.direction
        : null;
    const tsText = (r: UsageRow) => `target share ${signed(r.ts.delta!)} points since Week ${r.ts.baseWeek}`;
    const snapText = (r: UsageRow) => `snap share ${signed(r.snap.delta!, 0)} since Week ${r.snap.baseWeek}`;
    const moves = (dir: "up" | "down") =>
      skill.flatMap((r) => {
        const ts = tsMove(r);
        const snap = snapMove(r);
        if (ts === dir) {
          const against =
            snap && snap !== dir
              ? `, even as his snap share ${snap === "up" ? "rose" : "fell"} ${Math.abs(Math.round(r.snap.delta!))} points`
              : snap === dir
                ? `, ${snapText(r)}`
                : "";
          return [`${r.player.name} (${tsText(r)}${against})`];
        }
        if (!ts && snap === dir) return [`${r.player.name} (${snapText(r)})`];
        return [];
      });
    const up = moves("up").slice(0, 3);
    const down = moves("down").slice(0, 3);
    const base = skill[0]?.ts.baseWeek;
    ask(
      `Which ${nick} players are gaining or losing fantasy football opportunity?`,
      up.length || down.length
        ? (up.length ? `Gaining ${wk}: ${list(up)}.` : `No ${nick} player has a confirmed rise in role ${wk}.`) +
            (down.length ? ` Losing: ${list(down)}.` : ` No one's role is in a confirmed decline.`) +
            ` A trend only counts here when the latest game confirms it.`
        : skill.length
          ? `No ${nick} player's role has moved enough to call a trend ${wk}${base ? `: target shares are within 2 points of Week ${base} or the latest game has not confirmed the move` : ""}.`
          : null,
    );
  }

  // 13. What target share means.
  {
    const cliff = getTargetShareCliff();
    const above = passCatchers.filter((r) => (r.player.targetShare ?? 0) >= 20);
    const closest = passCatchers[0];
    ask(
      `What does target share mean for ${nick} fantasy football players?`,
      `Target share is the percentage of a team's targets that go to one player. ` +
        (cliff
          ? `Since ${cliff.seasons.slice(0, 4)}, receivers with a 20%+ target share have averaged ${cliff.above20.ppg} fantasy points per game, compared with ${cliff.from10to20.ppg} for receivers between 10% and 20%. `
          : "") +
        (above.length
          ? `On the ${nick}, ${list(above.map((r) => `${r.player.name} (${f1(r.player.targetShare!)}%)`))} ${above.length === 1 ? "is" : "are"} above 20% ${wk}.`
          : closest
            ? `No ${nick} receiver is above 20% ${wk}; ${closest.player.name} is closest at ${f1(closest.player.targetShare!)}%.`
            : ""),
    );
  }

  // 14. xFP and FPOE.
  {
    const swing = [...skill]
      .filter((r) => r.player.fpoePerGame != null && Math.abs(r.player.fpoePerGame) >= 1.5)
      .sort((a, b) => Math.abs(b.player.fpoePerGame!) - Math.abs(a.player.fpoePerGame!))[0];
    ask(
      `What are expected fantasy points (xFP) and fantasy points over expected (FPOE)?`,
      `xFP measures the fantasy value of a player's opportunities, while FPOE shows how far his actual production finished above or below that expectation. ` +
        (byXfp
          ? `On the ${nick}, ${byXfp.player.name} leads the skill players at ${f1(byXfp.player.xfpPerGame!)} xFP per game ${wk}` +
            (swing ? `, and ${swing.player.name} is running ${signed(swing.player.fpoePerGame!)} FPOE per game` : "") +
            `. `
          : "") +
        `Opportunity tends to be more stable than short-term efficiency, so xFP is often the better guide to what comes next.`,
    );
  }

  // 15. Putting it to work.
  {
    const set = skill.filter((r) => r.tier === "set").map((r) => r.player.name);
    if (view.qb && rows.some((r) => r.player === view.qb && r.tier === "set")) set.push(view.qb.name);
    const trades = [
      buy ? `${buy.row.player.name} is the current buy-low` : null,
      sell ? `${sell.row.player.name} the current sell-high` : null,
    ].filter((s): s is string => s != null);
    ask(
      `How should I use ${nick} usage data for trades, waivers and start/sit decisions?`,
      `Start with the shares: target share, snap share and red-zone opportunities show who is earning work before the box score does. ` +
        (set.length ? `For start/sit, the ${poss} Set & forget players ${wk} are ${list(set)}; settle the closer calls in our Start/Sit tool. ` : `For start/sit, settle the close calls in our Start/Sit tool. `) +
        `For trades, look for a role that is growing or a gap between xFP and actual points` +
        (trades.length ? `; ${list(trades)}` : "") +
        `. Run any offer through the Trade Analyzer before you send it. ` +
        (cuff ? `For waivers and bench spots, watch the backs next in line, like ${cuff.rb2.name}. ` : "") +
        `Redraft Command runs these same opportunity trends against your actual roster for lineups, trades and waivers.`,
      [
        link(START_SIT_URL, "Start/Sit tool", "start-sit-usage-faq"),
        link(TRADE_CALCULATOR_URL, "Trade Analyzer", "trade-analyzer-usage-faq"),
        link(REDRAFT_COMMAND_URL, "Redraft Command", "redraft-command-usage-faq"),
      ],
    );
  }

  return out;
}

function trendClause(row: UsageRow): string {
  const t = row.ts;
  if (t.delta == null || t.baseWeek == null) return "";
  return t.direction === "flat"
    ? `, holding steady since Week ${t.baseWeek}`
    : `, ${t.direction} ${Math.abs(t.delta).toFixed(1)} points since Week ${t.baseWeek}`;
}

function fpoeClause(p: UsagePlayer): string {
  const v = p.fpoePerGame;
  if (v == null) return "";
  if (Math.abs(v) < 0.05) return " He is scoring right at that expectation.";
  return ` He is scoring ${f1(Math.abs(v))} points a game ${v > 0 ? "above" : "below"} that expectation.`;
}
