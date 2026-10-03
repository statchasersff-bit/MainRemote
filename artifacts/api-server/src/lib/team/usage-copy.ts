/**
 * The Usage tab's words.
 *
 * Every sentence here is written from the numbers, by rule - there is no model
 * call and no per-team text file, so all 32 clubs re-write themselves each
 * week when the data does. The spec's editorial rule is the constraint on each
 * template: a line has to state a MECHANISM ("Johnson owns third downs, so
 * Cook's catches are capped"), not restate the number beside it. Where the data
 * cannot support a mechanism, the line says less rather than inventing one.
 *
 * Plain strings out; the renderer escapes them. `**…**` is not markup here -
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

/** "a" or "an" before a number as it is read aloud: an 8, an 11, an 18, an 80. */
function art(n: number | string | null, cap = false): string {
  const t = String(n);
  const an = /^8/.test(t) || /^1[18](\D|$)/.test(t);
  return cap ? (an ? "An" : "A") : an ? "an" : "a";
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
  const cards: EnvCard[] = [];
  const good = (rank: number | null) => rank != null && rank <= 12;

  if (env.proe.value != null && env.proe.rank != null) {
    const v = env.proe.value;
    const note =
      v >= 3
        ? `Throws more than game situations call for - more pass attempts to share among the pass-catchers`
        : v <= -3
          ? `Runs more than game situations call for - fewer pass attempts to share among the pass-catchers`
          : v <= -1
            ? `Slightly run-leaning relative to situation - target concentration matters more than raw pass volume here`
            : v >= 1
              ? `Slightly pass-leaning relative to situation - the target tree, not the play-calling, decides who eats`
              : `Throws about as much as situations call for - the target tree, not the play-calling, decides who eats`;
    cards.push({ label: "Pass rate over expected", value: `${signed(v)}%`, rank: ordinal(env.proe.rank), good: good(env.proe.rank), note });
  }

  if (env.rzPassRate.value != null && env.rzPassRate.rank != null) {
    const rank = env.rzPassRate.rank;
    const ez = [...view.all].filter((p) => p.pos !== "QB").sort((a, b) => b.ezTargets - a.ezTargets)[0];
    const rzLeader = view.rows.find((r) => r.leadsRz)?.player;
    let note: string;
    if (rank <= 10) {
      note = ez && ez.ezTargets > 0
        ? `Throws inside the 20 - ${surname(ez.name)}'s ${ez.ezTargets} end-zone target${ez.ezTargets === 1 ? "" : "s"} lead the team`
        : `Throws inside the 20 - red-zone targets are live for the whole tree`;
    } else if (rank >= 23) {
      // A team rate supports a team conclusion: fewer red-zone targets to go
      // around. Who runs it in, and what that does to whom, is not in it.
      note = `Run-heavy inside the 20 - passing on ${env.rzPassRate.value.toFixed(0)}% of red-zone plays limits the red-zone targets available to the receivers`;
    } else {
      note = rzLeader
        ? `Balanced inside the 20 - ${surname(rzLeader.name)} leads the team with ${rzLeader.rzTouches} red-zone opportunities`
        : `Balanced inside the 20`;
    }
    cards.push({ label: "Red-zone pass rate", value: `${env.rzPassRate.value.toFixed(0)}%`, rank: ordinal(rank), good: good(rank), note });
  }

  if (env.pace.value != null && env.pace.rank != null) {
    const rank = env.pace.rank;
    const note =
      rank <= 10
        ? "Seconds per play in neutral situations - faster neutral pace creates more potential play volume when drives are sustained"
        : rank >= 23
          ? "Seconds per play in neutral situations - slower neutral pace caps the potential play volume"
          : "Seconds per play in neutral situations";
    cards.push({ label: "Neutral pace", value: `${env.pace.value.toFixed(1)}s`, rank: `${ordinal(rank)} fastest`, good: good(rank), note });
  }

  // Stands in for the spec's 11-personnel rate: personnel groupings come from
  // participation data, which is published after the season. See buildUsage.mjs.
  if (env.playsPerGame.value != null && env.playsPerGame.rank != null) {
    const rank = env.playsPerGame.rank;
    const note =
      rank <= 10
        ? "Dropbacks and runs a game, kneels and spikes excluded - more plays to share among the starters"
        : rank >= 23
          ? "Dropbacks and runs a game, kneels and spikes excluded - fewer plays to go around, so shares matter more"
          : "Dropbacks and runs a game, kneels and spikes excluded - league-average volume, so shares decide it";
    cards.push({ label: "Qualifying plays / game", value: env.playsPerGame.value.toFixed(1), rank: ordinal(rank), good: good(rank), note });
  }

  if (env.xfpPerGame.value != null && env.xfpPerGame.rank != null) {
    const rank = env.xfpPerGame.rank;
    const note =
      "Combined expected fantasy production generated by the offense" +
      (rank <= 8
        ? " - high overall opportunity value gives more than one starter room to pay off"
        : rank >= 25
          ? " - low overall opportunity value puts more pressure on players to command large individual shares"
          : "");
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
      caption: `${surname(rb1.name)} weighted opps / active game${rank ? ` - RB${rank} in the NFL` : ""}`,
    });
  }
  chips.push({ value: String(rb1.hvt), caption: `${surname(rb1.name)} high-value touches (in-10 carries + receptions), season` });
  if (rb2 && rb2.woppPerGame != null) {
    chips.push({ value: rb2.woppPerGame.toFixed(1), caption: `${surname(rb2.name)} weighted opps / active game` });
  }
  if (rb1.woppPerGame != null && rb1.lastSeasonWoppPerGame != null) {
    const d = rb1.woppPerGame - rb1.lastSeasonWoppPerGame;
    const read =
      d >= 1.5 ? "role grew, not just efficiency" : d <= -1.5 ? "a smaller role than last season" : "the same role as last season";
    chips.push({ value: signed(d), caption: `${surname(rb1.name)} wOpp per active game vs. last season - ${read}` });
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
      ? `${ownerShare(passingOwner)}% of the backs' third-down carries + targets`
      : `${ownerShare(passingOwner)}% of the backfield's targets`;
    const tm = twoMin(passingOwner);
    out.push({
      lead: `Why ${surname(rb1.name)}'s reception count stays capped:`,
      body:
        `${passingOwner.name} has ${where}${tm != null && tm >= 40 ? ` and ${tm}% of the two-minute carries + targets` : ""}. ` +
        `${surname(rb1.name)}'s current receiving role is the smaller one: ${rb1.receptions} catch${rb1.receptions === 1 ? "" : "es"} through ${g} game${g === 1 ? "" : "s"} is ${art(catchPace)} ${catchPace}-catch pace. ` +
        `While ${who} holds most of the passing-down work, ${surname(rb1.name)}'s receptions have to come on other downs.`,
    });
  } else {
    const share = ownerShare(rb1);
    const trailing = totals.trailing >= 6 ? situationShare(view, rb1, "trailing") : null;
    // His share of the room's carries + targets in every situation, to judge
    // whether the trailing split is holding up or shrinking.
    const roomWork = view.rbs.reduce((s, p) => s + p.carries + p.targets, 0);
    const overall = roomWork ? Math.round((100 * (rb1.carries + rb1.targets)) / roomWork) : null;
    const games = rb1.games;
    out.push({
      lead: `${surname(rb1.name)}'s receiving role:`,
      body:
        (thirdSample
          ? `His third-down involvement (${share != null ? `${share}% of ` : ""}the backs' third-down carries + targets) gives him a receiving path even when rushing volume falls`
          : `His ${share != null ? `${share}% ` : ""}share of the backfield's targets gives him a receiving path even when rushing volume falls`) +
        `; ${rb1.receptions} catch${rb1.receptions === 1 ? "" : "es"} through ${games} game${games === 1 ? "" : "s"} is ${art(catchPace)} ${catchPace}-catch pace. ` +
        (trailing != null
          ? // Opportunity, not snaps: the split counts carries + targets, and
            // participation data (who was on the field) arrives after the season.
            overall == null || trailing >= overall * 0.75
            ? `Trailing by 7+, ${surname(rb1.name)} still receives ${trailing}% of the RB room's carries + targets, so his opportunity has not disappeared in negative game scripts.`
            : `Trailing by 7+, his share of the RB room's carries + targets drops to ${trailing}% (${overall}% overall), so negative game scripts cut into his work.`
          : ""),
    });
  }

  // The handcuff: RB1's work redistributed in proportion to who takes the
  // valuable (early-down and red-zone) carries + targets behind him.
  if (rb2 && (rb2.woppShare ?? 0) >= 5 && rb1.woppPerGame != null && rb2.woppPerGame != null) {
    const valuable = (p: UsagePlayer) => p.situation.early + p.situation.rz;
    const behind = others.reduce((s, p) => s + valuable(p), 0);
    const weight = behind ? valuable(rb2) / behind : 1 / Math.max(1, others.length);
    const projected = rb2.woppPerGame + rb1.woppPerGame * weight;
    // The share is over season totals, like the bar above: summing per-game
    // rates would overweight a back who missed games.
    const room = view.rbs.reduce((s, p) => s + p.wopp, 0);
    const projShare = room ? Math.round((100 * (rb2.wopp + rb1.wopp * weight)) / room) : null;
    const rank = rbRankFor(view.doc.rbWoppPool, projected);
    const grade =
      rank <= 12 ? "a top-12 weekly RB by volume" : rank <= 24 ? "an RB2 by volume" : "flex volume at best";
    const rb2Early = situationShare(view, rb2, "early");
    const rb2Rz = situationShare(view, rb2, "rz");
    const backs =
      rb3 && passingOwner === rb3
        ? `while ${surname(rb3.name)} keeps passing downs`
        : "";
    // A role is only claimed on a sample that can carry it: the room's
    // red-zone split is often two or three plays in September.
    const roles = [
      totals.early >= 10 && rb2Early != null && rb2Early >= 15 ? "early-down" : null,
      totals.rz >= 8 && rb2Rz != null && rb2Rz >= 15 ? "red-zone" : null,
    ].filter(Boolean) as string[];
    // Who inherits what: RB1's work goes to the backs behind him in
    // proportion to their early-down + red-zone work.
    const heirs = others
      .map((p) => ({ p, w: behind ? valuable(p) / behind : 1 / Math.max(1, others.length) }))
      .filter((h) => Math.round(100 * h.w) > 0);
    const split =
      heirs.length > 1
        ? ` (${heirs.map((h) => `${surname(h.p.name)} ${Math.round(100 * h.w)}%`).join(", ")}, by their shares of the early-down and red-zone carries + targets behind him)`
        : "";
    out.push({
      lead: `The ${surname(rb2.name)} math if ${surname(rb1.name)} misses time:`,
      body:
        (roles.length
          ? `${surname(rb2.name)} backs up the ${list(roles)} role${roles.length > 1 ? "s (the valuable ones)" : " (the valuable one)"}${backs ? ` ${backs}` : ""}. `
          : `${surname(rb2.name)} is next in line by weighted opportunities${backs ? `, ${backs}` : ""}. `) +
        `Our contingency model reallocates ${surname(rb1.name)}'s carries + targets to the backs behind him${split}, projecting ${surname(rb2.name)} for ~${projShare}% of backfield weighted opportunities (~${projected.toFixed(1)} per active game) if ${surname(rb1.name)} is inactive - ${grade}` +
        (grade.startsWith("a top") || grade.startsWith("an RB2")
          ? view.rows.some((r) => r.player === rb2 && r.tier === "stash")
            ? ` - and why he's a STASH, not a cut.`
            : ` - worth a bench spot in deeper leagues.`
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

/**
 * Run direction, described and never explained: the split says where the runs
 * went, not what the play-caller wanted (fronts, audibles and game state all
 * move it). No "engine", no "plan". Gap YPC is noisy, so the attempt count
 * rides along with it.
 */
export function runNote(view: UsageView): string {
  const runs = view.team.runs;
  const best = bestGap(view);
  if (!best) return "";
  const total = Object.values(runs).reduce((s, r) => s + r.att, 0);
  const pctOf = (n: number) => Math.round((100 * n) / total);
  const rb1 = view.rbs[0];
  const left = runs.LT.att + runs.LE.att;
  const right = runs.RT.att + runs.RE.att;
  const inside = pctOf(runs.MID.att);

  const spread = `${inside}% of designed runs have gone up the middle, ${pctOf(left)}% to the left (tackle + end) and ${pctOf(right)}% to the right.`;
  // A concentration claim needs a team sample worth the word.
  const lean =
    total < 20
      ? ""
      : inside >= 55
        ? " The run game has been concentrated inside so far."
        : pctOf(left) >= 40
          ? " The run game has leaned left so far."
          : pctOf(right) >= 40
            ? " The run game has leaned right so far."
            : "";
  const r = runs[best];
  const efficiency =
    ` ${GAP_LABEL[best].replace(" ", "-")} runs have produced the highest YPC so far: ${r.ypc!.toFixed(1)} on ${r.att} attempts` +
    (r.att < 20 ? ", a small sample" : "") +
    ".";
  const side = best === "LE" || best === "LT" ? "left" : best === "MID" ? null : "right";
  const longest = rb1?.longestRuns ?? [];
  const onSide = side ? longest.filter(([, gap]) => (side === "left" ? gap === "LT" || gap === "LE" : gap === "RT" || gap === "RE")).length : 0;
  const longestLine =
    side && rb1 && longest.length >= 3 && onSide >= 2
      ? ` ${onSide === 3 ? "All three" : "Two"} of ${surname(rb1.name)}'s three longest runs came off the ${side} side.`
      : "";
  return spread + lean + efficiency + longestLine;
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

export function passNote(view: UsageView, qbName: string, nickname: string): string {
  const zones = view.team.zones;
  const best = bestZone(view);
  if (!best) return "";
  const deepAtt = (["DL", "DM", "DR"] as Zone[]).reduce((s, k) => s + (zones[k]?.att ?? 0), 0);
  const allAtt = (Object.values(zones) as Array<{ att: number }>).reduce((s, v) => s + v.att, 0);
  const shortShare = allAtt ? Math.round((100 * (allAtt - deepAtt)) / allAtt) : null;
  // "Most explosive" only when a deep zone actually out-gains every short one.
  const shortTop = Math.max(0, ...(["SL", "SM", "SR"] as Zone[]).map((k) => zones[k]?.ypa ?? 0));
  const deepBest = (["DL", "DM", "DR"] as Zone[])
    .filter((k) => (zones[k]?.att ?? 0) >= 2 && zones[k]?.ypa != null && zones[k]!.ypa! > shortTop)
    .sort((a, b) => zones[b]!.ypa! - zones[a]!.ypa!)[0];

  const deepShare = allAtt ? Math.round((100 * deepAtt) / allAtt) : 0;
  // A deep-only receiver on a short-passing team: the mapped version of his
  // problem. Judged on his own deep-target rate (20+ air yards), not his aDOT:
  // an 18-yard average can hide zero deep targets or a mix of screens and bombs.
  const deepRate = (p: UsagePlayer) => (p.targets && p.deepTargets != null ? Math.round((100 * p.deepTargets) / p.targets) : null);
  const decoy = view.rows
    .map((r) => r.player)
    .filter(
      (p) =>
        (p.pos === "WR" || p.pos === "TE") &&
        (p.targetShare ?? 100) < 15 &&
        (p.deepTargets ?? 0) >= 2 &&
        (deepRate(p) ?? 0) >= 2 * deepShare,
    )
    .sort((a, b) => (deepRate(b) ?? 0) - (deepRate(a) ?? 0))[0];

  // The lead is the best sub-20-yard zone on a real sample, stated as exactly
  // that: a September zone is ten throws, not an "engine".
  const shortBest = (["SL", "SM", "SR"] as Zone[])
    .filter((k) => (zones[k]?.att ?? 0) >= 5 && zones[k]?.ypa != null)
    .sort((a, b) => zones[b]!.ypa! - zones[a]!.ypa!)[0];
  const shortOwner = shortBest ? zoneOwner(view, shortBest) : null;
  return (
    (shortBest
      ? `The ${ZONE_LABEL[shortBest].toLowerCase()} has been the ${nickname}' most efficient sub-20-yard area at ${zones[shortBest]!.ypa!.toFixed(1)} YPA on ${zones[shortBest]!.att} attempts` +
        (shortOwner ? `, ${shortOwner}'s territory` : "") +
        `. `
      : "") +
    `${qbName} keeps ${shortShare}% of his throws under 20 air yards` +
    (deepBest
      ? `, with the ${ZONE_LABEL[deepBest].toLowerCase()} his most explosive zone (${zones[deepBest]!.ypa!.toFixed(1)} YPA on ${zones[deepBest]!.att} attempt${zones[deepBest]!.att === 1 ? "" : "s"})`
      : "") +
    `. ` +
    (decoy && best.startsWith("S")
      ? `${surname(decoy.name)}'s fantasy problem, mapped: ${decoy.deepTargets} of his ${decoy.targets} targets (${deepRate(decoy)}%) have come 20+ yards downfield, the slice that is only ${deepShare}% of ${qbName}'s throws. `
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
  if (p.pos === "RB") return `RB${rank} in weighted opps per active game, NFL`;
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
  if (w >= 0.45) return "strong - elite at 0.60";
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
          ? ` He's scoring ${signed(fpoe)} points a game over expected - efficiency that may not repeat; his ${p.xfpPerGame} xFP a game is the opportunity underneath it.`
          : ` Production is running ${Math.abs(fpoe).toFixed(1)} points a game below the value of his opportunities - a potential regression signal if the role holds.`;

  if (p.pos === "QB") {
    const rushing = p.gzCarries >= 3 || (p.designedRunRate ?? 0) >= 8;
    const rushYards = p.rushYards ?? 0;
    const gp = Math.max(1, p.games);
    const xfpRank = p.leagueRank.rank ? ` (QB${p.leagueRank.rank} in expected points)` : "";
    if (rushing) {
      // His own carries only: the team's inside-the-10 pass rate counts every
      // runner, so it says nothing about how often HE keeps it.
      return {
        thesis: p.gzCarries >= 3 ? "The goal-line QB." : "The rushing floor.",
        body:
          ` ${p.gzCarries} carr${p.gzCarries === 1 ? "y" : "ies"} inside the 10, ${art(p.designedRunRate)} ${p.designedRunRate}% designed-run rate and ${rushYards} rushing yards through ${gp} game${gp === 1 ? "" : "s"}` +
          (p.gzCarries >= 3
            ? `: his rushing role adds goal-line touchdown equity on top of the passing${xfpRank}.`
            : `: designed runs add a rushing floor beyond scrambles${xfpRank}.`) +
          `${fpoeLine} ${tail}`,
      };
    }
    // A low designed-run rate is not a pocket passer: scrambles still add
    // rushing yards, so the copy only says "through the air" for the TDs.
    const inside = `${p.gzCarries} carr${p.gzCarries === 1 ? "y" : "ies"} inside the 10`;
    if (rushYards / gp >= 15 || (p.scrambleRate ?? 0) >= 6) {
      return {
        thesis: "Limited designed runs, real scramble yards.",
        body:
          ` ${surname(p.name)}'s designed rushing role is limited, but scrambling still adds meaningful floor: ${rushYards} rushing yards through ${gp} game${gp === 1 ? "" : "s"}.` +
          ` With ${p.gzCarries ? `only ${inside}` : "no carries inside the 10"}, however, most of his touchdown equity still comes through the passing game${xfpRank}.${fpoeLine} ${tail}`,
      };
    }
    return {
      thesis: "A pocket passer's profile.",
      body:
        ` ${rushYards} rushing yards through ${gp} game${gp === 1 ? "" : "s"} and ${inside}: his points come mostly through the air, so his weekly range follows the pass volume${xfpRank}.${fpoeLine} ${tail}`,
    };
  }

  if (p.pos === "RB") {
    const rb1 = view.rbs[0];
    if (row.tier === "stash" && rb1 && rb1 !== p) {
      return {
        thesis: "Contingent value, quantified.",
        body:
          ` The ${p.touchShare ?? 0}% touch share is standalone-flex-in-a-pinch at best; the real number is what it becomes if ${surname(rb1.name)} misses time - see The Backfield Split above. ${tail}`,
      };
    }
    if ((p.woppShare ?? 0) >= 65) {
      return {
        thesis: "The locked-in workhorse.",
        body:
          ` ${p.woppShare ?? 0}% of the backfield's weighted opportunities, ${p.rzOppShare ?? 0}% of the backs' red-zone carries + targets and ${p.gzCarries} carr${p.gzCarries === 1 ? "y" : "ies"} inside the 10.` +
          fpoeLine +
          ` ${tail}`,
      };
    }
    return {
      thesis: "A shared backfield.",
      body:
        ` ${p.woppShare ?? 0}% of the weighted opportunities means another back takes a real cut every week, so his weekly volume depends on how that split breaks.` +
        fpoeLine +
        ` ${tail}`,
    };
  }

  // WR / TE
  const ays = p.airYardsShare ?? 0;
  const ts = p.targetShare ?? 0;
  const adot = p.adot ?? 0;
  const fr = p.firstReadShare;
  const frLine = fr != null ? `${art(fr)} ${fr}% first-read share` : "";

  if (ays >= 30 && ts >= 20) {
    return {
      thesis: "The alpha profile, fully formed.",
      body:
        ` ${art(ays, true)} ${ays}% air-yards share is an alpha-level share of downfield opportunity${frLine ? `, ${frLine} shows he's regularly the first option` : ""}, and his targets have averaged ${adot} air yards.` +
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
        (fr != null && fr >= 20 ? `, with ${frLine} showing he's increasingly being featured as the first option` : "") +
        `. If the usage holds, his season totals understate his current role.` +
        fpoeLine +
        ` ${tail}`,
    };
  }
  if (adot >= 13 && ts < 15) {
    return {
      thesis: "Deep on average, small share.",
      body:
        // aDOT is an average and target share is a share of team targets: the
        // depth mix comes from his own deep-target count, and nothing here says
        // when he is on the field (that needs route data).
        ` His targets have come far downfield on average (${adot}-yard aDOT), but he has only ${ts}% of team targets` +
        (p.deepTargets != null && p.targets ? `; ${p.deepTargets} of his ${p.targets} were 20+ yards downfield` : "") +
        (fr != null && fr < 12 ? `, and ${art(fr)} ${fr}% first-read share means he's rarely the first option` : "") +
        `. The low target share limits the value of that downfield role. ${tail}`,
    };
  }
  if (adot > 0 && adot <= 7 && ays < 20) {
    return {
      thesis: `The ceiling problem in two numbers: ${art(ays)} ${ays}% air-yards share and ${art(adot)} ${adot} aDOT.`,
      body:
        ` ${adot < 6 ? "His targets are concentrated close to the line of scrimmage on average" : `He is being used primarily in the short area, with ${art(adot)} ${adot}-yard aDOT`}, so his yardage leans on what he gains after the catch` +
        (row.ts.direction === "down" && row.ts.confirmed ? ` - and the share itself is the one drifting down` : "") +
        `.` +
        fpoeLine +
        ` ${tail}`,
    };
  }
  if (ts < 12) {
    return {
      thesis: "Not enough of the pie.",
      body:
        ` ${art(ts, true)} ${ts}% target share is a small slice of the team's targets` +
        (frLine ? `, and ${frLine} says he's rarely the first option` : "") +
        `. A role expansion or an injury to one of the team's higher-volume target earners is the clearest path to more targets. ${tail}`,
    };
  }
  return {
    thesis: ts >= 20 ? "Volume you can set in the lineup." : "A starter's share without the alpha tag.",
    body:
      ` ${art(ts, true)} ${ts}% target share and ${p.xfpPerGame ?? 0} expected points a game` +
      (frLine && ays ? `, with ${frLine} and ${art(ays)} ${ays}% air-yards share` : frLine ? `, with ${frLine}` : ays ? `, with ${art(ays)} ${ays}% air-yards share` : "") +
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
        body: `The volume is there and the points aren't - yet. ${p.xfpPerGame} expected points a game against ${p.fpPerGame} actual is a gap worth investigating - if the role holds, it's a potential regression signal. Check why before you trade for him.`,
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
      body: "The role is arriving before the box score does. Trade for him this week - not after the two-touchdown game makes it obvious to your league.",
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
          ? [{ value: `${last.toFixed(1)}%`, caption: `W${lastWeek} share${seasonLow ? " - season low" : ""}` }]
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
    body: `Under ${Math.ceil((p.targetShare ?? 0) / 5) * 5 || 5}% target share on ${snapWord} snap count. One more quiet week and he's droppable in 12-team leagues. A role expansion - or an injury to one of the team's higher-volume target earners - is the clearest path back to consistent targets.`,
    proof: [
      ...(last != null ? [{ value: `${last.toFixed(1)}%`, caption: `W${lastWeek} target share` }] : []),
      { value: String(rzSince), caption: `RZ opportunities since ${base}` },
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
      `${lead.player.name} leads the ${teamName} with ${art(lead.player.targetShare!.toFixed(1))} ${lead.player.targetShare!.toFixed(1)}% target share through Week ${view.throughWeek}${trendLine}.` +
      (second ? ` ${second.player.name} is second at ${second.player.targetShare!.toFixed(1)}%.` : ""),
  };
}
