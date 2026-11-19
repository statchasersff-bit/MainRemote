/**
 * The premium comparison version of the Offensive Coaching & Scheme top
 * block (mak's instructions, 2026-11-05): the coordinator profile, an
 * Offensive Identity strip (four tiles and one sentence; the review of
 * 2026-11-15, replacing the two takeaways that restated the tables), a Play
 * Calling section with its comparison table, and a Formations & Tempo
 * section with its table (no shotgun row) and the formation visual.
 *
 * Since 2026-11-05 ("keep the new designs") this IS the page's top block:
 * the original header, profile, KPI tiles and tendency tables were deleted
 * on 2026-11-10. The heading carries .sct-h2 so a section address
 * promotes it to the H1 (team-render.ts promoteHeading). Every number here is the
 * same row view the original tables draw (rowViews / changeText from
 * coaching-render.ts), so the two cannot disagree; no
 * data is fetched or computed twice. Styles are isolated under `.sct-cp-*`
 * (team.css) and never touch the original's rules.
 */

import { escapeHtml } from "../render";
import { premiumTabHead } from "./premium-head";
import { usageStyleHead } from "./coaching-premium-tendencies";
import {
  FORMATIONS_NOTE,
  GROUPS,
  KEEP_SUB,
  changeText,
  cityOf,
  num,
  rankWords,
  relNote,
  rowLabel,
  rowViews,
  schemeChip,
  seasonOf,
  splitTree,
  stintLine,
  surnameOf,
  type RowView,
} from "./coaching-render";
import { headshotImg } from "../headshot-html";
import { coachPhoto, getCoachingStaff, reliabilityRating, type TeamCoaching, type TendencyRow } from "./coaching";
import type { NflTeam } from "./teams";
import type { UsageView } from "./usage";

const e = escapeHtml;

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/* ------------------------------------------------------------------ icons */

/** Inline icons drawn in currentColor; the mockup's set: play diagram, football, target, layers, gauge, clipboard, bars, info. */
const ICON: Record<string, string> = {
  diagram: `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><path d="M5 9l6 6M11 9l-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="23" cy="9" r="3.2" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 25c5-9 12-9 17-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M22 19l4 2-1 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pass: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 19c1-8 7-14 16-15 -1 9-7 15-16 15z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 15l6-6M10 12l2 2M12 10l2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  target: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>`,
  motion: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3l9 4.5-9 4.5-9-4.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 17a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 17l4-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17" r="1.6" fill="currentColor"/></svg>`,
  play: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 3h6v3H9zM8 11l3 3M11 11l-3 3M13 15h3M13 18h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3l9 4.5-9 4.5-9-4.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  bars: `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2" y="11" width="4" height="7" fill="currentColor"/><rect x="8" y="7" width="4" height="11" fill="currentColor"/><rect x="14" y="3" width="4" height="15" fill="currentColor"/></svg>`,
  trend: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 12l4-4 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 5h3v3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  info: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7v4M8 4.8v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  /** The decorative wave under a KPI (a divider, not data). */
  wave: `<svg viewBox="0 0 100 18" width="100%" height="18" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12c12-8 22 2 34-2s22-10 34-4 20 6 32 2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  /** The faint play diagram on the header's right. */
};

/* --------------------------------------------------------------- overview */

/** The card's continuity line: the shared sentence, "caller" spelled out, both clauses capitalized, no period. */
function contNote(c: TeamCoaching, rating: ReturnType<typeof reliabilityRating>): string {
  const base = relNote(c, rating)
    .replace(/\.$/, "")
    .replace(/^Same caller as (\d{4}) · strong baseline$/, "Same play-caller as $1 · strong historical baseline");
  return base.replace(/ · (\w)/, (_m, ch: string) => ` · ${ch.toUpperCase()}`);
}

function profileCard(c: TeamCoaching, team: NflTeam): string {
  const [title] = c.playCaller.kicker.split(" · ");
  const staff = getCoachingStaff(team.abbreviation, seasonOf(c));
  const isHC = /head coach/i.test(title ?? "");
  const role = isHC ? "Head Coach & Play-Caller" : `${title ?? "Offensive Coordinator"} & Play-Caller`.replace(/^offensive coordinator/i, "Offensive Coordinator");
  const under = !isHC && staff?.hc ? `Under head coach ${staff.hc}` : "";
  // Phones print a short eyebrow and context line (mak, 2026-11-15): "OC /
  // Play-caller", "Under Mike Vrabel · third stint with New England".
  const roleShort = isHC
    ? "HC / Play-caller"
    : /^offensive coordinator$/i.test(title ?? "Offensive Coordinator")
      ? "OC / Play-caller"
      : `${title} / Play-caller`;
  const stint = stintLine(c, team);
  const contextShort = [!isHC && staff?.hc ? `Under ${staff.hc}` : "", under && stint ? stint.charAt(0).toLowerCase() + stint.slice(1) : stint].filter(Boolean).join(" · ");
  const tree = c.playCaller.tree ? splitTree(c.playCaller.tree) : null;
  const scheme = tree?.note ? schemeChip(tree.note) : null;
  const rating = reliabilityRating(c);
  const word = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" }[rating];
  // The club's own headshot beside the role and name (mak, 2026-11-10).
  const photo = headshotImg({
    src: coachPhoto(team.abbreviation, seasonOf(c), c.playCaller.name),
    className: "sct-cp-face",
    alt: c.playCaller.name,
    variants: ["160", "256", "320"],
    sizes: "80px",
    loading: "lazy",
  });
  return (
    `<div class="sct-cp-profile">` +
    `<div class="sct-cp-who${photo ? " has-face" : ""}">` +
    (photo ?? "") +
    `<div class="sct-cp-who-text">` +
    `<p class="sct-cp-kicker">${e(role)}</p>` +
    `<p class="sct-cp-kicker-short">${e(roleShort)}</p>` +
    `<p class="sct-cp-name">${e(c.playCaller.name)}</p>` +
    `</div></div>` +
    `<p class="sct-cp-pills">` +
    `<span class="sct-cp-pill"${tree?.note ? ` title="${e(tree.note)}"` : ""}>${e(tree ? tree.tag : "No established tree")}</span>` +
    (scheme ? `<span class="sct-cp-pill" title="${e(tree?.note ?? "")}">${e(scheme)}</span>` : "") +
    `</p>` +
    `<p class="sct-cp-context">${e([under, stint].filter(Boolean).join(" · "))}</p>` +
    (contextShort ? `<p class="sct-cp-context-short">${e(contextShort)}</p>` : "") +
    `<div class="sct-cp-cont">` +
    `<p class="sct-cp-cont-row"><span class="sct-cp-cont-label">Coaching continuity</span>` +
    /* A dot and a word, not a bar (mak, 2026-11-10): the rating is qualitative, so nothing should read as a score. */
    `<span class="sct-cp-cont-state is-${rating.toLowerCase()}"><span class="sct-cp-cont-dot" aria-hidden="true"></span>` +
    `<span class="sct-cp-cont-status is-${rating.toLowerCase()}">${e(word)}</span> continuity</span></p>` +
    `<p class="sct-cp-cont-note">${e(contNote(c, rating))}</p>` +
    `</div>` +
    `</div>`
  );
}

/** "▼ 2.5 pp vs 2025" / "▲ 1.4s faster than 2025": the change line, a triangle for direction. */
/* ----------------------------------------------------------------- tables */

/** The dumbbell: hollow prior, filled current, a tick for the NFL average; the same scale rule as the original strip. */
function dumbbell(row: TendencyRow, v: RowView, priorYear: string, season: number): string {
  const prior = num(row.prior);
  const now = num(v.current);
  const avg = num(row.nflAvg);
  if (prior == null || now == null) return "";
  const pts = avg == null ? [prior, now] : [prior, now, avg];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const half = Math.max((max - min) / 2, row.invert ? 2.5 : 5) * 1.35;
  const mid = (min + max) / 2;
  const x = (val: number) => {
    const p = Math.max(3, Math.min(97, ((val - (mid - half)) / (2 * half)) * 100));
    return row.invert ? 100 - p : p;
  };
  const a = x(prior);
  const b = x(now);
  const label = `${priorYear} ${row.prior}, ${season} ${v.current}${avg == null ? "" : `, NFL avg ${row.nflAvg}`}`;
  return (
    `<span class="sct-cp-db" role="img" aria-label="${e(label)}" title="${e(label)}">` +
    `<span class="sct-cp-db-bar is-${v.change.dir}" style="left:${Math.min(a, b).toFixed(1)}%;width:${Math.abs(b - a).toFixed(1)}%"></span>` +
    (avg == null ? "" : `<span class="sct-cp-db-avg" style="left:${x(avg).toFixed(1)}%" title="${e(`NFL avg ${row.nflAvg}`)}"></span>`) +
    `<span class="sct-cp-db-prior" style="left:${a.toFixed(1)}%"></span>` +
    `<span class="sct-cp-db-now" style="left:${b.toFixed(1)}%"></span>` +
    `</span>`
  );
}

/** Phone labels for the Play Calling and Formations & Tempo rows (mak, 2026-11-15); the full name stays in the button and its popover. */
const SHORT_LABEL: Record<string, string> = {
  passRate: "Pass Rate",
  proe: "PROE",
  earlyDownPassRate: "Early-Down Pass",
  rzPassRate: "Red-Zone Pass",
  paRate: "Play Action",
  motionRate: "Motion",
  noHuddleRate: "No-Huddle",
  pace: "Neutral Pace",
};

function table(
  views: Array<{ row: TendencyRow; v: RowView; i: number }>,
  c: TeamCoaching,
  team: NflTeam,
  priorYear: string,
  season: number,
): string {
  const callerLast = c.tendencies.priorLabel.match(/\((.+)\)$/)?.[1] ?? "";
  const newCaller = /prev/i.test(callerLast);
  const through = c.tendencies.samples?.throughWeek;
  const groupRows = GROUPS.map((g) => ({
    title: g.title,
    rows: g.keys.map((k) => views.find((x) => x.row.key === k)).filter((x): x is NonNullable<typeof x> => !!x),
  })).filter((g) => g.rows.length);
  const body = groupRows
    .map(({ title, rows: group }) => {
      // One gold row per group: its biggest move (3+ points, or a second of pace).
      const notable = group
        .filter(({ row, v }) => v.delta != null && Math.abs(v.delta) >= (row.key === "pace" ? 1 : 3))
        .sort((a, b) => Math.abs(b.v.delta as number) - Math.abs(a.v.delta as number))[0];
      const rows = group
        .map(({ row, v, i }) => {
          const s = c.tendencies.samples;
          const subText =
            row.key === "rzPassRate" && s?.rzPlays
              ? `${s.rzPlays} plays${s.priorRzPlays != null ? ` (${s.priorRzPlays} in ${priorYear})` : ""}`
              : row.sub && row.key && KEEP_SUB.has(row.key)
                ? row.sub
                : "";
          const sub = subText ? `<span class="sct-cp-sub">${e(subText)}</span>` : "";
          const chg = changeText(row, v);
          const pace = chg.match(/^(\d+(?:\.\d)?) seconds? (faster|slower)$/);
          const chgHtml = pace
            ? `<span class="sct-cp-chg-long">${e(chg)}</span><span class="sct-cp-chg-short" title="${e(chg)}"><span aria-hidden="true">${e(`${pace[2] === "faster" ? "−" : "+"}${pace[1]}s`)}</span><span class="sct-visually-hidden">${e(chg)}</span></span>`
            : e(chg);
          const words = rankWords(row, v);
          const rankTitle = words && v.of ? `${words} of ${v.of} offenses, ${season}${through ? ` through Week ${through}` : ""}` : "";
          const nfl =
            `<span class="sct-cp-nfl-avg">${e(row.nflAvg)}</span>` +
            (words
              ? `<span class="sct-cp-nfl-rank" title="${e(rankTitle)}">${e(`${v.tied ? "T-" : ""}${ordinal(v.rank as number)}`)}<span class="sct-cp-nfl-dir"> ${row.invert ? "fastest" : "highest"}</span><span class="sct-visually-hidden">${e(` of ${v.of}`)}</span></span>`
              : "");
          return (
            `<tr${row === notable?.row ? ` class="is-notable"` : ""}>` +
            `<th scope="row" class="sct-cp-td is-metric">${rowLabel(row, `sct-cp-def-${i}`, row.key ? SHORT_LABEL[row.key] : undefined)}${sub}</th>` +
            `<td class="sct-cp-td is-prior">${e(row.prior)}</td>` +
            `<td class="sct-cp-td is-now">${e(v.current)}</td>` +
            `<td class="sct-cp-td is-change"><span class="sct-cp-chg">${dumbbell(row, v, priorYear, season)}` +
            `<span class="sct-cp-chg-v"><span class="sct-cp-change is-${v.change.dir}">${chgHtml}</span></span></span></td>` +
            `<td class="sct-cp-td is-nfl">${nfl}</td>` +
            `</tr>`
          );
        })
        .join("");
      return `<tr class="sct-cp-group-row"><th scope="colgroup" colspan="5">${e(title)}</th></tr>${rows}`;
    })
    .join("");
  return (
    `<div class="sct-cp-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} offensive tendencies, ${season} vs ${priorYear}`)}">` +
    // is-play-calling / is-formations-tempo keep the phone table treatment
    // (short labels, fixed figure columns) the two tables had.
    `<table class="sct-cp-table is-tendencies is-play-calling is-formations-tempo">` +
    `<thead><tr>` +
    `<th scope="col">Metric</th>` +
    `<th scope="col" class="is-prior">${e(priorYear)}<span class="sct-cp-th-sub">${e(newCaller ? "Previous staff" : callerLast || "Prior season")}</span></th>` +
    `<th scope="col" class="is-now">${season}<span class="sct-cp-th-sub">${e(through ? `Thru Wk ${through}` : "Current")}</span></th>` +
    `<th scope="col">Change<span class="sct-cp-th-sub">${e(newCaller ? "vs previous staff" : `pts vs ${priorYear}`)}</span></th>` +
    `<th scope="col" class="is-nfl">NFL<span class="sct-cp-th-sub">Avg · rank</span></th>` +
    `</tr></thead><tbody>${body}</tbody></table></div>`
  );
}

/* --------------------------------------------------------------- insights */

/** Each tendency's move in words, after "Compared with 2025, New England is ...": [up, down]. Pace is seconds, so "up" is faster. */
const MOVE_WORDS: Record<string, [string, string]> = {
  passRate: ["throwing more overall", "throwing less overall"],
  proe: ["passing more than its situations predict", "throwing less than its situations predict"],
  earlyDownPassRate: ["throwing more on early downs", "running more on early downs"],
  rzPassRate: ["passing more near the goal line", "running more near the goal line"],
  paRate: ["using more play-action", "using less play-action"],
  motionRate: ["using more pre-snap motion", "using less pre-snap motion"],
  shotgunRate: ["lining up in shotgun more", "lining up under center more"],
  noHuddleRate: ["going no-huddle more", "going no-huddle less"],
  pace: ["playing faster", "playing slower"],
};

/**
 * One sentence for the whole offense: its three biggest moves (3+ points, or
 * a second of pace counted as 3), in words with no figure, since the tiles
 * and tables carry the numbers. Replaces the Play Calling Key Takeaway and
 * the Formations & Tempo takeaway (the review of 2026-11-15).
 */
function identitySentence(all: Array<{ row: TendencyRow; v: RowView }>, team: NflTeam, priorYear: string): string {
  const moved = all
    .filter(({ row, v }) => row.key && MOVE_WORDS[row.key] && v.delta != null && Math.abs(v.delta) >= (row.key === "pace" ? 1 : 3))
    .map(({ row, v }) => ({ key: row.key as string, d: v.delta as number, size: Math.abs(v.delta as number) * (row.key === "pace" ? 3 : 1) }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 3);
  const city = cityOf(team);
  if (!moved.length)
    return /^the /.test(priorYear)
      ? `${city} runs much like ${priorYear.replace(/ staff$/, " staff's")} offense: no tendency has moved 3 points or more.`
      : `${city} looks much like its ${priorYear} offense: no tendency has moved 3 points or more.`;
  const words = moved.map(({ key, d }) => MOVE_WORDS[key]![d > 0 ? 0 : 1]);
  const list = words.length < 2 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `Compared with ${priorYear}, ${city} is ${list}.`;
}

/* ----------------------------------------------------------------- public */

export function renderCoachingPremium(c: TeamCoaching, team: NflTeam, view: UsageView | null): string {
  const season = seasonOf(c);
  const priorYear = c.tendencies.priorLabel.match(/^\d{4}/)?.[0] ?? c.tendencies.priorLabel;
  const views = rowViews(c, view);
  const inTable = views.filter(({ row }) => row.key && GROUPS.some((g) => g.keys.includes(row.key as string)));
  const last = surnameOf(c);
  const possessive = /s$/.test(last) ? `${last}'` : `${last}'s`;
  const newCaller = /prev/i.test(c.tendencies.priorLabel);
  const through = c.tendencies.samples?.throughWeek;
  const window = `${season}${through ? ` through Week ${through}` : ""} vs ${priorYear}${newCaller ? ", when the previous staff called plays" : ""}`;
  const section = (title: string, icon: string, sub: string, body: string) =>
    `<section class="sct-cp-section">${usageStyleHead(title, icon, sub)}<div class="sct-cp-section-body">${body}</div></section>`;
  // Team Pages Phase 2 (2026-11-19): the four identity tiles, the Play
  // Calling and Formations & Tempo tables and the formation donut were one
  // set of figures printed up to three times; they are one table now, with
  // shotgun back as a row, the NFL average and a league rank on every row,
  // and the identity sentence as the summary over it.
  const how =
    `<details class="sct-cp-how"><summary>How these are measured</summary>` +
    `<p>Select a metric for its definition. Changes are percentage points (pts) between the two seasons; pace is seconds between snaps, and fewer is faster. ` +
    `NFL rank is among all ${views[0]?.v.of ?? 32} offenses in ${season}${through ? ` through Week ${through}` : ""}, from the same play-by-play and definitions: 1st is the highest rate, or the fastest pace; equal values share a rank (T-). ` +
    `In the bar, the hollow dot is ${e(priorYear)}, the filled dot ${season}, the tick the NFL average; the gold row is each group's biggest change of 3 pts or a second of pace.` +
    (newCaller ? ` ${e(priorYear)} was called by the previous staff, so a change here is a change of play-caller as much as a trend.` : "") +
    `</p><p>${e(FORMATIONS_NOTE)}</p></details>`;
  return (
    `<div class="sct-block sct-cp" id="coaching-premium" data-sct-premium="coaching">` +
    premiumTabHead({
      hook: "sct-cp-head",
      icon: "coaching",
      art: "coaching",
      heading: `<h2 class="sct-h2 sct-up-h2 sct-cp-h2">Offensive Coaching &amp; Scheme</h2>`,
      phoneTitle: "Offensive Coaching & Scheme",
      dek: "Play-calling tendencies, offensive philosophy, formations, and coaching history.",
    }) +
    `<div class="sct-cp-overview is-coach-only">${profileCard(c, team)}</div>` +
    (inTable.length
      ? section(
          "Offensive Tendencies",
          ICON["play"]!,
          `How ${possessive} offense calls and lines up, ${window}`,
          `<p class="sct-cp-id-line">${e(identitySentence(inTable, team, newCaller ? `the ${priorYear} staff` : priorYear))}</p>` +
            table(inTable, c, team, priorYear, season) +
            how,
        )
      : "") +
    `</div>`
  );
}
