/**
 * Markup for Fantasy Points Allowed.
 *
 * Server-only, like team-render.ts and player-render.ts. The whole table - all
 * 32 defenses, every rank, both views - is in the response, and client/fpa.ts
 * only adds column sorting on top of it.
 *
 * The rules are the other tools':
 *
 * 1. A field we do not have is not rendered, and a table with nothing ingested
 *    is no table rather than 32 rows of zeroes.
 * 2. Nothing predicts. This page reports what defenses have allowed and ranks
 *    it; it does not say who to start.
 *
 * And one this table needs specifically:
 *
 * 3. **The number says what it is a mix of.** Early in a season the figure is
 *    mostly last season's, and a rank presented without that caveat is the page
 *    lying by omission. The data-mode note sat above the table for that reason;
 *    since 2026-10-10 (mak's spec) it sits directly under it, so that the first
 *    thing read is the week range in the heading and the answer sentence, and
 *    the note is still met before the legend and the FAQ. The "Updated ...,
 *    through Week N" line under the H1 carries the currency the note used to
 *    lead with.
 *
 * A note on color. Rank 1 is the softest defense and rank 32 the toughest,
 * with league average in the middle - that is a DIVERGING scale, not an ordinal
 * one, so it takes two hues either side of a neutral rather than one ramp.
 * Green is the exploitable pole and red the one to avoid, and only the top and
 * bottom twelve are tinted at all - the eight ranks around the median stay white.
 * Red-green is the pair color blindness erases, so the arms are NOT symmetric:
 * red runs 0.080 darker than its green mirror, which is what keeps the mirrored
 * pairs at ΔE 15.6 under protanopia and 7.5 under deuteranopia rather than ~1.
 * 7.5 is the floor band, legal only because there is a second encoding - every
 * tinted cell carries its rank (visually hidden since 2026-10-08 at mak's
 * request, still read out by screen readers and shown in the cell's tooltip),
 * and the rows arrive sorted by it. See fpa.css for the full derivation.
 */

import { escapeHtml, escapeJsonLd } from "./render";
import { DEFAULT_FPA_FORMAT, currentSeasonWeight } from "./fpa/blend";
import { ROLLING_WINDOW_WEEKS } from "./fpa/math";
import { HOUSE_RULES, RECEPTION_POINTS } from "./scoring/house-rules";
import type { FpaRow, FpaTableData, FpaView } from "./fpa/fpa-data";
import { FANTASY_POSITIONS, type FantasyPosition, type ScoringFormat } from "./fpa/nflverse";
import { fpaPageCopy, fpaScopeLabel, teamLabel, type FpaPageCopy } from "./fpa-seo";
import { SOS_DEFAULT_PAGE_BASE, sosPagePath } from "./sos-render";

/** Where the Related links point. Absolute: this markup is printed inside statchasers.com. */
const SITE = "https://statchasers.com";

export interface FpaRenderOptions {
  /**
   * Embedded inside a statchasers.com page: drops the standalone chrome and
   * demotes the title to an <h2>, because the host page supplies the H1.
   */
  embed?: boolean;
  /**
   * The page's own path, which the season links are built on (`<base>/2025/`
   * and back). Defaults to this app's own /fpa.
   */
  basePath?: string;
  /**
   * Where the CSV lives. Defaults to this app's own /fpa.
   *
   * Deliberately NOT `basePath`. That one is a WordPress page path once
   * SC_FPA_PATH is set, and the CSV is not a WordPress page - it is a route on
   * this server. Building it from `basePath` produced
   * `/nfl/fantasy-points-allowed-by-position//download.csv`, which is not a
   * path on the site at all: a browser reads a leading `//` as
   * protocol-relative and goes looking for a HOST called `download.csv`.
   *
   * So the embed passes an absolute URL to this origin, for the same reason
   * `endpoint` does, and the standalone page leaves it at the default.
   */
  csvBase?: string;
  /** Where a team link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /** Carried onto internal links so embed mode stays embed mode. */
  linkQuery?: string;
  /**
   * Where the bundle fetches the other five combinations from.
   *
   * The controls are real links and stay real links - but a click on one
   * should not change the address of the page a reader is on, so the bundle
   * intercepts it and swaps the table in place instead. To do that it needs
   * an address for the fragment, and it cannot derive one: embedded, this
   * markup is printed inside a statchasers.com page, and `/embed/fpa` there
   * resolves against WordPress rather than against this app. So the server
   * says where it lives, absolute for the embed and relative for its own page.
   *
   * Left unset the bundle does nothing and every control navigates, which is
   * what a reader with scripting off gets either way.
   */
  endpoint?: string;
  /** Rendered for testability; the cache keys on the data, not on this. */
  now?: number;
  /**
   * Where the strength-of-schedule pages live - the rail's view links and
   * every position cell point there. This app's own /strength-of-schedule by
   * default, the WordPress page's path in the embed fragment; the position
   * pages are `<base>/rb/` and so on, as sosPagePath() spells them.
   */
  sosBase?: string;
}

/** The team a card leads with: the easiest remaining schedule, as the board scores it. */
export interface FpaRailTeam {
  code: string;
  fullName: string;
  logo: string;
  /** Average opponent aFPA over the remaining weeks. */
  afpa: number;
  /** Against the mean of every team on the board. */
  delta: number;
}

/**
 * What a position card previews: the easiest remaining schedule, in the dress
 * the strength-of-schedule page's own cards wear - crest, code, figure, name,
 * delta - from the SAME boards the linked pages render (fpa-ssr.ts reads
 * them through rosEasiest, sos-model.ts). Null when there is nothing to show
 * - no schedule, no weeks left, an archive season - and the cards are then
 * title and note only.
 */
export interface FpaRail {
  teaser: Record<FantasyPosition, { top: FpaRailTeam; easiest: { code: string; fullName: string }[] }> | null;
  /**
   * The week the Start/Sit card names: the start/sit tool's own week
   * (startSitWeek()), never the FPA table's. Null or absent: "This week".
   */
  startSitWeek?: number | null;
}

/**
 * The week the start/sit tool is on (2026-11-20). The card links to
 * /redraft-command/who-should-i-start, whose "Who Should I Start in Week N?"
 * is Sleeper's /v1/state/nfl week during the regular season and playoffs
 * (redraft-command server/nflState.ts fantasyWeek; it rolls on Tuesday
 * morning ET). The card reads the same state, so its week moves when the
 * tool's does - not when FPA data lands. Until 11-20 it said "Week N+1" off
 * the FPA table, which read "Week 12" after Week 11's Thursday game.
 */
export function startSitWeek(state: { seasonType: string; week: number } | null | undefined): number | null {
  if (!state) return null;
  if (state.seasonType !== "regular" && state.seasonType !== "post") return null;
  return Number.isInteger(state.week) && state.week >= 1 ? state.week : null;
}

/** How many easiest defenses a card's label names. */
export const TEASER_COUNT = 3;

const DASH = "-";

const FORMAT_LABELS: Record<ScoringFormat, string> = {
  standard: "Standard",
  half: "Half-PPR",
  ppr: "PPR",
};

/*
 * Shorter stand-ins for the narrowest screens. Only the two that are long
 * enough to matter differ; PPR is already as short as it gets, so it has no
 * entry and renders as itself either way.
 */
const FORMAT_ABBR: Partial<Record<ScoringFormat, string>> = {
  standard: "Std",
  half: "Half",
};

/*
 * The controls name the two things by the names the rest of the page uses for
 * them - FPA and aFPA - rather than describing them. "Raw" and "Adjusted"
 * describe a treatment; the page, the FAQ and the column headers all talk about
 * FPA and aFPA, and a reader who has met those two acronyms should find them on
 * the switch that produces them.
 */
const VIEW_LABELS: Record<FpaView, string> = {
  raw: "FPA",
  adjusted: "aFPA",
};

/* The same two in prose, for sentences an acronym would read badly in. */
const VIEW_NAMES: Record<FpaView, string> = {
  raw: "raw",
  adjusted: "adjusted",
};

function styleAttr(parts: Array<string | null | false>): string {
  const kept = parts.filter((p): p is string => typeof p === "string" && p !== "");
  return kept.length ? ` style="${escapeHtml(kept.join(";"))}"` : "";
}

function num(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : DASH;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/* ------------------------------------------------------------- the scale */

// The tier scale is shared with the player pages (fpa/matchup-bands.ts).
export { matchupTier, type MatchupTier } from "./fpa/matchup-bands";
import { matchupTier, type MatchupTier } from "./fpa/matchup-bands";

const TIER_LABEL: Record<MatchupTier, string> = {
  "soft-2": "Softest (1–6)",
  "soft-1": "Soft (7–12)",
  mid: "Middle of the pack (13–20)",
  "tough-1": "Tough (21–26)",
  "tough-2": "Toughest (27–32)",
};

/**
 * The scoring-format and view controls.
 *
 * Buttons, not links (WEB-020, 2026-11-27). Both genuinely change every
 * number in the table, but the six combinations are one page - the canonical
 * has always said so - and as links they printed `?format=half`,
 * `?format=standard` and `?view=adjusted` into the HTML of the current page
 * AND the archive, where a crawler queued them as addresses (and the
 * archive's three pointed at the CURRENT season's page). As buttons there is
 * nothing to queue. The bundle (client/fpa.ts) fetches the combination and
 * writes it to the address as a fragment, `#format=half&view=adjusted`, which
 * is what makes it shareable; an old `?format=&view=` bookmark is still
 * rendered by the server. `aria-pressed` says which one is on, and the group
 * is named for a screen reader by the same word printed above it. With
 * scripting off the page's own table is already on screen.
 */
function renderControls(data: FpaTableData): string {
  /*
   * An option's text, with its narrow-screen stand-in beside it when it has
   * one. Both are in the markup and CSS shows one - but with display:none, not
   * clipping, so the hidden one leaves the accessibility tree too and a screen
   * reader never reads "Standard Std".
   */
  const optionText = (text: string, abbr?: string): string =>
    abbr && abbr !== text
      ? `<span class="scf-opt-full">${escapeHtml(text)}</span>` +
        `<span class="scf-opt-abbr">${escapeHtml(abbr)}</span>`
      : escapeHtml(text);

  const group = (
    label: string,
    items: {
      text: string;
      abbr?: string;
      title: string;
      active: boolean;
      /* What this option selects, for the bundle. */
      data: string;
    }[],
  ): string =>
    `<div class="scf-control">` +
    `<span class="scf-control-label" aria-hidden="true">${escapeHtml(label)}</span>` +
    `<div class="scf-opts" role="group" aria-label="${escapeHtml(label)}">` +
    items
      .map(
        (item) =>
          `<button type="button" class="scf-opt${item.active ? " is-active" : ""}"` +
          item.data +
          ` title="${escapeHtml(item.title)}"` +
          ` aria-pressed="${item.active ? "true" : "false"}"` +
          `>${optionText(item.text, item.abbr)}</button>`,
      )
      .join("") +
    `</div>` +
    `</div>`;

  const formats = (["standard", "half", "ppr"] as ScoringFormat[]).map(
    (format) => ({
      text: FORMAT_LABELS[format],
      abbr: FORMAT_ABBR[format],
      title: `Recompute every figure in ${FORMAT_LABELS[format]} scoring`,
      active: format === data.format,
      data: ` data-scf-format="${escapeHtml(format)}"`,
    }),
  );

  const views = (["raw", "adjusted"] as FpaView[]).map((view) => ({
    text: VIEW_LABELS[view],
    title:
      view === "raw"
        ? "Points allowed per game, as measured"
        : "The same, corrected for the strength of the offenses each defense faced",
    active: view === data.view,
    data: ` data-scf-view="${escapeHtml(view)}"`,
  }));

  return (
    `<div class="scf-controls">` +
    // The two groups are one unit: they are a single choice made twice, and
    // splitting them across rows reads as two unrelated widgets. The wrapper
    // refuses to wrap, and the abbreviations are what pays instead.
    `<div class="scf-control-set">` +
    group("Scoring", formats) +
    group("View", views) +
    `</div>` +
    // The legend, where the Download CSV link used to be (mak, 2026-11-04):
    // the key to the tints sits on the row that sets them, right-aligned.
    // The CSV route (/fpa/download.csv) still serves; the page just no
    // longer links it.
    renderLegend() +
    `</div>`
  );
}

/* --------------------------------------------------------------- the table */

/**
 * One tinted cell. With a `link`, the figure is a link to that team's schedule
 * against the position (mak's rail spec, 2026-11-04): the cells ARE the
 * click-through, in place of a column of five text links per row. The tint,
 * the figure and the rank are unchanged; the link's label says where it goes
 * ("Detroit RB schedule") for a reader who cannot see which column this is.
 */
function renderCell(
  entry: { fpa: number; rank: number },
  link: { href: string; label: string } | null = null,
): string {
  const tier = matchupTier(entry.rank);
  const inner =
    `<span class="scf-fpa">${escapeHtml(num(entry.fpa))}</span>` +
    `<span class="scf-rank">${entry.rank}</span>`;
  return (
    // The title sits on the cell, not the rank: the rank is clipped out of
    // sight (fpa.css, .scf-rank), and a tooltip on a 1px box is no tooltip.
    `<td class="scf-cell" data-tier="${tier}" data-sort="${entry.fpa}" title="${escapeHtml(
      `${ordinal(entry.rank)} most points allowed - ${TIER_LABEL[tier]}`,
    )}">` +
    (link
      ? `<a class="scf-cell-link" href="${escapeHtml(link.href)}" aria-label="${escapeHtml(link.label)}" target="_top">${inner}</a>`
      : inner) +
    `</td>`
  );
}

function renderRow(row: FpaRow, rows: FpaRow[], options: FpaRenderOptions): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";
  const sosBase = options.sosBase ?? SOS_DEFAULT_PAGE_BASE;
  const team = row.team;
  const scheduleHref = team ? `${prefix}${team.slug}/schedule/${query}` : null;
  // "Detroit", or the full name where two clubs share a city (fpa-seo.ts).
  const label = teamLabel(row, rows);

  // Crest, then the abbreviation with the full name under it. The abbreviation
  // is what a reader scanning 32 rows actually matches on - it is how the team
  // is written everywhere else in fantasy - and the full name below it is there
  // for anyone who does not know the three letters cold.
  const identity =
    `<span class="scf-team-id">` +
    `<span class="scf-team-abbr">${escapeHtml(row.abbr)}</span>` +
    // Both spellings are in the markup and CSS shows one: the full name, or
    // the nickname ("Panthers") once the rail beside the table has squeezed
    // the column (mak, 2026-11-04). display:none, not clipping, so a screen
    // reader never hears "Carolina Panthers Panthers".
    `<span class="scf-team-name">` +
    `<span class="scf-team-name-full">${escapeHtml(row.name)}</span>` +
    (team ? `<span class="scf-team-name-short">${escapeHtml(team.nickname)}</span>` : "") +
    `</span>` +
    `</span>`;

  // The team's schedule page rather than its hub (mak, 2026-10-10): a reader
  // looking at what a defense allows wants to see who it plays next.
  const name =
    team && scheduleHref
    ? `<a class="scf-team-link" href="${escapeHtml(scheduleHref)}" target="_top">` +
      `<img class="scf-team-logo" src="${escapeHtml(team.logo)}" alt=""` +
      ` width="22" height="22" loading="lazy" decoding="async" />` +
      `${identity}</a>`
    : `<span class="scf-team-link is-plain">${identity}</span>`;

  return (
    `<tr class="scf-row" data-team="${escapeHtml(row.abbr)}">` +
    // The sort key is stated rather than read off the cell: the cell's text is
    // now the abbreviation and the name run together, and sorting on
    // "CARCarolina Panthers" would work by accident rather than on purpose.
    `<th scope="row" class="scf-team" data-sort="${escapeHtml(row.abbr)}">${name}</th>` +
    // Each position cell lands on the team's row of that position's
    // strength-of-schedule board (`/rb/#scsos-team-det`): the page that
    // shows who this defense plays next, against this position. A row the
    // team table cannot resolve has no page to land on and stays plain.
    FANTASY_POSITIONS.map((p) =>
      renderCell(
        row.byPos[p],
        team
          ? {
              href: `${sosPagePath(sosBase, p.toLowerCase() as "qb" | "rb" | "wr" | "te")}#scsos-team-${team.abbreviation}`,
              label: `${label} ${p} schedule`,
            }
          : null,
      ),
    ).join("") +
    // OFF is the four summed, not a position, so it has no board of its own;
    // it goes where the team cell goes, the team's full schedule.
    renderCell(
      { fpa: row.offFpa, rank: row.offRank },
      scheduleHref ? { href: scheduleHref, label: `${label} schedule` } : null,
    ) +
    `<td class="scf-games" data-sort="${row.gamesPlayed}">${row.gamesPlayed}` +
    // The row-end affordance: shown on hover (fpa.css), so the click-through
    // is discoverable without a column of links. Decorative; the cells carry
    // the labels.
    `<span class="scf-row-go" aria-hidden="true"><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` +
    `</td>` +
    `</tr>`
  );
}

function renderTable(data: FpaTableData, options: FpaRenderOptions): string {
  const head =
    `<tr>` +
    `<th scope="col" class="scf-th-team" data-sort-type="text">Defense</th>` +
    FANTASY_POSITIONS.map(
      (p) =>
        `<th scope="col" data-sort-type="number" title="${escapeHtml(
          `Fantasy points allowed to ${p}s per game, and where that ranks`,
        )}">${p}</th>`,
    ).join("") +
    // The rows arrive in OFF rank order (fpa-data.ts), so that column says
    // so before the bundle runs: a screen reader hears which way the table
    // is sorted, and the arrow is on screen from the first paint.
    `<th scope="col" data-sort-type="number" aria-sort="descending" title="${escapeHtml(
      "The four positions summed - the whole fantasy offense",
    )}">OFF</th>` +
    // Named for the season rather than "Games Played". Early in a season the
    // figure is mostly LAST season's, so a bare "Games Played: 1" beside it
    // reads as the sample the number came from, which it is not.
    `<th scope="col" class="scf-th-games" data-sort-type="number" title="${escapeHtml(
      `${data.season} games played. Early in the season the figures are still ` +
        `mostly the prior season's - see the note above.`,
    )}">${escapeHtml(String(data.season))} G</th>` +
    `</tr>`;

  return (
    `<div class="scf-scroll">` +
    `<table class="scf-table" data-scf-table>` +
    // The scope label leads the caption: this table is season-to-date, the
    // rail's views are forward-looking, and the week range is what tells a
    // reader moving between them which is which.
    `<caption class="scf-caption"><span class="scf-scope">${escapeHtml(fpaScopeLabel(data))}.</span> ${escapeHtml(
      `All 32 NFL defenses, ` +
        `${FORMAT_LABELS[data.format]} scoring, ${VIEW_NAMES[data.view]} view. ` +
        `Rank 1 is the most points allowed, i.e. the softest matchup. ` +
        `Each cell opens that team's schedule against the position.`,
    )}</caption>` +
    `<thead>${head}</thead>` +
    `<tbody>${data.rows.map((row) => renderRow(row, data.rows, options)).join("")}</tbody>` +
    `</table></div>`
  );
}

/**
 * The legend.
 *
 * Present because the cells are tinted, and a color scale with no key is a
 * decoration. Every swatch names its arm in words as well.
 */
function renderLegend(): string {
  const items = (["soft-2", "soft-1", "tough-1", "tough-2"] as MatchupTier[])
    .map(
      (tier) =>
        `<li class="scf-legend-item">` +
        `<span class="scf-legend-swatch" data-tier="${tier}" aria-hidden="true"></span>` +
        `<span class="scf-legend-label">${escapeHtml(TIER_LABEL[tier])}</span>` +
        `</li>`,
    )
    .join("");
  return `<div class="scf-legend-wrap"><ul class="scf-legend">${items}</ul></div>`;
}

/*
 * The FAQ.
 *
 * Reference copy, and the one part of this page written for search rather than
 * for the reader already looking at the table - which is why it is the only
 * part with headings. Everything else here deliberately ships none, because the
 * WordPress page owns the H1 and a fragment that invents its own outline fights
 * it. An FAQ is the exception: the question IS the structure, and a <p> in bold
 * would be a heading that no crawler and no screen reader can see.
 *
 * Below the table, not above it. Somebody who arrived from a search for "what
 * is adjusted fantasy points allowed" gets their answer either way; somebody
 * who came to read the table should not have to scroll past an essay first.
 *
 * Five questions on the current page, three on a finished season's (WEB-030,
 * 2026-11-27). It was nineteen, most of them one question asked per position
 * ("Which teams allow the most fantasy points to RBs?" and so on) with answers
 * that only said to look at the table. What is left is what the table cannot
 * say about itself: what the number is, how scoring moves it, what the
 * adjustment does, what a bye and last season do to it, and when it changes.
 *
 * Built from the table rather than written as a constant, for two reasons.
 * The season names are the table's own, so an archive's questions talk about
 * its season and nothing on it mentions a current week. And the figures the
 * answers quote - the scoring coefficients, the blend weights, the rolling
 * window - are read from the code that applies them (house-rules.ts,
 * blend.ts, math.ts), so the prose cannot describe arithmetic the ingest does
 * not do. The visible FAQ and the FAQPage data both come from this one list.
 */

export interface FpaFaqItem {
  q: string;
  /** One answer, as paragraphs. */
  a: readonly string[];
}

/** "0.5" or "1", never "1.0". */
function points(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The scoring rules every format shares, as one clause. */
function sharedScoring(): string {
  const r = HOUSE_RULES;
  return (
    `${points(r.passYd)} points per passing yard, ${points(r.passTd)} per passing touchdown, ` +
    `${points(r.passInt)} per interception, ${points(r.rushYd)} per rushing or receiving yard, ` +
    `${points(r.rushTd)} per rushing or receiving touchdown, ${points(r.twoPt)} per two-point ` +
    `conversion and ${points(r.fumLost)} per fumble lost`
  );
}

/** The first week count at which the current season stands alone (the rolling window). */
function blendDropWeek(): number {
  for (let week = 1; week <= 18; week++) {
    if (currentSeasonWeight(week) >= 1) return week;
  }
  return 18;
}

/**
 * The blend as a schedule: the weight of the current season after each of
 * the first four weeks, the weight it climbs to, and the week the previous
 * season drops out. Read off currentSeasonWeight(), not retyped.
 */
function blendSchedule(season: number, baseline: number): string {
  const pct = (week: number) => Math.round(currentSeasonWeight(week) * 100);
  const dropWeek = blendDropWeek();
  let cap = 0;
  for (let week = 1; week < dropWeek; week++) cap = Math.max(cap, pct(week));
  const step = pct(5) - pct(4);
  return (
    `Early in the season a game or two is a small sample, so the ${season} figure is ` +
    `blended with the ${baseline} full-season figure (Weeks 1-17). ${season} games count for ` +
    `${pct(1)}% after one week of games, ${pct(2)}% after two, ${pct(3)}% after three and ` +
    `${pct(4)}% after four, then ${step} percentage points more each week up to ${cap}%. ` +
    `Only complete weeks count: a week joins the table once all of its games are in, so a ` +
    `Thursday game waits for the rest of its week. ` +
    `Once a ${ordinal(dropWeek)} complete week is in, ${baseline} drops out and the table reads ` +
    `only the most recent ${ROLLING_WINDOW_WEEKS} weeks of ${season} games.`
  );
}

/** The current page's questions. */
function liveFaq(data: FpaTableData): FpaFaqItem[] {
  const season = data.season;
  const baseline = data.baselineSeason;
  return [
    {
      q: "What does Fantasy Points Allowed (FPA) measure?",
      a: [
        "Fantasy Points Allowed is the fantasy production an NFL defense has given up to one " +
          "position, per game it has played: the points scored against it by opposing " +
          "quarterbacks, running backs, wide receivers or tight ends, added up for each position " +
          "and divided by that defense's games. OFF is the four positions added together.",
        "Every column is ranked across all 32 defenses. Rank 1 has allowed the most points, the " +
          "softest matchup, and rank 32 the fewest, the toughest. Two defenses on the same figure " +
          "are ordered alphabetically by team abbreviation.",
      ],
    },
    {
      q: "How does the scoring format change FPA?",
      a: [
        `Only receptions are scored differently. All three formats count ${sharedScoring()}. ` +
          `Half-PPR adds ${points(RECEPTION_POINTS.half)} points per reception and PPR adds ` +
          `${points(RECEPTION_POINTS.ppr)}.`,
        "So the formats differ most at the positions that catch the most passes, and a defense " +
          "that gives up a lot of catches can rank softer in PPR than in Standard. The table " +
          `opens in ${FORMAT_LABELS[DEFAULT_FPA_FORMAT]}; the scoring control above it switches format.`,
      ],
    },
    {
      q: `What is the difference between raw FPA and adjusted FPA (${VIEW_LABELS.adjusted})?`,
      a: [
        "Raw FPA is what a defense has actually allowed per game. Adjusted FPA corrects that " +
          "figure for the offenses it faced: for each position, every opponent's own fantasy " +
          "points per game at that position are averaged over the games the defense played (a " +
          "team faced twice counts twice), and the gap between that average and the league " +
          "average for the position is subtracted from the raw figure.",
        "A defense whose opponents averaged 2 points a game above the league average at wide " +
          "receiver has 2 points taken off its raw WR figure; one that faced below-average " +
          "offenses has the difference added. The View switch above the table shows either, " +
          `labeled ${VIEW_LABELS.raw} and ${VIEW_LABELS.adjusted}.`,
      ],
    },
    {
      q: "How do games played, byes and last season affect the figure?",
      a: [
        "Every figure is per game the defense played, so a bye is not a game and costs nothing: " +
          "a defense that has had its bye is compared on the same terms as one that has not. The " +
          "Games column shows how many games the current figure covers.",
        blendSchedule(season, baseline),
        `The current table: ${data.methodology}`,
      ],
    },
    {
      q: "When is the FPA table updated?",
      a: [
        "The table is recalculated after NFL games are played, from each game's published player " +
          "stats. The line under the page heading gives the date of the last update and the last " +
          "week the figures hold in full, and names any games already counted from a week still " +
          "being played.",
      ],
    },
  ];
}

/** A finished season's questions: its coverage, its method, its place in the next season's table. */
function archiveFaq(data: FpaTableData): FpaFaqItem[] {
  const season = data.season;
  const through = data.weekNumber ?? 17;
  const items: FpaFaqItem[] = [
    {
      q: `What does the ${season} Fantasy Points Allowed table cover?`,
      a: [
        `The complete ${season} NFL regular season, Weeks 1-${through}, for all 32 defenses: ` +
          "fantasy points allowed per game to quarterbacks, running backs, wide receivers and " +
          "tight ends, with OFF as the four added together. Week 18 is left out, as it is from " +
          "the current table, because so many starters rest in the final week.",
        `Every figure is ${season} data only, with nothing blended in from another season, and ` +
          "the season is over, so these are its final figures rather than a running total.",
      ],
    },
    {
      q: `How are the ${season} figures and ranks calculated?`,
      a: [
        "The same way as the current table, without the blend. Each figure is the points a " +
          "position scored against the defense, divided by the games that defense played in " +
          `Weeks 1-${through}, so a bye does not count as a game. Adjusted FPA ` +
          `(${VIEW_LABELS.adjusted}) then takes out the strength of the offenses faced: the gap ` +
          "between those opponents' average production at the position and the league average " +
          "is subtracted.",
        "Rank 1 allowed the most points and rank 32 the fewest, with ties ordered by team " +
          "abbreviation.",
      ],
    },
  ];
  // Only the season straight before the current one is its baseline
  // (FPA_BASELINE_SEASON, 2025 by default); an older archive says nothing
  // about a table it never fed.
  if (season === data.currentSeason - 1) {
    const next = data.currentSeason;
    items.push({
      q: `How is the ${season} season used in the ${next} table?`,
      a: [
        `It is the ${next} table's baseline. Before any ${next} games are played, the current ` +
          `table is these ${season} figures in full; as ${next} weeks are played, ${next} games ` +
          `count for more each week, and once a ${ordinal(blendDropWeek())} week of ${next} games ` +
          `is in, ${season} drops out and the current table reads ${next} games only.`,
      ],
    });
  }
  return items;
}

/** The questions this table's page carries: the one list the markup and the schema read. */
export function fpaFaq(data: FpaTableData): FpaFaqItem[] {
  return data.kind === "live" ? liveFaq(data) : archiveFaq(data);
}

function renderFaq(data: FpaTableData, items: readonly FpaFaqItem[]): string {
  if (items.length === 0) return "";
  // One fold per question, not one around the lot. The questions are the index
  // - somebody scanning for the one they arrived with has to see them without
  // opening anything - while a run of open answers below the table is the wall
  // this fold exists to prevent. So the questions show and the answers are
  // shut. Indexed either way: a crawler reads the DOM, not the open state.
  const body = items
    .map(
      (item) =>
        `<details class="scf-faq-item">` +
        `<summary class="scf-faq-q-row">` +
        `<h3 class="scf-faq-q">${escapeHtml(item.q)}</h3>` +
        `</summary>` +
        // One .scf-faq-a per question even when the answer runs to two
        // paragraphs: the block is the answer, and the <p>s inside it are its
        // shape. A second sibling .scf-faq-a would be a second answer.
        `<div class="scf-faq-a">` +
        item.a.map((text) => `<p>${escapeHtml(text)}</p>`).join("") +
        `</div>` +
        `</details>`,
    )
    .join("");

  const title =
    data.kind === "archive" ? `${data.season} Fantasy Points Allowed FAQ` : "Fantasy Points Allowed FAQ";
  return (
    `<section class="scf-faq">` +
    `<h2 class="scf-faq-title">${escapeHtml(title)}</h2>` +
    `<div class="scf-faq-body">${body}</div>` +
    `</section>`
  );
}

/**
 * The page's FAQPage node, or the inert island the plugin builds it from.
 *
 * Same two-mode arrangement as team-render.ts's faqSchema() and
 * rankings-render.ts's renderFaqSchema(), for the reason given at length in the
 * first: standalone this page owns its document and emits the node itself;
 * embedded, WordPress owns the document and Rank Math owns its graph, so a
 * second `<script type="application/ld+json">` arriving from inside a mounted
 * fragment competes with that graph instead of joining it - the same reasoning
 * as the embed mount adding no canonical and no H1. The island is the same
 * questions as data, and statchasers-fpa.php lifts them into the one <script>
 * the host page already prints, then strips the island.
 *
 * Data rather than the plugin re-reading the rendered markup: by then every
 * answer has been escaped for display, and un-escaping prose in PHP to feed a
 * crawler is a worse job than handing over the array it was built from.
 *
 * The two-paragraph answers join with a space rather than shipping an array.
 * `acceptedAnswer.text` is one string, every paragraph here is a complete
 * sentence, and a rule followed by its qualification reads as one answer when
 * the break is taken out - which is the whole of what a crawler gets.
 *
 * The standalone page ships `noindex, indexifembedded`, so this node is not
 * what ranks - the WordPress copy is. It is emitted anyway because a page that
 * describes itself only when embedded is a page whose structured data nobody
 * can check without WordPress in front of it.
 */
function renderFaqSchema(items: readonly FpaFaqItem[], options: FpaRenderOptions): string {
  if (items.length === 0) return "";
  const entries = items.map((item) => ({
    q: item.q,
    a: item.a.join(" "),
  }));

  if (options.embed) {
    return (
      `<script type="application/json" class="scf-faq-data">` +
      escapeJsonLd(JSON.stringify(entries)) +
      `</script>`
    );
  }

  return (
    `<script type="application/ld+json">` +
    escapeJsonLd(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: entries.map((entry) => ({
          "@type": "Question",
          name: entry.q,
          acceptedAnswer: { "@type": "Answer", text: entry.a },
        })),
      }),
    ) +
    `</script>`
  );
}

/* ------------------------------------------------- answer, seasons, related */

/*
 * The answer sentence ("Softest matchups through Week 8: Detroit allows the
 * most...") is no longer printed above the controls (mak, 2026-11-04). It
 * stays in the page copy (fpa-seo.ts) for the plugin's island and the
 * description; only the on-page paragraph is gone.
 */

/**
 * "Updated Oct 8, through Week 5", under the heading. Standalone only: on a
 * WordPress page the plugin prints it under the page's own H1, from the
 * island, so the fragment leaves it out rather than print it twice.
 */
function renderUpdated(copy: FpaPageCopy): string {
  if (!copy.updatedLine) return "";
  const time = copy.updatedIso
    ? `<time datetime="${escapeHtml(copy.updatedIso)}">${escapeHtml(copy.updatedLine)}</time>`
    : escapeHtml(copy.updatedLine);
  return `<p class="scf-updated">${time}</p>`;
}

/**
 * Where an archive season lives: `<base>/2025/` on the WordPress page, and
 * `/fpa?season=2025` on this app's own page, which has no path for it.
 */
export function fpaSeasonPath(base: string, season: number): string {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed === "/fpa" || trimmed === "" ? `/fpa?season=${season}` : `${trimmed}/${season}/`;
}

/**
 * The link between the current table and the archive (mak, 2026-10-10: "link
 * the two pages to each other"). On the current page: each finished season's
 * full-season table. On an archive page: the current season's table. Nothing
 * when there is no other season to show.
 */
function renderSeasons(data: FpaTableData, options: FpaRenderOptions): string {
  const base = options.basePath ?? "/fpa";
  // `linkQuery` is "?embed=1" or ""; a path that already carries a query takes
  // it as a second parameter.
  const query = options.linkQuery ?? "";
  const withQuery = (path: string): string =>
    !query ? path : path.includes("?") ? `${path}&${query.replace(/^\?/, "")}` : `${path}${query}`;
  const items =
    data.kind === "archive"
      ? [{ href: withQuery(base), text: `Current ${data.currentSeason} data` }]
      : data.archiveSeasons.map((season) => ({
          href: withQuery(fpaSeasonPath(base, season)),
          text: `${season} full season`,
        }));
  if (items.length === 0) return "";
  return (
    `<nav class="scf-seasons" aria-label="Other seasons">` +
    (data.kind === "archive" ? "" : `<span class="scf-seasons-label">Archive:</span> `) +
    items
      .map((item) => `<a class="scf-season-link" href="${escapeHtml(item.href)}" target="_top">${escapeHtml(item.text)}</a>`)
      .join(`<span class="scf-seasons-sep" aria-hidden="true"> · </span>`) +
    `</nav>`
  );
}

/**
 * The page's words, as data, for the WordPress plugin: title, H1, description,
 * the Updated line and the date behind it, which season and kind this is, and
 * the archive seasons the sitemap should list. statchasers-fpa.php reads it
 * into Rank Math's title, description and graph and strips it before printing.
 * Embedded only; standalone the page prints the same words itself.
 */
function renderMetaIsland(copy: FpaPageCopy, options: FpaRenderOptions): string {
  if (!options.embed) return "";
  return (
    `<script type="application/json" class="scf-page-data">` +
    escapeJsonLd(JSON.stringify(copy)) +
    `</script>`
  );
}

/* ------------------------------------------------------------------ rail */

/** The four position cards, in order. */
const CHIP_POSITIONS: readonly FantasyPosition[] = ["QB", "RB", "WR", "TE"];

function signed(value: number): string {
  const r = Math.round(value * 10) / 10;
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}`;
}

/**
 * One card, in the strength-of-schedule page's card dress (sos-render.ts,
 * renderCard): the faded crest bottom right, an uppercase title, a two-line
 * note, then the team - crest, code, the figure with its unit, the full name
 * and the delta against league average. `team` null gives a card of title
 * and note alone (the start/sit tools, or a position with no board).
 */
function renderRailCard(opts: {
  href: string;
  title: string;
  note: string;
  team: FpaRailTeam | null;
  unit: string;
  pos?: FantasyPosition;
  current?: boolean;
  label?: string;
  /** The call to action at the card's foot: "View QB schedules". None on the current view. */
  cta?: string;
}): string {
  const t = opts.team;
  return (
    `<li class="scf-rail-item">` +
    `<a class="scf-card${opts.current ? " is-current" : ""}" href="${escapeHtml(opts.href)}"` +
    (opts.pos ? ` data-pos="${opts.pos}"` : "") +
    (opts.label ? ` aria-label="${escapeHtml(opts.label)}"` : "") +
    (opts.current ? ` aria-current="page" target="_top"` : ` target="_blank" rel="noopener"`) +
    `>` +
    (t ? `<img class="scf-card-mark" src="${escapeHtml(t.logo)}" alt="" aria-hidden="true" loading="lazy" decoding="async" />` : "") +
    `<span class="scf-card-head">` +
    `<span class="scf-card-title">${escapeHtml(opts.title)}</span>` +
    `</span>` +
    `<span class="scf-card-note">${escapeHtml(opts.note)}</span>` +
    // The team block (mak, 2026-11-04): two columns, two rows. Left, the
    // crest directly above the code; right, the figure directly above the
    // delta. No full name - the crest and the code are the identity; the
    // name is the code's title and in the label.
    (t
      ? `<span class="scf-card-body">` +
        `<span class="scf-card-team">` +
        `<img class="scf-card-img" src="${escapeHtml(t.logo)}" alt="" width="32" height="32" loading="lazy" decoding="async" />` +
        `<span class="scf-card-name" title="${escapeHtml(t.fullName)}">${escapeHtml(t.code)}</span>` +
        `</span>` +
        `<span class="scf-card-figure">` +
        `<span class="scf-card-value">${escapeHtml(num(t.afpa))}<small>${escapeHtml(opts.unit)}</small></span>` +
        `<span class="scf-card-delta">${escapeHtml(signed(t.delta))} vs avg</span>` +
        `</span></span>`
      : "") +
    // The call to action (mak, 2026-11-04): the card is the link, and this is
    // what says so - a button-shaped row at the foot naming the destination.
    (opts.cta
      ? `<span class="scf-card-cta">${escapeHtml(opts.cta)}` +
        `<svg class="scf-card-cta-arrow" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
        `</span>`
      : "") +
    `</a></li>`
  );
}

/**
 * The schedule rail (mak's spec, 2026-11-04; cards in the SOS page's dress
 * from the same afternoon).
 *
 * A column of six cards to the right of the table at 1240px and up; a grid
 * of the same cards above the table below that. Each card previews its
 * destination the way the strength-of-schedule page's own cards do: the
 * easiest remaining schedule for that position, with its figure and how far
 * it sits from league average. The current view is docked at the top,
 * pressed in and tagged, leading with the softest defense on this table;
 * Find a player is shaped like the search box it opens.
 *
 * No headings. The fragment is printed under a WordPress H1 and keeps its
 * outline to the FAQ (see renderFaq); the eyebrow is a paragraph styled as
 * small caps, and the <nav> carries the name a heading would have.
 */
function renderRail(data: FpaTableData, options: FpaRenderOptions, rail: FpaRail): string {
  const sosBase = options.sosBase ?? SOS_DEFAULT_PAGE_BASE;
  const base = options.basePath ?? "/fpa";
  const query = options.linkQuery ?? "";
  const withQuery = (path: string): string =>
    !query ? path : path.includes("?") ? `${path}&${query.replace(/^\?/, "")}` : `${path}${query}`;
  const pos = (p: FantasyPosition) => sosPagePath(sosBase, p.toLowerCase() as "qb" | "rb" | "wr" | "te");
  // The overview's player board, with the finder focused (client/sos.ts).
  const finder = `${sosBase.replace(/\/+$/, "")}/?tab=player#scsos-find`;

  // The current view leads with this table's softest defense overall (OFF
  // rank 1), against the league mean of the same column.
  const soft = data.rows.find((r) => r.offRank === 1 && r.team);
  const offMean = data.rows.reduce((a, r) => a + r.offFpa, 0) / Math.max(1, data.rows.length);
  const current = renderRailCard({
    href: withQuery(base),
    // "Most FPts allowed", no "Viewing" pill (mak, 2026-11-04): the pressed
    // state and the gold edge are what mark it as the page being read.
    title: "Most FPts allowed",
    note: `${fpaScopeLabel(data)}. Softest defense overall.`,
    team: soft?.team
      ? { code: soft.team.code, fullName: soft.team.fullName, logo: soft.team.logo, afpa: soft.offFpa, delta: soft.offFpa - offMean }
      : null,
    unit: "FPA",
    current: true,
  });

  const cards = CHIP_POSITIONS.map((p) => {
    const preview = rail.teaser?.[p] ?? null;
    const easiest = preview?.easiest ?? [];
    return renderRailCard({
      href: pos(p),
      title: `Easiest ${p} Schedule`,
      note: `Easiest rest-of-season ${p} schedule by opponent aFPA.`,
      team: preview?.top ?? null,
      unit: "aFPA",
      pos: p,
      cta: `View All ${p} Schedules`,
      label:
        `${p} schedules, rest of season.` +
        (easiest.length ? ` Easiest: ${easiest.map((t) => t.fullName).join(", ")}.` : ""),
    });
  }).join("");

  const search =
    `<li class="scf-rail-item">` +
    `<a class="scf-card is-search" href="${escapeHtml(finder)}" target="_blank" rel="noopener">` +
    `<svg class="scf-card-glass" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" /><line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />` +
    `</svg>` +
    `<span class="scf-card-placeholder">Find a player's schedule</span>` +
    `</a></li>`;

  return (
    `<div class="scf-aside">` +
    // No eyebrow and no box around the cards (mak, 2026-11-04): the <nav>'s
    // name is for assistive tech; on screen the cards stand on their own.
    `<nav class="scf-rail${rail.teaser ? "" : " is-sparse"}" aria-label="Schedule views" data-scf-rail>` +
    // The finder sits right under the current view, ahead of the four
    // position cards (mak, 2026-11-04).
    `<ul class="scf-rail-list">${current}${search}${cards}</ul>` +
    `</nav>` +
    renderStartSit(rail.startSitWeek ?? null) +
    `</div>`
  );
}

/**
 * The start/sit group under the schedules (mak, 2026-11-04): for a reader
 * who is here to set this week's lineup. One card, in a new tab: the
 * head-to-head start/sit tool (the Projections card was dropped the same
 * day). The week named is the tool's own (startSitWeek()), so the card and
 * the page it opens always agree; with none known it says "This week".
 */
function renderStartSit(week: number | null): string {
  const next = week !== null ? `Week ${week}` : "This week";
  return (
    `<nav class="scf-rail scf-rail-startsit" aria-label="Start or sit" data-scf-startsit>` +
    `<ul class="scf-rail-list">` +
    renderRailCard({
      href: `${SITE}/redraft-command/who-should-i-start`,
      title: "Who Should I Start?",
      note: `${next}: compare two players head to head.`,
      team: null,
      unit: "",
      cta: "Compare players",
    }) +
    `</ul>` +
    `</nav>`
  );
}

/* --------------------------------------------------------- page assembly */

export function renderFpaPage(
  data: FpaTableData,
  options: FpaRenderOptions = {},
  rail: FpaRail = { teaser: null },
): string {
  const copy = fpaPageCopy(data);
  // One list for the visible FAQ and its schema. The current page's questions
  // describe the live table; an archive's describe its own season (coverage,
  // method, its place in the next table) rather than repeating the current
  // page's answers at a second address (WEB-030, 2026-11-27).
  const faq = fpaFaq(data);
  return (
    `<div class="scf${options.embed ? " is-embed" : ""}" data-scf-root="1"` +
    ` data-season="${escapeHtml(String(data.season))}"` +
    ` data-kind="${escapeHtml(data.kind)}"` +
    ` data-format="${escapeHtml(data.format)}"` +
    ` data-view="${escapeHtml(data.view)}"` +
    // The combination the page prints with no fragment and no query: what the
    // bundle leaves out of the address (`#format=half` but never `#format=ppr`).
    ` data-default-format="${escapeHtml(DEFAULT_FPA_FORMAT)}"` +
    (options.endpoint
      ? ` data-scf-endpoint="${escapeHtml(options.endpoint)}"`
      : "") +
    `>` +
    (options.embed ? "" : renderUpdated(copy)) +
    // An archive page's way back, above its table. The live page's link to
    // the archive went with the list above the table (mak, 2026-11-04) and
    // stays off it (mak, 2026-11-27: a restored link under the table was
    // declined); the archive is reached through the sitemap.
    (data.kind === "archive" ? renderSeasons(data, options) : "") +
    // The body: the rail and the sheet. Rail first in the markup, so that
    // collapsed (under 1240px) it is the row above the table, and in a tab
    // order it is reached before the 32 rows in either layout.
    `<div class="scf-body">` +
    renderRail(data, options, rail) +
    `<div class="scf-main">` +
    renderControls(data) +
    renderTable(data, options) +
    // The blend note ("12% 2025 baseline and 88% 2026 data") is no longer
    // printed under the table (mak, 2026-11-04).
    `</div>` +
    `</div>` +
    // The Related links block (mak, 2026-10-10) was removed 2026-11-04: the
    // rail's cards are the links now.
    renderFaq(data, faq) +
    `</div>` +
    // Outside the root div, like the other tools put it: the node describes the
    // page, and the plugin strips the embedded form before printing anyway.
    renderFaqSchema(faq, options) +
    renderMetaIsland(copy, options)
  );
}

/**
 * The page when nothing has been ingested.
 *
 * An honest empty state rather than a table of zeroes, and it says what to run
 * - because the only person who ever sees this is whoever is setting the tool
 * up. Readers never reach it: the shortcode renders nothing at all in that case
 * and leaves the host page intact.
 */
export function renderFpaEmpty(options: FpaRenderOptions = {}): string {
  return (
    `<div class="scf${options.embed ? " is-embed" : ""}" data-scf-root="1" data-empty="1">` +
    `<p class="scf-empty">${escapeHtml(
      // Reader-facing: the page this lands on is public. How to fill it is in
      // the README and the ingest route, not in the empty state.
      "Fantasy Points Allowed figures are not available right now. Please check back soon.",
    )}</p>` +
    `</div>`
  );
}

/** The table as CSV, matching what is on screen exactly. */
export function renderFpaCsv(data: FpaTableData): string {
  const header = [
    "Defense",
    ...FANTASY_POSITIONS.flatMap((p) => [`${p} FPA`, `${p} Rank`]),
    "OFF FPA",
    "OFF Rank",
    `${data.season} Games`,
  ];

  const quote = (value: string | number): string => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = data.rows.map((row) =>
    [
      row.name,
      ...FANTASY_POSITIONS.flatMap((p) => [
        num(row.byPos[p].fpa),
        row.byPos[p].rank,
      ]),
      num(row.offFpa),
      row.offRank,
      row.gamesPlayed,
    ]
      .map(quote)
      .join(","),
  );

  return [header.map(quote).join(","), ...lines].join("\n");
}
