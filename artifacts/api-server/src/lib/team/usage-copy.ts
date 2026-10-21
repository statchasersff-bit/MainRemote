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
  baseLabel,
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

export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "a" or "an" before a number as it is read aloud: an 8, an 11, an 18, an 80. */
export function art(n: number | string | null, cap = false): string {
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

export function environmentCards(view: UsageView, city = "The offense"): EnvCard[] {
  const { env } = view.team;
  const cards: EnvCard[] = [];
  const good = (rank: number | null) => rank != null && rank <= 12;

  if (env.proe.value != null && env.proe.rank != null) {
    const v = env.proe.value;
    const note =
      v >= 3
        ? "Throws more than situations call for, so there are more pass attempts to share."
        : v <= -3
          ? "Runs more than situations call for, so there are fewer pass attempts to share."
          : v <= -1
            ? "Slightly run-leaning for the situation, so target concentration matters more than pass volume."
            : v >= 1
              ? "Slightly pass-leaning for the situation, so target distribution matters more than pass volume."
              : "Play-calling is near expectation, so target distribution matters more than pass volume.";
    cards.push({ label: "Pass rate over expected", value: `${signed(v)}%`, rank: ordinal(env.proe.rank), good: good(env.proe.rank), note });
  }

  if (env.rzPassRate.value != null && env.rzPassRate.rank != null) {
    const rank = env.rzPassRate.rank;
    const ez = [...view.all].filter((p) => p.pos !== "QB").sort((a, b) => b.ezTargets - a.ezTargets)[0];
    const rzLeader = view.rows.find((r) => r.leadsRz)?.player;
    let note: string;
    if (rank <= 10) {
      note =
        ez && ez.ezTargets > 0
          ? `${city} throws often inside the 20; ${surname(ez.name)} leads the team with ${ez.ezTargets} end-zone target${ez.ezTargets === 1 ? "" : "s"}.`
          : `${city} throws often inside the 20, so red-zone targets are live for the whole tree.`;
    } else if (rank >= 23) {
      // A team rate supports a team conclusion: fewer red-zone targets to go
      // around. Who runs it in, and what that does to whom, is not in it.
      note = `${city} runs inside the 20, passing on ${env.rzPassRate.value.toFixed(0)}% of red-zone plays, which limits the red-zone targets to go around.`;
    } else {
      note = rzLeader
        ? `${city} is balanced inside the 20; ${surname(rzLeader.name)} leads the team with ${rzLeader.rzTouches} red-zone opportunities.`
        : `${city} is balanced inside the 20.`;
    }
    cards.push({ label: "Red-zone pass rate", value: `${env.rzPassRate.value.toFixed(0)}%`, rank: ordinal(rank), good: good(rank), note });
  }

  if (env.pace.value != null && env.pace.rank != null) {
    const rank = env.pace.rank;
    const note =
      rank <= 10
        ? "Faster pace creates more potential volume when drives are sustained."
        : rank >= 23
          ? "Slower pace caps the potential play volume."
          : "Seconds per play in neutral situations.";
    cards.push({ label: "Neutral pace", value: `${env.pace.value.toFixed(1)}s`, rank: `${ordinal(rank)} fastest`, good: good(rank), note });
  }

  // Stands in for the spec's 11-personnel rate: personnel groupings come from
  // participation data, which is published after the season. See buildUsage.mjs.
  if (env.playsPerGame.value != null && env.playsPerGame.rank != null) {
    const rank = env.playsPerGame.rank;
    const note =
      rank <= 10
        ? "More plays means more opportunity to distribute."
        : rank >= 23
          ? "Fewer plays to go around, so shares matter more."
          : "League-average volume, so shares decide it.";
    cards.push({ label: "Qualifying plays/game", value: env.playsPerGame.value.toFixed(1), rank: ordinal(rank), good: good(rank), note });
  }

  if (env.xfpPerGame.value != null && env.xfpPerGame.rank != null) {
    const rank = env.xfpPerGame.rank;
    // The number and rank speak for themselves in the middle of the league.
    const note =
      rank <= 8
        ? "High overall opportunity value gives more than one starter room to pay off."
        : rank >= 25
          ? "Low overall opportunity value puts more pressure on players to command large shares."
          : "";
    cards.push({ label: "Team xFP/game", value: env.xfpPerGame.value.toFixed(1), rank: ordinal(rank), good: good(rank), note });
  }

  return cards;
}

/* --------------------------------------------------------------- backfield */

export interface Takeaway {
  /** The bold opener; empty for a paragraph that continues the one above. */
  lead: string;
  /** Prose; **double asterisks** mark the numbers the renderer sets in bold. */
  body: string;
}

/** Share (0–100) a back holds of the room's work in one situation. */
export function situationShare(view: UsageView, p: UsagePlayer, key: keyof UsagePlayer["situation"]): number | null {
  const total = view.team.rbSituationTotals[key];
  return total ? Math.round((100 * p.situation[key]) / total) : null;
}

export interface HandcuffProjection {
  rb1: UsagePlayer;
  rb2: UsagePlayer;
  /** RB2's weighted opportunities per active game with RB1 out. */
  projected: number;
  /** RB2's projected share of the room's weighted opportunities. */
  projShare: number | null;
  grade: string;
  valuable: (p: UsagePlayer) => number;
  behind: number;
}

/**
 * The handcuff: RB1's work redistributed in proportion to who takes the
 * valuable (early-down and red-zone) carries + targets behind him. Shared by
 * the backfield takeaway and the FAQ so the two cannot quote different numbers.
 */
export function handcuffProjection(view: UsageView): HandcuffProjection | null {
  const [rb1, rb2] = view.rbs;
  if (!rb1 || !rb2 || (rb2.woppShare ?? 0) < 5 || rb1.woppPerGame == null || rb2.woppPerGame == null) return null;
  const others = view.rbs.slice(1);
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
  return { rb1, rb2, projected, projShare, grade, valuable, behind };
}

/**
 * The backfield paragraphs, in mak's compact wording (2026-10-20): the lead
 * back's workload with last season for scale, his receiving path, then the
 * handcuff math. The stat chips that used to carry the first of these are
 * gone; the numbers live in the prose.
 */
export function backfieldTakeaways(view: UsageView): Takeaway[] {
  const [rb1, rb2] = view.rbs;
  if (!rb1) return [];
  const out: Takeaway[] = [];
  const totals = view.team.rbSituationTotals;

  if (rb1.woppPerGame != null) {
    const rank = rb1.qualified ? rb1.leagueRank.rank : null;
    const d = rb1.lastSeasonWoppPerGame == null ? null : rb1.woppPerGame - rb1.lastSeasonWoppPerGame;
    const scale =
      d == null
        ? ""
        : d >= 1.5
          ? ` His workload is up **${signed(d)} weighted opportunities/game** from last season.`
          : d <= -1.5
            ? ` His workload is down **${Math.abs(d).toFixed(1)} weighted opportunities/game** from last season.`
            : ` His workload is level with last season (**${signed(d)} weighted opportunities/game**).`;
    out.push({
      lead: `${surname(rb1.name)}:`,
      body:
        `${rb1.woppPerGame.toFixed(1)} weighted opportunities per active game${rank ? `, RB${rank} in the NFL` : ""}, with ${rb1.hvt} high-value touch${rb1.hvt === 1 ? "" : "es"}.` +
        scale,
    });
  }

  // Who owns passing downs: third down when the sample can carry it, the
  // room's targets when it cannot.
  const thirdSample = totals.third >= 8;
  const passingOwner = thirdSample
    ? [...view.rbs].sort((a, b) => b.situation.third - a.situation.third)[0]
    : [...view.rbs].sort((a, b) => b.targets - a.targets)[0];
  const roomTargets = view.rbs.reduce((s, p) => s + p.targets, 0);
  const ownerShare = (p: UsagePlayer) =>
    thirdSample ? situationShare(view, p, "third") : roomTargets ? Math.round((100 * p.targets) / roomTargets) : null;
  const twoMin = (p: UsagePlayer) => (totals.twoMin >= 5 ? situationShare(view, p, "twoMin") : null);

  if (passingOwner && passingOwner !== rb1 && (ownerShare(passingOwner) ?? 0) >= 40) {
    const where = thirdSample
      ? `**${ownerShare(passingOwner)}% of the backs' third-down carries + targets**`
      : `**${ownerShare(passingOwner)}% of the backfield's targets**`;
    const tm = twoMin(passingOwner);
    out.push({
      lead: `Why ${surname(rb1.name)}'s reception count stays capped:`,
      body:
        `${passingOwner.name} has ${where}${tm != null && tm >= 40 ? ` and ${tm}% of the two-minute work` : ""}, ` +
        `so ${surname(rb1.name)}'s receptions have to come on other downs.`,
    });
  } else {
    const trailing = totals.trailing >= 6 ? situationShare(view, rb1, "trailing") : null;
    // His share of the room's carries + targets in every situation, to judge
    // whether the trailing split is holding up or shrinking. Opportunity, not
    // snaps: participation data (who was on the field) arrives after the season.
    const roomWork = view.rbs.reduce((s, p) => s + p.carries + p.targets, 0);
    const overall = roomWork ? Math.round((100 * (rb1.carries + rb1.targets)) / roomWork) : null;
    const path = thirdSample
      ? "His third-down role gives him receiving value even when rushing volume falls"
      : "His share of the backfield's targets gives him receiving value even when rushing volume falls";
    const script =
      trailing == null
        ? "."
        : overall == null || trailing >= overall * 0.75
          ? ", and his share holds up in negative game scripts."
          : ", though negative game scripts reduce his share of the backfield.";
    out.push({ lead: "", body: path + script });
  }

  // The handcuff: RB1's work redistributed in proportion to who takes the
  // valuable (early-down and red-zone) carries + targets behind him.
  const cuff = handcuffProjection(view);
  if (rb2 && cuff) {
    const { projected, projShare, grade } = cuff;
    const level = grade.startsWith("a top") ? "RB1-level volume" : grade.startsWith("an RB2") ? "RB2-level volume" : "flex-level volume at best";
    const startable = level !== "flex-level volume at best";
    const stash = view.rows.some((r) => r.player === rb2 && r.tier === "stash");
    out.push({
      lead: `If ${surname(rb1.name)} misses time:`,
      body:
        `${surname(rb2.name)} projects for ` +
        (projShare != null ? `roughly **${projShare}% of backfield weighted opportunities**, or about ` : "about ") +
        `**${projected.toFixed(1)} per active game** - ${level}` +
        (startable ? (stash ? " and why he remains a **stash**, not a cut." : ", worth a bench spot in deeper leagues.") : "."),
    });
  } else {
    out.push({
      lead: `No clear handcuff behind ${surname(rb1.name)}:`,
      body: `No other back has 5% of the backfield's weighted opportunities, so an absence would be settled on the waiver wire, not by a stash on your bench.`,
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

  const spread = `**${pctOf(runs.MID.att)}%** of runs have gone inside, versus **${pctOf(left)}% left** and **${pctOf(right)}% right**.`;
  const r = runs[best];
  const efficiency =
    ` ${GAP_LABEL[best].replace(" ", "-")} runs have been most efficient at **${r.ypc!.toFixed(1)} YPC**` +
    (r.att < 20 ? `, though on only ${r.att} attempts.` : ` on ${r.att} attempts.`);
  const side = best === "LE" || best === "LT" ? "left" : best === "MID" ? null : "right";
  const longest = rb1?.longestRuns ?? [];
  const onSide = side ? longest.filter(([, gap]) => (side === "left" ? gap === "LT" || gap === "LE" : gap === "RT" || gap === "RE")).length : 0;
  const longestLine =
    side && rb1 && longest.length >= 3 && onSide >= 2
      ? ` ${onSide === 3 ? "All three" : "Two"} of ${surname(rb1.name)}'s three longest runs came off the ${side} side.`
      : "";
  return spread + efficiency + longestLine;
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

/**
 * The pass-map paragraphs (mak's wording, 2026-10-20): where the passer
 * lives, then the receiver whose targets live somewhere else. Zone YPAs stay
 * in the grid above; the prose names the zones.
 */
export function passNote(view: UsageView, qbName: string): string[] {
  const zones = view.team.zones;
  const best = bestZone(view);
  if (!best) return [];
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

  // The best sub-20-yard zone on a real sample: a September zone is ten
  // throws, not an "engine".
  const shortBest = (["SL", "SM", "SR"] as Zone[])
    .filter((k) => (zones[k]?.att ?? 0) >= 5 && zones[k]?.ypa != null)
    .sort((a, b) => zones[b]!.ypa! - zones[a]!.ypa!)[0];
  const shortOwner = shortBest ? zoneOwner(view, shortBest) : null;
  const zone = (k: Zone) => ZONE_LABEL[k].toLowerCase();
  const where = shortBest
    ? ` The ${zone(shortBest)}${shortOwner ? `, ${shortOwner}'s territory,` : ""} is his most efficient high-volume area` +
      (deepBest ? `, while the ${zone(deepBest)} is the most explosive.` : ".")
    : deepBest
      ? ` The ${zone(deepBest)} is his most explosive zone.`
      : "";
  const first = `${qbName} keeps **${shortShare}% of throws under 20 yards**.` + where;
  const second =
    decoy && best.startsWith("S")
      ? `${surname(decoy.name)} has seen **${deepRate(decoy)}% of his targets deep**, even though only **${deepShare}% of ${qbName}'s throws** go 20+ yards downfield.`
      : "";
  return [first, second].filter(Boolean);
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
  const base = row.ts.baseWeek != null ? baseLabel(row.ts) : "the start";
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
    if (row.snap.delta != null && row.snap.delta > 0) proof.push({ value: signed(row.snap.delta, 0), caption: `snap share pts, last 3 vs ${baseLabel(row.snap)}` });
    if (row.ts.delta != null && row.ts.delta > 0) proof.push({ value: signed(row.ts.delta), caption: `target share pts, last 3 vs ${base}` });
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
        { value: signed(row.ts.delta ?? 0), caption: `target share pts, last 3 vs ${base}` },
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
