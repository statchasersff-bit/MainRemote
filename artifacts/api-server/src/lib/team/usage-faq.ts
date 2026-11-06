/**
 * The Snap Counts & Player Usage page's Common questions.
 *
 * Rewritten 2026-11-05 on mak's NFL-first brief: the questions are the ones
 * a reader searching for a club's snap counts, target leaders, backfield
 * split and offensive tendencies asks, in the order the page answers them,
 * with the fantasy questions (usage profiles, the handcuff, xFP/FPOE, how to
 * use the data) kept at the end for the readers who want them.
 *
 * Every answer is written from the same view the report draws, by rule, so
 * an answer cannot quote a number the page above it does not show. A
 * question that names a player (the lead back, the passer) is asked only
 * when the view has that player, and a question the data cannot answer is
 * left out rather than answered with a guess. The questions are in the
 * page's FAQPage too, so every answer is plain text; a link is a phrase of
 * that text the renderer wraps, so the schema's answer and the visible
 * answer stay the same words. A tool whose address is not set yet (null in
 * matchup/recap.ts) drops its sentence, not just its link.
 */

import {
  GAP_LABEL,
  ZONE_LABEL,
  art,
  bestGap,
  bestZone,
  handcuffProjection,
  list,
  signed,
  situationShare,
  usageTrends,
} from "./usage-copy";
import { baseWords, getTargetShareCliff, surname, type RunGap, type UsagePlayer, type UsageRow, type UsageView, type Zone } from "./usage";
import type { NflTeam } from "./teams";
import { RB_HANDCUFF_RANKINGS_URL, REDRAFT_COMMAND_URL, START_SIT_URL, TRADE_CALCULATOR_URL } from "../matchup/recap";

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
  const tgt = view.team.targets;
  const byTargets = view.all.filter((p) => p.targets > 0).sort((a, b) => b.targets - a.targets);
  const tShare = (p: UsagePlayer) => (tgt ? f1((100 * p.targets) / tgt) : null);
  const [rb1, rb2, rb3] = view.rbs;
  const cuff = handcuffProjection(view);
  const totals = view.team.rbSituationTotals;
  const byXfp = [...skill]
    .filter((r) => r.player.xfpPerGame != null)
    .sort((a, b) => (b.player.xfpPerGame ?? 0) - (a.player.xfpPerGame ?? 0))[0];

  // 1. Target leader.
  {
    const [lead, second, third] = byTargets;
    const leadRow = rows.find((r) => r.player === lead);
    ask(
      `Who leads the ${nick} in targets?`,
      lead && tShare(lead)
        ? `${lead.name} leads the ${nick} with ${plural(lead.targets, "target")} ${wk}, ${art(tShare(lead))} ${tShare(lead)}% share of the team's ${tgt}${leadRow ? trendClause(leadRow) : ""}.` +
            (second ? ` ${second.name} is second with ${second.targets} (${tShare(second)}%)` + (third ? `, then ${third.name} with ${third.targets}.` : ".") : "")
        : null,
    );
  }

  // 2. Snap leaders.
  {
    const withSnaps = view.all.filter((p) => (p.snaps ?? 0) > 0 && p.snapShare != null);
    const teamSnaps = view.team.snapsByWeek ? Object.values(view.team.snapsByWeek).reduce((s, n) => s + n, 0) : 0;
    const qb = withSnaps.filter((p) => p.pos === "QB").sort((a, b) => (b.snaps ?? 0) - (a.snaps ?? 0))[0];
    const others = withSnaps.filter((p) => p.pos !== "QB").sort((a, b) => (b.snaps ?? 0) - (a.snaps ?? 0)).slice(0, 3);
    const line = (p: UsagePlayer) => `${p.name} (${p.snaps} snaps, ${p.snapShare}%)`;
    ask(
      `Who plays the most offensive snaps for the ${nick}?`,
      teamSnaps && others.length
        ? (qb ? `${qb.name} has played ${qb.snaps} of the ${poss} ${teamSnaps} offensive snaps (${qb.snapShare}%) ${wk}. ` : "") +
            `Among the backs, receivers and tight ends, ${list(others.map(line))} lead${others.length === 1 ? "s" : ""} the team. ` +
            `Snap share is a player's offensive snaps over the team's in the games counted.`
        : null,
    );
  }

  // 3. Lead back.
  ask(
    `Who is the ${poss} lead running back?`,
    rb1
      ? `${rb1.name} is the ${poss} lead back ${wk} with ${plural(rb1.carries, "carry", "carries")}` +
          (rb1.touchShare != null ? `, ${rb1.touchShare}% of the running backs' touches` : "") +
          (rb1.snapShare != null ? `, on ${rb1.snapShare}% of the offensive snaps` : "") +
          `.` +
          (rb2 ? ` ${rb2.name} is next with ${plural(rb2.carries, "carry", "carries")}${rb3 && rb3.carries > 0 ? `, then ${rb3.name} with ${rb3.carries}` : ""}.` : "") +
          ` Carries count scrambles and exclude kneel-downs.`
      : null,
  );

  // 4. The split by situation.
  if (rb1 && rb2) {
    const pair = (key: keyof UsagePlayer["situation"]) => {
      const a = situationShare(view, rb1, key);
      const b = situationShare(view, rb2, key);
      return a == null || b == null ? null : `${a}% to ${b}%`;
    };
    const splits = [
      totals.early >= 10 && pair("early") ? `on early downs it is ${pair("early")} (${plural(totals.early, "opportunity", "opportunities")})` : null,
      totals.third >= 5 && pair("third") ? `on third down ${pair("third")} (${totals.third})` : null,
      totals.rz >= 5 && pair("rz") ? `in the red zone ${pair("rz")} (${totals.rz})` : null,
      totals.trailing >= 6 && pair("trailing") ? `trailing by seven or more ${pair("trailing")} (${totals.trailing})` : null,
    ].filter((s): s is string => s != null);
    const roomWork = view.rbs.reduce((s, p) => s + p.carries + p.targets, 0);
    const share = (p: UsagePlayer) => (roomWork ? Math.round((100 * (p.carries + p.targets)) / roomWork) : null);
    ask(
      `How do the ${nick} split the backfield between ${rb1.name} and ${rb2.name}?`,
      share(rb1) != null && share(rb2) != null
        ? `${rb1.name} has ${share(rb1)}% of the ${poss} running back carries and targets ${wk} and ${rb2.name} has ${share(rb2)}%` +
            (rb3 && (share(rb3) ?? 0) >= 5 ? `, with ${rb3.name} at ${share(rb3)}%` : "") +
            `.` +
            (splits.length ? ` By situation, ${list(splits)}. Shares are of the backs' carries + targets, not snaps.` : "")
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

  // 6. How the passer spreads it.
  if (view.qb && tgt) {
    const top = byTargets.filter((p) => p.pos !== "QB").slice(0, 3);
    if (top.length) {
      const topShare = Math.round(top.reduce((s, p) => s + (100 * p.targets) / tgt, 0));
      const shape = topShare >= 65 ? "a concentrated distribution" : topShare <= 50 ? "a spread-out distribution" : null;
      const zones = view.team.zones;
      const deep = (["DL", "DM", "DR"] as Zone[]).reduce((s, k) => s + (zones[k]?.att ?? 0), 0);
      const all = (Object.values(zones) as Array<{ att: number }>).reduce((s, z) => s + z.att, 0);
      const best = bestZone(view);
      const qbName = surname(view.qb.name);
      ask(
        `How does ${view.qb.name} distribute his passes?`,
        `${list(top.map((p) => `${p.name} (${tShare(p)}%)`))} lead the ${tgt} ${nick} targets ${wk}, so the top ${top.length === 1 ? "one takes" : `${top.length} take`} ${topShare}% of the looks${shape ? `, ${shape}` : ""}.` +
          (all
            ? ` By field zone, ${qbName} keeps ${Math.round((100 * (all - deep)) / all)}% of his ${all} charted attempts under 20 air yards` +
              (best && zones[best]?.ypa != null
                ? `, and the ${ZONE_LABEL[best].toLowerCase()} has been his most efficient high-volume zone at ${f1(zones[best]!.ypa!)} yards per attempt on ${zones[best]!.att}`
                : "") +
              `.`
            : ""),
      );
    }
  }

  // 7. Run direction.
  {
    const runs = view.team.runs;
    const gaps = Object.keys(runs) as RunGap[];
    const total = gaps.reduce((s, g) => s + runs[g].att, 0);
    const best = bestGap(view);
    if (total >= 10) {
      const pctOf = (n: number) => Math.round((100 * n) / total);
      const left = runs.LT.att + runs.LE.att;
      const right = runs.RT.att + runs.RE.att;
      ask(
        `Where do the ${nick} run the ball?`,
        `Of the ${poss} ${total} designed runs ${wk}, ${pctOf(runs.MID.att)}% have gone inside (${runs.MID.att} attempts${runs.MID.ypc != null ? `, ${f1(runs.MID.ypc)} yards per carry` : ""}), ${pctOf(left)}% to the left side and ${pctOf(right)}% to the right.` +
          (best
            ? ` The most efficient gap with a real sample is the ${GAP_LABEL[best].toLowerCase()} at ${f1(runs[best].ypc!)} yards per carry on ${runs[best].att} attempts.`
            : "") +
          ` "Inside" includes runs behind either guard; scrambles and kneel-downs are not designed runs.`,
      );
    }
  }

  // 8. Who is gaining and losing.
  {
    const trends = usageTrends(view);
    const up = trends.filter((t) => t.direction === "up").map((t) => `${t.player.name} (${t.short})`);
    const down = trends.filter((t) => t.direction === "down").map((t) => `${t.player.name} (${t.short})`);
    const base = skill[0] ? baseWords(skill[0].ts) : "";
    ask(
      `Which ${nick} players' roles are growing or shrinking?`,
      up.length || down.length
        ? (up.length ? `Growing ${wk}: ${list(up)}.` : `No ${nick} player has a confirmed rise in role ${wk}.`) +
            (down.length ? ` Shrinking: ${list(down)}.` : ` No one's role is in a confirmed decline.`) +
            ` Each move is the player's last three games against the three he played before them; it counts when it clears the steady band (5% of snap share, 2% of target share) and the latest game confirms it.`
        : skill.length
          ? `No ${nick} player's role has moved enough to call a trend ${wk}${base ? `: the last three games' snap and target shares are within the steady band of ${base} or the latest game has not confirmed the move` : ""}.`
          : null,
    );
  }

  // 9. Definitions.
  {
    const kneels = view.team.kneels;
    const qb = view.qb;
    ask(
      `How are snap counts, targets and carries counted on this page?`,
      `Snaps are offensive snaps from the official gamebooks, and snap share is a player's snaps over the ${poss} offensive snaps in the games counted. ` +
        `A target is a pass attempt with an intended receiver, so throwaways and spikes carry none; target share is a player's targets over the team's ${tgt}. ` +
        `Carries include quarterback scrambles and exclude kneel-downs${kneels != null ? ` (${kneels} ${wk})` : ""}, which the official box score counts as rushing attempts` +
        (qb && qb.kneels ? `; ${surname(qb.name)}'s official total is his ${qb.carries} carries here plus ${qb.kneels} kneels` : "") +
        `. Situational shares are of the running backs' carries + targets, not snaps, and each row prints the number of opportunities it is measured on.`,
    );
  }

  // 10. The next back.
  if (rb1 && rb2) {
    ask(
      `Who is the ${poss} backup running back behind ${rb1.name}?`,
      cuff
        ? `${rb2.name} is next in line behind ${rb1.name} by carries and targets ${wk}, with ${plural(rb2.carries, "carry", "carries")}, ${plural(rb2.targets, "target")}${rb2.snapShare != null ? ` and ${art(rb2.snapShare)} ${rb2.snapShare}% snap share` : ""}. ` +
            `If ${surname(rb1.name)} missed time and his work were shared out in proportion to who takes the early-down and red-zone touches behind him, ${surname(rb2.name)} would be at about ${f1(cuff.projected)} carries + 2 × targets per game` +
            (cuff.projShare != null ? `, roughly ${cuff.projShare}% of the backfield's work` : "") +
            `.`
        : `No back behind ${rb1.name} has 5% of the backfield's carries + 2 × targets ${wk}, so the ${nick} have no established second back; an absence would open a role no one on the roster currently holds.`,
    );
  }

  // 11. (fantasy) Best usage profile.
  if (byXfp) {
    const p = byXfp.player;
    const cliff = getTargetShareCliff();
    const source =
      p.pos === "RB"
        ? p.woppShare != null
          ? ` It comes from ${p.woppShare}% of the backfield's weighted opportunities (carries + 2 × targets)${p.qualified && p.leagueRank.rank ? `, RB${p.leagueRank.rank} per active game in the NFL` : ""}.`
          : ""
        : p.targetShare != null
          ? ` It comes from ${art(f1(p.targetShare))} ${f1(p.targetShare)}% target share${p.wopr != null ? ` and a ${p.wopr.toFixed(2)} WOPR` : ""}.`
          : "";
    ask(
      `Which ${nick} player has the best fantasy football usage profile?`,
      `${p.name} has the ${poss} strongest fantasy usage profile ${wk}: ${f1(p.xfpPerGame!)} expected fantasy points (xFP) per game, the most of any ${nick} ${view.qb ? "skill player outside the quarterback" : "skill player"}.` +
        source +
        fpoeClause(p) +
        (cliff
          ? ` For scale, since ${cliff.seasons.slice(0, 4)} receivers with a 20%+ target share have averaged ${cliff.above20.ppg} fantasy points per game, against ${cliff.from10to20.ppg} for receivers between 10% and 20%.`
          : ""),
    );
  }

  // 12. (fantasy) The handcuff.
  if (rb1) {
    ask(
      `Who is the ${poss} top fantasy football handcuff?`,
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

  // 13. (fantasy) xFP and FPOE.
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
        `Opportunity tends to be more stable than short-term efficiency, so xFP is often the better guide to what comes next. Both sit behind the + button in the Advanced & Fantasy Analysis table.`,
    );
  }

  // 14. (fantasy) Putting it to work.
  {
    const set = skill.filter((r) => r.tier === "set").map((r) => r.player.name);
    if (view.qb && rows.some((r) => r.player === view.qb && r.tier === "set")) set.push(view.qb.name);
    const buy = view.signals.find((s) => s.kind === "buy");
    const sell = view.signals.find((s) => s.kind === "sell");
    const trades = [
      buy ? `${buy.row.player.name} is the current buy-low` : null,
      sell ? `${sell.row.player.name} the current sell-high` : null,
    ].filter((s): s is string => s != null);
    ask(
      `How should I use ${nick} usage data for fantasy trades, waivers and start/sit decisions?`,
      `Start with the shares: snap share, target share and red-zone opportunities show who is earning work before the box score does. ` +
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
    ? `, holding steady over his last three games against ${baseWords(t)}`
    : `, ${t.direction} ${Math.abs(t.delta).toFixed(1)}% over his last three games against ${baseWords(t)}`;
}

function fpoeClause(p: UsagePlayer): string {
  const v = p.fpoePerGame;
  if (v == null) return "";
  if (Math.abs(v) < 0.05) return " He is scoring right at that expectation.";
  return ` He is scoring ${f1(Math.abs(v))} points a game ${v > 0 ? "above" : "below"} that expectation.`;
}
