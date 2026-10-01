/**
 * The Usage tab's words.
 *
 * Every sentence here is written from the numbers, by rule — there is no model
 * call and no per-team text file, so all 32 clubs re-write themselves each
 * week when the data does. The spec's editorial rule is the constraint on each
 * template: a line has to state a MECHANISM ("Johnson owns third downs, so
 * Cook's catches are capped"), not restate the number beside it. Where the data
 * cannot support a mechanism, the line says less rather than inventing one.
 *
 * Plain strings out; the renderer escapes them. `**…**` is not markup here —
 * notes that open with a bold thesis return it as a separate field.
 */

import {
  ordinal,
  rbRankFor,
  surname,
  type RunGap,
  type Signal,
  type UsagePlayer,
  type UsageRow,
  type UsageView,
  type Zone,
} from "./usage";

/* ------------------------------------------------------------ formatting */

const MINUS = "−";

export function signed(v: number, places = 1): string {
  const fixed = Math.abs(v).toFixed(places);
  if (Number(fixed) === 0) return (0).toFixed(places);
  return `${v > 0 ? "+" : MINUS}${fixed}`;
}

export function pct(v: number | null | undefined, places = 1): string {
  return v == null ? "" : `${v.toFixed(places)}%`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const POS_PLURAL: Record<string, string> = { QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs" };

/* ------------------------------------------------------------ environment */

export interface EnvCard {
  label: string;
  value: string;
  rank: string;
  good: boolean;
  note: string;
}

export function environmentCards(view: UsageView): EnvCard[] {
  const { env } = view.team;
  const rb1 = view.rbs[0];
  const qb = view.qb;
  const receivers = view.rows
    .filter((r) => r.player.pos === "WR" || r.player.pos === "TE")
    .map((r) => r.player);
  const [wr1, wr2] = receivers;
  const cards: EnvCard[] = [];
  const good = (rank: number | null) => rank != null && rank <= 12;

  if (env.proe.value != null && env.proe.rank != null) {
    const v = env.proe.value;
    const note =
      v >= 3
        ? `Throws more than game situations call for${wr1 ? ` — the volume ${list([wr1, wr2].filter(Boolean).map((p) => surname(p!.name)))} live on` : ""}`
        : v <= -3
          ? `Runs more than game situations call for — a cap on the pass-catchers' volume${rb1 ? ` and a floor under ${surname(rb1.name)}` : ""}`
          : `Throws about as much as situations call for — the target tree, not the play-calling, decides who eats`;
    cards.push({ label: "Pass rate over expected", value: `${signed(v)}%`, rank: ordinal(env.proe.rank), good: good(env.proe.rank), note });
  }

  if (env.rzPassRate.value != null && env.rzPassRate.rank != null) {
    const rank = env.rzPassRate.rank;
    const ez = [...view.all].filter((p) => p.pos !== "QB").sort((a, b) => b.ezTargets - a.ezTargets)[0];
    const rzLeader = view.rows.find((r) => r.leadsRz)?.player;
    let note: string;
    if (rank <= 10) {
      note = ez && ez.ezTargets > 0
        ? `Throws inside the 20 — ${surname(ez.name)}'s ${ez.ezTargets} end-zone target${ez.ezTargets === 1 ? "" : "s"} lead the team`
        : `Throws inside the 20 — red-zone targets are live for the whole tree`;
    } else if (rank >= 23) {
      note =
        qb && rb1 && qb.gzCarries >= 2 && qb.gzCarries >= rb1.gzCarries
          ? `Run-first inside the 20 — ${surname(qb.name)}'s legs cap the receivers' TDs`
          : rb1
            ? `Run-first inside the 20 — ${surname(rb1.name)}'s ${rb1.gzCarries} green-zone carries eat the receivers' TDs`
            : `Run-first inside the 20 — the receivers' TD odds shrink`;
    } else {
      note = rzLeader
        ? `Balanced inside the 20 — ${surname(rzLeader.name)} leads the team with ${rzLeader.rzTouches} red-zone touches`
        : `Balanced inside the 20`;
    }
    cards.push({ label: "Red-zone pass rate", value: `${env.rzPassRate.value.toFixed(0)}%`, rank: ordinal(rank), good: good(rank), note });
  }

  if (env.pace.value != null && env.pace.rank != null) {
    const rank = env.pace.rank;
    const note =
      rank <= 10
        ? "Seconds per play in neutral situations — a fast offense means more snaps for every starter"
        : rank >= 23
          ? "Seconds per play in neutral situations — a slow offense shrinks the pie"
          : "Seconds per play in neutral situations";
    cards.push({ label: "Neutral pace", value: `${env.pace.value.toFixed(1)}s`, rank: `${ordinal(rank)} fastest`, good: good(rank), note });
  }

  // Stands in for the spec's 11-personnel rate: personnel groupings come from
  // participation data, which is published after the season. See buildUsage.mjs.
  if (env.playsPerGame.value != null && env.playsPerGame.rank != null) {
    const rank = env.playsPerGame.rank;
    const note =
      rank <= 10
        ? "Offensive plays a game — extra volume lifts every starter's floor"
        : rank >= 23
          ? "Offensive plays a game — fewer snaps to go around, so shares matter more"
          : "Offensive plays a game — league-average volume, so shares decide it";
    cards.push({ label: "Plays per game", value: env.playsPerGame.value.toFixed(1), rank: ordinal(rank), good: good(rank), note });
  }

  if (env.xfpPerGame.value != null && env.xfpPerGame.rank != null) {
    const rank = env.xfpPerGame.rank;
    const note =
      "Total expected fantasy points this offense creates" +
      (rank <= 8 ? " — a rising tide for every starter" : rank >= 25 ? " — a thin pie, so only the top shares pay" : "");
    cards.push({ label: "Team xFP / game", value: env.xfpPerGame.value.toFixed(1), rank: ordinal(rank), good: good(rank), note });
  }

  return cards;
}

/* --------------------------------------------------------------- backfield */

export interface StatChip {
  value: string;
  caption: string;
}

export function backfieldChips(view: UsageView): StatChip[] {
  const [rb1, rb2] = view.rbs;
  if (!rb1) return [];
  const chips: StatChip[] = [];
  const rank = rb1.qualified ? rb1.leagueRank.rank : null;
  if (rb1.woppPerGame != null) {
    chips.push({
      value: rb1.woppPerGame.toFixed(1),
      caption: `${surname(rb1.name)} weighted opps/game${rank ? ` — RB${rank} in the NFL` : ""}`,
    });
  }
  chips.push({ value: String(rb1.hvt), caption: `${surname(rb1.name)} high-value touches (in-10 carries + targets)` });
  if (rb2 && rb2.woppPerGame != null) {
    chips.push({ value: rb2.woppPerGame.toFixed(1), caption: `${surname(rb2.name)} weighted opps/game` });
  }
  if (rb1.woppPerGame != null && rb1.lastSeasonWoppPerGame != null) {
    const d = rb1.woppPerGame - rb1.lastSeasonWoppPerGame;
    const read =
      d >= 1.5 ? "role grew, not just efficiency" : d <= -1.5 ? "a smaller role than last season" : "the same role as last season";
    chips.push({ value: signed(d), caption: `${surname(rb1.name)} wOpp/g vs. last season — ${read}` });
  }
  return chips;
}

export interface Takeaway {
  lead: string;
  body: string;
}

/** Share (0–100) a back holds of the room's work in one situation. */
export function situationShare(view: UsageView, p: UsagePlayer, key: keyof UsagePlayer["situation"]): number | null {
  const total = view.team.rbSituationTotals[key];
  return total ? Math.round((100 * p.situation[key]) / total) : null;
}

export function backfieldTakeaways(view: UsageView): Takeaway[] {
  const [rb1, rb2, rb3] = view.rbs;
  if (!rb1) return [];
  const out: Takeaway[] = [];
  const g = Math.max(1, rb1.games);
  const catchPace = Math.round((rb1.receptions / g) * 17);
  const totals = view.team.rbSituationTotals;

  // Who owns passing downs: third down when the sample can carry it, the
  // room's targets when it cannot.
  const thirdSample = totals.third >= 8;
  const others = view.rbs.slice(1);
  const passingOwner = thirdSample
    ? [...view.rbs].sort((a, b) => b.situation.third - a.situation.third)[0]
    : [...view.rbs].sort((a, b) => b.targets - a.targets)[0];
  const roomTargets = view.rbs.reduce((s, p) => s + p.targets, 0);
  const ownerShare = (p: UsagePlayer) =>
    thirdSample ? situationShare(view, p, "third") : roomTargets ? Math.round((100 * p.targets) / roomTargets) : null;
  const twoMin = (p: UsagePlayer) => (totals.twoMin >= 5 ? situationShare(view, p, "twoMin") : null);

  if (passingOwner && passingOwner !== rb1 && (ownerShare(passingOwner) ?? 0) >= 40) {
    const who = surname(passingOwner.name);
    const where = thirdSample
      ? `${ownerShare(passingOwner)}% of the backs' third-down work`
      : `${ownerShare(passingOwner)}% of the backfield's targets`;
    const tm = twoMin(passingOwner);
    out.push({
      lead: `Why ${surname(rb1.name)}'s reception count stays capped:`,
      body:
        `${passingOwner.name} owns ${where}${tm != null && tm >= 40 ? ` and ${tm}% of two-minute work` : ""}. ` +
        `${surname(rb1.name)}'s ${catchPace}-catch pace isn't a talent question — the passing-down role belongs to ${who}. ` +
        `Green flag for his rushing floor, hard ceiling on his PPR upside.`,
    });
  } else {
    const share = ownerShare(rb1);
    const trailing = totals.trailing >= 6 ? situationShare(view, rb1, "trailing") : null;
    out.push({
      lead: `Why ${surname(rb1.name)}'s floor holds in PPR:`,
      body:
        `He keeps ${share != null ? `${share}% of ` : ""}${thirdSample ? "the backs' third-down work" : "the backfield's targets"} as well as the early downs, so his catches don't depend on game script — a ${catchPace}-catch pace. ` +
        (trailing != null
          ? `Trailing by 7+, he still gets ${trailing}% of the backs' work — no one takes the hurry-up snaps from him.`
          : `No one on this depth chart takes the hurry-up snaps from him.`),
    });
  }

  // The handcuff: RB1's work redistributed in proportion to who takes the
  // valuable (early-down and red-zone) snaps behind him.
  if (rb2 && (rb2.woppShare ?? 0) >= 5 && rb1.woppPerGame != null && rb2.woppPerGame != null) {
    const valuable = (p: UsagePlayer) => p.situation.early + p.situation.rz;
    const behind = others.reduce((s, p) => s + valuable(p), 0);
    const weight = behind ? valuable(rb2) / behind : 1 / Math.max(1, others.length);
    const projected = rb2.woppPerGame + rb1.woppPerGame * weight;
    const roomPerGame = view.rbs.reduce((s, p) => s + (p.woppPerGame ?? 0), 0);
    const projShare = roomPerGame ? Math.round((100 * projected) / roomPerGame) : null;
    const rank = rbRankFor(view.doc.rbWoppPool, projected);
    const grade =
      rank <= 12 ? "a top-12 weekly RB by volume" : rank <= 24 ? "an RB2 by volume" : "flex volume at best";
    const rb2Early = situationShare(view, rb2, "early");
    const rb2Rz = situationShare(view, rb2, "rz");
    const backs =
      rb3 && passingOwner === rb3
        ? `while ${surname(rb3.name)} keeps passing downs`
        : "";
    const roles = [
      rb2Early != null && rb2Early >= 15 ? "early-down" : null,
      rb2Rz != null && rb2Rz >= 15 ? "red-zone" : null,
    ].filter(Boolean) as string[];
    out.push({
      lead: `The ${surname(rb2.name)} math if ${surname(rb1.name)} misses time:`,
      body:
        (roles.length
          ? `${surname(rb2.name)} backs up the ${list(roles)} role${roles.length > 1 ? "s" : ""} (the valuable ones)${backs ? ` ${backs}` : ""}. `
          : `${surname(rb2.name)} is next in line by weighted opportunities${backs ? `, ${backs}` : ""}. `) +
        `A ${surname(rb1.name)} absence projects ${surname(rb2.name)} to ~${projShare}% of weighted opportunities — about ${projected.toFixed(1)} a game, ${grade}` +
        (grade.startsWith("a top") || grade.startsWith("an RB2")
          ? view.rows.some((r) => r.player === rb2 && r.tier === "stash")
            ? ` — and why he's a STASH, not a cut.`
            : ` — worth a bench spot in deeper leagues.`
          : `.`),
    });
  } else {
    out.push({
      lead: `No clear handcuff behind ${surname(rb1.name)}:`,
      body: `No other back has 5% of the backfield's weighted opportunities, so a ${surname(rb1.name)} absence would be settled on the waiver wire, not by a stash on your bench.`,
    });
  }
  return out;
}

/* ----------------------------------------------------------- run direction */

export const GAP_LABEL: Record<RunGap, string> = {
  LE: "Left end",
  LT: "Left tackle",
  MID: "Middle",
  RT: "Right tackle",
  RE: "Right end",
};

const GAP_PHRASE: Record<RunGap, string> = {
  LE: "off left end",
  LT: "behind left tackle",
  MID: "up the middle",
  RT: "behind right tackle",
  RE: "off right end",
};

export function bestGap(view: UsageView): RunGap | null {
  const runs = view.team.runs;
  const total = Object.values(runs).reduce((s, r) => s + r.att, 0);
  const floor = Math.max(5, total * 0.08);
  let best: RunGap | null = null;
  for (const gap of Object.keys(runs) as RunGap[]) {
    const r = runs[gap];
    if (r.att < floor || r.ypc == null) continue;
    if (!best || r.ypc > (runs[best].ypc ?? -Infinity)) best = gap;
  }
  return best;
}

export function runNote(view: UsageView): string {
  const runs = view.team.runs;
  const best = bestGap(view);
  if (!best) return "";
  const total = Object.values(runs).reduce((s, r) => s + r.att, 0);
  const rb1 = view.rbs[0];
  const mid = runs.MID;

  if (best === "MID") {
    return (
      `The interior is the run game's engine: ${mid.ypc!.toFixed(1)} yards per carry up the middle on ${mid.att} attempts, ` +
      `${Math.round((100 * mid.att) / total)}% of all designed runs. The edges are a change-up, not the plan — ` +
      `when an interior lineman sits out practice, that's a usage note, not just an injury note.`
    );
  }

  const side = best === "LE" || best === "LT" ? "left" : "right";
  const [a, b]: RunGap[] = side === "left" ? ["LT", "LE"] : ["RT", "RE"];
  const sideAtt = runs[a].att + runs[b].att;
  const partner = best === a ? b : a;
  // The other gap on that side only joins the claim when it pulls its weight
  // too: at least what the interior gains. "4.6 behind right tackle and 1.0 off
  // right end" is not an engine.
  const partnerYpc = runs[partner].ypc;
  const partnerLine =
    runs[partner].att >= 3 && partnerYpc != null && partnerYpc >= (mid.ypc ?? 0)
      ? ` and ${partnerYpc.toFixed(1)} ${GAP_PHRASE[partner]}`
      : "";
  const longest = rb1?.longestRuns ?? [];
  const onSide = longest.filter(([, gap]) => gap === a || gap === b).length;
  const longestLine =
    rb1 && longest.length >= 3 && onSide >= 2
      ? `, and ${onSide === 3 ? "all three" : "two"} of ${surname(rb1.name)}'s three longest runs came off the ${side} side`
      : "";
  return (
    `The ${side} side is the run game's engine: ${runs[best].ypc!.toFixed(1)} yards per carry ${GAP_PHRASE[best]}${partnerLine} — ` +
    `${Math.round((100 * sideAtt) / total)}% of all designed runs go that way${longestLine}. ` +
    (mid.att > 0 && mid.ypc != null
      ? `Interior volume (${mid.att} attempts) does the clock work at ${mid.ypc.toFixed(1)}; the ${side} edge does the damage. `
      : "") +
    `When the line's ${side} side sits out practice, that's a usage note, not just an injury note.`
  );
}

/* ------------------------------------------------------------ pass map */

export const ZONE_LABEL: Record<Zone, string> = {
  DL: "Deep left",
  DM: "Deep middle",
  DR: "Deep right",
  SL: "Short left",
  SM: "Short middle",
  SR: "Short right",
};

/** The gold zone: the best YPA among zones that carry 10%+ of the attempts. */
export function bestZone(view: UsageView): Zone | null {
  let best: Zone | null = null;
  for (const [key, z] of Object.entries(view.team.zones) as Array<[Zone, NonNullable<UsageView["team"]["zones"][Zone]>]>) {
    if ((z.share ?? 0) < 10 || z.ypa == null) continue;
    if (!best || z.ypa > (view.team.zones[best]!.ypa ?? -Infinity)) best = key;
  }
  return best;
}

/** "Moore's side": a zone owner, when one receiver has 35%+ of its targets. */
export function zoneOwner(view: UsageView, zone: Zone): string | null {
  const top = view.team.zones[zone]?.top;
  if (!top || (top.share ?? 0) < 35 || top.targets < 4) return null;
  return surname(top.name);
}

export function passNote(view: UsageView, qbName: string): string {
  const zones = view.team.zones;
  const best = bestZone(view);
  if (!best) return "";
  const z = zones[best]!;
  const owner = zoneOwner(view, best);
  const deepAtt = (["DL", "DM", "DR"] as Zone[]).reduce((s, k) => s + (zones[k]?.att ?? 0), 0);
  const allAtt = (Object.values(zones) as Array<{ att: number }>).reduce((s, v) => s + v.att, 0);
  const shortShare = allAtt ? Math.round((100 * (allAtt - deepAtt)) / allAtt) : null;
  const deepBest = (["DL", "DM", "DR"] as Zone[])
    .filter((k) => (zones[k]?.att ?? 0) >= 2 && zones[k]?.ypa != null)
    .sort((a, b) => zones[b]!.ypa! - zones[a]!.ypa!)[0];

  const deepShare = allAtt ? Math.round((100 * deepAtt) / allAtt) : 0;
  // A deep-only receiver on a short-passing team: the mapped version of his problem.
  const decoy = view.rows
    .map((r) => r.player)
    .filter((p) => (p.pos === "WR" || p.pos === "TE") && (p.adot ?? 0) >= 13 && (p.targetShare ?? 100) < 15)
    .sort((a, b) => (b.adot ?? 0) - (a.adot ?? 0))[0];

  return (
    `The ${ZONE_LABEL[best].toLowerCase()} is the efficiency engine (${z.ypa} YPA)` +
    (owner ? ` — and it's ${owner}'s territory` : "") +
    `. ${qbName} keeps ${shortShare}% of his throws under 20 air yards` +
    (deepBest
      ? `, with the ${ZONE_LABEL[deepBest].toLowerCase()} his most explosive zone (${zones[deepBest]!.ypa} YPA on ${zones[deepBest]!.att} attempt${zones[deepBest]!.att === 1 ? "" : "s"})`
      : "") +
    `. ` +
    (decoy && best.startsWith("S")
      ? `${surname(decoy.name)}'s fantasy problem, mapped: a ${decoy.adot}-yard aDOT puts him in the ${deepShare}% deep slice of this chart while the ${ZONE_LABEL[best].toLowerCase()} feasts. `
      : "") +
    `Gold = highest-YPA high-volume zone.`
  );
}

/* ------------------------------------------------------------- the table */

export const TIER_LABEL = {
  set: "Set & forget",
  starter: "Starter",
  flex: "Flex",
  volatile: "Volatile",
  stash: "Stash",
} as const;

export function roleLine(row: UsageRow): string {
  const p = row.player;
  if (p.pos === "RB") {
    if (row.tier === "stash") return `${row.role} · handcuff${p.touchShare != null ? `, ${p.touchShare}% of RB touches` : ""}`;
    return `${row.role}${p.touchShare != null ? `, ${p.touchShare}% of RB touches` : ""}`;
  }
  return row.role;
}

export function rankLine(p: UsagePlayer): string {
  const rank = p.leagueRank.rank;
  if (!rank) return "";
  if (p.pos === "WR" || p.pos === "TE") return `${p.pos}${rank} in target share, NFL`;
  if (p.pos === "RB") return `RB${rank} in weighted opps/game, NFL`;
  return `QB${rank} in xFP/game, NFL`;
}

export function woprCaption(p: UsagePlayer): string {
  const w = p.wopr ?? 0;
  if (p.pos === "TE") {
    if (w >= 0.45) return "elite for TE";
    if (w >= 0.35) return "strong for TE";
    if (w >= 0.25) return "streamer range";
    return "below startable";
  }
  if (w >= 0.6) return "elite";
  if (w >= 0.45) return "strong — elite at 0.60";
  if (w >= 0.3) return "flex range";
  return "below startable";
}

/* --------------------------------------------------------- profile notes */

export interface ProfileNote {
  thesis: string;
  body: string;
}

export function profileNote(row: UsageRow, view: UsageView): ProfileNote {
  const p = row.player;
  const tail = `Bars show percentile vs. all NFL ${POS_PLURAL[p.pos]}.`;
  const fpoe = p.fpoePerGame;
  const fpoeLine =
    fpoe == null || p.xfpPerGame == null
      ? ""
      : Math.abs(fpoe) < 0.05
        ? ` Production is running right at expected, so this is volume, not a hot streak.`
        : Math.abs(fpoe) < 1.5
        ? ` Production is running ${signed(fpoe)} ${fpoe > 0 ? "over" : "against"} expected, so this is volume, not a hot streak.`
        : fpoe >= 1.5
          ? ` He's scoring ${signed(fpoe)} points a game over expected — some of that is efficiency that regresses, but the ${p.xfpPerGame} xFP floor holds.`
          : ` He's ${signed(fpoe)} a game against expected: the volume is there and the box score hasn't caught up — a buy signal, not a warning.`;

  if (p.pos === "QB") {
    const rushing = p.gzCarries >= 3 || (p.designedRunRate ?? 0) >= 8;
    const in10 = view.team.env.in10PassRate.value;
    if (rushing) {
      return {
        thesis: p.gzCarries >= 3 ? "The goal-line QB." : "The rushing floor.",
        body:
          ` ${p.gzCarries} green-zone carr${p.gzCarries === 1 ? "y" : "ies"} in ${p.games} game${p.games === 1 ? "" : "s"} and a ${p.designedRunRate}% designed-run rate` +
          (in10 != null ? ` — with a ${in10}% pass rate inside the 10, the most valuable real estate in fantasy goes to his legs as often as his arm` : "") +
          `.` +
          (p.xfpPerGame != null && p.leagueRank.rank ? ` His xFP alone (QB${p.leagueRank.rank} league-wide) justifies the price before any efficiency.` : "") +
          ` ${tail}`,
      };
    }
    return {
      thesis: "A pocket passer's profile.",
      body:
        ` ${p.gzCarries} green-zone carr${p.gzCarries === 1 ? "y" : "ies"} and a ${p.scrambleRate ?? 0}% scramble rate: his points have to come through the air, so his weekly range follows the pass volume` +
        (p.leagueRank.rank ? ` (QB${p.leagueRank.rank} in expected points)` : "") +
        `.${fpoeLine} ${tail}`,
    };
  }

  if (p.pos === "RB") {
    const rb1 = view.rbs[0];
    if (row.tier === "stash" && rb1 && rb1 !== p) {
      return {
        thesis: "Contingent value, quantified.",
        body:
          ` The ${p.touchShare ?? 0}% touch share is standalone-flex-in-a-pinch at best; the real number is what it becomes if ${surname(rb1.name)} misses time — see The Backfield Split above. ${tail}`,
      };
    }
    if ((p.woppShare ?? 0) >= 65) {
      return {
        thesis: "The locked-in workhorse.",
        body:
          ` A ${p.rzOppShare ?? 0}% share of the backs' red-zone work is the RB stat that tracks fantasy points best, and ${p.gzCarries} green-zone carr${p.gzCarries === 1 ? "y" : "ies"} put him at the goal line.` +
          fpoeLine +
          ` ${tail}`,
      };
    }
    return {
      thesis: "A shared backfield.",
      body:
        ` ${p.woppShare ?? 0}% of the weighted opportunities means another back takes a real cut every week, so his floor rises and falls with game script.` +
        fpoeLine +
        ` ${tail}`,
    };
  }

  // WR / TE
  const ays = p.airYardsShare ?? 0;
  const ts = p.targetShare ?? 0;
  const adot = p.adot ?? 0;
  const fr = p.firstReadShare;
  const frLine = fr != null ? `a ${fr}% first-read share` : "";

  if (ays >= 30 && ts >= 20) {
    return {
      thesis: "The alpha profile, fully formed.",
      body:
        ` A ${ays}% air-yards share clears the 30% alpha threshold${frLine ? `, ${frLine} says the offense is designed through him` : ""}, and a ${adot}-yard aDOT ${adot >= 8 && adot <= 13 ? "sits in the sweet spot — deep enough for ceiling, not so deep it gets volatile" : adot > 13 ? "keeps his ceiling high and his floor jumpy" : "keeps him on the move-the-chains throws"}.` +
        fpoeLine +
        ` ${tail}`,
    };
  }
  if (row.ts.direction === "up" && row.ts.confirmed && (row.ts.delta ?? 0) >= 4) {
    const trail = row.ts.trail.filter((v): v is number => v != null).map((v) => `${v.toFixed(0)}%`).join(" → ");
    return {
      thesis: "The role is arriving before the box score does.",
      body:
        ` His target share has run ${trail} over the last ${row.ts.trail.length} games` +
        (fr != null && fr >= 20 ? `, with ${frLine} saying the plays are being designed for him` : "") +
        `. Volume that is growing this fast gets repriced the week it scores.` +
        fpoeLine +
        ` ${tail}`,
    };
  }
  if (adot >= 13 && ts < 15) {
    return {
      thesis: "The deep-decoy profile.",
      body:
        ` A ${adot}-yard aDOT sits past the depth where weekly production turns boom/bust, and a ${ts}% target share says he isn't earning volume when he's out there` +
        (fr != null && fr < 12 ? `; a ${fr}% first-read share means the plays are rarely designed for him` : "") +
        `. Best-ball ceiling, seasonal-league headache. ${tail}`,
    };
  }
  if (adot > 0 && adot <= 7 && ays < 20) {
    return {
      thesis: `The ceiling problem in two numbers: a ${ays}% air-yards share and a ${adot} aDOT.`,
      body:
        ` His targets travel nowhere, so even a healthy target share converts to modest yardage` +
        (row.ts.direction === "down" && row.ts.confirmed ? ` — and the share itself is the one drifting down` : "") +
        `.` +
        fpoeLine +
        ` ${tail}`,
    };
  }
  if (ts < 12) {
    return {
      thesis: "Not enough of the pie.",
      body:
        ` A ${ts}% target share is under the line where weekly fantasy value lives` +
        (frLine ? `, and ${frLine} says he's rarely the design` : "") +
        `. He needs an injury above him or a role change, not a better matchup. ${tail}`,
    };
  }
  return {
    thesis: ts >= 20 ? "Volume you can set in the lineup." : "A starter's share without the alpha tag.",
    body:
      ` A ${ts}% target share and ${p.xfpPerGame ?? 0} expected points a game` +
      (frLine ? `, with ${frLine}` : "") +
      (ays ? `; a ${ays}% air-yards share decides how much of that turns into yards` : "") +
      `.` +
      fpoeLine +
      ` ${tail}`,
  };
}

/* ----------------------------------------------------------------- signals */

export interface SignalCopy {
  label: string;
  body: string;
  proof: Array<{ value: string; caption: string }>;
}

export function signalCopy(signal: Signal): SignalCopy {
  const { row } = signal;
  const p = row.player;
  const base = row.ts.baseWeek != null ? `W${row.ts.baseWeek}` : "the start";
  const last = row.ts.trail[row.ts.trail.length - 1];
  const lastWeek = row.ts.trailWeeks[row.ts.trailWeeks.length - 1];

  if (signal.kind === "buy") {
    if (signal.reason === "points") {
      return {
        label: "Buy low",
        body: `The volume is there and the points aren't — yet. ${p.xfpPerGame} expected points a game against ${p.fpPerGame} actual is the gap that closes on its own. Trade for him before it does.`,
        proof: [
          { value: `${p.xfpPerGame}`, caption: "xFP per game" },
          { value: signed(p.fpoePerGame ?? 0), caption: "points vs. expected per game" },
        ],
      };
    }
    const proof = [];
    if (row.snap.delta != null && row.snap.delta > 0) proof.push({ value: signed(row.snap.delta, 0), caption: `snap share pts since W${row.snap.baseWeek}` });
    if (row.ts.delta != null && row.ts.delta > 0) proof.push({ value: signed(row.ts.delta), caption: `target share pts since ${base}` });
    if (proof.length < 2 && p.xfpPerGame != null) proof.push({ value: `${p.xfpPerGame}`, caption: "xFP per game" });
    return {
      label: "Buy low",
      body: "The role is arriving before the box score does. Trade for him this week — not after the two-touchdown game makes it obvious to your league.",
      proof: proof.slice(0, 2),
    };
  }

  if (signal.kind === "sell") {
    const trail = row.ts.trail.filter((v): v is number => v != null);
    let straight = 0;
    for (let i = trail.length - 1; i > 0; i -= 1) {
      if (trail[i]! < trail[i - 1]!) straight += 1;
      else break;
    }
    const seasonLow = last != null && p.weekly.every((w) => w.ts == null || w.ts >= last);
    return {
      label: "Sell high",
      body:
        `Season totals still read like a starter, but ` +
        (straight >= 2
          ? `the share is drifting the wrong way ${straight + 1 === 3 ? "three" : straight + 1} straight weeks`
          : last != null && seasonLow
            ? `the share just fell to a season low`
            : `the share is moving the wrong way`) +
        `. Name value currently exceeds trajectory.`,
      proof: [
        { value: signed(row.ts.delta ?? 0), caption: `target share pts since ${base}` },
        ...(last != null
          ? [{ value: `${last.toFixed(1)}%`, caption: `W${lastWeek} share${seasonLow ? " — season low" : ""}` }]
          : []),
      ],
    };
  }

  const snapWord = row.snap.direction === "down" ? "a shrinking" : "a flat";
  const rzSince = p.weekly
    .filter((w) => row.ts.baseWeek == null || w.week > row.ts.baseWeek)
    .reduce((s, w) => s + (w.rz ?? 0), 0);
  return {
    label: "Watch",
    body: `Under ${Math.ceil((p.targetShare ?? 0) / 5) * 5 || 5}% target share on ${snapWord} snap count. One more quiet week and he's droppable in 12-team leagues; an injury above him is the fastest path back.`,
    proof: [
      ...(last != null ? [{ value: `${last.toFixed(1)}%`, caption: `W${lastWeek} target share` }] : []),
      { value: String(rzSince), caption: `RZ touches since ${base}` },
    ],
  };
}

/* --------------------------------------------------------------------- FAQ */

export function targetShareFaq(view: UsageView, teamName: string): { question: string; answer: string } | null {
  const receivers = view.rows
    .filter((r) => r.player.pos !== "QB" && r.player.targetShare != null)
    .sort((a, b) => (b.player.targetShare ?? 0) - (a.player.targetShare ?? 0));
  const [lead, second] = receivers;
  if (!lead) return null;
  const t = lead.ts;
  const trendLine =
    t.delta == null || t.baseWeek == null
      ? ""
      : t.direction === "flat"
        ? `, holding steady since Week ${t.baseWeek}`
        : `, ${t.direction === "up" ? "up" : "down"} ${Math.abs(t.delta).toFixed(1)} points since Week ${t.baseWeek}`;
  return {
    question: `Who leads the ${teamName} in target share?`,
    answer:
      `${lead.player.name} leads the ${teamName} with a ${lead.player.targetShare!.toFixed(1)}% target share through Week ${view.throughWeek}${trendLine}.` +
      (second ? ` ${second.player.name} is second at ${second.player.targetShare!.toFixed(1)}%.` : ""),
  };
}
