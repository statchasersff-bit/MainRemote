/**
 * The player profile header: photo well, identity, scoreboard, action strip.
 *
 * Its own module, like lib/matchup/scoreboard-hero.ts, for the same reason:
 * it is one self-contained component with a spec of its own (mak's, of
 * 2026-09-29), and keeping it off player-render.ts's import graph lets
 * tests/player-header.test.mjs render it against hand-built states without
 * loading the database the rest of the profile reads.
 *
 * Its styles are in player.css under "header", with their own tokens and face.
 */

import { escapeHtml } from "../render";
import { headshotImg } from "../headshot-html";
import { easternParts } from "../news-card";
import type { PlayerRenderOptions } from "../player-render";
import type { NflTeam } from "../team/teams";
import type { PlayerPageData } from "./player-data";
import { SCORING_SHORT } from "./scoring";
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
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * The season the Outlook tab is about.
 *
 * Named once rather than written into six strings: this tab is the one place
 * on the page allowed to talk about a season nobody has played, and the year it
 * means has to be impossible to leave half-updated.
 */
export const OUTLOOK_SEASON = 2026;

/**
 * A player's start/sit page is this plus his slug. The final address, not the
 * /launch/ path that redirects to it.
 */
export const STARTSIT_BASE =
  "https://statchasers.com/redraft-command/who-should-i-start/";

/**
 * Three bands, for a restrained tint rather than a red-to-green ramp.
 *
 * The rank is the reading and the colour is a hint underneath it, so only the
 * top and bottom thirds are tinted at all and the middle is left alone. A card
 * per fixture in full green or full red turns a schedule into a traffic light
 * and buries the thing the block is actually for, which is who and when.
 */
export type MatchupBand = "soft" | "mid" | "tough";

export function matchupBand(rank: number): MatchupBand {
  if (rank <= 10) return "soft";
  if (rank >= 23) return "tough";
  return "mid";
}

/**
 * How severe a designation is, for the pill's accent.
 *
 * Four buckets, matching the team hub's `injurySeverity` exactly so the same
 * status is the same colour on both pages. Anything unrecognised is treated as
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
function formatHeight(height: string | null): string {
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

/**
 * How wide a name sets in the header, in ems of its own font size.
 *
 * Measured in headless Chromium against Archivo 800 at 78% width: the longest
 * names on the site run 0.42–0.49em a character ("Marquez Valdes-Scantling" is
 * 10.75em, "Amon-Ra St. Brown" 8.34em). Half an em is the ceiling of that, so
 * the estimate errs wide and the name errs small rather than into the
 * scoreboard. player.css divides the column's width by this to cap the size.
 */
function nameEm(text: string): string {
  return (text.trim().length * 0.5 + 0.2).toFixed(2);
}

/** The word the name can least afford to break inside: where it may wrap. */
function longestWord(name: string): string {
  return name.trim().split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), "");
}

/* ------------------------------------------------------------ team ink */

/** WCAG relative luminance of a #rrggbb colour, or null for anything else. */
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

/** Contrast of white text on this colour. 0 for a colour that did not parse. */
function whiteContrast(hex: string): number {
  const l = luminance(hex);
  return l === null ? 0 : 1.05 / (l + 0.05);
}

/** The colour mixed toward black by `amount` (0–1). */
function darken(hex: string, amount: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const mix = (v: number): string =>
    Math.round(v * (1 - amount)).toString(16).padStart(2, "0");
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

/** WCAG AA for the 12px position tag, which is white text on this colour. */
const TEAM_INK_CONTRAST = 4.5;

/**
 * The club colour the header paints with: the photo well, the position tag,
 * the start of the accent bar.
 *
 * The primary where white text on it passes AA, else the secondary where
 * that passes, else the primary taken darker until it does. The third case is
 * real: Carolina, Miami and the Chargers all have a light primary AND a light
 * secondary, and swapping to a second failing colour fixes nothing. Darkening
 * keeps the club recognisable where a fallback to navy would not.
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

/** What the Stats tab covers, by position. */
const STAT_CATEGORIES: Record<string, string> = {
  QB: "passing, rushing",
  RB: "rushing, receiving",
  WR: "receiving",
  TE: "receiving",
  K: "kicking",
};

/**
 * The second line of the header's H1, per tab.
 *
 * The name and this line are one heading, so every tab's address has its own
 * H1 - "Jacoby Brissett / Game log: 2026 weekly stats and fantasy points" -
 * without the name itself ever changing. The nav links carry the line for
 * each tab (data-scp-kind) and client/player.ts swaps it on a click.
 */
export function headerKind(data: PlayerPageData, tab: string): string {
  const leagueSeason = data.leagueSeason ?? data.season;
  switch (tab) {
    case "stats": {
      const cats = STAT_CATEGORIES[data.player.position ?? ""];
      return `Stats: ${data.season} and career ${cats ? `${cats} and ` : ""}fantasy numbers`;
    }
    case "game-log":
      return `Game log: ${data.season} weekly stats and fantasy points`;
    case "outlook":
      return `${OUTLOOK_SEASON} fantasy outlook and rest-of-season projection`;
    case "injury":
      return "Injury status and history";
    case "news":
      return "Latest news and fantasy analysis";
    case "bio":
      return "Bio, career timeline and draft history";
    default: {
      const next = headerFixture(data);
      return next && !seasonNotStarted(data)
        ? `Fantasy outlook, stats and Week ${next.game.week} start/sit for ${leagueSeason}`
        : `Fantasy outlook and stats for ${leagueSeason}`;
    }
  }
}

/** The tab as the analytics attribute spells it: "game-log" is "gamelog". */
function ctaTab(tab: string): string {
  return tab.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/* ------------------------------------------------------- what is next */

/** Week 1 is not logged yet: there is nothing this season to start anyone in. */
function seasonNotStarted(data: PlayerPageData): boolean {
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
function headerFixture(
  data: PlayerPageData,
): { game: UpcomingGame; bye: number | null } | null {
  const game = data.upcoming[0];
  if (!game) return null;
  const bye = data.byeWeek ?? null;
  const byeNext = bye !== null && bye > (data.leagueWeek ?? 0) && bye < game.week;
  return { game, bye: byeNext ? bye : null };
}

/** "Sun Oct 4, 1:00 PM ET", or as much of it as ESPN has confirmed. */
function headerKickoff(game: UpcomingGame): string {
  if (game.kickoffMs === null) return "";
  const parts = easternParts(game.kickoffMs);
  const day = `${parts.weekday} ${parts.month} ${parts.day}`;
  return game.timeConfirmed ? `${day}, ${parts.time}` : day;
}

/** The strip's chip: the same three bands the Upcoming Matchups cards use. */
const CHIP_WORD: Record<MatchupBand, { cls: string; word: string }> = {
  soft: { cls: "is-good", word: "favorable" },
  mid: { cls: "is-mid", word: "neutral" },
  tough: { cls: "is-bad", word: "tough" },
};

/* ----------------------------------------------------------- scoreboard */

/**
 * An ownership share for the scoreboard: a whole number.
 *
 * Below one percent it reads "<1%" rather than "0%", which would claim nobody
 * rosters him. And 100% is reserved for 100%: thirty players sat at 99.0 or
 * above in the week this was written and one of them was in every league.
 */
function rosteredPct(value: number): string {
  if (value < 0.5) return "<1%";
  return `${Math.min(Math.round(value), value >= 100 ? 100 : 99)}%`;
}

interface BoardCell {
  label: string;
  value: string;
  lead?: boolean;
}

/**
 * The navy panel: rate, rank, ownership, with the season they belong to.
 *
 * All three cells always print, with a dash where a figure does not exist -
 * the one place on this page that does, because the panel is a fixed frame a
 * reader learns to read across profiles, and a two-cell panel on one player
 * reads as a layout bug. Never 0.0 for a player who has not played.
 */
function headerBoard(data: PlayerPageData): { caption: string; cells: BoardCell[] } {
  const { stats, format, player } = data;
  const played = Boolean(stats && stats.gamesPlayed > 0);

  const season = data.production.find((row) => row.season === data.season);
  // By points per game where that rank exists, by points scored until it does.
  const rank =
    season?.posFinishPpg ?? data.seasonRank ?? season?.posFinishTotal ?? data.seasonRankTotal;
  const pos = player.position ?? "";

  return {
    // "2026 Season", centred above the board (mak, 2026-09-30); the "final"
    // and "Through Week N" wording inside the board is gone.
    caption: `${data.season} Season`,
    cells: [
      {
        label: `${SCORING_SHORT[format]} PPG`,
        value: played && stats ? num(stats.ppg) : DASH,
        lead: true,
      },
      { label: "Pos rank", value: played && pos && rank != null ? `${pos}${rank}` : DASH },
      // Sleeper's redraft pool - see scripts/player/buildRosterPct.mjs.
      { label: "Rostered", value: data.rosterPct ? rosteredPct(data.rosterPct.owned) : DASH },
    ],
  };
}

/** Redraft Command's own page, for the header's rest-of-season button. */
const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

/**
 * A plain person, for a player with no usable headshot: head and shoulders,
 * the same proportions as Sleeper's cutouts, so the well does not change shape.
 */
const SILHOUETTE =
  `<svg class="scp-pwell-sil" viewBox="0 0 200 145" aria-hidden="true" focusable="false">` +
  `<circle cx="100" cy="52" r="34" />` +
  `<path d="M22 145c4-40 38-58 78-58s74 18 78 58z" />` +
  `</svg>`;

/**
 * The photo well: the club's colour, cut on the diagonal, with the jersey
 * number drawn in outline behind the headshot.
 *
 * Sleeper's thumbnails are transparent cutouts cropped at the chest, so the
 * figure stands on the well's floor rather than in a frame. The silhouette is
 * always in the markup, under the photo: client/player.ts marks the well
 * `is-missing` when the image fails, and a player with no source at all ships
 * that way. Either way the well is the same size, because the image carries
 * its own width and height.
 */
function renderPhotoWell(data: PlayerPageData): string {
  const { player } = data;
  const jersey = player.number
    ? `<span class="scp-pwell-num" aria-hidden="true">${escapeHtml(String(player.number))}</span>`
    : "";
  // The full figure at its own 350x254 ratio, drawn 200px wide (160 on a
  // phone): the f200 derivative for 1x screens and the f350 original size for
  // 2x, versioned and WebP (headshot-html.ts). Still the LCP candidate, so
  // eager and at high priority. Both of those are spelled out because WP
  // Rocket's LazyLoad rewrote this tag on the live site (2026-10-08): it
  // swapped the src for a blank SVG and parked the real URLs in data-lazy-*,
  // which defeats the priority hint. Rocket leaves alone any <img> carrying
  // loading="eager" or data-no-lazy, and so do the other lazy-load plugins
  // that honour that attribute; the news plugin also names this class in
  // Rocket's exclusion filter. A player known to have no photo ships the
  // silhouette.
  const img =
    headshotImg({
      src: player.headshotUrl,
      id: player.id,
      className: "scp-pwell-img",
      alt: `${player.name} headshot`,
      variants: ["f200", "f350"],
      sizes: "(max-width: 640px) 160px, 200px",
      width: 350,
      height: 254,
      loading: "eager",
      fetchpriority: "high",
      extra: ' data-no-lazy="1"',
    }) ?? "";
  return (
    `<div class="scp-pwell${img ? "" : " is-missing"}" data-scp-pwell>` +
    jersey +
    SILHOUETTE +
    img +
    `</div>`
  );
}

/** The designation pill's tone: amber for questionable, red for anything worse. */
function injuryPill(
  status: string,
  href: string,
): string {
  const severity = designationSeverity(status);
  const key = status.trim().toLowerCase();
  const label = /^ir\b/.test(key) || key.includes("injured reserve") ? "IR" : status.trim();
  const tone = severity === "out" || severity === "doubtful" ? "is-bad" : "is-mid";
  return (
    `<a class="scp-ptag-inj ${tone}" href="${escapeHtml(href)}" target="_top">` +
    `${escapeHtml(label)}</a>`
  );
}

/**
 * The profile header: photo well, identity, scoreboard, and the strip under
 * them with the next matchup and the two ways on.
 *
 * `tab` is the panel the page opens on. It picks the H1's second line and the
 * analytics tag on both buttons; the nav links carry the same two things for
 * every other tab, so a click can update them without the server.
 *
 * Exported for tests/player-header.test.mjs, which renders it against
 * hand-built states (a bye, a free agent, the offseason) that the fixture
 * roster cannot be relied on to contain on any given day.
 */
export function renderHero(
  data: PlayerPageData,
  options: PlayerRenderOptions,
  tab = "overview",
): string {
  const { player, team } = data;
  // The page's H1 on the standalone page. Embedded it is an H2, including when
  // the tool supplies the heading: that H1 is a panel's promoted heading, the
  // keyword phrase the SEO audit asked for - see promoteHeading().
  const Heading = options.embed ? "h2" : "h1";
  const prefix = options.playerPathPrefix ?? "/player/";
  const teamPrefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";
  const tabUrl = (id: string): string => `${prefix}${player.slug}/${id}/${query}`;

  /* ---- the tag row ---- */

  const tags: string[] = [];
  if (player.position) {
    tags.push(`<span class="scp-ptag-pos">${escapeHtml(player.position)}</span>`);
  }
  tags.push(
    team
      ? `<a class="scp-ptag-team" href="${escapeHtml(`${teamPrefix}${team.slug}/${query}`)}"` +
          ` target="_top">${escapeHtml(team.fullName)}</a>`
      : `<span class="scp-ptag-team">Free agent</span>`,
  );
  if (player.number) {
    tags.push(`<span class="scp-ptag-num">#${escapeHtml(String(player.number))}</span>`);
  }
  const status = data.designation?.injuryStatus ?? player.injury_status ?? "";
  if (status.trim()) tags.push(injuryPill(status, tabUrl("injury")));

  /* ---- the spec row ---- */

  const spec: Array<[string, string]> = [];
  if (player.age) spec.push(["Age", String(player.age)]);
  const height = formatHeight(player.height);
  const build = [height, player.weight ? `${player.weight} lb` : ""].filter(Boolean).join(", ");
  if (build) spec.push(["Height / weight", build]);
  if (player.years_exp !== null && player.years_exp !== undefined) {
    spec.push([
      "Experience",
      player.years_exp === 0 ? "Rookie" : `${ordinal(player.years_exp + 1)} season`,
    ]);
  }
  // Only when the year, the round and the pick are all known. draft.json
  // writes the same null row for an undrafted player as for one whose draft
  // is simply not recorded, so "Undrafted" would be a guess - see bio.ts.
  const draft = data.bioProfile.draft;
  if (draft && draft.year && draft.round && draft.pick) {
    spec.push(["Drafted", `${draft.year} R${draft.round}, #${draft.pick}`]);
  }
  const specRow = spec.length
    ? `<dl class="scp-pspec">` +
      spec
        .map(([dt, dd]) => `<div><dt>${escapeHtml(dt)}</dt> <dd>${escapeHtml(dd)}</dd></div>`)
        .join(" ") +
      `</dl>`
    : "";

  /* ---- the scoreboard ---- */

  const board = headerBoard(data);
  const scoreboard =
    `<div class="scp-pboard-wrap">` +
    `<p class="scp-pboard-cap">${escapeHtml(board.caption)}</p>` +
    `<div class="scp-pboard">` +
    `<dl class="scp-pboard-stats">` +
    board.cells
      .map(
        (cell) =>
          `<div${cell.lead ? ` class="is-lead"` : ""}>` +
          `<dt>${escapeHtml(cell.label)}</dt> <dd>${escapeHtml(cell.value)}</dd></div>`,
      )
      .join(" ") +
    `</dl></div></div>`;

  /* ---- the strip ---- */

  const cta = ctaTab(tab);
  const last = lastName(player.name);
  const next = headerFixture(data);
  let strip = "";
  if (team) {
    let line = "";
    if (next) {
      const { game, bye } = next;
      const opp = game.opponent?.nickname ?? game.opponentName;
      const fixture = `Week ${game.week} ${game.homeAway === "away" ? "at" : "vs."} ${opp}`;
      const when = headerKickoff(game);
      const text = bye !== null
        ? `<strong>${escapeHtml(`Week ${bye}: bye.`)}</strong>` +
          escapeHtml(` Next game ${fixture}${when ? `, ${when}` : ""}`)
        : `<strong>${escapeHtml(fixture)}</strong>${when ? escapeHtml(`, ${when}`) : ""}`;
      const band = game.matchup ? CHIP_WORD[matchupBand(game.matchup.rank)] : null;
      const chip =
        band && game.matchup
          ? `<span class="scp-mchip ${band.cls}">${escapeHtml(
              `${ordinal(game.matchup.rank)} vs. ${game.matchup.position}s, ${band.word}`,
            )}</span>`
          : "";
      // Spaces between the flex items, which the layout ignores, so the line's
      // text reads as words rather than "1:00 PM ET8th vs. QBs".
      line = `<p class="scp-pstrip-mu"><span>${text}</span>${chip ? ` ${chip}` : ""}</p>`;
    }

    // Start/sit while there is a week to start him in; before Week 1, or once
    // the schedule has run out, the question is the season rather than a week.
    let primary = "";
    if (next && !seasonNotStarted(data)) {
      const href = `${options.startSitBase ?? STARTSIT_BASE}${encodeURIComponent(player.slug)}`;
      primary =
        `<a class="scp-pbtn scp-pbtn--dark" href="${escapeHtml(href)}"` +
        ` data-cta="startsit-header-${cta}" data-scp-cta="startsit-header">` +
        `${escapeHtml(`Should I start ${last} in Week ${next.game.week}?`)}</a>`;
    } else if (data.fantasyOutlook2026) {
      primary =
        `<a class="scp-pbtn scp-pbtn--dark" href="${escapeHtml(tabUrl("outlook"))}"` +
        ` target="_top" data-cta="outlook-header-${cta}" data-scp-cta="outlook-header">` +
        `${escapeHtml(`See ${last}'s ${OUTLOOK_SEASON} outlook`)}</a>`;
    }
    const redraft =
      `<a class="scp-pbtn scp-pbtn--line"` +
      ` href="${escapeHtml(`${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(player.slug)}`)}"` +
      ` data-cta="redraft-command-header-${cta}" data-scp-cta="redraft-command-header">` +
      `Rest-of-season value in Redraft Command</a>`;

    strip =
      `<div class="scp-pstrip">` +
      line +
      `<div class="scp-pstrip-acts">${[primary, redraft].filter(Boolean).join(" ")}</div>` +
      `</div>`;
  }

  const ink = teamInk(team);
  return (
    `<header class="scp-phead" aria-label="Player summary"` +
    styleAttr([ink && `--scp-team:${ink}`]) +
    `>` +
    `<div class="scp-phead-main">` +
    renderPhotoWell(data) +
    `<div class="scp-pid">` +
    `<div class="scp-ptags">${tags.join(" ")}</div>` +
    `<${Heading} class="scp-phead-h1">` +
    `<span class="scp-phead-name"${styleAttr([
      `--scp-name-em:${nameEm(player.name)}`,
      `--scp-word-em:${nameEm(longestWord(player.name))}`,
    ])}>` +
    player.name
      .trim()
      .split(/\s+/)
      .map((word) => `<span class="scp-phead-word">${escapeHtml(word)}</span>`)
      .join(" ") +
    `</span> ` +
    `<span class="scp-phead-kind">${escapeHtml(headerKind(data, tab))}</span>` +
    `</${Heading}>` +
    specRow +
    `</div>` +
    scoreboard +
    `</div>` +
    strip +
    `</header>`
  );
}
