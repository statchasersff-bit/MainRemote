/**
 * The player profile header: the premium design mak approved on 2026-11-05
 * (built against attached_assets/player header reference.png, first as a
 * comparison under the 2026-09-29 header, then made the header when mak said
 * "remove the older design"). A team-colored portrait panel cut on a gold
 * diagonal, the identity in a navy hero (position, club, status, the name as
 * the page's heading, number and position, one bio line), the fantasy trio
 * in a gold-edged panel, four season stat cards, a gold Redraft Command
 * button with the start/sit question beside it, and the next matchup as a
 * compact strip above the page's own tab bar.
 *
 * Its own module, like lib/matchup/scoreboard-hero.ts, for the same reason:
 * it is one self-contained component, and keeping it off player-render.ts's
 * import graph lets tests/player-header.test.mjs render it against
 * hand-built states without loading the database the rest of the profile
 * reads.
 *
 * Its styles are in player.css under "header", with their own tokens and
 * face. The hooks other code keys on kept their names across the redesign:
 * [data-scp-pwell] and .scp-pwell-img (client/player.ts marks a failed photo;
 * the WordPress plugin keeps WP Rocket's lazy-load off that class),
 * .scp-phead-h1 / .scp-phead-name / .scp-phead-kind (the client swaps the
 * section word on a tab click), data-scp-cta on both buttons (the client
 * re-tags them per tab).
 */

import { escapeHtml } from "../render";
import { possessive } from "./title-case";
import { headshotImg } from "../headshot-html";
import { easternParts } from "../news-card";
import type { PlayerRenderOptions } from "../player-render";
import type { NflTeam } from "../team/teams";
import type { PlayerPageData } from "./player-data";
import { SCORING_SHORT } from "./scoring";
import { OUTLOOK_SEASON } from "./outlook-2026";
import { sectionHref } from "./sections";
import { getEntryPoints } from "./scoring";
import { heroCells, playedEntries, seasonTotals } from "./season-line";
import { passerRating } from "./stats-profile";
import type { UpcomingGame } from "./upcoming";

const DASH = "-";

/** One decimal, the way every figure on the profile is printed. */
function num(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : DASH;
}

/** Attribute-safe style declaration list, or "". */
function styleAttr(parts: Array<string | null | false>): string {
  const kept = parts.filter((p): p is string => typeof p === "string" && p !== "");
  return kept.length ? ` style="${escapeHtml(kept.join(";"))}"` : "";
}

/** "1st", "2nd", "23rd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

// The season the Outlook tab is about: lib/player/outlook-2026.ts owns it,
// re-exported here because the header's importers always read it from here.
export { OUTLOOK_SEASON };

/**
 * A player's start/sit page is this plus his slug. The final address, not the
 * /launch/ path that redirects to it.
 */
export const STARTSIT_BASE =
  "https://statchasers.com/redraft-command/who-should-i-start/";

/**
 * Three bands, for a restrained tint rather than a red-to-green ramp.
 *
 * The rank is the reading and the color is a hint underneath it, so only the
 * top and bottom thirds are tinted at all and the middle is left alone. A card
 * per fixture in full green or full red turns a schedule into a traffic light
 * and buries the thing the block is actually for, which is who and when.
 */
// One methodology for the site: the FPA page's bands (fpa/matchup-bands.ts).
export { matchupBand, type MatchupBand } from "../fpa/matchup-bands";
import { BAND_WORDS, matchupBand, type MatchupBand } from "../fpa/matchup-bands";

/**
 * How severe a designation is, for the pill's accent.
 *
 * Four buckets, matching the team hub's `injurySeverity` exactly so the same
 * status is the same color on both pages. Anything unrecognized is treated as
 * "questionable" rather than dropped - an unfamiliar designation is still a
 * designation, and guessing it is harmless while hiding it is not.
 */
export function designationSeverity(status: string | null | undefined): string {
  const key = (status ?? "").trim().toLowerCase();
  if (/^(out|ir|pup|nfi|susp|dnr|doubtful-out)/.test(key) || key.includes("injured reserve")) {
    return "out";
  }
  if (key === "doubtful") return "doubtful";
  if (key === "probable" || key === "active" || key === "full") return "probable";
  return "questionable";
}

/**
 * A designation that takes a player off the active roster for longer than one
 * game: injured reserve, the PUP or NFI lists, a suspension, did not report.
 * Returned as the words a sentence uses ("injured reserve"), or null.
 *
 * Different from "Out", which is one game's status and still leaves a
 * start/sit question to ask. With one of these the question answers itself,
 * so the header says where he stands instead (UI brief, 2026-11-18). Read off
 * the same designation the pill prints, never off a player name, and with no
 * return date: the feed does not have one and the page does not guess.
 */
export function rosterDesignation(data: PlayerPageData): string | null {
  const key = (data.designation?.injuryStatus ?? "").trim().toLowerCase();
  if (!key) return null;
  if (/^ir\b/.test(key) || key.includes("injured reserve")) return "injured reserve";
  if (/^pup\b/.test(key) || key.includes("physically unable")) return "the PUP list";
  if (/^nfi\b/.test(key) || key.includes("non-football")) return "the non-football injury list";
  if (/^sus/.test(key)) return "suspended";
  if (/^dnr\b/.test(key)) return "did not report";
  return null;
}

/**
 * The strip's short form of the note, for a header too narrow to keep the
 * long one and "View matchup" on one line: "On IR", "Suspended".
 */
function rosterNoteShort(data: PlayerPageData): string {
  const words = rosterDesignation(data);
  if (!words) return "";
  if (words === "injured reserve") return "On IR";
  if (words === "the PUP list") return "On PUP";
  if (words === "the non-football injury list") return "On NFI";
  return words[0]!.toUpperCase() + words.slice(1);
}

/** "On injured reserve (elbow)", "Suspended": the strip's factual note. */
function rosterNote(data: PlayerPageData): string {
  const words = rosterDesignation(data);
  if (!words) return "";
  const part = (data.designation?.injuryBodyPart ?? "").trim().toLowerCase();
  const lead = words === "suspended" || words === "did not report" ? words[0]!.toUpperCase() + words.slice(1) : `On ${words}`;
  return part && words !== "suspended" && words !== "did not report" ? `${lead} (${part})` : lead;
}

/**
 * Suffixes that belong to the surname rather than standing as one.
 *
 * "Odell Beckham Jr." splits after Odell, not after Beckham: a hero reading
 * "JR." in 44px would be the one thing on the page nobody could misread as
 * anything but a bug.
 */
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * A name as the hero sets it: given name small above, surname large below.
 *
 * The split is presentational and the H1 is not: `first` and `last` are
 * rendered as two spans with a real space between them, so the heading's text
 * content is still exactly `player.name` for a crawler, a screen reader and
 * the tests that compare the two. Anything this cannot split cleanly - a
 * single-word name, or a name that would not reassemble to itself - falls back
 * to one span, which is the old treatment and never wrong.
 */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { first: "", last: name };

  const bare = (word: string): string => word.toLowerCase().replace(/\.+$/, "");
  // A suffix takes the name before it along with it, so "Beckham Jr." stays one
  // surname - but only when there is a given name left over to put above it.
  const cut =
    parts.length >= 3 && NAME_SUFFIXES.has(bare(parts[parts.length - 1] ?? ""))
      ? parts.length - 2
      : parts.length - 1;

  const first = parts.slice(0, cut).join(" ");
  const last = parts.slice(cut).join(" ");
  // The heading has to reassemble to the name it was built from, or the split
  // has quietly rewritten the H1. Double spaces and odd whitespace land here.
  if (`${first} ${last}` !== name) return { first: "", last: name };
  return { first, last };
}

/** Height stored as total inches ("73") rendered as feet and inches. */
export function formatHeight(height: string | null): string {
  if (!height) return "";
  const trimmed = height.trim();
  if (trimmed.includes("'") || trimmed.includes("-")) return trimmed;
  const inches = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(inches) || inches <= 0) return trimmed;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/**
 * Particles that belong to the surname, so "Amon-Ra St. Brown" is asked about
 * as "St. Brown" and not as "Brown". Lowercase, without the trailing dot.
 */
const SURNAME_PARTICLES = new Set(["st", "de", "del", "della", "di", "da", "van", "von", "la", "le", "du"]);

/** The surname a sentence would use: "Should I start St. Brown in Week 4?" */
export function lastName(name: string): string {
  const { first, last } = splitName(name);
  if (!first) return last;
  const given = first.split(" ");
  const tail: string[] = [];
  while (given.length > 1) {
    const word = given[given.length - 1] ?? "";
    if (!SURNAME_PARTICLES.has(word.toLowerCase().replace(/\.+$/, ""))) break;
    tail.unshift(word);
    given.pop();
  }
  return [...tail, last].join(" ");
}

/* ------------------------------------------------------------ team ink */

/** WCAG relative luminance of a #rrggbb color, or null for anything else. */
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** Contrast of white text on this color. 0 for a color that did not parse. */
function whiteContrast(hex: string): number {
  const l = luminance(hex);
  return l === null ? 0 : 1.05 / (l + 0.05);
}

/** The color mixed toward black by `amount` (0–1). */
function darken(hex: string, amount: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const mix = (v: number): string =>
    Math.round(v * (1 - amount)).toString(16).padStart(2, "0");
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

/** WCAG AA for the 12px position tag, which is white text on this color. */
const TEAM_INK_CONTRAST = 4.5;

/**
 * The club color the header paints with: the photo well, the position tag,
 * the start of the accent bar.
 *
 * The primary where white text on it passes AA, else the secondary where
 * that passes, else the primary taken darker until it does. The third case is
 * real: Carolina, Miami and the Chargers all have a light primary AND a light
 * secondary, and swapping to a second failing color fixes nothing. Darkening
 * keeps the club recognizable where a fallback to navy would not.
 *
 * Null for a player with no club; the stylesheet's default (ink-2) answers.
 */
export function teamInk(team: NflTeam | null): string | null {
  if (!team) return null;
  if (whiteContrast(team.primaryColor) >= TEAM_INK_CONTRAST) return team.primaryColor;
  if (whiteContrast(team.secondaryColor) >= TEAM_INK_CONTRAST) return team.secondaryColor;
  if (luminance(team.primaryColor) === null) return null;
  for (let step = 1; step <= 10; step += 1) {
    const candidate = darken(team.primaryColor, step * 0.08);
    if (whiteContrast(candidate) >= TEAM_INK_CONTRAST) return candidate;
  }
  return null;
}

/* ---------------------------------------------------------- the H1 subtitle */

/**
 * The second line of the header's heading, per tab.
 *
 * The name and this line are one heading, so every section address has its
 * own H1 - "George Pickens / Stats", "George Pickens / Injury Status" -
 * without the name itself ever changing. The profile has no second line at
 * all: its H1 is the player's name and nothing else (mak's player-entity
 * brief, 2026-11-03), because the hub is the player's page before it is a
 * page about any one thing. The nav links carry the line for each tab
 * (data-scp-kind) and client/player.ts swaps it on a click.
 *
 * The phrases are the section H1s of the brief, and statchasers_player_heading()
 * in the WordPress plugin spells them the same way for the theme's title.
 */
export const SECTION_KINDS: Record<string, string> = {
  stats: "Stats",
  "game-log": "Game Log",
  // "{Name} 2026 Fantasy Outlook": the one dated section H1, from the
  // Outlook brief mak approved on 2026-11-05 (the Stats title is dated the
  // same way since 11-04). The year is the outlook's, not the player's.
  outlook: `${OUTLOOK_SEASON} Fantasy Outlook`,
  injury: "Injury Status",
  news: "News",
  bio: "Bio",
};

export function headerKind(_data: PlayerPageData, tab: string): string {
  return SECTION_KINDS[tab] ?? "";
}

/** The tab as the analytics attribute spells it: "game-log" is "gamelog". */
function ctaTab(tab: string): string {
  return tab.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/* ------------------------------------------------------- what is next */

/** Week 1 is not logged yet: there is nothing this season to start anyone in. */
export function seasonNotStarted(data: PlayerPageData): boolean {
  return (data.leagueWeek ?? 0) === 0;
}

/**
 * The fixture the header's strip is about, and whether a bye comes first.
 *
 * The bye is "next" while the league has not logged it yet and the club's next
 * game is after it. Read off the league's logged weeks rather than the clock,
 * so it flips on the same data refresh that moves everything else on the page
 * and a cached render cannot be a day out of step with its own game log.
 */
export function headerFixture(
  data: PlayerPageData,
): { game: UpcomingGame; bye: number | null } | null {
  const game = (data.upcoming ?? [])[0];
  if (!game) return null;
  const bye = data.byeWeek ?? null;
  const byeNext = bye !== null && bye > (data.leagueWeek ?? 0) && bye < game.week;
  return { game, bye: byeNext ? bye : null };
}

/** "Sun Oct 4, 1:00 PM ET", or as much of it as ESPN has confirmed. */
export function headerKickoff(game: UpcomingGame): string {
  if (game.kickoffMs === null) return "";
  const parts = easternParts(game.kickoffMs);
  const day = `${parts.weekday} ${parts.month} ${parts.day}`;
  return game.timeConfirmed ? `${day}, ${parts.time}` : day;
}

/** The strip's chip: the same three bands the Upcoming Matchups cards use. */
export const CHIP_WORD: Record<MatchupBand, { cls: string; word: string }> = {
  soft: { cls: "is-good", word: BAND_WORDS.soft.toLowerCase() },
  mid: { cls: "is-mid", word: BAND_WORDS.mid.toLowerCase() },
  tough: { cls: "is-bad", word: BAND_WORDS.tough.toLowerCase() },
};

/* ----------------------------------------------------------- scoreboard */

/**
 * An ownership share for the scoreboard: a whole number.
 *
 * Below one percent it reads "<1%" rather than "0%", which would claim nobody
 * rosters him. And 100% is reserved for 100%: thirty players sat at 99.0 or
 * above in the week this was written and one of them was in every league.
 */
// Shared with the FAQ (rounding.ts), so the two cannot disagree.
import { rosteredPct } from "./rounding";

export interface BoardCell {
  /** The figure: "16.5", "QB17", "13%". */
  value: string;
  /** The word after it, which is what identifies it: "PPG", "rostered". */
  unit: string;
  /** The spelled-out reading, for the tooltip and a screen reader. */
  title: string;
  lead?: boolean;
}

/**
 * The fantasy trio of the strip: rate, rank, ownership.
 *
 * All three always print, with a dash where a figure does not exist - the
 * one place on this page that does, because the trio is a fixed frame a
 * reader learns to read across profiles, and a two-figure strip on one
 * player reads as a layout bug. Never 0.0 for a player who has not played.
 */
export function headerBoard(data: PlayerPageData): BoardCell[] {
  const { stats, format, player } = data;
  const played = Boolean(stats && stats.gamesPlayed > 0);

  const season = data.production.find((row) => row.season === data.season);
  // By total points scored, always (mak, 2026-11-27): the same basis as the
  // Stats tab's rank and career chart, so the header never shows a per-game
  // rank beside a total-points rank elsewhere on the page.
  const rank = season?.posFinishTotal ?? data.seasonRankTotal;
  const fmtWord = player.position === "K" ? "" : `${SCORING_SHORT[format]} `;
  const rankTitle = `${data.season} position rank by total ${fmtWord}fantasy points`;
  const pos = player.position ?? "";
  const ranked = played && pos && rank != null;
  // The game log's own average over the games he played (the Stats rule).
  const ppg = stats?.ppg ?? 0;

  return [
    {
      value: played && stats ? num(ppg) : DASH,
      unit: "PPG",
      title: fmtWord ? `${fmtWord}fantasy points per game` : "Fantasy points per game (a kicker scores the same in every format)",
      lead: true,
    },
    // "QB17" says what it is; only the dash needs the word.
    {
      value: ranked ? `${pos}${rank}` : DASH,
      unit: ranked ? "" : "rank",
      title: rankTitle,
    },
    // Sleeper's redraft pool - see scripts/player/buildRosterPct.mjs.
    {
      value: data.rosterPct ? rosteredPct(data.rosterPct.owned) : DASH,
      unit: "rostered",
      title: "Share of redraft leagues where he is rostered",
    },
  ];
}


/**
 * A plain person, for a player with no usable headshot: head and shoulders,
 * the same proportions as Sleeper's cutouts, so the panel does not change
 * shape. Under the photo in the markup; client/player.ts marks the panel
 * `is-missing` when the image fails, and a player with no source ships so.
 */
const SILHOUETTE =
  `<svg class="scp-pwell-sil" viewBox="0 0 200 145" aria-hidden="true" focusable="false">` +
  `<circle cx="100" cy="52" r="34" />` +
  `<path d="M22 145c4-40 38-58 78-58s74 18 78 58z" />` +
  `</svg>`;

/* ------------------------------------------------------------------ icons */

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICON = {
  columns: svg(`<path d="M5 20v-7M12 20V5M19 20v-10"/>`),
  football: svg(`<path d="M5.2 18.8c-2.3-2.3-1.4-8.1 2.6-12.1s9.8-4.9 12.1-2.6 1.4 8.1-2.6 12.1-9.8 4.9-12.1 2.6z"/><path d="M9 15l6-6"/><path d="M10.2 11.3l1.2 1.2M12.4 9.1l1.2 1.2M11.3 13.5l1.2 1.2"/>`),
  trophy: svg(`<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3.5 3.5 0 0 0 8.5 11M16 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5"/><path d="M12 13v3.5"/><path d="M8.5 20h7M10 16.5h4v3.5h-4z"/>`),
  target: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`),
  intercept: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>`),
  trend: svg(`<path d="M3 17l5-6 4 4 5-7 4 3"/><path d="M17 8h4v4"/>`),
  arrow: svg(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
  question: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>`),
  compass: svg(`<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`),
};

/** The full word for the position tag's abbreviation. */
const POSITION_WORD: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  K: "Kicker",
  DEF: "Defense",
};

/* ------------------------------------------------------------- portrait */

/**
 * The portrait panel: the club's color, cut on the diagonal, with the jersey
 * number drawn in outline behind the headshot.
 *
 * Sleeper's thumbnails are transparent cutouts cropped at the chest, so the
 * figure stands on the panel's floor rather than in a frame, drawn a little
 * wider than the panel so the face reads large. The f200 derivative is the
 * src and the f350 original is in the srcset for the 300px slot. Still the
 * LCP candidate, so eager and at high priority, both spelled out because WP
 * Rocket's LazyLoad rewrote this tag on the live site (2026-10-08); Rocket
 * leaves alone any <img> carrying loading="eager" or data-no-lazy, and the
 * news plugin also names this class in Rocket's exclusion filter.
 */
function renderPortrait(data: PlayerPageData): string {
  const { player, team } = data;
  // The club's logo, faded behind the figure, on the phone's white portrait
  // area only (mak's mobile brief, 2026-11-05); hidden on the desktop panel.
  const mark = team?.logo
    ? `<img class="scp-pwell-mark" src="${escapeHtml(team.logo)}" alt="" aria-hidden="true" width="120" height="120" loading="lazy" decoding="async">`
    : "";
  const jersey = player.number
    ? `<span class="scp-pwell-num" aria-hidden="true">${escapeHtml(String(player.number))}</span>`
    : "";
  const img =
    headshotImg({
      src: player.headshotUrl,
      id: player.id,
      className: "scp-pwell-img",
      alt: `${player.name} headshot`,
      variants: ["f200", "f350"],
      sizes: "(max-width: 560px) 200px, (max-width: 600px) 120px, 300px",
      width: 350,
      height: 254,
      loading: "eager",
      fetchpriority: "high",
      extra: ' data-no-lazy="1"',
    }) ?? "";
  return (
    `<div class="scp-pwell${img ? "" : " is-missing"}" data-scp-pwell>` +
    `<div class="scp-pwell-paint" aria-hidden="true"></div>` +
    mark +
    jersey +
    SILHOUETTE +
    img +
    `</div>`
  );
}

/* --------------------------------------------------------------- status */

/**
 * The designation pill: gold for questionable, red for anything worse, green
 * for a probable. A link to the Injury tab when the player has one; a
 * designation with no injury record behind it is the status alone, not a
 * link that 302s back to the page it is on.
 */
function injuryPill(status: string, href: string | null): string {
  const severity = designationSeverity(status);
  const key = status.trim().toLowerCase();
  const label = /^ir\b/.test(key) || key.includes("injured reserve") ? "IR" : status.trim();
  const tone = severity === "out" || severity === "doubtful" ? "is-bad" : severity === "probable" ? "is-good" : "is-mid";
  // Both forms print; the phone header (560px and under) shows the short one.
  const short = designationShort(label);
  const inner =
    short.toLowerCase() === label.toLowerCase()
      ? escapeHtml(label)
      : `<span class="scp-ptag-long">${escapeHtml(label)}</span><span class="scp-ptag-short">${escapeHtml(short)}</span>`;
  if (!href) return `<span class="scp-ptag-inj ${tone}">${inner}</span>`;
  return `<a class="scp-ptag-inj ${tone}" href="${escapeHtml(href)}" target="_top">${inner}</a>`;
}

/**
 * The pill's phone label: the designation as an injury report abbreviates it
 * ("QUES", "DOUB", "OUT", "IR"). Anything unrecognized keeps its own words.
 */
export function designationShort(status: string): string {
  const key = status.trim().toLowerCase();
  if (key.startsWith("ques")) return "QUES";
  if (key.startsWith("doub")) return "DOUB";
  if (key.startsWith("prob")) return "PROB";
  if (key === "out") return "OUT";
  if (/^ir\b/.test(key) || key.includes("injured reserve")) return "IR";
  if (/^pup\b/.test(key) || key.includes("physically unable")) return "PUP";
  if (/^nfi\b/.test(key) || key.includes("non-football")) return "NFI";
  if (key.startsWith("sus")) return "SUSP";
  if (/^dnr\b/.test(key) || key === "did not report") return "DNR";
  return status.trim();
}

/**
 * The status pill: the injury designation when there is one, else the page's
 * own roster status - "Active" only when the bio pipeline classed him
 * active, "Free Agent" or "Former" when it classed him so; no
 * classification, no pill. Never "Active" by default.
 */
function statusPill(data: PlayerPageData, options: PlayerRenderOptions): string {
  const status = data.designation?.injuryStatus ?? "";
  if (status.trim()) return injuryPill(status, sectionHref(data, options, "injury"));
  // Missed the club's last game with no game status yet (the shared
  // current-status rule, kind "pending"): the header says Pending, as the
  // Injury tab, Depth Chart and Injury Watch do, not the roster's "Active"
  // (Team Pages release 2026-11-20: Josh Jacobs, Ty Simpson).
  if (data.currentStatus?.kind === "pending") return injuryPill("Pending", sectionHref(data, options, "injury"));
  const page = (data as { bioPage?: { status?: string } | null }).bioPage;
  if (page?.status === "active") return `<span class="scp-ptag-status is-good">Active</span>`;
  if (page?.status === "free-agent") return `<span class="scp-ptag-status is-none">Free Agent</span>`;
  if (page?.status === "former") return `<span class="scp-ptag-status is-none">Former</span>`;
  return "";
}

/* ----------------------------------------------------------- stat cards */

/** The card's label and icon for one of season-line's cells, by position. */
function cardFace(pos: string, label: string): { label: string; icon: string } {
  const k = label.toLowerCase();
  if (pos === "QB") {
    if (k === "cmp") return { label: "CMP / ATT", icon: ICON.target };
    if (k === "yds") return { label: "PASS YDS", icon: ICON.columns };
    if (k === "td") return { label: "PASS TD", icon: ICON.trophy };
    if (k === "int") return { label: "INT", icon: ICON.intercept };
  }
  if (pos === "RB") {
    if (k === "car") return { label: "CARRIES", icon: ICON.football };
    if (k === "yds") return { label: "RUSH YDS", icon: ICON.columns };
    if (k === "td") return { label: "TOTAL TD", icon: ICON.trophy };
    if (k === "rec") return { label: "REC", icon: ICON.target };
  }
  if (k === "rec") return { label: "REC", icon: ICON.football };
  if (k === "yds") return { label: "REC YDS", icon: ICON.columns };
  if (k === "td") return { label: "REC TD", icon: ICON.trophy };
  if (k === "y/r") return { label: "YPR", icon: ICON.target };
  return { label: label.toUpperCase(), icon: ICON.columns };
}

/** Yards first, as the reference orders them; the rest keep season-line's order. */
function orderCells<T extends { label: string }>(cells: T[]): T[] {
  return [...cells.filter((c) => c.label === "yds"), ...cells.filter((c) => c.label !== "yds")];
}

/**
 * The four season stat cards: season-line's cells over the same game log the
 * Stats tab sums, so the cards and the tables agree. A player with no logged
 * game this season, or a position the logs carry no line for, gets none.
 */
function renderCards(data: PlayerPageData): string {
  const pos = data.player.position ?? "";
  const played = playedEntries(data.gameLog ?? []);
  const totals = seasonTotals(played, (e) => getEntryPoints(e.stats, data.format));
  const cells = orderCells(heroCells(pos, totals)).slice(0, 4);
  if (cells.length === 0) return "";
  // The phone's four-column strip (mak, 2026-11-05) reads Pass yds, TD, INT
  // and a fourth cell shown only there, with the CMP / ATT card hidden there
  // (the Stats tab carries the pair). Since 2026-11-06 that cell is the NFL
  // passer rating, not Comp % (mak asked for QBR; ESPN's Total QBR is not in
  // our data, the passer rating is the league's own formula on these totals).
  const rating = pos === "QB" ? passerRating({ passAtt: totals.att, passCmp: totals.cmp, passYd: totals.passYd, passTd: totals.passTd, passInt: totals.int } as never) : null;
  const pct =
    rating !== null
      ? `<li class="scp-pp-card is-phone" title="Passer rating">` +
        `<span class="scp-pp-card-icon" aria-hidden="true">${ICON.target}</span>` +
        `<b class="scp-pp-card-v">${escapeHtml(rating.toFixed(1))}</b>` +
        `<span class="scp-pp-card-l">RATE</span>` +
        `</li>`
      : "";
  return (
    // The phone's panel heading (2026-11-05), the season from the page data.
    `<p class="scp-pm-season">${escapeHtml(`${data.season} Regular Season`)}</p>` +
    `<ul class="scp-pp-cards">` +
    cells
      .map((c) => {
        const face = cardFace(pos, c.label);
        return (
          `<li class="scp-pp-card${pos === "QB" && c.label === "cmp" && pct ? " is-desk" : ""}" title="${escapeHtml(c.title)}">` +
          `<span class="scp-pp-card-icon" aria-hidden="true">${face.icon}</span>` +
          // A two-figure value ("135/205") at a size that holds the card.
          `<b class="scp-pp-card-v${c.value.length > 5 ? " is-long" : ""}">${escapeHtml(c.value)}</b>` +
          `<span class="scp-pp-card-l">${escapeHtml(face.label)}</span>` +
          `</li>`
        );
      })
      .join("") +
    pct +
    `</ul>`
  );
}

/* ---------------------------------------------------------------- board */

/** The fantasy panel's labels, in the trio's order; the first names the scoring. */
const BOARD_LABEL = ["FPPG", "POS RANK", "ROSTERED"];

/**
 * The fantasy trio under a caption that says what it measures: three cells,
 * the rate in gold, each figure over its label, the label carrying the full
 * reading. Dashes where a figure does not exist (never 0.0 for a player who
 * has not played).
 */
/**
 * The scoring format to name beside a fantasy figure, or "" when the format
 * does not change it: a kicker scores the same in Standard, Half-PPR and PPR
 * (lib/scoring/house-rules.ts), so "FPPG · PPR" implied a difference there is
 * none (Phase 1 cleanup, 2026-11-19).
 */
export function formatTag(data: Pick<PlayerPageData, "player" | "format">): string {
  return data.player.position === "K" ? "" : SCORING_SHORT[data.format];
}

function renderBoard(data: PlayerPageData): string {
  const tag = formatTag(data);
  return (
    `<div class="scp-pboard-wrap">` +
    // The phone's caption (mak's mobile brief, 2026-11-05): the scoring named
    // once here, so the FPPG label drops its own " · PPR" at that width.
    `<p class="scp-pm-fan-cap">${escapeHtml(tag ? `Fantasy · ${tag}` : "Fantasy points")}</p>` +
    `<p class="scp-pboard-cap">${escapeHtml(`${data.season} Fantasy Season`)}</p>` +
    `<div class="scp-pboard">` +
    headerBoard(data)
      .map(
        (c, i) =>
          `<span class="scp-pstat${c.lead ? " is-lead" : ""}">` +
          `<b>${escapeHtml(c.value)}</b>` +
          `<abbr title="${escapeHtml(c.title)}">${i === 0 ? `${BOARD_LABEL[0]}${tag ? `<span class="scp-pstat-fmt"> · ${escapeHtml(tag)}</span>` : ""}` : escapeHtml(BOARD_LABEL[i] ?? c.unit)}</abbr>` +
          `</span>`,
      )
      .join("") +
    `</div></div>`
  );
}

/* ------------------------------------------------------------------ hero */

/** What the page composition hands the header beyond the data. */
export interface HeroExtras {
  /** The matchup page for the next fixture, when the pair has one. */
  matchupHref?: string | null;
}

/**
 * The profile header.
 *
 * `tab` is the panel the page opens on. It picks the heading's second line
 * and the analytics tag on both buttons; the nav links carry the same two
 * things for every other tab, so a click can update them without the server.
 *
 * Exported for tests/player-header.test.mjs, which renders it against
 * hand-built states (a bye, a free agent, the offseason) that the fixture
 * roster cannot be relied on to contain on any given day.
 */
export function renderHero(
  data: PlayerPageData,
  options: PlayerRenderOptions,
  tab = "overview",
  extras: HeroExtras = {},
): string {
  const { player, team } = data;
  // The page's H1: on the standalone page, and on the host once it has
  // stood down (the plugin's "the tool supplies the heading" mode, ?h1=1).
  // Only a plain embed, where the theme prints the page title above the
  // fragment, keeps this an H2 - there the host's title is the H1, and the
  // plugin spells it the way this heading reads (statchasers_player_heading).
  const Heading = options.embed && !options.ownHeading ? "h2" : "h1";
  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";
  const kind = headerKind(data, tab);
  const cta = ctaTab(tab);
  const last = lastName(player.name);
  const pos = player.position ?? "";
  // His weekly start/sit page, or "" (see startSitHref): the header's one
  // fantasy action at every width.
  const startHref = startSitHref(data, options);

  /* ---- the tag row ---- */

  const sep = ` <span class="scp-pp-sep" aria-hidden="true"></span> `;
  const tags: string[] = [];
  if (pos) tags.push(`<span class="scp-ptag-pos">${escapeHtml(pos)}</span>`);
  tags.push(
    team
      ? // The abbreviation is the narrow-phone spelling (<= 370px, player.css
        // swaps the two); the full name stays the accessible name.
        `<a class="scp-ptag-team" href="${escapeHtml(`${teamPrefix}${team.slug}/${query}`)}"` +
          ` target="_top" aria-label="${escapeHtml(team.fullName)}">` +
          `<span class="scp-ptag-team-full">${escapeHtml(team.fullName)}</span>` +
          `<span class="scp-ptag-team-abbr" aria-hidden="true">${escapeHtml(team.code)}</span></a>`
      : `<span class="scp-ptag-team">Free agent</span>`,
  );
  const status = statusPill(data, options);
  const tagRow = `<div class="scp-ptags">${tags.join(" ")}${status ? sep + status : ""}</div>`;

  /* ---- the heading, the number and position, the bio line ---- */

  // The phone masthead (mak, 2026-11-06) sets the name on two deliberate
  // lines, first name over the rest; the spans are inline elsewhere and the
  // name's text is unchanged. A long part takes a smaller size there.
  const nameParts = player.name.trim().split(/\s+/);
  const first = nameParts.length > 1 ? nameParts[0] : "";
  const rest = nameParts.length > 1 ? nameParts.slice(1).join(" ") : player.name;
  const longName = Math.max(first.length, rest.length) > 11;
  const nameHtml = first
    ? `<span class="scp-phead-first">${escapeHtml(first)}</span> <span class="scp-phead-last">${escapeHtml(rest)}</span>`
    : escapeHtml(player.name);
  const heading =
    `<${Heading} class="scp-phead-h1">` +
    `<span class="scp-phead-name${longName ? " is-long" : ""}">${nameHtml}</span>` +
    // The section's word after the name, as part of the heading: "George
    // Pickens Stats". The profile has none, so its heading is the name
    // alone - no empty span, so the H1's text IS the name.
    (kind ? ` <span class="scp-phead-kind">${escapeHtml(kind)}</span>` : "") +
    `</${Heading}>`;

  const under: string[] = [];
  if (player.number) under.push(`#${escapeHtml(String(player.number))}`);
  if (pos) under.push(escapeHtml(POSITION_WORD[pos] ?? pos));
  const underRow = under.length ? `<p class="scp-pp-under">${under.map((u) => `<span>${u}</span>`).join(sep)}</p>` : "";

  // One line, no labels: every value says what it is; each keeps its
  // reading as a tooltip. "Undrafted" is never printed: draft.json writes
  // the same null row for an undrafted player as for one whose draft is
  // simply not recorded (see bio.ts).
  const spec: Array<[string, string]> = [];
  if (player.age) spec.push([`${player.age} yrs`, "Age"]);
  const height = formatHeight(player.height);
  const build = [height, player.weight ? `${player.weight} lbs` : ""].filter(Boolean).join(", ");
  if (build) spec.push([build, "Height, weight (lb)"]);
  const college = data.bioProfile?.college ?? null;
  if (college) spec.push([college, "College"]);
  if (player.years_exp !== null && player.years_exp !== undefined) {
    spec.push([player.years_exp === 0 ? "Rookie" : `${ordinal(player.years_exp + 1)} Season`, "Experience"]);
  }
  const draft = data.bioProfile?.draft;
  if (draft && draft.year && draft.round && draft.pick) {
    spec.push([`${draft.year} R${draft.round}, P${draft.pick}`, `Drafted ${draft.year}, round ${draft.round}, pick ${draft.pick}`]);
  }
  const specRow = spec.length
    ? `<p class="scp-pspec">` +
      // The draft pick is marked so a narrower hero can drop it (it is on
      // the Bio tab) rather than wrap the line (UI brief, 2026-11-18).
      spec
        .map(([v, t]) => `<span class="scp-pspec-i${t.startsWith("Drafted") ? " is-draft" : ""}" title="${escapeHtml(t)}">${escapeHtml(v)}</span>`)
        .join(sep) +
      `</p>`
    : "";

  const identity = `<div class="scp-pid">${tagRow}${heading}${underRow}${specRow}</div>`;

  /* ---- the phone's own rows (mak's mobile brief, 2026-11-05) ---- */

  // Shown only when the block is 560px or narrower (player.css, the phone
  // `pp` container query): the desktop tag row, under-row and spec line are
  // hidden there and these take their place, so each fact is in the
  // accessibility tree once at any width. The heading is never duplicated.
  //
  // mak's compact identity (2026-11-05): no separate club banner; two short
  // lines beside the portrait under the name -
  //   "Patriots · #10 · QB · Active"
  //   "24 yrs · 6'4\" · 225 lbs", then the college on its own line
  const dot = `<span class="scp-pm-dot" aria-hidden="true">·</span>`;
  const club = team
    ? `<a class="scp-pm-team" href="${escapeHtml(`${teamPrefix}${team.slug}/${query}`)}" target="_top">${escapeHtml(team.nickname)}</a>`
    : `<span class="scp-pm-team">Free agent</span>`;
  const metaOne = [
    club,
    player.number ? `#${escapeHtml(String(player.number))}` : "",
    pos ? escapeHtml(pos) : "",
    status ? `<span class="scp-pm-status">${status}</span>` : "",
  ].filter(Boolean);
  const metaTwo = [
    player.age ? `${escapeHtml(String(player.age))} yrs` : "",
    escapeHtml(height),
    player.weight ? `${escapeHtml(String(player.weight))} lbs` : "",
  ].filter(Boolean);
  const meta =
    `<div class="scp-pm-meta">` +
    `<p class="scp-pm-meta-1">${metaOne.join(dot)}</p>` +
    (metaTwo.length ? `<p class="scp-pm-meta-2">${metaTwo.join(dot)}</p>` : "") +
    (college ? `<p class="scp-pm-meta-3">${escapeHtml(college)}</p>` : "") +
    // The phone's one fantasy door (mak, 2026-11-06): the header leads with
    // the NFL profile, so the FPPG / rank / rostered row and its separate
    // Redraft Command arrow are gone and this outlined button under the
    // college is the fantasy action. It opened his Redraft Command player
    // page until the 2026-11-26 audit (WEB-017): that page is a noindex
    // shell with no player content, so the button now opens his weekly
    // start/sit page - the one player-specific Redraft destination with a
    // real answer on it - and is left out when there is no week to start
    // him in (see startSitHref).
    (startHref
      ? `<a class="scp-pm-fp" href="${escapeHtml(startHref)}"` +
        ` aria-label="${escapeHtml(`Should I start ${player.name} this week? Start/sit in Redraft Command`)}"` +
        ` data-cta="startsit-header-${cta}-mobile" data-scp-cta="startsit-header">` +
        `${escapeHtml(`Should I start ${last}?`)}<span class="scp-pm-fp-arrow" aria-hidden="true">→</span></a>`
      : "") +
    `</div>`;

  /* ---- the actions ---- */

  const outlookHref = sectionHref(data, options, "outlook");
  // The gold button is the fantasy action: his weekly start/sit page while
  // there is a week to start him in. It was "View Fantasy Football Profile"
  // into Redraft Command's player page until the 2026-11-26 audit (WEB-017,
  // a noindex shell), and the white button carried the start/sit link; the
  // two were the same decision twice. Now gold = start/sit, white = the
  // injury status (on IR, PUP...) or the outlook, and a player with no week
  // ahead gets the white button alone.
  const redraft = startHref
    ? `<a class="scp-pbtn scp-pbtn--gold" href="${escapeHtml(startHref)}"` +
      ` data-cta="startsit-header-${cta}" data-scp-cta="startsit-header">` +
      `<span class="scp-pbtn-icon" aria-hidden="true">${ICON.trend}</span>${escapeHtml(`Should I start ${last}?`)}` +
      `<span class="scp-pbtn-arrow" aria-hidden="true">${ICON.arrow}</span></a>`
    : "";
  let second = "";
  const injuryHref = sectionHref(data, options, "injury");
  if (rosterDesignation(data) && injuryHref) {
    // On IR (or PUP, suspended...): "Should I start him?" answers itself, so
    // the button opens his injury status instead.
    second =
      `<a class="scp-pbtn scp-pbtn--white" href="${escapeHtml(injuryHref)}" target="_top"` +
      ` data-cta="injury-header-${cta}" data-scp-cta="injury-header">` +
      `<span class="scp-pbtn-icon" aria-hidden="true">${ICON.question}</span>${escapeHtml(`${possessive(last)} injury status`)}</a>`;
  } else if (outlookHref) {
    second =
      `<a class="scp-pbtn scp-pbtn--white" href="${escapeHtml(outlookHref)}" target="_top"` +
      ` data-cta="outlook-header-${cta}" data-scp-cta="outlook-header">` +
      `<span class="scp-pbtn-icon" aria-hidden="true">${ICON.compass}</span>${escapeHtml(`${possessive(last)} ${OUTLOOK_SEASON} outlook`)}</a>`;
  }
  const actions = `<div class="scp-pp-actions">${redraft}${second}</div>`;
  const strip = matchupStrip(data, extras);

  const ink = teamInk(team);
  return (
    `<header class="scp-phead" aria-label="Player summary"` +
    styleAttr([ink && `--scp-team:${ink}`, team && `--scp-team-2:${team.secondaryColor}`]) +
    `>` +
    `<section class="scp-phead-hero" aria-label="${escapeHtml(`${player.name} summary`)}">` +
    renderPortrait(data) +
    identity +
    meta +
    renderBoard(data) +
    renderCards(data) +
    actions +
    `<span class="scp-phead-stripes" aria-hidden="true"></span>` +
    `</section>` +
    strip +
    `</header>`
  );
}

/**
 * His Redraft Command start/sit page, or "" when Redraft Command has no
 * populated one for him this week (data.startSitPage false: a 404 for a
 * player Sleeper does not roster, a noindex "updating" page for a deep
 * reserve; 2026-11-27 audit, item 5). Every start/sit link on the player
 * page, FAQ answers included, goes through here.
 */
export function startSitPageUrl(data: PlayerPageData, options: PlayerRenderOptions): string {
  if (data.startSitPage === false) return "";
  return `${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(data.player.slug)}`;
}

/**
 * The "Should I start {Last}?" link while there is a week to start him in,
 * or "" before Week 1 and once the schedule has run out. The header's white
 * button and the Overview's phone link (mak, 2026-11-05) share it.
 */
export function startSitHref(data: PlayerPageData, options: PlayerRenderOptions): string {
  if (!data.team || !headerFixture(data) || seasonNotStarted(data) || rosterDesignation(data)) return "";
  return startSitPageUrl(data, options);
}

/**
 * The next matchup strip, under the hero. Not shown at 560px and under
 * (mak's mobile brief, 2026-11-05): there the Overview's week-by-week strip
 * and the Outlook's upcoming matchups carry the fixture where it belongs.
 */
function matchupStrip(data: PlayerPageData, extras: HeroExtras = {}): string {
  const { team } = data;
  const next = headerFixture(data);
  let strip = "";
  if (team && next) {
    const { game, bye } = next;
    const opp = game.opponent?.fullName ?? game.opponentName;
    const fixture = `Week ${game.week} ${game.homeAway === "away" ? "at" : "vs."} ${opp}`;
    const when = headerKickoff(game);
    const band = game.matchup ? CHIP_WORD[matchupBand(game.matchup.rank)] : null;
    strip =
      `<div class="scp-pstrip">` +
      `<span class="scp-pstrip-cap">Next matchup</span>` +
      `<span class="scp-pstrip-mu"><strong>${escapeHtml(bye !== null ? `Week ${bye}: bye. Then ${fixture}` : fixture)}</strong></span>` +
      // One unbreakable run: "1:00 PM" on one line with "ET" alone on the
      // next is the break it must not take.
      (when ? `<span class="scp-pstrip-when">${escapeHtml(when)}</span>` : "") +
      (band && game.matchup
        ? `<span class="scp-mchip ${band.cls}">${escapeHtml(`${ordinal(game.matchup.rank)} vs. ${game.matchup.position}s, ${band.word}`)}</span>`
        : "") +
      // The club's next game is still the club's next game; say plainly that
      // he is not on the active roster for it (no return date - see
      // rosterDesignation()).
      // Both forms printed; player.css shows the short one under 1100px.
      // The short one is aria-hidden, so a screen reader hears the note once.
      (rosterNote(data)
        ? `<span class="scp-pstrip-note">` +
          `<span class="scp-pstrip-note-full">${escapeHtml(rosterNote(data))}</span>` +
          `<span class="scp-pstrip-note-short" aria-hidden="true">${escapeHtml(rosterNoteShort(data))}</span>` +
          `</span>`
        : "") +
      (extras.matchupHref
        ? `<a class="scp-pstrip-link" href="${escapeHtml(extras.matchupHref)}" target="_top">View matchup<span aria-hidden="true">${ICON.arrow}</span></a>`
        : "") +
      `</div>`;
  }
  return strip;
}
