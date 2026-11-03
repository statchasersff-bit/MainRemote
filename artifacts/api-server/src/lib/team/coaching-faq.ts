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
function rowNums(row: TendencyRow | undefined, view: UsageView | null): RowNums {
  if (!row) return { prior: null, current: null, nflAvg: null, rank: null };
  const env = row.feed && view ? view.team.env[row.feed] : undefined;
  const current = env?.value != null ? Math.round(env.value * 10) / 10 : num(row.current);
  const m = row.change.text.match(/(\d+)(?:st|nd|rd|th) in NFL/);
  const rank = env?.rank ?? (m ? Number(m[1]) : null);
  return { prior: row.priorNum ?? num(row.prior), current, nflAvg: num(row.nflAvg), rank };
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
  const wk = view?.throughWeek ?? (wkMatch ? Number(wkMatch[1]) : c.reliability.ledgerStats?.called ?? null);
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
  const nums = (key: string) => rowNums(row(key), view);
  const shifts = c.shifts.filter((s) => s.key && (SHIFT_PHRASE[s.key] || SHIFT_NOUN[s.key]));
  const shiftDir = (key: string): "up" | "down" | null => {
    const r = row(key);
    if (!r) return null;
    const n = rowNums(r, view);
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
    if (shotgun.current != null) {
      field.push(`lined up in shotgun on ${f1(shotgun.current)}% of snaps`);
      if (shotgun.nflAvg != null) leans.push({ name: "shotgun", d: shotgun.current - shotgun.nflAvg });
    }
    if (motion.current != null) {
      field.push(`used pre-snap motion on ${f1(motion.current)}%`);
      if (motion.nflAvg != null) leans.push({ name: "motion", d: motion.current - motion.nflAvg });
    }
    if (pa.current != null) {
      field.push(`play action on ${f1(pa.current)}% of dropbacks`);
      if (pa.nflAvg != null) leans.push({ name: "play action", d: pa.current - pa.nflAvg });
    }
    const above = leans.filter((l) => l.d >= 2).map((l) => l.name);
    const below = leans.filter((l) => l.d <= -2).map((l) => l.name);
    const compare =
      leans.length === 0
        ? ""
        : above.length === leans.length
          ? ", above the league average on all three"
          : below.length === leans.length
            ? ", below the league average on all three"
            : above.length === 0 && below.length === 0
              ? ", close to the league average on all three"
              : `, ${[above.length ? `above the league average on ${list(above)}` : "", below.length ? `below it on ${list(below)}` : ""].filter(Boolean).join(" and ")}`;
    ask(
      `What offensive scheme do the ${nick} run under ${caller}?`,
      `${surPoss} ${nick} offense comes out of the ${tree}.`,
      field.length ? `On the field in ${season}, the ${nick} have ${list(field)}${compare}.` : null,
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
    ratesLine,
  );

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
    const snaps = c.shifts.find((s) => s.key === "fourthGoRate")?.note?.match(/(\d+) such snaps/);
    const sample = snaps ? ` That is ${snaps[1]} such snaps so far, so the rate can swing.` : "";
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
      ask(
        `How aggressive are the ${nick} on fourth down?`,
        `The ${nick} have been ${level} in short-yardage situations in opponent territory.`,
        `${through}, ${city} has gone for it on ${f1(fourth.current)}% of tracked fourth downs with two yards or fewer to gain in opponent territory` +
          (fourth.prior != null ? `, compared with ${f1(fourth.prior)}% ${returning ? `in ${prior}` : `for the ${prior} staff`}` : "") +
          (fourth.nflAvg != null ? ` and a league average near ${f1(fourth.nflAvg)}%` : "") +
          `.${sample}`,
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
  const dist = (label: string) => c.distribution.rows.find((r) => r.label === label);
  const rbRow = dist("Running backs");
  const wrRow = dist("Wide receivers");
  const teRow = dist("Tight ends");
  const trackedSeasons = c.dossier.reduce((n, s) => n + (s.prints?.filter((p) => p.year < season).length ?? 0), 0);
  const hist = trackedSeasons >= 1;
  const scope = hist ? `Across ${surPoss} play-calling seasons since 2016` : `In ${season} so far`;
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
    ask(
      `Does ${caller} favor wide receivers or tight ends?`,
      `${scope}, his offenses have sent about ${wrRow.pct}% of targets to wide receivers and ${teRow.pct}% to tight ends, compared with league averages of approximately ${wrRow.nfl}% and ${teRow.nfl}%.`,
      strongest
        ? `The strongest ${hist ? "historical " : ""}positional tendency ${strongest.r === rbRow ? "has instead been" : "has been"} ${leanPhrase}${hist ? "" : ", on one partial season"}.`
        : "No position runs more than a few points from league average, so the target tree follows the talent on the roster.",
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
    const lo = priorBars.length ? priorBars.reduce((a, b) => (b.value < a.value ? b : a)) : null;
    const hi = priorBars.length ? priorBars.reduce((a, b) => (b.value > a.value ? b : a)) : null;
    const range =
      lo && hi && lo !== hi
        ? `His lead backs have ranged from only ${lo.value}% of backfield weighted opportunities in ${barName(lo.label)} to roughly ${hi.value}% in ${barName(hi.label)}. `
        : lo
          ? `His lead back handled ${lo.value}% of backfield weighted opportunities in ${barName(lo.label)}. `
          : "";
    const prevRange =
      !priorBars.length && prevStaffBars.length
        ? ` The previous staff's lead back held ${Math.min(...prevStaffBars.map((b) => b.value))}% to ${Math.max(...prevStaffBars.map((b) => b.value))}% over the seasons before him.`
        : "";
    ask(
      `Does ${caller} use a workhorse running back?`,
      priorBars.length ? trend : `${sur} has no prior tracked seasons as a play-caller, so the ${season} split is the only read on him.`,
      `${range}${place} lead back has handled approximately ${curShare}% of weighted backfield opportunities in ${season}.${prevRange}`,
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
      : `His best finish was ${best.rank != null ? ordinal(best.rank) : "unranked"} in scoring with the ${best.year} ${best.club} (${f1(best.ppg)} points per game).`;
    const caveat = lowClubs.length
      ? ` His results have varied significantly by team and personnel, however, including lower-scoring seasons with the ${list(lowClubs)}.`
      : "";
    const current = c.dossier.find((s) => s.current)?.seasons?.find((y) => y.year === season);
    ask(
      `How successful have ${surPoss} offenses been historically?`,
      lead,
      `${detail}${caveat}`,
      current && wk ? `In ${season}, the ${nick} are averaging ${f1(current.ppg)} points per game through Week ${wk}${current.rank != null ? `, ${ordinal(current.rank)} in the NFL` : ""}.` : null,
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

  // The brief keeps 12-16. The motion question goes first when the list runs
  // long: the scheme answer already quotes the motion rate.
  if (out.length > 16) {
    const at = out.findIndex((q) => /pre-snap motion/.test(q.question));
    if (at >= 0) out.splice(at, 1);
  }
  return out.slice(0, 16);
}
