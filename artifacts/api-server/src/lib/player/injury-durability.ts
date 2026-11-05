/**
 * The Durability Profile card at the foot of the Injury tab (mak, 2026-10-30):
 * Redraft Command's player-page injury card, brought back home.
 *
 * Redraft Command built its card on data copied out of this repository
 * (data/injury-impact/) and on helpers ported from lib/injury-impact; this
 * module ports the card's own layer back - the region episodes, the written
 * account of each one, the quiet availability grid, the region pills and the
 * body figure's markers - and renders it server-side in the tab's house style.
 * client/player.ts (wireDurability) adds the two things markup cannot: the
 * figure recolored into the club's kit, and region selection shared between
 * the markers, the pills, the grid's outlined weeks and the open record.
 *
 * Only a player the durability set scores (drafted QB/RB/WR/TE since 2009)
 * gets the card; everyone else's tab ends where it did. The pure helpers are
 * exported for the tests.
 */
import { gsisForSleeper, getDurability, getPlayerSlice } from "../injury-impact/data";
import type { GmInjury, GmPlayer } from "../injury-impact/durability";
import { classify, REGIONS, regionChips, riskModel, severityColor, type Region } from "../injury-impact/player";
import type { InjuryRow, PlayerSlice } from "../injury-impact/types";
import { escapeHtml } from "../render";
import { assetUrl } from "../asset-origin";
import type { PlayerPageData } from "./player-data";
import type { PlayerRenderOptions } from "../player-render";
import { titleCase } from "./title-case";

/* ------------------------------------------------------------- episodes */

/** One injury episode in a body region, for the region's written account. */
export interface RegionEpisode {
  season: number;
  /** First week on the report, or the first game missed when no report row names it. */
  week: number | null;
  /** The injury as reported ("Hamstring", "Calf · Achilles"). */
  injury: string;
  gamesMissed: number;
  seasonEnding: boolean;
  ongoing: boolean;
  returnWeek: number | null;
  returnedInPlayoffs: boolean;
  /** Weeks named on the injury report. */
  reportWeeks: number;
  /** Worst game designation (Out > Doubtful > Questionable), when any. */
  worstStatus: string | null;
  /** Worst practice participation, short form ("Did Not Participate"), when any. */
  worstPractice: string | null;
  /** The play-by-play injury in the week before (or of) the first report. */
  inGame: { week: number | null; opponent: string; qtr: number | null; clock: string | null } | null;
}

const STATUS_RANK: Record<string, number> = { out: 3, doubtful: 2, questionable: 1 };
const practiceRank = (p: string): number => (/did not/i.test(p) ? 3 : /limited/i.test(p) ? 2 : /full/i.test(p) ? 1 : 0);
const formatInjury = (s: string): string => s.replace(/_/g, " ");

/**
 * A region's injury history as episodes, oldest first: each time-loss injury
 * on the durability timeline (scored and unscored seasons alike), joined to
 * the run of report weeks around it, and each run of report weeks that cost
 * no games (played through). A run breaks at a gap of more than two weeks.
 */
export function regionEpisodes(slice: Pick<PlayerSlice, "rows" | "inGame">, injuries: GmInjury[], regionKey: string): RegionEpisode[] {
  type Run = { season: number; weeks: number[]; phrases: string[]; status: string | null; practice: string | null };
  const bySeason = new Map<number, { week: number; phrase: string; row: InjuryRow }[]>();
  for (const row of slice.rows) {
    if (row.season == null || row.week == null) continue;
    const phrase = [row.reportPrimaryInjury ?? row.practicePrimaryInjury, row.reportSecondaryInjury ?? row.practiceSecondaryInjury]
      .filter((x): x is string => Boolean(x))
      .find((ph) => classify(ph).includes(regionKey));
    if (!phrase) continue;
    const list = bySeason.get(row.season) ?? [];
    list.push({ week: row.week, phrase: formatInjury(phrase), row });
    bySeason.set(row.season, list);
  }
  const runs: Run[] = [];
  for (const [season, list] of bySeason) {
    list.sort((a, b) => a.week - b.week);
    let run: Run | null = null;
    for (const m of list) {
      if (!run || m.week - run.weeks[run.weeks.length - 1]! > 2) {
        run = { season, weeks: [], phrases: [], status: null, practice: null };
        runs.push(run);
      }
      if (!run.weeks.includes(m.week)) run.weeks.push(m.week);
      if (!run.phrases.includes(m.phrase)) run.phrases.push(m.phrase);
      const st = m.row.reportStatus;
      if (st && (STATUS_RANK[st.toLowerCase()] ?? 0) > (STATUS_RANK[(run.status ?? "").toLowerCase()] ?? 0)) run.status = st;
      const pr = m.row.practiceStatus?.replace(/ in Practice$/i, "") ?? null;
      if (pr && practiceRank(pr) > practiceRank(run.practice ?? "")) run.practice = pr;
    }
  }

  const used = new Set<Run>();
  const episodes: RegionEpisode[] = [];
  for (const inj of injuries) {
    if (!classify(inj.bodyPart).includes(regionKey)) continue;
    const t = inj.timing;
    const out = Math.max(t.weeksOut ?? 0, inj.gm);
    // The report run that leads into this absence: it starts no more than
    // three weeks before the first game missed and no later than its end.
    const run = runs.find(
      (r) => !used.has(r) && r.season === inj.year && t.week != null && r.weeks[0]! >= t.week - 3 && r.weeks[0]! <= t.week + out,
    );
    if (run) used.add(run);
    episodes.push({
      season: inj.year,
      week: run ? Math.min(run.weeks[0]!, t.week ?? run.weeks[0]!) : t.week,
      injury: run ? run.phrases.join(" · ") : inj.bodyPart,
      gamesMissed: inj.gm,
      seasonEnding: t.seasonEnding,
      ongoing: t.ongoing,
      returnWeek: t.returnWeek,
      returnedInPlayoffs: t.returnedInPlayoffs,
      reportWeeks: run?.weeks.length ?? 0,
      worstStatus: run?.status ?? null,
      worstPractice: run?.practice ?? null,
      inGame: null,
    });
  }
  for (const r of runs) {
    if (used.has(r)) continue;
    episodes.push({
      season: r.season,
      week: r.weeks[0]!,
      injury: r.phrases.join(" · "),
      gamesMissed: 0,
      seasonEnding: false,
      ongoing: false,
      returnWeek: null,
      returnedInPlayoffs: false,
      reportWeeks: r.weeks.length,
      worstStatus: r.status,
      worstPractice: r.practice,
      inGame: null,
    });
  }
  for (const ep of episodes) {
    if (ep.week == null) continue;
    const g = slice.inGame.find(
      (e) => e.season === ep.season && e.seasonType === "REG" && e.week != null && e.week >= ep.week! - 1 && e.week <= ep.week!,
    );
    if (g) ep.inGame = { week: g.week, opponent: g.opponent, qtr: g.qtr, clock: g.clock };
  }
  return episodes.sort((a, b) => a.season - b.season || (a.week ?? 0) - (b.week ?? 0));
}

/** Season -> the weeks a region's injuries cost him: from the first week of
 *  each time-loss episode up to its return (or the season's end). The grid
 *  outlines only the missed games inside these weeks. */
export function regionLostWeeks(episodes: RegionEpisode[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const ep of episodes) {
    if (ep.gamesMissed <= 0) continue;
    const start = ep.week ?? (ep.inGame?.week != null ? ep.inGame.week + 1 : null);
    if (start == null) continue;
    const end = ep.returnWeek != null ? ep.returnWeek - 1 : 18;
    const key = String(ep.season);
    const list = out[key] ?? (out[key] = []);
    for (let w = start; w <= end; w += 1) list.push(w);
  }
  return out;
}

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" }) as Record<number, string>)[n % 10] ?? "th"}`;
const games = (n: number): string => `${n} game${n === 1 ? "" : "s"}`;
/** "right Elbow" -> "Right Elbow": the sources disagree on case. Only a
 *  lowercase word start changes, so "ACL" and "MCL" stay as they are. */
export const capitalizeWords = (s: string): string => s.replace(/(^|[\s/-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
/** "Week 12", or "Playoffs" past the regular season (17 weeks before 2021, 18 since). */
const weekName = (season: number, week: number): string => (week > (season >= 2021 ? 18 : 17) ? "Playoffs" : `Week ${week}`);

export type EpisodeTag = "First" | "Re-aggravated" | "Recurring";

/** One episode as a sentence or three: how, what it cost, first or recurring. */
export function tellEpisode(ep: RegionEpisode, prev: RegionEpisode | null, index: number, noun: string): { tag: EpisodeTag; text: string } {
  const parts: string[] = [];
  if (ep.inGame) {
    const when = ep.inGame.qtr != null ? ` (Q${ep.inGame.qtr}${ep.inGame.clock ? `, ${ep.inGame.clock}` : ""})` : "";
    parts.push(`Hurt during the Week ${ep.inGame.week} game vs ${ep.inGame.opponent}${when}.`);
  }
  if (ep.seasonEnding) {
    parts.push(ep.gamesMissed > 0 ? `Missed the rest of the season (${games(ep.gamesMissed)}).` : "Ended the season.");
  } else if (ep.ongoing) {
    parts.push(`Still out, ${games(ep.gamesMissed)} missed so far.`);
  } else if (ep.gamesMissed > 0) {
    const back = ep.returnWeek != null ? ` and returned in Week ${ep.returnWeek}` : ep.returnedInPlayoffs ? " and returned for the playoffs" : "";
    parts.push(`Missed ${games(ep.gamesMissed)}${back}.`);
  } else {
    const span = ep.reportWeeks > 1 ? ` across ${ep.reportWeeks} weeks on the report` : "";
    const practice = ep.worstPractice ?? "";
    if (ep.worstStatus) parts.push(`Listed ${ep.worstStatus}${span} but didn't miss a game.`);
    else if (/did not/i.test(practice)) parts.push(`Sat out practice${span} but didn't miss a game.`);
    else if (/limited/i.test(practice)) parts.push(`Limited in practice${span} but didn't miss a game.`);
    else parts.push(`Practiced fully${span}; no games missed.`);
  }
  if (index === 0) {
    parts.push(`First ${noun} issue on record.`);
    return { tag: "First", text: parts.join(" ") };
  }
  if (prev && prev.season === ep.season) {
    parts.push(`Re-aggravated in the same season as the ${prev.week != null ? `Week ${prev.week} ` : ""}injury.`);
    return { tag: "Re-aggravated", text: parts.join(" ") };
  }
  parts.push(`${ordinal(index + 1)} ${noun} issue; the last was in ${prev?.season}.`);
  return { tag: "Recurring", text: parts.join(" ") };
}

/* ---------------------------------------------------------------- model */

const TIER_COLOR: Record<GmPlayer["tier"]["key"], string> = {
  iron: "#10b981",
  moderate: "#d4af37",
  elevated: "#f97316",
  high: "#ef4444",
};

/**
 * Where each region's marker sits on the figure, as percentages of the
 * figure's 4:5 frame. Redraft Command's coordinates, given in its base
 * render's pixels (383 x 753) and converted here once. The archive records
 * no side, so a paired region is marked once, on the player's left (the
 * viewer's right).
 */
const FIGURE_W = 383;
const FIGURE_H = 753;
const IMG_W_PCT = (FIGURE_W / FIGURE_H / (4 / 5)) * 100;
const at = (x: number, y: number): { x: number; y: number } => ({
  x: (100 - IMG_W_PCT) / 2 + (x / FIGURE_W) * IMG_W_PCT,
  y: (y / FIGURE_H) * 100,
});
export const REGION_COORDS: Record<string, { x: number; y: number }> = {
  head: at(200, 72),
  neck: at(200, 142),
  shoulder: at(288, 182),
  chest: at(198, 222),
  core: at(198, 292),
  arm: at(304, 292),
  hand: at(321, 400),
  hip: at(198, 352),
  thigh: at(243, 430),
  knee: at(244, 505),
  calf: at(255, 575),
  ankle: at(262, 648),
  foot: at(270, 700),
};

interface RegionView {
  region: Region;
  gamesMissed: number;
  severe: boolean;
  episodes: RegionEpisode[];
  color: { fill: string; stroke: string };
}

export interface DurabilityModel {
  gm: GmPlayer;
  slice: PlayerSlice;
  /** Worst first: games missed, then episodes. */
  regions: RegionView[];
  /** The region open on arrival: the worst one, or null with no episodes anywhere. */
  worst: string | null;
}

/** The card's inputs for a page's player, or null when he has no profile. */
export function durabilityModel(data: PlayerPageData): DurabilityModel | null {
  const gsis = gsisForSleeper(data.player.id);
  if (!gsis) return null;
  const gm = getDurability()?.byKey[gsis] ?? null;
  const slice = getPlayerSlice(gsis);
  if (!gm || !slice) return null;
  const injuries = [...gm.inj, ...gm.extra.inj];
  const chips = regionChips(riskModel(slice.rows, slice.impacts, slice.unscored));
  const regions: RegionView[] = chips
    .map(({ region, stat }) => ({
      region,
      gamesMissed: stat.gamesMissed,
      severe: stat.severe,
      episodes: regionEpisodes(slice, injuries, region.key),
      color: severityColor(stat.gamesMissed, stat.severe),
    }))
    .sort((a, b) => b.gamesMissed - a.gamesMissed || b.episodes.length - a.episodes.length);
  let worst: RegionView | null = null;
  for (const r of regions) {
    if (!r.episodes.length) continue;
    const missed = r.episodes.reduce((n, e) => n + e.gamesMissed, 0);
    const best = worst ? worst.episodes.reduce((n, e) => n + e.gamesMissed, 0) : -1;
    if (!worst || missed > best || (missed === best && r.episodes.length > worst.episodes.length)) worst = r;
  }
  return { gm, slice, regions, worst: worst?.region.key ?? null };
}

/* --------------------------------------------------------------- render */

const n1 = (v: number): string => v.toFixed(1);

/** The ten-notch health bar (Redraft Command's "HP"): the score, in the tier's color, the tier named under it. */
function renderHealth(gm: GmPlayer): string {
  const color = TIER_COLOR[gm.tier.key];
  const pct = Math.max(0, Math.min(100, gm.score));
  return (
    `<div class="scp-in-hp" role="img" aria-label="${escapeHtml(`Durability ${n1(gm.score)} of 100, ${gm.tier.name}`)}" style="--hp:${escapeHtml(color)}">` +
    `<div class="scp-in-hp-head"><span class="scp-in-hp-k">HP</span><span class="scp-in-hp-v"><b>${n1(gm.score)}</b><small> / 100</small></span></div>` +
    `<div class="scp-in-hp-bar"><span class="scp-in-hp-fill" style="width:${pct.toFixed(1)}%"></span><span class="scp-in-hp-gloss"></span><span class="scp-in-hp-notches"></span></div>` +
    `<p class="scp-in-hp-tier">${escapeHtml(gm.tier.name)}</p>` +
    `</div>`
  );
}

const BOX: Record<string, [string, string]> = {
  P: ["g", "played"],
  X: ["r", "missed to injury"],
  D: ["d", "dressed, didn't play"],
  "-": ["d", "didn't play (not injury)"],
};

/**
 * One box per team game, a row per season of his career (the unscored
 * seasons included, as the profile shows them), playoffs after a gap. The
 * quiet palette: played recedes so the missed games carry the story; a bye is
 * a dim slot; this season's weeks still to come are empty outlines. Each
 * missed box names its season and week so the script can outline the open
 * region's lost weeks; the worst region's are outlined on arrival.
 */
export function renderAvailGrid(gm: GmPlayer, current: { season: number; week: number } | null, highlight: Record<string, number[]> | null): string {
  const seasons: Record<string, [number, number] | undefined> = { ...gm.extra.seasons, ...gm.seasons } as Record<string, [number, number]>;
  const weeks: Record<string, string | undefined> = { ...gm.extra.w, ...(gm.w ?? {}) };
  const all = Object.keys(seasons).map(Number).sort((a, b) => a - b);
  if (!all.length) return "";
  const years: number[] = [];
  for (let y = all[0]!; y <= all[all.length - 1]!; y += 1) years.push(y);
  const hasPO = years.some((y) => gm.post[y]);
  const box = (k: string, title: string, season?: number, week?: number, mark = false): string =>
    `<i class="scp-in-ab is-${k}${mark ? " is-mark" : ""}"${season != null && week != null ? ` data-s="${season}" data-w="${week}"` : ""} title="${escapeHtml(title)}"></i>`;
  const spacer = `<i class="scp-in-ab-gap" aria-hidden="true"></i>`;

  const rowFor = (y: number): string => {
    const key = String(y);
    const marked = highlight?.[key] ? new Set(highlight[key]) : null;
    const futureFrom = current && current.season === y ? current.week : null;
    const po = gm.post[y];
    const ws = weeks[key];
    const season = seasons[key];
    let out = "";
    if (ws && season) {
      const [reg = "", playoff = ""] = ws.split("|");
      let g = 0;
      [...reg].forEach((ch, i) => {
        if (futureFrom != null && i + 1 >= futureFrom) {
          out += box("f", `${y}, week ${i + 1}: not played yet`);
          return;
        }
        if (ch === "B") {
          out += box("d", `${y}: bye week`);
          return;
        }
        const [k, t] = BOX[ch] ?? BOX["-"]!;
        g += 1;
        out += box(k, `${y}, game ${g}: ${t}`, y, i + 1, k === "r" && !!marked?.has(i + 1));
      });
      for (let i = reg.length; i < 18; i += 1) out += box("d", `${y}: beyond this season's game count`);
      if (playoff) {
        out += spacer;
        [...playoff].forEach((ch, i) => {
          const [k, t] = BOX[ch] ?? BOX["-"]!;
          out += box(k, `${y} playoffs, game ${i + 1}: ${t}`);
        });
      }
      return out;
    }
    if (season) {
      const gp = season[0] - (po ? po[0] : 0);
      const gmissed = season[1] - (po ? po[1] : 0);
      const cap = futureFrom != null ? Math.max(0, futureFrom - 1) : 18;
      const gpShown = Math.min(gp, cap);
      const gmShown = Math.min(gmissed, cap - gpShown);
      for (let i = 0; i < gpShown; i += 1) out += box("g", `${y}: played`);
      for (let i = 0; i < gmShown; i += 1) out += box("r", `${y}: missed to injury`);
      for (let i = gpShown + gmShown; i < 18; i += 1) out += i >= cap ? box("f", `${y}: not played yet`) : box("d", `${y}: beyond this season's game count`);
    } else {
      for (let i = 0; i < 18; i += 1) out += box("d", `${y}: not rostered`);
    }
    if (po) {
      const [pp, pm, pt] = po;
      out += spacer;
      for (let i = 0; i < pp; i += 1) out += box("g", `${y} playoffs: played`);
      for (let i = 0; i < pm; i += 1) out += box("r", `${y} playoffs: missed to injury`);
      for (let i = pp + pm; i < pt; i += 1) out += box("d", `${y} playoffs: did not play (not injury)`);
    }
    return out;
  };

  return (
    `<div class="scp-in-av${hasPO ? " has-po" : ""}" data-scp-avail>` +
    `<div class="scp-in-av-head" aria-hidden="true"><span class="scp-in-av-year"></span><span class="scp-in-av-reg">Regular season</span>${hasPO ? `<span class="scp-in-av-po">Playoffs</span>` : ""}</div>` +
    years.map((y) => `<div class="scp-in-av-row"><span class="scp-in-av-year">${y}</span><span class="scp-in-av-boxes">${rowFor(y)}</span></div>`).join("") +
    `<div class="scp-in-av-legend"><span><i class="scp-in-ab is-g"></i>Played</span><span><i class="scp-in-ab is-r"></i>Missed to Injury</span><span><i class="scp-in-ab is-d"></i>Bye / Inactive</span></div>` +
    `</div>`
  );
}

function renderTiles(gm: GmPlayer): string {
  const tile = (value: string | number, label: string, title?: string): string =>
    `<div class="scp-in-dt"${title ? ` title="${escapeHtml(title)}"` : ""}><p class="scp-in-dt-v">${escapeHtml(String(value))}</p><p class="scp-in-dt-k">${escapeHtml(label)}</p></div>`;
  const seasons = gm.seasonYears.length;
  return (
    `<div class="scp-in-dur-tiles">` +
    tile(gm.major, "Major Injuries") +
    tile(gm.soft, "Soft-Tissue Events") +
    tile(gm.gmTot, "Games Missed", `Over ${seasons} season${seasons === 1 ? "" : "s"}`) +
    tile(n1(gm.perYearRate), "Missed / Season") +
    `</div>`
  );
}

function renderPills(regions: RegionView[], worst: string | null): string {
  if (!regions.length) return `<p class="scp-in-dur-none">No localized injuries recorded from the weekly reports.</p>`;
  return (
    `<div class="scp-in-rp-row">` +
    regions
      .map((r) => {
        const on = r.region.key === worst;
        const n = r.episodes.length;
        const style = on ? ` style="--rp-stroke:${r.color.stroke};--rp-fill:${r.color.fill}"` : "";
        return (
          `<button type="button" class="scp-in-rp${on ? " is-on" : ""}" data-region="${escapeHtml(r.region.key)}" aria-pressed="${on ? "true" : "false"}"${style} ` +
          `title="${escapeHtml(`${r.region.label} · ${n} occurrence${n === 1 ? "" : "s"} · ${r.gamesMissed} games missed`)}">` +
          `${escapeHtml(r.region.label)}<b>${n}</b></button>`
        );
      })
      .join("") +
    `</div>`
  );
}

/** Every region's record, the worst one open; the script swaps them. */
function renderDetails(regions: RegionView[], worst: string | null): string {
  return regions
    .filter((r) => r.episodes.length > 0)
    .map((r) => {
      const noun = r.region.label.toLowerCase();
      const missed = r.episodes.reduce((n, e) => n + e.gamesMissed, 0);
      const told = r.episodes.map((ep, i) => ({ ep, ...tellEpisode(ep, r.episodes[i - 1] ?? null, i, noun) })).reverse();
      const lost = regionLostWeeks(r.episodes);
      return (
        `<div class="scp-in-rd" data-region-detail="${escapeHtml(r.region.key)}" data-lost="${escapeHtml(JSON.stringify(lost))}"${r.region.key === worst ? "" : " hidden"}>` +
        `<div class="scp-in-rd-head"><span><b>${escapeHtml(r.region.label)}</b> · ${r.episodes.length} Occurrence${r.episodes.length === 1 ? "" : "s"} · ${missed} Game${missed === 1 ? "" : "s"} Missed</span>` +
        `<button type="button" class="scp-in-rd-x" data-region-close aria-label="Close">×</button></div>` +
        `<ol class="scp-in-rd-list">` +
        told
          .map(({ ep, tag, text }) => {
            const week = ep.inGame?.week ?? ep.week;
            return (
              `<li><div class="scp-in-rd-line"><span class="scp-in-rd-when">${ep.season}${week != null ? ` · ${escapeHtml(weekName(ep.season, week))}` : ""}</span>` +
              `<span class="scp-in-rd-inj">${escapeHtml(capitalizeWords(ep.injury))}</span>` +
              `<span class="scp-in-rd-tag is-${tag.toLowerCase().replace(/[^a-z]/g, "")}">${escapeHtml(tag)}</span></div>` +
              `<p>${escapeHtml(text)}</p></li>`
            );
          })
          .join("") +
        `</ol></div>`
      );
    })
    .join("");
}

/* ---------------------------------------------------------- figure labels */

/**
 * A marker's callout beside the figure, worded like the body map's labels
 * above it (mak, 2026-10-30: "i really like how we labeled this body map,
 * can you do the same for the new one"): "R. thumb ×2" over "2016, 2017: 10
 * games", "Hip" over "2026, played thru".
 */
export interface FigureLabel {
  region: string;
  column: "left" | "right";
  /** The label's center, as a percent of the frame's height. */
  y: number;
  /** The marker, as percents of the frame. */
  mx: number;
  my: number;
  title: string;
  sub: string;
}

/** The frame's share of the figure block's width; the gutters take the rest. */
export const FIGURE_FRAME_PCT = 54;
const FIGURE_GUTTER_PCT = (100 - FIGURE_FRAME_PCT) / 2;
const LABEL_Y_MIN = 7;
const LABEL_Y_MAX = 93;
/* The block the spacing is sized for: a gutter of 100px and a frame 230px
   tall (a 345px block, a phone's), with a label 12px/14.4px bold lines over
   11px/13.2px ones and the body map's rough glyph widths. Phones set the type
   a size smaller than that, so the estimate stays on the generous side there;
   wider blocks wrap less and only gain room. */
const LABEL_GUTTER_PX = 100;
const LABEL_FRAME_H_PX = 230;
const LABEL_MIN_GAP_PX = 6;

const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The body map's short words for a report term. */
const SHORT_NAME: Record<string, string> = {
  quadricep: "quad",
  quadriceps: "quad",
  "concussion evaluation": "concussion",
  "concussion protocol": "concussion",
  "achilles tendon": "achilles",
  "mcl sprain": "knee",
  "acl tear": "knee",
};

/** A label's height in px at the sizing width, from the lines its words need. */
function labelHeightPx(title: string, sub: string): number {
  const lines = (text: string, perChar: number): number => Math.max(1, Math.ceil((text.length * perChar) / LABEL_GUTTER_PX));
  return lines(title, 6.9) * 14.4 + lines(sub, 5.5) * 13.2 + 2;
}

/** The body map's words for a region: side prefix when every sided phrase agrees, the parts named, years and the outcome. */
export function labelWords(r: Pick<RegionView, "region" | "episodes" | "gamesMissed">): { title: string; sub: string } {
  const seen = new Map<string, { n: number; last: number }>();
  const sides = new Set<string>();
  let sided = 0;
  for (const ep of r.episodes) {
    for (const phrase of ep.injury.split(" · ")) {
      const m = /^\s*(left|right)\s+(.+)$/i.exec(phrase);
      const raw = (m ? m[2]! : phrase)
        .replace(/\s*\(.*?\)\s*/g, " ")
        .trim()
        .toLowerCase();
      const name = SHORT_NAME[raw] ?? raw;
      if (m) {
        sides.add(m[1]!.toLowerCase());
        sided += 1;
      }
      if (!name) continue;
      const hit = seen.get(name) ?? { n: 0, last: 0 };
      seen.set(name, { n: hit.n + 1, last: Math.max(hit.last, ep.season) });
    }
  }
  // The part named most often first, then the most recent: "Hamstring / Quad".
  // "Undisclosed" (a reserve stint no report named) is not a part: the other
  // names carry the label, and alone it falls back to the region's name.
  const names = [...seen]
    .filter(([name]) => name !== "undisclosed")
    .sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)
    .map(([name]) => name);
  const prefix = sided > 0 && sides.size === 1 ? ([...sides][0] === "right" ? "R. " : "L. ") : "";
  const count = r.episodes.length > 1 ? ` ×${r.episodes.length}` : "";
  // Two names at most, as the gutter is narrow: "Hamstring / Quad +1".
  const shown = names.slice(0, 2).map(capFirst).join(" / ") + (names.length > 2 ? ` +${names.length - 2}` : "");
  const base = names.length === 0 ? r.region.label : names.length === 1 ? (prefix ? `${prefix}${names[0]}` : capFirst(names[0]!)) : shown;
  const games = r.episodes.reduce((n, e) => n + e.gamesMissed, 0);
  const years = [...new Set(r.episodes.map((e) => e.season))].sort((a, b) => a - b).join(", ");
  const outcome = games === 0 ? "played thru" : `${games} game${games === 1 ? "" : "s"}`;
  const sub = !years
    ? r.gamesMissed > 0
      ? `${r.gamesMissed} game${r.gamesMissed === 1 ? "" : "s"}`
      : "no time missed"
    : r.episodes.length > 1 && games > 0
      ? `${years}: ${outcome}`
      : `${years}, ${outcome}`;
  return { title: `${base}${count}`, sub };
}

/**
 * Where each label sits: the viewer's left for markers left of center, right
 * for right, a centered marker (head, chest, hip) in whichever column has
 * room; then the column's labels pushed apart top to bottom, and walked back
 * up when the last one runs off the bottom - the body map's placement.
 */
export function figureLabels(regions: Pick<RegionView, "region" | "episodes" | "gamesMissed">[]): FigureLabel[] {
  type Item = { key: string; c: { x: number; y: number }; title: string; sub: string };
  const items: Item[] = [];
  for (const r of regions) {
    const c = REGION_COORDS[r.region.key];
    if (!c) continue;
    items.push({ key: r.region.key, c, ...labelWords(r) });
  }
  items.sort((a, b) => a.c.y - b.c.y);
  const left: Item[] = [];
  const right: Item[] = [];
  const centered = (it: Item): boolean => Math.abs(it.c.x - 50) < 3;
  for (const it of items) if (!centered(it)) (it.c.x < 50 ? left : right).push(it);
  for (const it of items) if (centered(it)) (left.length <= right.length ? left : right).push(it);
  const place = (col: Item[], column: "left" | "right"): FigureLabel[] => {
    const sorted = [...col].sort((a, b) => a.c.y - b.c.y);
    // Each label's half height as a percent of the frame, so two neighbors
    // sit at least a small gap apart whatever their line counts.
    const half = sorted.map((it) => (labelHeightPx(it.title, it.sub) / 2 / LABEL_FRAME_H_PX) * 100);
    const gapPct = (LABEL_MIN_GAP_PX / LABEL_FRAME_H_PX) * 100;
    const apart = (i: number): number => half[i - 1]! + half[i]! + gapPct;
    const lo = (i: number): number => Math.max(LABEL_Y_MIN, half[i]!);
    const hi = (i: number): number => Math.min(LABEL_Y_MAX, 100 - half[i]!);
    const ys = sorted.map((it, i) => Math.min(Math.max(it.c.y, lo(i)), hi(i)));
    for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i]!, ys[i - 1]! + apart(i));
    if (ys.length && ys[ys.length - 1]! > hi(ys.length - 1)) {
      ys[ys.length - 1] = hi(ys.length - 1);
      for (let i = ys.length - 2; i >= 0; i -= 1) ys[i] = Math.min(ys[i]!, ys[i + 1]! - apart(i + 1));
    }
    return sorted.map((it, i) => ({ region: it.key, column, y: Math.max(ys[i]!, lo(i)), mx: it.c.x, my: it.c.y, title: it.title, sub: it.sub }));
  };
  return [...place(left, "left"), ...place(right, "right")];
}

function renderLabels(labels: FigureLabel[], worst: string | null): string {
  const pct = (v: number): string => v.toFixed(2);
  // Leader lines, under the markers: from the marker to the label's near edge.
  const lines = labels
    .map((l) => {
      const x1 = FIGURE_GUTTER_PCT + (l.mx * FIGURE_FRAME_PCT) / 100;
      // The label box ends 6% inside the frame's empty margin; its text stops 1.5% short of that.
      const x2 = l.column === "left" ? FIGURE_GUTTER_PCT + 6 : 100 - FIGURE_GUTTER_PCT - 6;
      return `<line x1="${pct(x1)}" y1="${pct(l.my)}" x2="${pct(x2)}" y2="${pct(l.y)}" vector-effect="non-scaling-stroke"/>`;
    })
    .join("");
  const callouts = labels
    .map((l) => {
      const on = l.region === worst;
      return (
        `<button type="button" class="scp-in-fl is-${l.column}${on ? " is-on" : ""}" data-region="${escapeHtml(l.region)}" aria-pressed="${on ? "true" : "false"}" style="top:${pct(l.y)}%">` +
        `<b>${escapeHtml(l.title)}</b><span>${escapeHtml(l.sub)}</span></button>`
      );
    })
    .join("");
  return `<svg class="scp-in-fl-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${lines}</svg>${callouts}`;
}

function renderFigure(data: PlayerPageData, regions: RegionView[], worst: string | null): string {
  const team = data.team;
  const number = data.player.number != null ? String(data.player.number).replace(/\D/g, "").slice(0, 2) : "";
  const markers = regions
    .map((r) => {
      const c = REGION_COORDS[r.region.key];
      if (!c) return "";
      const size = r.severe || r.gamesMissed > 0 ? 20 : 15;
      const note = r.severe ? "season-ending" : r.gamesMissed > 0 ? `${r.gamesMissed} missed` : "no time missed";
      const on = r.region.key === worst;
      return (
        `<button type="button" class="scp-in-mk${on ? " is-on" : ""}" data-region="${escapeHtml(r.region.key)}" aria-pressed="${on ? "true" : "false"}" ` +
        `aria-label="${escapeHtml(`${r.region.label}: ${note}`)}" title="${escapeHtml(`${r.region.label} · ${note}`)}" ` +
        `style="left:${c.x.toFixed(2)}%;top:${c.y.toFixed(2)}%;width:${size}px;height:${size}px;background:${r.color.fill};border-color:${r.color.stroke}"></button>`
      );
    })
    .join("");
  // The frame first, so the labels after it can follow its selection state.
  return (
    `<div class="scp-in-figwrap">` +
    `<div class="scp-in-fig${worst ? " has-sel" : ""}" data-scp-figure data-primary="${escapeHtml(team?.primaryColor ?? "#4b5563")}" data-secondary="${escapeHtml(team?.secondaryColor ?? "#9ca3af")}" data-number="${escapeHtml(number)}">` +
    `<img class="scp-in-fig-img" src="${escapeHtml(assetUrl("/injury-figure/player-base.webp"))}" alt="" aria-hidden="true" crossorigin="anonymous" decoding="async" />` +
    markers +
    `</div>` +
    renderLabels(figureLabels(regions), worst) +
    `</div>`
  );
}

/**
 * The card: a reading order (Redraft Command, 2026-10-28). The signature at
 * the right - the figure, the durability bar, his status now and his career
 * availability - and the evidence at the left, top to bottom: the availability
 * grid with the four tiles beside it, the region pills worst first, then the
 * open region's record.
 */
export function renderDurabilitySection(data: PlayerPageData, _options: PlayerRenderOptions = {}): string {
  const m = durabilityModel(data);
  if (!m) return "";
  const { gm, regions, worst } = m;
  const status = (data.designation?.injuryStatus ?? "").trim();
  const tone = !status ? "good" : /^q/i.test(status) ? "mid" : "bad";
  const current = { season: data.leagueSeason, week: data.leagueWeek };
  const worstView = regions.find((r) => r.region.key === worst) ?? null;
  const highlight = worstView ? regionLostWeeks(worstView.episodes) : null;
  return (
    `<section class="scp-ox-sec scp-in-dur-sec" aria-labelledby="scp-in-dur-h" data-scp-durability>` +
    `<h2 class="scp-ox-h2" id="scp-in-dur-h">${escapeHtml(titleCase("Durability profile"))}</h2>` +
    `<div class="scp-in-dur">` +
    `<div class="scp-in-dur-side">` +
    renderFigure(data, regions, worst) +
    `<div class="scp-in-dur-sig">` +
    renderHealth(gm) +
    `<p class="scp-in-dur-status"><b class="is-${tone}">${escapeHtml(status || "Healthy")}</b><i aria-hidden="true"> • </i><b>${n1(gm.availPct)}%</b> career availability</p>` +
    `</div></div>` +
    `<div class="scp-in-dur-ev">` +
    renderAvailGrid(gm, current, highlight) +
    renderTiles(gm) +
    `</div>` +
    `<div class="scp-in-dur-reg">` +
    renderPills(regions, worst) +
    renderDetails(regions, worst) +
    `</div>` +
    `</div></section>`
  );
}

/* ------------------------------------------- the premium comparison's parts */

/** One of the four summary tiles. */
export interface DurabilityTile {
  value: string;
  label: string;
  title: string | null;
}

/**
 * The card's pieces for the premium Injury Status and History comparison
 * (mak's brief, 2026-11-05; lib/player/injury-premium.ts): the same figure,
 * pills, records and grid the card prints (so client/player.ts wires the
 * premium block's region selection exactly as it wires the card), with the
 * figures the premium lays out its own way.
 */
export interface DurabilityParts {
  score: number;
  tier: { key: GmPlayer["tier"]["key"]; name: string; color: string };
  availPct: number;
  seasons: number;
  tiles: DurabilityTile[];
  regions: Array<{ key: string; label: string; episodes: number; gamesMissed: number }>;
  worst: string | null;
  figure: string;
  pills: string;
  details: string;
  grid: string;
}

export function durabilityParts(data: PlayerPageData): DurabilityParts | null {
  const m = durabilityModel(data);
  if (!m) return null;
  const { gm, regions, worst } = m;
  const current = { season: data.leagueSeason, week: data.leagueWeek };
  const worstView = regions.find((r) => r.region.key === worst) ?? null;
  const highlight = worstView ? regionLostWeeks(worstView.episodes) : null;
  const seasons = gm.seasonYears.length;
  return {
    score: gm.score,
    tier: { key: gm.tier.key, name: gm.tier.name, color: TIER_COLOR[gm.tier.key] },
    availPct: gm.availPct,
    seasons,
    tiles: [
      { value: String(gm.major), label: "Major Injuries", title: null },
      { value: String(gm.soft), label: "Soft-Tissue Events", title: null },
      { value: String(gm.gmTot), label: "Games Missed", title: `Over ${seasons} season${seasons === 1 ? "" : "s"}` },
      { value: n1(gm.perYearRate), label: "Missed / Season", title: null },
    ],
    regions: regions.map((r) => ({ key: r.region.key, label: r.region.label, episodes: r.episodes.length, gamesMissed: r.gamesMissed })),
    worst,
    figure: renderFigure(data, regions, worst),
    pills: renderPills(regions, worst),
    details: renderDetails(regions, worst),
    grid: renderAvailGrid(gm, current, highlight),
  };
}
