/**
 * The Coaching tab's Common questions - mak's brief (2026-11-03), written
 * from the same data the tab shows, by rule.
 *
 * The brief targets the searches around a club's offensive coordinator,
 * play-caller, scheme and tendencies, plus the fantasy questions this page
 * has unusually good data for. It templates across all 32 clubs, but the
 * questions bend to the data: a club with a new play-caller is asked "What
 * changed", a club with the same caller is asked how its tendencies have
 * moved and whether last season is a baseline. A question the data cannot
 * answer is left out rather than answered with a guess, and the list is
 * capped at sixteen (the brief: "12-16").
 *
 * Every number here is one the tab above shows: feed-backed rows read the
 * usage env block live, the way the tendencies table does, so an answer and
 * the table never disagree. The answers are plain text, because they are
 * the page's FAQPage entries too.
 */

import type { CoachingStaffEntry, TeamCoaching, TendencyRow } from "./coaching";
import { getTeamByAbbreviation, type NflTeam } from "./teams";
import { surname, type UsageView } from "./usage";
import { possessive } from "../player/title-case";
import { distributionModel, distributionPrints, rowView, seasonPeriod, yearsText } from "./coaching-render";
import type { FaqItem } from "./faq-block";

/* ---------------------------------------------------------------- helpers */

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

const ORDINAL_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinalWord = (n: number): string => ORDINAL_WORDS[n] ?? ordinal(n);

/** "Buffalo's", or "the Giants'" where two clubs share a city. */
const placeOf = (team: NflTeam): string =>
  /^(New York|Los Angeles)$/.test(team.city) ? `the ${team.nickname}'` : `${team.city}'s`;

/** "a, b and c" - the house list, no serial comma. */
const list = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const f1 = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** A stored cell as a number: "60.5%", "+2.4%", "−1.3%", "34.4s"; "-" is null. */
function num(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace("−", "-").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

interface RowNums {
  prior: number | null;
  current: number | null;
  nflAvg: number | null;
  rank: number | null;
}

/**
 * A row's numbers, with the feed-backed rows read live from the usage env
 * block - the same source the tendencies table draws its current column
 * from, so the FAQ cannot quote a number the table does not show.
 */
function rowNums(row: TendencyRow | undefined, view: UsageView | null, season?: number): RowNums {
  if (!row) return { prior: null, current: null, nflAvg: null, rank: null };
  // The table's own numbers (Team Pages Phase 2, 2026-11-19): both seasons
  // from the coaching file and the rank over the same 32 offenses, so an
  // answer can never quote a figure or rank the table does not show.
  const v = rowView(row, view, season);
  return { prior: num(row.prior), current: num(row.current), nflAvg: num(row.nflAvg), rank: v.rank };
}

/** "above", "slightly above", "in line with", ... for a rate against its league average. */
function versus(value: number, avg: number, near = 1, slight = 3): string {
  const d = value - avg;
  if (Math.abs(d) < near) return "in line with";
  if (Math.abs(d) < slight) return d > 0 ? "slightly above" : "slightly below";
  return d > 0 ? "above" : "below";
}

const moved = (delta: number, flat = 0.5): "risen" | "fallen" | "held" =>
  Math.abs(delta) < flat ? "held" : delta > 0 ? "risen" : "fallen";

/** The brief's phrasing for a headline move, by tendency key and direction. */
const SHIFT_PHRASE: Record<string, [up: string, down: string]> = {
  fourthGoRate: ["more aggressive on fourth down", "more conservative on fourth down"],
  rzPassRate: ["more pass-heavy in the red zone", "more run-heavy in the red zone"],
  paRate: ["heavier on play action", "lighter on play action"],
  passRate: ["more pass-heavy overall", "more run-heavy overall"],
  proe: ["more pass-leaning than the situation predicts", "more run-leaning than the situation predicts"],
  pace: ["faster-paced", "slower-paced"],
  earlyDownPassRate: ["more pass-heavy on early downs", "more run-heavy on early downs"],
  noHuddleRate: ["heavier on no-huddle", "lighter on no-huddle"],
  motionRate: ["more motion-heavy", "less motion-heavy"],
  shotgunRate: ["more shotgun-based", "more under-center"],
};

/** The same moves as things a fantasy manager watches. */
const SHIFT_NOUN: Record<string, [up: string, down: string]> = {
  fourthGoRate: ["aggressive fourth-down decisions", "conservative fourth-down decisions"],
  rzPassRate: ["increased red-zone passing", "increased red-zone rushing"],
  paRate: ["increased play-action rate", "reduced play-action rate"],
  passRate: ["higher overall pass rate", "lower overall pass rate"],
  proe: ["pass-leaning situational profile", "run-leaning situational profile"],
  pace: ["faster neutral pace", "slower neutral pace"],
  earlyDownPassRate: ["increased early-down passing", "increased early-down rushing"],
  noHuddleRate: ["increased no-huddle usage", "reduced no-huddle usage"],
  motionRate: ["increased pre-snap motion", "reduced pre-snap motion"],
  shotgunRate: ["heavier shotgun mix", "heavier under-center mix"],
};

/** A backfield bar's "'20 NE" as "the 2020 Patriots offense". */
function barName(label: string): string {
  const m = label.match(/^'(\d\d)\s+([A-Z]{2,3})$/);
  if (!m) return label;
  const year = 2000 + Number(m[1]);
  const code = { STL: "LAR", SD: "LAC", OAK: "LV" }[m[2]] ?? m[2];
  const club = getTeamByAbbreviation(code)?.nickname ?? m[2];
  return `the ${year} ${club} offense`;
}

/** The club in a dossier stop label, "Rams · OC" -> "Rams". */
const stopClub = (stop: string): string => stop.split(" · ")[0] ?? stop;

/* ------------------------------------------------------------------ main */

export function coachingFaq(
  c: TeamCoaching,
  team: NflTeam,
  view: UsageView | null,
  staff: CoachingStaffEntry | null,
): FaqItem[] {
  const season = parseInt(c.tendencies.currentLabel, 10);
  const prior = season - 1;
  const nick = team.nickname;
  const city = team.city;
  const full = `${city} ${nick}`;
  const place = placeOf(team);
  const caller = c.playCaller.name;
  const sur = surname(caller);
  const surPoss = possessive(sur);
  const wkMatch = c.scoreState.sub.match(/Week (\d+)/);
  // The snapshot's cutoff, as in the period line and the table (team audit,
  // 2026-11-24): a club on bye that week used to read one week earlier here.
  const wk = seasonPeriod(c).throughWeek ?? view?.throughWeek ?? (wkMatch ? Number(wkMatch[1]) : c.reliability.ledgerStats?.called ?? null);
  const through = wk ? `Through Week ${wk} of ${season}` : `In ${season}`;
  const returning = c.reliability.priorSeasonsAsCaller > 0;
  const priorSeasons = c.reliability.priorSeasonsAsCaller;
  const callerTitle = staff?.playCaller?.title ?? c.playCaller.kicker.split(" · ")[0] ?? "Offensive coordinator";
  const hcCalls = /head coach/i.test(callerTitle);
  const hc = staff?.hc ?? null;
  const oc = staff?.oc ?? c.staff.oc.name;
  const prevCaller = staff?.prevCaller ?? null;
  const abbr = team.abbreviation.toUpperCase();

  // Consecutive seasons on this club's call sheet, ending now (NE: 2025-26 = 2).
  const called = new Set<number>();
  for (const stop of staff?.callingStops ?? []) if (stop.team === abbr) for (const y of stop.seasons) called.add(y);
  let stint = 0;
  while (called.has(season - stint)) stint += 1;

  const row = (key: string) => c.tendencies.rows.find((r) => r.key === key);
  const nums = (key: string) => rowNums(row(key), view, season);
  // A fourth-down move on fewer than 15 opportunities is not a headline
  // change (mak's coaching brief, 2026-11-05); its own question states the sample.
  const smallFourth = (c.tendencies.samples?.fourthShortAll ?? 15) < 15;
  const shifts = c.shifts.filter((s) => s.key && (SHIFT_PHRASE[s.key] || SHIFT_NOUN[s.key]) && !(s.key === "fourthGoRate" && smallFourth));
  const shiftDir = (key: string): "up" | "down" | null => {
    const r = row(key);
    if (!r) return null;
    const n = rowNums(r, view, season);
    if (n.prior != null && n.current != null) {
      const d = n.current - n.prior;
      if (r.invert) return d < 0 ? "up" : "down";
      return d > 0 ? "up" : "down";
    }
    return r.change.dir === "flat" ? null : r.change.dir;
  };
  const shiftKeys = shifts.map((s) => s.key as string);
  const isShift = (key: string) => shiftKeys.includes(key);
  const shiftPhrases = shiftKeys
    .map((k) => {
      const dir = shiftDir(k);
      return dir ? SHIFT_PHRASE[k]?.[dir === "up" ? 0 : 1] ?? null : null;
    })
    .filter((p): p is string => p != null);
  const shiftNouns = shiftKeys
    .map((k) => {
      const dir = shiftDir(k);
      return dir ? SHIFT_NOUN[k]?.[dir === "up" ? 0 : 1] ?? null : null;
    })
    .filter((p): p is string => p != null);
  const than = returning ? `than it was in ${prior}` : `than the ${prior} staff was`;

  const out: FaqItem[] = [];
  const ask = (question: string, ...answer: Array<string | null>) => {
    const parts = answer.filter((p): p is string => !!p);
    if (parts.length) out.push({ question, answer: parts });
  };

  /* 1. The offensive coordinator. */
  const nth = (n: number) => (n <= 10 ? ordinalWord(n) : ordinal(n));
  const tenure = returning
    ? `This is ${surPoss} ${nth(priorSeasons + 1)} ${nick} season with play-calling responsibility` +
      (stint > 1 && !hcCalls ? `, and his ${ordinalWord(stint)} consecutive season as offensive coordinator` : "") +
      (hc && !hcCalls ? ` under head coach ${hc}.` : ".")
    : `It is his first season calling plays for the ${nick}` +
      (hc && !hcCalls ? ` under head coach ${hc}` : "") +
      (prevCaller ? `. In ${prior} the plays were called by ${prevCaller}.` : ".");
  if (hcCalls) {
    ask(
      `Who is the ${nick} offensive coordinator in ${season}?`,
      `${oc} is the ${full} offensive coordinator in ${season}, but head coach ${caller} is the primary offensive play-caller. ${tenure}`,
    );
  } else {
    ask(
      `Who is the ${nick} offensive coordinator in ${season}?`,
      `${oc} is the ${full} offensive coordinator and primary offensive play-caller in ${season}. ${tenure}`,
    );
  }

  /* 2. The play-caller. */
  ask(
    `Who calls plays for the ${nick} offense?`,
    `${caller} calls the offensive plays for the ${full}${hcCalls ? " as head coach" : ""}. ` +
      (returning
        ? `Because ${sur} also handled play-calling duties in ${prior}, last season provides a ${priorSeasons >= 2 ? "strong" : "useful"} baseline for evaluating how ${place} offensive tendencies have changed in ${season}.`
        : `${sur} took over the call sheet this season${prevCaller ? `; the ${prior} offense was called by ${prevCaller}` : ""}. Last season's tendencies therefore describe a different coach's offense, and the ${season} sample is the signal.`),
  );

  /* 3. The scheme. */
  const tree = staff?.tree ?? c.playCaller.tree;
  if (tree) {
    const shotgun = nums("shotgunRate");
    const motion = nums("motionRate");
    const pa = nums("paRate");
    const field: string[] = [];
    const leans: Array<{ name: string; d: number }> = [];
    // No figures (team audit, 2026-11-24): the tendencies table prints the
    // three rates and their NFL averages; the answer keeps the comparison.
    void field;
    if (shotgun.current != null && shotgun.nflAvg != null) leans.push({ name: "shotgun", d: shotgun.current - shotgun.nflAvg });
    if (motion.current != null && motion.nflAvg != null) leans.push({ name: "pre-snap motion", d: motion.current - motion.nflAvg });
    if (pa.current != null && pa.nflAvg != null) leans.push({ name: "play action", d: pa.current - pa.nflAvg });
    // One sentence of comparison after the figures (Team Pages Phase 2B,
    // 2026-11-19): it used to trail the list as ", below it on motion",
    // which read as broken. 2 points either way counts as above or below.
    const above = leans.filter((l) => l.d >= 2).map((l) => l.name);
    const below = leans.filter((l) => l.d <= -2).map((l) => l.name);
    const close = leans.filter((l) => Math.abs(l.d) < 2).map((l) => l.name);
    const all = leans.length === 3 ? "all three" : list(leans.map((l) => l.name));
    const parts = [
      above.length ? `above the league average on ${above.length === leans.length ? all : list(above)}` : "",
      below.length ? `below the league average on ${below.length === leans.length ? all : list(below)}` : "",
      close.length ? `close to it on ${close.length === leans.length ? all : list(close)}` : "",
    ].filter(Boolean);
    if (parts.length && /^close/.test(parts[0])) parts[0] = parts[0].replace("close to it", "close to the league average");
    const compareLine = parts.length ? `${through}, the ${nick} have been ${list(parts)}.` : null;
    ask(
      `What offensive scheme do the ${nick} run under ${caller}?`,
      `${surPoss} ${nick} offense comes out of the ${tree}.`,
      compareLine,
    );
  }

  /* 4. What changed, or how it has moved. */
  const pr = nums("passRate");
  const rz = nums("rzPassRate");
  const rates: string[] = [];
  if (pr.prior != null && pr.current != null) {
    const m = moved(pr.current - pr.prior);
    rates.push(m === "held" ? `overall pass rate has held near ${f1(pr.current)}%` : `overall pass rate has ${m} from ${f1(pr.prior)}% to ${f1(pr.current)}%`);
  }
  if (rz.prior != null && rz.current != null) {
    const m = moved(rz.current - rz.prior);
    rates.push(m === "held" ? `red-zone pass rate has held near ${f1(rz.current)}%` : `red-zone pass rate has ${m} from ${f1(rz.prior)}% to ${f1(rz.current)}%`);
  }
  const ratesLine = rates.length ? `The ${nick}' ${rates.join(", while the ")}.` : null;
  ask(
    returning ? `How has the ${nick} offense changed in ${season}?` : `What changed with the ${nick} offense in ${season}?`,
    shiftPhrases.length
      ? `${through}, ${city} has been ${list(shiftPhrases)} ${than}.`
      : `${through}, nothing in the ${nick}' tendency profile has moved far enough from ${prior} to count as a headline change${returning ? `: ${sur} is running the offense much as he did last season` : ""}.`,
  );
  // The pass-rate figures that followed repeated the table's first row (team audit, 2026-11-24).
  void ratesLine;

  /* 5. Pass-heavy? */
  const proe = nums("proe");
  if (pr.current != null && pr.nflAvg != null) {
    const proeRead =
      proe.current == null
        ? null
        : proe.current > 1
          ? "meaning they pass more than the down, distance and score would predict"
          : proe.current < -1
            ? "indicating a modest lean toward the run relative to game situation"
            : "right about what the situation predicts";
    ask(
      `Are the ${nick} a pass-heavy offense in ${season}?`,
      `The ${nick} have passed on approximately ${f1(pr.current)}% of their offensive plays in ${season}, ${versus(pr.current, pr.nflAvg)} the NFL average of roughly ${f1(pr.nflAvg)}%.`,
      proe.current != null
        ? `Their situation-adjusted pass rate over expected ${
            returning && proe.prior != null ? `has moved from ${proe.prior > 0 ? "+" : ""}${f1(proe.prior)}% in ${prior} to ` : "sits at "
          }${proe.current > 0 ? "+" : ""}${f1(proe.current)}%, ${proeRead}.`
        : null,
    );
  }

  /* 6. Play action. */
  const pa = nums("paRate");
  if (pa.current != null) {
    const lead =
      returning && pa.prior != null
        ? `${place} play-action rate has ${moved(pa.current - pa.prior) === "held" ? `held near ${f1(pa.current)}%` : `${moved(pa.current - pa.prior)} from ${f1(pa.prior)}% in ${prior} to ${f1(pa.current)}%`} of dropbacks in ${season}.`
        : `${city} has used play action on ${f1(pa.current)}% of dropbacks in ${season}${pa.prior != null ? `, against ${f1(pa.prior)}% for the ${prior} staff` : ""}.`;
    const vs = pa.nflAvg != null ? `${versus(pa.current, pa.nflAvg)} the roughly ${f1(pa.nflAvg)}% league-average rate` : null;
    ask(
      `How often do the ${nick} use play action?`,
      lead,
      isShift("paRate")
        ? `That is one of the clearest year-over-year changes in the ${nick} offense under ${sur}${vs ? ` and puts ${city} ${vs}` : ""}.`
        : vs
          ? `That puts ${city} ${vs}.`
          : null,
    );
  }

  /* 7. Fourth down. */
  const fourth = nums("fourthGoRate");
  const fourthRow = row("fourthGoRate");
  if (fourthRow) {
    // The samples the builder stores (2026-11-05), else the shift note's count.
    const smp = c.tendencies.samples;
    const snaps = c.shifts.find((s) => s.key === "fourthGoRate")?.note?.match(/(\d+) such snaps/);
    const count = smp?.fourthShortAll ?? (snaps ? Number(snaps[1]) : null);
    const went = smp?.fourthShortGo ?? null;
    const sample =
      count != null && count < 15
        ? ` The ${season} rate rests on ${went != null ? `${went} of ${count}` : count} such ${count === 1 ? "opportunity" : "opportunities"} so far, a small sample that can swing with one decision; fourth-down calls are game management shared with the head coach.`
        : "";
    if (fourth.current == null) {
      ask(
        `How aggressive are the ${nick} on fourth down?`,
        `The ${nick} have faced fewer than three fourth downs with two yards or fewer to gain in opponent territory ${wk ? `through Week ${wk}` : `in ${season}`}, too few to grade.` +
          (fourth.prior != null ? ` ${returning ? sur : `The ${prior} staff`} went for it on ${f1(fourth.prior)}% of them in ${prior}${fourth.nflAvg != null ? `, against a league average near ${f1(fourth.nflAvg)}%` : ""}.` : ""),
      );
    } else {
      const level =
        fourth.current >= 90
          ? "extremely aggressive"
          : fourth.current >= 75
            ? "aggressive"
            : fourth.current >= 50
              ? "about average"
              : "conservative";
      // The rates are on the Fourth-Down Decisions card; the answer keeps
      // the reading, the league comparison and the sample (team audit, 2026-11-24).
      const vsLeague =
        fourth.nflAvg == null
          ? ""
          : fourth.current - fourth.nflAvg >= 5
            ? `, more often than the league as a whole in ${season}`
            : fourth.current - fourth.nflAvg <= -5
              ? `, less often than the league as a whole in ${season}`
              : `, about as often as the league as a whole in ${season}`;
      const vsPrior =
        fourth.prior == null
          ? ""
          : ` ${returning ? `In ${prior} he` : `The ${prior} staff`} went for it ${fourth.prior - fourth.current >= 5 ? "more" : fourth.current - fourth.prior >= 5 ? "less" : "about as"} often${fourth.prior - fourth.current >= 5 || fourth.current - fourth.prior >= 5 ? "" : " as this offense"}.`;
      ask(
        `How aggressive are the ${nick} on fourth down?`,
        `The ${nick} have been ${level} on fourth-and-2 or less in opponent territory${vsLeague}.${vsPrior}${sample}`,
      );
    }
  }

  /* 8. Red zone. */
  if (rz.current != null) {
    const rankLine =
      rz.rank != null && rz.rank <= 10
        ? ` That is the ${rz.rank === 1 ? "highest" : `${ordinal(rz.rank)}-highest`} rate in the NFL.`
        : rz.rank != null && rz.rank >= 28
          ? ` That is the ${rz.rank === 32 ? "lowest" : `${ordinal(33 - rz.rank)}-lowest`} rate in the NFL.`
          : "";
    ask(
      `How often do the ${nick} pass in the red zone?`,
      `${city} has passed on ${f1(rz.current)}% of red-zone plays in ${season}` +
        (rz.prior != null ? `, ${rz.current > rz.prior ? "up" : rz.current < rz.prior ? "down" : "unchanged"} from ${f1(rz.prior)}% ${returning ? `in ${prior}` : `under the ${prior} staff`}` : "") +
        (rz.nflAvg != null ? `, and ${versus(rz.current, rz.nflAvg)} the league average of about ${f1(rz.nflAvg)}%` : "") +
        `.${rankLine}`,
      isShift("rzPassRate")
        ? `That makes red-zone ${shiftDir("rzPassRate") === "up" ? "passing" : "rushing"} one of the most significant tendency changes for the ${nick} this season.`
        : null,
    );
  }

  /* Distribution: the historical target tree. */
  // The card's model: the per-season prints, so the span here is the card's
  // title span, gaps included (team audit, 2026-11-24: the copy said "since
  // 2016" under a 2023-2026 title).
  const dm = distributionModel(c);
  const dist = (label: string) => dm.rows.find((r) => r.row.label === label)?.row;
  const rbRow = dist("Running backs");
  const wrRow = dist("Wide receivers");
  const teRow = dist("Tight ends");
  const trackedSeasons = dm.years.filter((y) => y < season).length;
  const hist = trackedSeasons >= 1;
  const scope = hist ? `Across ${surPoss} tracked play-calling seasons (${dm.span})` : `In ${season} so far`;
  const leans = [rbRow, wrRow, teRow]
    .filter((r): r is NonNullable<typeof r> => r != null && r.pct != null && r.nfl != null)
    .map((r) => ({ r, d: (r.pct ?? 0) - (r.nfl ?? 0) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const strongest = leans[0] && Math.abs(leans[0].d) >= 3 ? leans[0] : null;
  const leanPhrase = strongest
    ? strongest.r === rbRow
      ? strongest.d > 0
        ? "greater involvement for running backs in the passing game"
        : "a below-average share of targets for running backs"
      : strongest.r === wrRow
        ? strongest.d > 0
          ? "an above-average share of targets for wide receivers"
          : "a below-average wide receiver target share"
        : strongest.d > 0
          ? "heavier tight end usage in the passing game"
          : "a below-average share of targets for tight ends"
    : null;

  /* 9. Running backs. */
  if (rbRow?.pct != null && rbRow.nfl != null) {
    const d = rbRow.pct - rbRow.nfl;
    ask(
      `Does ${caller} target running backs often?`,
      d >= 3
        ? `Historically, yes. ${scope}, running backs have received approximately ${rbRow.pct}% of offensive targets, compared with a league-average rate of about ${rbRow.nfl}%.`
        : d <= -3
          ? `Less than most play-callers. ${scope}, running backs have received approximately ${rbRow.pct}% of offensive targets, compared with a league-average rate of about ${rbRow.nfl}%.`
          : `Not unusually. ${scope}, running backs have received approximately ${rbRow.pct}% of offensive targets, right around the league-average rate of about ${rbRow.nfl}%.`,
      d >= 3
        ? `${hist ? "His offenses have therefore tended to generate" : "The offense has generated"} more receiving opportunities for running backs than the typical NFL offense, although current personnel and game situations remain important.`
        : d <= -3
          ? `${hist ? "His offenses have sent" : "The offense has sent"} fewer targets to the backfield than the typical NFL offense, so a pass-catching back here needs the roster, not the scheme, to make the case.`
          : `Backfield receiving work here follows the roster more than the scheme, so weigh the current depth chart over ${hist ? "the coaching history" : "the early split"}.`,
    );
  }

  /* 10. Wide receivers or tight ends. */
  if (wrRow?.pct != null && wrRow.nfl != null && teRow?.pct != null && teRow.nfl != null) {
    // What the card's averages cannot show (team audit, 2026-11-24): how
    // many of his seasons lean the same way, each against that season's
    // league. The averages themselves are on the card above.
    const prints = distributionPrints(c);
    const pos = strongest ? (strongest.r === wrRow ? "WR" : strongest.r === teRow ? "TE" : "RB") : null;
    const same = pos && strongest
      ? prints.filter((p) => ((p.shares[pos] as number) - (p.league[pos] as number)) * Math.sign(strongest.d) >= 3)
      : [];
    const p = seasonPeriod(c);
    const live = dm.includesCurrent && p.partial ? ` ${season} is in progress (${p.partial}).` : "";
    ask(
      `Does ${caller} favor wide receivers or tight ends?`,
      strongest
        ? `${scope}, the strongest ${hist ? "historical " : ""}positional tendency ${strongest.r === rbRow ? "has instead been" : "has been"} ${leanPhrase}${hist ? "" : ", on one partial season"}.`
        : `${scope}, no position has run more than a few points from the league average, so the target tree follows the talent on the roster.`,
      strongest && prints.length > 1
        ? `${same.length} of his ${prints.length} tracked seasons (${yearsText(same.map((x) => x.year)) || "none"}) ran 3 pp or more ${strongest.d > 0 ? "above" : "below"} that season's league average at the position.${live}`
        : null,
    );
  }

  /* 11. Workhorse back. */
  // Starred bars ('23*) are a previous staff's seasons, context on the chart
  // but not this caller's record, so the FAQ leaves them out.
  const priorBars = c.backfield.bars.filter((b) => !b.current && !/\*$/.test(b.label));
  const prevStaffBars = c.backfield.bars.filter((b) => !b.current && /\*$/.test(b.label));
  const liveLead = view ? Math.max(0, ...view.rbs.map((p) => p.woppShare ?? 0)) : 0;
  const currentBar = c.backfield.bars.find((b) => b.current);
  const curShare = liveLead > 0 ? Math.round(liveLead) : currentBar?.value ?? null;
  if (curShare != null) {
    const note = c.backfield.note;
    const trend = /The trend is concentration/.test(note)
      ? `Mostly, yes. His lead backs' share has held or grown season over season, so a clear RB1 role is the pattern.`
      : /The trend is a spread/.test(note)
        ? `Less and less. His lead back's share has drifted down over his seasons, so committee risk is real.`
        : `There is no consistent workhorse pattern across ${surPoss} career.`;
    // The shares are on the backfield chart and in the season table; the
    // answer places this season against his range instead (team audit,
    // 2026-11-24: Detroit's lead-back share printed five times).
    void prevStaffBars;
    const lo = priorBars.length ? Math.min(...priorBars.map((b) => b.value)) : null;
    const hi = priorBars.length ? Math.max(...priorBars.map((b) => b.value)) : null;
    const bp = seasonPeriod(c);
    const when = bp.partial ? `in ${season} (${bp.partial})` : `in ${season}`;
    const vsRange =
      lo == null || hi == null
        ? null
        : curShare > hi
          ? `${place} lead back ${when} has a larger share than any of his previous lead backs.`
          : curShare < lo
            ? `${place} lead back ${when} has a smaller share than any of his previous lead backs.`
            : `${place} lead back ${when} sits inside the range of his previous seasons.`;
    void barName;
    ask(
      `Does ${caller} use a workhorse running back?`,
      priorBars.length ? trend : `${sur} has no prior tracked seasons as a play-caller, so the ${season} split is the only read on him.`,
      vsRange,
      "Weighted opportunities count carries plus twice the number of targets.",
    );
  }

  /* 12. Game script. */
  const state = (label: RegExp) => {
    const r = c.scoreState.rows.find((x) => label.test(x.label));
    const plays = r?.result?.match(/(\d+) plays/);
    return r?.share != null ? { share: r.share, plays: plays ? Number(plays[1]) : null } : null;
  };
  const leading = state(/^Leading/);
  const close = state(/^Within/);
  const trailing = state(/^Trailing/);
  if (leading && close && trailing) {
    const d = trailing.share - leading.share;
    const read =
      d >= 15
        ? "a sharp increase in passing when game script turns negative"
        : d >= 5
          ? "a moderate increase in passing when game script becomes negative"
          : d > -5
            ? "so game script has barely moved the play-calling"
            : "an unusual lean toward the run when behind";
    ask(
      `How does the ${nick} offense change when trailing?`,
      `${through}, ${city} has passed on approximately ${leading.share}% of plays when leading by seven or more and ${close.share}% when the score is within seven points.`,
      `That rate ${d > 0 ? "rises" : d < 0 ? "falls" : "holds"} to approximately ${trailing.share}% when the ${nick} trail by seven or more, ${read}.` +
        (trailing.plays != null && trailing.plays < 60 ? ` The trailing sample is ${trailing.plays} plays, so weigh it lightly.` : ""),
    );
  }

  /* 13. Pace. */
  const pace = nums("pace");
  if (pace.current != null) {
    const vs =
      pace.nflAvg != null
        ? pace.current - pace.nflAvg <= -1
          ? `faster than the NFL-average pace of about ${f1(pace.nflAvg)} seconds`
          : pace.current - pace.nflAvg >= 1
            ? `slower than the NFL-average pace of about ${f1(pace.nflAvg)} seconds`
            : `close to the NFL-average pace of about ${f1(pace.nflAvg)} seconds`
        : null;
    if (returning && pace.prior != null) {
      const d = pace.prior - pace.current;
      const verb = Math.abs(d) < 0.3 ? "held" : d > 0 ? "quickened" : "slowed";
      ask(
        `How fast do the ${nick} play on offense?`,
        `${place} neutral-situation pace has ${verb === "held" ? `held near ${f1(pace.current)} seconds per play` : `${verb} from approximately ${f1(pace.prior)} seconds per play in ${prior} to ${f1(pace.current)} seconds`} in ${season}.`,
        (verb === "held" ? "" : `That is a ${f1(Math.abs(d))}-second ${d > 0 ? "increase" : "decrease"} in tempo`) +
          (vs ? `${verb === "held" ? "That" : " and"} puts the ${nick} ${vs}.` : "."),
      );
    } else {
      ask(
        `How fast do the ${nick} play on offense?`,
        `${city} has averaged ${f1(pace.current)} seconds per play in neutral game situations in ${season}${pace.prior != null ? `, against ${f1(pace.prior)} seconds for the ${prior} staff` : ""}.`,
        vs ? `That puts the ${nick} ${vs}.` : null,
      );
    }
  }

  /* 14. Motion. */
  const motion = nums("motionRate");
  if (motion.current != null) {
    const d = motion.prior != null ? motion.current - motion.prior : null;
    ask(
      `How often do the ${nick} use pre-snap motion?`,
      `The ${nick} have used pre-snap motion on approximately ${f1(motion.current)}% of offensive plays in ${season}` +
        (motion.prior != null ? `, ${d! > 0 ? "up" : d! < 0 ? "down" : "unchanged"} from ${f1(motion.prior)}% ${returning ? `in ${prior}` : `under the ${prior} staff`}` : "") +
        ".",
      motion.nflAvg != null
        ? `That is ${versus(motion.current, motion.nflAvg)} the league-average rate of about ${f1(motion.nflAvg)}%` +
          (returning && d != null && d >= 2
            ? ` and indicates that motion has become a larger part of the current ${city} offense.`
            : returning && d != null && d <= -2
              ? ` and indicates that motion has become a smaller part of the current ${city} offense.`
              : ".")
        : null,
    );
  }

  /* 15. Historical success. */
  const past = c.dossier.flatMap((s) => (s.seasons ?? []).filter((y) => y.year < season).map((y) => ({ ...y, club: stopClub(s.stop) })));
  if (past.length >= 1) {
    const firsts = past.filter((y) => y.rank === 1);
    const topFive = past.filter((y) => y.rank != null && y.rank <= 5);
    const lows = past.filter((y) => y.rank != null && y.rank >= 25);
    const best = past.reduce((a, b) => (b.ppg > a.ppg ? b : a));
    const lowClubs = [...new Set(lows.map((y) => y.club))];
    const lead = firsts.length
      ? `${sur} has coordinated several of the NFL's highest-scoring offenses.`
      : topFive.length
        ? `${sur} has coordinated some of the NFL's better scoring offenses.`
        : best.rank != null && best.rank <= 12
          ? `${surPoss} offenses have mostly finished in the league's middle tier for scoring.`
          : `${surPoss} offenses have mostly finished in the lower half of the league for scoring.`;
    const firstClubs = [...new Set(firsts.map((y) => y.club))];
    const detail = firsts.length
      ? `His ${list(firstClubs)} offenses finished first in scoring in ${list(firsts.map((y) => String(y.year)))}` +
        (topFive.length > firsts.length ? `, and ${topFive.length - firsts.length === 1 ? "one other season" : `${topFive.length - firsts.length} other seasons`} ranked inside the NFL's top five in points per game.` : ".")
      : `His best finish was ${best.rank != null ? `${ordinal(best.rank)} of 32 in points per game` : "unranked in scoring"}, with the ${best.year} ${best.club}.`;
    const caveat = lowClubs.length
      ? ` His results have varied significantly by team and personnel, however, including lower-scoring seasons with the ${list(lowClubs)}.`
      : "";
    // This season against his past, not its figure again (team audit,
    // 2026-11-24: Detroit's points per game printed seven times), with its
    // partial status and games named.
    const current = c.dossier.find((s) => s.current)?.seasons?.find((y) => y.year === season);
    const cp = seasonPeriod(c);
    const bestPast = Math.max(...past.map((y) => y.ppg));
    const worstPast = Math.min(...past.map((y) => y.ppg));
    const where = current
      ? current.ppg > bestPast
        ? "more points per game than any of his previous offenses"
        : current.ppg < worstPast
          ? "fewer points per game than any of his previous offenses"
          : "within the range of his previous offenses in points per game"
      : "";
    ask(
      `How successful have ${surPoss} offenses been historically?`,
      lead,
      `${detail}${caveat}`,
      current && where ? `${cp.partial ? `Through Week ${cp.throughWeek} of ${season} (${cp.games ?? current.games} games, a season still in progress)` : `In ${season}`}, the ${nick} are scoring ${where}.` : null,
    );
  }

  /* 16. Fantasy. */
  const backfieldRead =
    curShare == null
      ? null
      : curShare >= 60
        ? `concentrated backfield (the lead back has ${curShare}% of weighted opportunities)`
        : curShare <= 45
          ? `split backfield (the lead back has only ${curShare}% of weighted opportunities)`
          : `current backfield split (the lead back has ${curShare}% of weighted opportunities)`;
  const watch = [...shiftNouns, ...(backfieldRead ? [backfieldRead] : [])];
  ask(
    `What does ${surPoss} offense mean for fantasy football?`,
    leanPhrase
      ? `For fantasy football, ${surPoss} strongest ${hist ? "historical tendency has been" : `tendency through Week ${wk ?? "-"} has been`} ${leanPhrase}` +
          (strongest && strongest.r !== wrRow && wrRow?.pct != null && wrRow.nfl != null && wrRow.pct - wrRow.nfl <= -2
            ? `, while wide receiver target share has generally run slightly below league average.`
            : ".")
      : `For fantasy football, ${surPoss} ${hist ? "offenses carry" : "offense carries"} no strong positional lean: ${hist ? "his target trees have" : "the target tree has"} followed the talent on the roster rather than the scheme.`,
    watch.length
      ? `For ${season} specifically, fantasy managers should also monitor ${place} ${list(watch)} rather than relying only on long-term coaching history.`
      : `For ${season} specifically, the tendency table above is the read: nothing has moved far enough from ${prior} to change the fantasy picture on its own.`,
  );

  /* 17. Last season as a baseline. */
  ask(
    `Is ${prior} a useful baseline for predicting the ${nick} offense in ${season}?`,
    returning
      ? `Yes. Because ${caller} remained ${place} primary play-caller from ${prior} into ${season}, the ${nick} have ${priorSeasons >= 2 ? "much more" : "more"} coaching continuity than teams that changed coordinators or play-callers.`
      : `Only with care. ${prevCaller ? `The ${prior} ${nick} offense was called by ${prevCaller}, and ${caller}` : caller} is new to the call sheet in ${season}, so last season's tendency numbers describe a different coach's offense.`,
    returning
      ? `That makes ${prior} a useful comparison point for identifying genuine changes in pass rate, pace, red-zone behavior, motion, play action and fourth-down aggressiveness.`
      : `The ${prior} column on this page is a reference for what changed, not a baseline to project from. The ${season} sample${wk ? `, through Week ${wk},` : ""} is the signal.`,
  );

  // Trimmed to the questions with distinct answers (mak, Team Pages Phase 2,
  // 2026-11-19): the rest restated one table row ("How often do the Patriots
  // use play action?") or another answer (who calls plays / who is the
  // coordinator; RB targets / WR or TE; the fantasy paragraph above). The
  // page's FAQPage is built from this list, so it still matches what shows.
  const DROP = [
    /^Who calls plays for /,
    /^Are the .* a pass-heavy offense /,
    /^How often do the .* use play action\?/,
    /^How often do the .* pass in the red zone\?/,
    /^Does .* target running backs often\?/,
    /^How does the .* offense change when trailing\?/,
    /^How fast do the .* play on offense\?/,
    /^How often do the .* use pre-snap motion\?/,
    /^What does .* offense mean for fantasy football\?/,
  ];
  return out.filter((q) => !DROP.some((re) => re.test(q.question)));
}
