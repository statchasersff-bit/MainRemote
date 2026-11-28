/**
 * The Stats tab's editorial summary (mak's brief, 2026-11-28): one headline
 * and one or two short paragraphs, written from the player's own numbers,
 * directly under the "{Name} Fantasy Football Stats" heading. It replaced
 * the generic "What His Career Numbers Say" read and the short "Rookie
 * season so far" block.
 *
 * Like the matchup recaps (recap-narrative.ts), no model is called: the
 * engine scores every story the data can support, picks the one with the
 * clearest evidence, and writes it from templates. Every figure is computed
 * here from the weekly game logs the career table sums, or read from the
 * advanced card (red-zone opportunities), so the copy cannot disagree with
 * the tables around it.
 *
 * The claims follow the brief's accuracy rules:
 *   - a comparison names both windows, and they never overlap (the last
 *     three appearances against the ones before them, never against a
 *     season average that contains them);
 *   - the metric keeps its name: carries plus targets are "carries and
 *     targets", red-zone opportunities are "red-zone opportunities";
 *   - appearances, ranked weeks and seasons are separate denominators;
 *   - ranks say their basis (weekly top-N finish, season finish by total
 *     points) and the scoring format is named;
 *   - no team-leadership claim (nothing here compares teammates), no
 *     "career high" without his first season in the data;
 *   - a missing snap count removes the snap sentence; nothing is filled in;
 *   - a season in progress says "through Week N", a finished one is past.
 */

import { getTeamByAbbreviation } from "../team/teams";

/* ------------------------------------------------------------------ input */

export interface StoryWeek {
  week: number;
  opp: string;
  /** His club that week (a traded season has two). */
  team: string;
  pts: number;
  passAtt: number; cmp: number; passYd: number; passTd: number; int: number;
  rushAtt: number; rushYd: number; rushTd: number;
  tgt: number; rec: number; recYd: number; recTd: number;
  /** His offensive snaps and his club's, when the log has both. */
  snaps: number | null;
  teamSnaps: number | null;
  /** Weekly positional finish, when the week is ranked. */
  posRank: number | null;
}

export interface StorySeason {
  season: number;
  inProgress: boolean;
  /** Appearances, in week order. */
  weeks: StoryWeek[];
  /** Season finish at the position by total points. */
  finish: number | null;
}

export interface StoryInput {
  name: string;
  last: string;
  pos: string;
  /** NFL experience (0 = rookie); null when unknown. */
  yearsExp: number | null;
  /** His current club's code, when he has one. */
  team: string | null;
  /** Still on a roster and playing this year or last; false = past tense. */
  active: boolean;
  format: "ppr" | "half" | "standard";
  leagueSeason: number;
  /** The league's latest logged week (0 before Week 1, 18+ after the season). */
  leagueWeek: number;
  /** His club's completed week, for "through Week N". */
  throughWeek: number;
  /** Seasons with at least one appearance, oldest first. */
  seasons: StorySeason[];
  /** His first season is in the data (career claims allowed). */
  fullCareer: boolean;
  /** Top-N weekly finish line at his position (24 RB/WR, 12 QB/TE). */
  topN: number;
  /** This season's red-zone opportunities and the week they run through. */
  redZone: { value: number; throughWeek: number | null } | null;
}

export interface StatsStory {
  /** Which story was told, for tests and debugging. */
  angle: string;
  headline: string;
  /** Plain text paragraphs (the renderer escapes them), unless `html`. */
  paragraphs: string[];
  /** The paragraphs are already HTML (an analyst's copy, through copyHtml). */
  html?: boolean;
}

/* ---------------------------------------------------------------- helpers */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = (n: number): string => (Number.isInteger(n) && n >= 0 && n <= 10 ? WORDS[n]! : String(n));
const one = (v: number): string => v.toFixed(1).replace(/^-/, "−");
const pct = (a: number, b: number): number => Math.round((a / b) * 100);
const plural = (n: number, noun: string, many = `${noun}s`): string => `${num(n)} ${n === 1 ? noun : many}`;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const sum = (ws: StoryWeek[], f: (w: StoryWeek) => number): number => ws.reduce((a, w) => a + f(w), 0);
const avg = (ws: StoryWeek[], f: (w: StoryWeek) => number): number => (ws.length ? sum(ws, f) / ws.length : 0);
const thousands = (n: number): string => Math.round(n).toLocaleString("en-US");

function clubNick(code: string | null): string | null {
  if (!code) return null;
  return getTeamByAbbreviation(code)?.nickname ?? null;
}

/** "the Broncos'" for a possessive, "the 49ers'" too. */
const clubPossessive = (nick: string): string => `the ${nick}'`;

/** Snap share over a window, only when every week carries both counts. */
function snapShare(ws: StoryWeek[]): number | null {
  if (!ws.length || ws.some((w) => !w.snaps || !w.teamSnaps)) return null;
  return pct(sum(ws, (w) => w.snaps!), sum(ws, (w) => w.teamSnaps!));
}

/** The position's own volume: what "workload" means for him. */
interface Volume {
  of: (w: StoryWeek) => number;
  /** "carries and targets combined", for a sentence. */
  phrase: string;
  /** Smallest per-game change worth a headline. */
  min: number;
}

function volumeFor(pos: string): Volume {
  if (pos === "QB") return { of: (w) => w.passAtt, phrase: "pass attempts", min: 7 };
  if (pos === "RB") return { of: (w) => w.rushAtt + w.tgt, phrase: "carries and targets combined", min: 5 };
  return { of: (w) => w.tgt, phrase: "targets", min: 2.5 };
}

/* ----------------------------------------------------------------- engine */

interface Candidate {
  angle: string;
  score: number;
  write: () => StatsStory;
}

export function composeStatsStory(input: StoryInput): StatsStory | null {
  const { name, last, pos, seasons } = input;
  if (!seasons.length) return null;
  const vol = volumeFor(pos);
  const latest = seasons[seasons.length - 1]!;
  const current = latest.season === input.leagueSeason && input.leagueWeek > 0 ? latest : null;
  const live = current !== null && current.inProgress;
  const nick = clubNick(input.team);
  const rookie = input.yearsExp === 0;
  const scoring = input.format === "ppr" ? "PPR" : input.format === "half" ? "half-PPR" : "standard-scoring";
  const points = (v: number): string => `${one(v)} ${scoring} points`;
  const through = (s: StorySeason): string =>
    s.inProgress && input.throughWeek > 0 ? `through Week ${input.throughWeek}` : `in ${s.season}`;
  const Through = (s: StorySeason): string => cap(through(s));
  const ranked = (s: StorySeason): StoryWeek[] => s.weeks.filter((w) => w.posRank !== null);
  const finishLine = (s: StorySeason): string | null => {
    const r = ranked(s);
    if (r.length < 2) return null;
    const top = r.filter((w) => w.posRank! <= input.topN).length;
    return `${top === 0 ? "no" : num(top)} top-${input.topN} ${pos} ${top === 1 ? "finish" : "finishes"} in ${plural(r.length, "ranked week")}`;
  };
  const tds = (ws: StoryWeek[]): number => sum(ws, (w) => w.rushTd + w.recTd + (pos === "QB" ? w.passTd : 0));
  const subject = rookie ? "The rookie" : last;
  const candidates: Candidate[] = [];

  /* ---- no appearance this season ---- */
  // The season has started, the logs cover it, and he has no row: a fact
  // only when he is still on a roster (active) and has an earlier season.
  if (!current && input.active && input.leagueWeek > 0 && input.leagueWeek < 18 && latest.season < input.leagueSeason) {
    const s = latest;
    const fin = s.finish && !s.inProgress ? `, finishing ${pos}${s.finish} in total ${scoring} points` : "";
    return {
      angle: "zero-this-season",
      headline: `${last} has yet to play in ${input.leagueSeason}`,
      paragraphs: [
        `Through Week ${input.throughWeek || input.leagueWeek}, ${name} has not appeared in a game this season. ` +
          `His last action came in ${s.season}, when he averaged ${points(avg(s.weeks, (w) => w.pts))} over ${plural(s.weeks.length, "appearance")}${fin}.`,
      ],
    };
  }

  /* ---- one appearance in the season on the page ---- */
  const focus = current ?? latest;
  if (focus.weeks.length === 1) {
    const w = focus.weeks[0]!;
    const opp = clubNick(w.opp);
    const prior = seasons.length > 1 ? seasons[seasons.length - 2]! : null;
    const first = seasons.length === 1;
    const headline = live
      ? first
        ? `${last} has one NFL appearance so far`
        : `${last} has played once in ${focus.season}`
      : first
        ? `${last} made one NFL appearance, in ${focus.season}`
        : `${last} played once in ${focus.season}`;
    const body =
      `In Week ${w.week}${opp ? ` against the ${opp}` : ""}, ${name} ${gameLine(pos, w)}, finishing with ${points(w.pts)}.` +
      (prior && prior.weeks.length >= 3
        ? ` He averaged ${points(avg(prior.weeks, (x) => x.pts))} over ${plural(prior.weeks.length, "appearance")} in ${prior.season}.`
        : "");
    return { angle: "one-game", headline, paragraphs: [body] };
  }

  /* ---- 1. a recent change in workload, this season ---- */
  if (current && current.weeks.length >= 5) {
    const ws = current.weeks;
    const recent = ws.slice(-3);
    const before = ws.slice(0, -3);
    const a = avg(before, vol.of);
    const b = avg(recent, vol.of);
    const diff = b - a;
    const rel = Math.abs(diff) / Math.max(a, b, 1);
    // Same club across the stretch, so "the Broncos' backfield" is true.
    const sameClub = recent.every((w) => w.team === recent[0]!.team);
    if (before.length >= 2 && Math.abs(diff) >= vol.min && rel >= 0.3) {
      candidates.push({
        angle: diff > 0 ? "workload-up" : "workload-down",
        score: 5 + Math.min(rel, 1.5),
        write: () => {
          const club = sameClub ? clubNick(recent[0]!.team) : null;
          const up = diff > 0;
          const headline = workloadHeadline(pos, last, up, club);
          const snapsNow = snapShare(recent);
          const snapsThen = snapShare(before);
          const firstN = `his first ${num(before.length)}`;
          let p1 =
            `${name} has averaged ${one(b)} ${vol.phrase} over his last three appearances, ` +
            `${up ? "up" : "down"} from ${one(a)} across ${firstN}.`;
          if (snapsNow !== null && snapsThen !== null && Math.abs(snapsNow - snapsThen) >= 8) {
            p1 += ` He played ${snapsNow}% of ${club ? clubPossessive(club) : "his team's"} offensive snaps in those three games, after ${snapsThen}% before them.`;
          } else if (snapsNow !== null) {
            p1 += ` He played ${snapsNow}% of the offensive snaps in those three games.`;
          }
          const recentPts = avg(recent, (w) => w.pts);
          const p2Parts: string[] = [];
          const touchdowns = tds(ws);
          p2Parts.push(
            `The stretch produced ${points(recentPts)} a game. ${Through(current)}, ${subject === last ? "he" : "the rookie"} is averaging ${points(avg(ws, (w) => w.pts))} across ${plural(ws.length, "appearance")}` +
              (touchdowns > 0 ? ` and has scored ${plural(touchdowns, "touchdown")}.` : "."),
          );
          const rz =
            pos === "RB" && input.redZone && input.redZone.value > 0 && (input.redZone.throughWeek ?? input.throughWeek) === input.throughWeek
              ? `${input.redZone.value} red-zone opportunities (carries and targets inside the 20)`
              : null;
          const fl = finishLine(current);
          if (rz && fl) p2Parts.push(`He has ${rz} and ${fl}.`);
          else if (rz || fl) p2Parts.push(`He has ${rz ?? fl}.`);
          return { angle: up ? "workload-up" : "workload-down", headline, paragraphs: [p1, p2Parts.join(" ")] };
        },
      });
    }
  }

  /* ---- 2. a change from last season ---- */
  if (current && current.weeks.length >= 4 && seasons.length >= 2) {
    const prev = seasons[seasons.length - 2]!;
    if (prev.season === current.season - 1 && prev.weeks.length >= 6) {
      const a = avg(prev.weeks, (w) => w.pts);
      const b = avg(current.weeks, (w) => w.pts);
      const diff = b - a;
      const rel = Math.abs(diff) / Math.max(a, b, 1);
      if (Math.abs(diff) >= 3 && rel >= 0.25) {
        candidates.push({
          angle: diff > 0 ? "season-up" : "season-down",
          score: 4 + Math.min(rel, 1.5),
          write: () => {
            const up = diff > 0;
            const second = input.yearsExp === 1;
            const then = second ? `his rookie season in ${prev.season}` : `${prev.season}`;
            const headline = up
              ? second
                ? `${last} has taken a step forward in his second season`
                : `${last} is outscoring his ${prev.season} pace`
              : `${last} has fallen off his ${prev.season} pace`;
            const va = avg(prev.weeks, vol.of);
            const vb = avg(current.weeks, vol.of);
            let p1 =
              `${name} is averaging ${points(b)} per game ${through(current)}, ${up ? "up" : "down"} from ${one(a)} in ${then}.`;
            if (Math.abs(vb - va) >= vol.min * 0.6) {
              p1 += ` His workload moved with it: ${one(vb)} ${vol.phrase} a game, against ${one(va)} last season.`;
            } else {
              p1 += ` His workload has held at about ${one(vb)} ${vol.phrase} a game, so the change has come from what he has done with it.`;
            }
            const fl = finishLine(current);
            const touchdowns = tds(current.weeks);
            const p2 =
              touchdowns > 0 && fl
                ? `He has scored ${plural(touchdowns, "touchdown")} in ${plural(current.weeks.length, "appearance")} and has ${fl}.`
                : touchdowns > 0
                  ? `He has scored ${plural(touchdowns, "touchdown")} in ${plural(current.weeks.length, "appearance")}.`
                  : fl
                    ? `He has ${fl}.`
                    : "";
            return { angle: up ? "season-up" : "season-down", headline, paragraphs: p2 ? [p1, p2] : [p1] };
          },
        });
      }
    }
  }

  /* ---- 3. a distinctive role this season ---- */
  if (current && current.weeks.length >= 4) {
    const ws = current.weeks;
    const totalPts = sum(ws, (w) => w.pts);
    if (pos === "RB") {
      const tpg = avg(ws, (w) => w.tgt);
      const recPts = sum(ws, (w) => w.rec * (input.format === "ppr" ? 1 : input.format === "half" ? 0.5 : 0) + w.recYd / 10 + w.recTd * 6);
      if (tpg >= 4.5 && totalPts > 0 && recPts / totalPts >= 0.3) {
        candidates.push({
          angle: "rb-receiving",
          score: 2.8 + Math.min((tpg - 4.5) / 4, 0.8),
          write: () => ({
            angle: "rb-receiving",
            headline: `${last} is a regular target out of ${nick ? clubPossessive(nick) : "his team's"} backfield`,
            paragraphs: [
              `${name} has drawn ${sum(ws, (w) => w.tgt)} targets in ${plural(ws.length, "appearance")} ${through(current)}, ${one(tpg)} a game, ` +
                `and caught ${sum(ws, (w) => w.rec)} for ${thousands(sum(ws, (w) => w.recYd))} yards. ` +
                `Receiving accounts for ${pct(recPts, totalPts)}% of his ${scoring} points.`,
              `He is averaging ${points(avg(ws, (w) => w.pts))} a game` + (finishLine(current) ? ` and has ${finishLine(current)}.` : "."),
            ],
          }),
        });
      }
    }
    if (pos === "QB") {
      const ryd = sum(ws, (w) => w.rushYd);
      const rtd = sum(ws, (w) => w.rushTd);
      const rushPts = ryd / 10 + rtd * 6;
      if ((ryd / ws.length >= 30 || rtd >= 4) && totalPts > 0) {
        candidates.push({
          angle: "qb-rushing",
          score: 3 + Math.min(rushPts / totalPts, 0.5) * 2,
          write: () => ({
            angle: "qb-rushing",
            headline: `${last}'s legs are a big part of his fantasy value`,
            paragraphs: [
              `${name} has run for ${thousands(ryd)} yards${rtd ? ` and ${plural(rtd, "touchdown")}` : ""} in ${plural(ws.length, "appearance")} ${through(current)}, ` +
                `${pct(rushPts, totalPts)}% of his ${scoring} points. He has thrown for ${thousands(sum(ws, (w) => w.passYd))} yards with ` +
                `${plural(sum(ws, (w) => w.passTd), "touchdown pass", "touchdown passes")} and ${plural(sum(ws, (w) => w.int), "interception")}.`,
              `He is averaging ${points(avg(ws, (w) => w.pts))} a game` + (finishLine(current) ? ` and has ${finishLine(current)}.` : "."),
            ],
          }),
        });
      }
    }
    if (pos === "RB" && input.redZone && input.redZone.value >= 15) {
      const td = tds(ws);
      if (td >= 5) {
        candidates.push({
          angle: "rb-red-zone",
          score: 2.8,
          write: () => ({
            angle: "rb-red-zone",
            headline: `${last} is turning red-zone work into touchdowns`,
            paragraphs: [
              `${name} has ${input.redZone!.value} red-zone opportunities, carries and targets inside the 20, ${through(current)}, ` +
                `and has scored ${plural(td, "touchdown")} in ${plural(ws.length, "appearance")}. ` +
                `Touchdowns account for ${pct(td * 6, Math.max(totalPts, 1))}% of his ${scoring} points.`,
              `He is averaging ${points(avg(ws, (w) => w.pts))} a game` + (finishLine(current) ? ` and has ${finishLine(current)}.` : "."),
            ],
          }),
        });
      }
    }
  }

  /* ---- 4. a run of weekly finishes ---- */
  if (current) {
    const r = ranked(current);
    if (r.length >= 5) {
      const top = r.filter((w) => w.posRank! <= input.topN).length;
      const rate = top / r.length;
      if (rate >= 0.6 || (rate <= 0.15 && r.length >= 6)) {
        const strong = rate >= 0.6;
        candidates.push({
          angle: strong ? "finishes-strong" : "finishes-weak",
          score: 2.5 + Math.abs(rate - 0.4) * 2,
          write: () => {
            const ws = current.weeks;
            const best = [...ws].sort((x, y) => y.pts - x.pts)[0]!;
            const opp = clubNick(best.opp);
            return {
              angle: strong ? "finishes-strong" : "finishes-weak",
              // A headline only this player can carry: every week, his season
              // rank when it is elite, else the count itself.
              headline: strong
                ? top === r.length
                  ? `${last} has been a top-${input.topN} ${pos} every week he has been ranked`
                  : current.finish && current.finish <= 5
                    ? `${last} ranks ${pos}${current.finish} in total ${scoring} points`
                    : `${last} has posted ${num(top)} top-${input.topN} weeks this season`
                : top === 0
                  ? `${last} has yet to post a top-${input.topN} week this season`
                  : `Starter-level weeks have been rare for ${last}`,
              paragraphs: [
                `${name} has finished as a top-${input.topN} ${pos} in ${top === 0 ? "none" : top === r.length ? "all" : num(top)} of his ${plural(r.length, "ranked week")} ${through(current)}, ` +
                  `averaging ${points(avg(ws, (w) => w.pts))} a game` +
                  (strong && top !== r.length && current.finish && current.finish <= 5 ? `, and he ranks ${pos}${current.finish} in total ${scoring} points. ` : ". ") +
                  (strong
                    ? `His best came in Week ${best.week}${opp ? ` against the ${opp}` : ""}, when he ${gameLine(pos, best)}. That game was worth ${points(best.pts)}.`
                    : `He has averaged ${one(avg(ws, vol.of))} ${vol.phrase} a game.`),
              ],
            };
          },
        });
      }
    }
  }

  /* ---- 5. a career peak or a sustained stretch ---- */
  const done = seasons.filter((s) => !s.inProgress && s.weeks.length >= 8);
  const past = !input.active;
  if (done.length >= 3 && input.fullCareer) {
    // Consecutive top-N season finishes ending with the latest full season.
    const lastDone = done[done.length - 1]!;
    let streak = 0;
    for (let i = seasons.length - 1, y = lastDone.season; i >= 0; i--) {
      const s = seasons[i]!;
      if (s.inProgress) continue;
      if (s.season !== y || !s.finish || s.finish > seasonLine(pos)) break;
      streak += 1;
      y -= 1;
    }
    const full = done.filter((s) => s.weeks.length >= 10);
    const byPpg = [...(full.length >= 2 ? full : done)].sort((x, y) => avg(y.weeks, (w) => w.pts) - avg(x.weeks, (w) => w.pts));
    // A live season of four games or more usually says more about an active
    // player than his history does; the career leads when it does not.
    const liveStory = current !== null && current.weeks.length >= 4;
    const careerScore = (base: number): number => (past ? base + 1.5 : liveStory ? base - 1 : base + 0.8);
    const nowLine =
      liveStory && current
        ? `${Through(current)} in ${current.season}, he is averaging ${points(avg(current.weeks, (w) => w.pts))} a game` +
          (finishLine(current) ? ` with ${finishLine(current)}.` : ".")
        : null;
    const peak = byPpg[0]!;
    const next = byPpg[1]!;
    const gap = avg(peak.weeks, (w) => w.pts) - avg(next.weeks, (w) => w.pts);
    if (streak >= 3) {
      candidates.push({
        angle: "career-streak",
        score: careerScore(3.2),
        write: () => {
          const run = seasons.filter((s) => !s.inProgress).slice(-streak);
          const firstYear = run[0]!.season;
          const lastYear = run[run.length - 1]!.season;
          const ones = run.filter((s) => s.finish === 1).length;
          const p1 =
            streak <= 5
              ? `${name} finished ${listSeasons(run.map((s) => `${pos}${s.finish} in ${s.season}`))}, ranked by total ${scoring} points.`
              : `${name} finished inside the top ${seasonLine(pos)} at ${pos} in total ${scoring} points every season from ${firstYear} through ${lastYear}` +
                (ones >= 2 ? `, including ${num(ones)} ${pos}1 finishes.` : ".");
          return {
            angle: "career-streak",
            headline: `${last} ${past ? "finished" : "has finished"} as a top-${seasonLine(pos)} ${pos} in ${num(streak)} straight seasons`,
            paragraphs: [
              `${p1} His best per-game season was ${peak.season}, at ${points(avg(peak.weeks, (w) => w.pts))} over ${plural(peak.weeks.length, "game")}.`,
              ...(nowLine ? [nowLine] : []),
            ],
          };
        },
      });
    }
    if (gap >= 3) {
      candidates.push({
        angle: "career-peak",
        score: careerScore(2),
        write: () => ({
          angle: "career-peak",
          headline: `${last}'s ${peak.season} season ${past ? "was" : "remains"} his best`,
          paragraphs: [
            `${name} averaged ${points(avg(peak.weeks, (w) => w.pts))} per game over ${plural(peak.weeks.length, "game")} in ${peak.season}` +
              (peak.finish ? `, finishing ${pos}${peak.finish} in total points` : "") +
              `. His next-best full season was ${next.season}, at ${one(avg(next.weeks, (w) => w.pts))}.`,
            ...(nowLine ? [nowLine] : []),
          ],
        }),
      });
    }
  }

  /* ---- 6. a short season so far ---- */
  if (focus.weeks.length >= 2 && focus.weeks.length <= 3) {
    candidates.push({
      angle: "small-sample",
      score: 1.5,
      write: () => {
        const ws = focus.weeks;
        const best = [...ws].sort((x, y) => y.pts - x.pts)[0]!;
        const opp = clubNick(best.opp);
        const live2 = focus.inProgress;
        return {
          angle: "small-sample",
          headline: live2
            ? `${last}'s best game so far came in Week ${best.week}`
            : `${last} appeared in ${num(ws.length)} games in ${focus.season}`,
          paragraphs: [
            `${name} ${live2 ? "has appeared" : "appeared"} in ${plural(ws.length, "game")} ${through(focus)}, averaging ${points(avg(ws, (w) => w.pts))}. ` +
              `In Week ${best.week}${opp ? ` against the ${opp}` : ""}, he ${gameLine(pos, best)}, good for ${points(best.pts)}.`,
          ],
        };
      },
    });
  }

  /* ---- 7. steady: no change worth inventing ---- */
  if (focus.weeks.length >= 4) {
    candidates.push({
      angle: "steady",
      score: 1,
      write: () => {
        const ws = focus.weeks;
        const lv = focus.inProgress;
        const fl = finishLine(focus);
        const snaps = snapShare(ws);
        const v = avg(ws, vol.of);
        const club = nick && lv ? ` for the ${nick}` : "";
        // The figure that defines his role leads, so no two players share a
        // headline with only the name changed.
        const unit = pos === "QB" ? "pass attempts" : pos === "RB" ? "carries and targets" : "targets";
        const headline =
          snaps !== null && snaps < 45
            ? `${last} ${lv ? "is playing" : "played"} a part-time role${lv ? club : ` in ${focus.season}`}`
            : pos === "QB"
              ? `${last} ${lv ? "is averaging" : "averaged"} ${thousands(avg(ws, (w) => w.passYd))} passing yards a game${lv ? "" : ` in ${focus.season}`}`
              : `${last} ${lv ? "is seeing" : "saw"} ${one(v)} ${unit} a game${lv ? club : ` in ${focus.season}`}`;
        return {
          angle: "steady",
          headline,
          paragraphs: [
            `${name} ${lv ? "is averaging" : "averaged"} ${points(avg(ws, (w) => w.pts))} and ${one(v)} ${vol.phrase} a game ` +
              `${through(focus)}, across ${plural(ws.length, "appearance")}` +
              (fl ? `, with ${fl}.` : ".") +
              (snaps !== null ? ` He has played ${snaps}% of the offensive snaps in those games.`.replace("has played", lv ? "has played" : "played") : "") +
              (focus.finish && !lv ? ` He finished ${pos}${focus.finish} in total ${scoring} points.` : ""),
          ],
        };
      },
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.write() ?? null;
}

/** A season-finish line worth a streak: RB/WR 24, QB/TE 12. */
function seasonLine(pos: string): number {
  return pos === "RB" || pos === "WR" ? 24 : 12;
}

function listSeasons(items: string[]): string {
  return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function workloadHeadline(pos: string, last: string, up: boolean, club: string | null): string {
  const of = club ? `${clubPossessive(club)} ` : "";
  if (pos === "RB") return up ? `${last} takes on a bigger role in ${of}backfield` : `${last}'s role is shrinking in ${of}backfield`;
  if (pos === "QB") return up ? `${club ? `The ${club} are` : "His team is"} leaning on ${last}'s arm` : `${last} is throwing less often lately`;
  return up ? `${last} is drawing more targets${club ? ` in ${clubPossessive(club)} offense` : ""}` : `Targets have thinned out for ${last}`;
}

/** "caught 4 of 5 targets for 18 yards", "caught his only target for 5 yards". */
function catches(w: StoryWeek): string {
  const td = w.recTd ? ` and ${w.recTd === 1 ? "a" : num(w.recTd)} touchdown${w.recTd === 1 ? "" : "s"}` : "";
  if (w.tgt === 1) return w.rec ? `caught his only target for ${w.recYd} yards${td}` : "was targeted once without a catch";
  if (w.rec === w.tgt) return `caught all ${w.tgt} of his targets for ${w.recYd} yards${td}`;
  return `caught ${w.rec} of ${w.tgt} targets for ${w.recYd} yards${td}`;
}

/** One game's line, in the position's own terms, with no empty clauses. */
function gameLine(pos: string, w: StoryWeek): string {
  const parts: string[] = [];
  const tdPhrase = (n: number, kind: string): string => (n ? ` and ${n === 1 ? "a" : num(n)} ${kind}${n === 1 ? "" : "s"}` : "");
  if (pos === "QB") {
    parts.push(`completed ${w.cmp} of ${w.passAtt} passes for ${w.passYd} yards` + tdPhrase(w.passTd, "touchdown") + (w.int ? `, with ${plural(w.int, "interception")}` : ""));
    if (w.rushAtt >= 3 || w.rushTd) parts.push(`ran for ${w.rushYd} yards${tdPhrase(w.rushTd, "score")}`);
  } else if (pos === "RB") {
    if (w.rushAtt) parts.push(`carried ${w.rushAtt} ${w.rushAtt === 1 ? "time" : "times"} for ${w.rushYd} yards${tdPhrase(w.rushTd, "touchdown")}`);
    if (w.tgt) parts.push(catches(w));
  } else {
    if (w.tgt) parts.push(catches(w));
    if (w.rushAtt) parts.push(`ran ${w.rushAtt === 1 ? "once" : w.rushAtt === 2 ? "twice" : `${w.rushAtt} times`} for ${w.rushYd} yards${tdPhrase(w.rushTd, "touchdown")}`);
  }
  if (!parts.length) return pos === "QB" ? "did not attempt a pass" : "did not record a touch";
  return parts.join(", and ");
}
