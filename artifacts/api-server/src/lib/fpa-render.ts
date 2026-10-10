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
import type { FpaRow, FpaTableData, FpaView } from "./fpa/fpa-data";
import { FANTASY_POSITIONS, type ScoringFormat } from "./fpa/nflverse";
import { fpaPageCopy, type FpaPageCopy } from "./fpa-seo";

/** Where the Related links point. Absolute: this markup is printed inside statchasers.com. */
const SITE = "https://statchasers.com";

export interface FpaRenderOptions {
  /**
   * Embedded inside a statchasers.com page: drops the standalone chrome and
   * demotes the title to an <h2>, because the host page supplies the H1.
   */
  embed?: boolean;
  /** Where the control links point. Defaults to this app's own /fpa. */
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
}

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

export type MatchupTier = "soft-2" | "soft-1" | "mid" | "tough-1" | "tough-2";

/**
 * Which arm of the diverging scale a rank sits on, and how far along it.
 *
 * Sixes at the ends, and the middle left blank: 1–6, 7–12, then eight ranks
 * of nothing, then 21–26 and 27–32. Symmetric about the league median, and
 * the shape is the point - a defense two places either side of average is not
 * a matchup, so tinting it spends the reader's attention on noise. Only the
 * twelve that are genuinely exploitable and the twelve that are genuinely
 * hard get a color.
 */
export function matchupTier(rank: number): MatchupTier {
  if (rank <= 6) return "soft-2";
  if (rank <= 12) return "soft-1";
  if (rank <= 20) return "mid";
  if (rank <= 26) return "tough-1";
  return "tough-2";
}

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
 * Real links to real URLs, because both genuinely change every number in the
 * table. `rel="nofollow"` on the non-default combinations, and the canonical
 * stays on the bare path, so six views of one table stay one page.
 */
function renderControls(data: FpaTableData, options: FpaRenderOptions): string {
  const base = options.basePath ?? "/fpa";

  const url = (format: ScoringFormat, view: FpaView): string => {
    const params = new URLSearchParams();
    if (format !== "half") params.set("format", format);
    if (view !== "raw") params.set("view", view);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  };

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
      href: string;
      text: string;
      abbr?: string;
      title: string;
      active: boolean;
      /* What this option selects, for the bundle. Stated rather than parsed
         back out of the href: that href points at the WordPress page once
         SC_FPA_PATH is set, and reading state out of somebody else's URL is
         guessing. */
      data: string;
    }[],
  ): string =>
    `<div class="scf-control">` +
    `<span class="scf-control-label">${escapeHtml(label)}</span>` +
    `<div class="scf-opts">` +
    items
      .map(
        (item) =>
          `<a class="scf-opt${item.active ? " is-active" : ""}"` +
          ` href="${escapeHtml(item.href)}"` +
          item.data +
          ` title="${escapeHtml(item.title)}"` +
          (item.active ? ` aria-current="true"` : ` rel="nofollow"`) +
          `>${optionText(item.text, item.abbr)}</a>`,
      )
      .join("") +
    `</div>` +
    `</div>`;

  const formats = (["standard", "half", "ppr"] as ScoringFormat[]).map(
    (format) => ({
      href: url(format, data.view),
      text: FORMAT_LABELS[format],
      abbr: FORMAT_ABBR[format],
      title: `Recompute every figure in ${FORMAT_LABELS[format]} scoring`,
      active: format === data.format,
      data: ` data-scf-format="${escapeHtml(format)}"`,
    }),
  );

  const views = (["raw", "adjusted"] as FpaView[]).map((view) => ({
    href: url(data.format, view),
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
    `<a class="scf-csv" href="${escapeHtml(
      `${(options.csvBase ?? "/fpa").replace(/\/+$/, "")}` +
        `/download.csv?format=${data.format}&view=${data.view}`,
    )}" rel="nofollow" download>Download CSV</a>` +
    `</div>`
  );
}

/**
 * What the numbers currently are.
 *
 * Under the table since 2026-10-10 (mak's spec): the heading and the answer
 * sentence now say which weeks the figures cover, and the blend note follows
 * the table it qualifies, ahead of the legend and the FAQ.
 */
function renderDataMode(data: FpaTableData): string {
  return (
    `<div class="scf-mode" data-preseason="${data.isPreseason ? "1" : "0"}">` +
    // No week/format heading: the controls above already say which view is on,
    // and the sentence below says what the numbers are. The label was repeating
    // both.
    `<p class="scf-mode-body">${escapeHtml(data.methodology)}</p>` +
    (data.view === "adjusted"
      ? `<p class="scf-mode-body">${escapeHtml(
          "Adjusted figures subtract how much stronger or weaker than league " +
            "average the offenses each defense faced have been, at that position. " +
            "It is a model; the raw view is what actually happened.",
        )}</p>`
      : "") +
    `</div>`
  );
}

/* --------------------------------------------------------------- the table */

function renderCell(entry: { fpa: number; rank: number }): string {
  const tier = matchupTier(entry.rank);
  return (
    // The title sits on the cell, not the rank: the rank is clipped out of
    // sight (fpa.css, .scf-rank), and a tooltip on a 1px box is no tooltip.
    `<td class="scf-cell" data-tier="${tier}" data-sort="${entry.fpa}" title="${escapeHtml(
      `${ordinal(entry.rank)} most points allowed - ${TIER_LABEL[tier]}`,
    )}">` +
    `<span class="scf-fpa">${escapeHtml(num(entry.fpa))}</span>` +
    `<span class="scf-rank">${entry.rank}</span>` +
    `</td>`
  );
}

function renderRow(row: FpaRow, options: FpaRenderOptions): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  // Crest, then the abbreviation with the full name under it. The abbreviation
  // is what a reader scanning 32 rows actually matches on - it is how the team
  // is written everywhere else in fantasy - and the full name below it is there
  // for anyone who does not know the three letters cold.
  const identity =
    `<span class="scf-team-id">` +
    `<span class="scf-team-abbr">${escapeHtml(row.abbr)}</span>` +
    `<span class="scf-team-name">${escapeHtml(row.name)}</span>` +
    `</span>`;

  // The team's schedule page rather than its hub (mak, 2026-10-10): a reader
  // looking at what a defense allows wants to see who it plays next.
  const name = row.team
    ? `<a class="scf-team-link" href="${escapeHtml(
        `${prefix}${row.team.slug}/schedule/${query}`,
      )}" target="_top">` +
      `<img class="scf-team-logo" src="${escapeHtml(row.team.logo)}" alt=""` +
      ` width="22" height="22" loading="lazy" decoding="async" />` +
      `${identity}</a>`
    : `<span class="scf-team-link is-plain">${identity}</span>`;

  return (
    `<tr class="scf-row" data-team="${escapeHtml(row.abbr)}">` +
    // The sort key is stated rather than read off the cell: the cell's text is
    // now the abbreviation and the name run together, and sorting on
    // "CARCarolina Panthers" would work by accident rather than on purpose.
    `<th scope="row" class="scf-team" data-sort="${escapeHtml(row.abbr)}">${name}</th>` +
    FANTASY_POSITIONS.map((p) => renderCell(row.byPos[p])).join("") +
    renderCell({ fpa: row.offFpa, rank: row.offRank }) +
    `<td class="scf-games" data-sort="${row.gamesPlayed}">${row.gamesPlayed}</td>` +
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
    `<th scope="col" data-sort-type="number" title="${escapeHtml(
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
    `<caption class="scf-caption">${escapeHtml(
      `Fantasy points allowed per game by all 32 NFL defenses, ` +
        `${FORMAT_LABELS[data.format]} scoring, ${VIEW_NAMES[data.view]} view. ` +
        `Rank 1 is the most points allowed, i.e. the softest matchup.`,
    )}</caption>` +
    `<thead>${head}</thead>` +
    `<tbody>${data.rows.map((row) => renderRow(row, options)).join("")}</tbody>` +
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
 */
const FAQ: readonly (readonly [string, readonly string[]])[] = [
  [
    "What is Fantasy Points Allowed by position?",
    [
      "Fantasy Points Allowed by position shows how many fantasy points each NFL " +
        "defense allows to opposing quarterbacks, running backs, wide receivers " +
        "and tight ends.",
      "It helps fantasy managers identify favorable and difficult weekly matchups " +
        "by position.",
    ],
  ],
  [
    "Which NFL teams allow the most fantasy points by position?",
    [
      "Teams near the top of the Fantasy Points Allowed rankings have surrendered " +
        "the most fantasy production to that position. The table opens sorted by " +
        "OFF, so the softest overall matchups are already at the top.",
      "Sort by the QB, RB, WR or TE column to put the defenses that have been the " +
        "most favorable matchups for that one position first.",
    ],
  ],
  [
    "Which NFL teams allow the fewest fantasy points by position?",
    [
      "Teams allowing the fewest fantasy points to a position have generally been " +
        "tougher fantasy matchups. They rank nearest 32 and carry the red tints in " +
        "the table.",
      "A low FPA can help identify difficult matchups, but player workload, talent, " +
        "injuries and game environment should still be considered.",
    ],
  ],
  [
    "Which teams allow the most fantasy points to RBs?",
    [
      "Use the RB Fantasy Points Allowed rankings to see which NFL defenses have " +
        "surrendered the most fantasy production to opposing running backs.",
      "You can compare teams in either the FPA or aFPA view and select the scoring " +
        "format that matches your league.",
    ],
  ],
  [
    "Which teams allow the most fantasy points to WRs?",
    [
      "The WR Fantasy Points Allowed rankings show which defenses have allowed the " +
        "most fantasy production to opposing wide receivers.",
      "This can help identify favorable wide receiver matchups for weekly start/sit " +
        "decisions.",
    ],
  ],
  [
    "Which teams allow the most fantasy points to QBs?",
    [
      "The QB Fantasy Points Allowed rankings show which NFL defenses have allowed " +
        "the most fantasy production to opposing quarterbacks.",
      "A higher FPA generally indicates a more favorable quarterback matchup.",
    ],
  ],
  [
    "Which teams allow the most fantasy points to TEs?",
    [
      "The TE Fantasy Points Allowed rankings show which defenses have surrendered " +
        "the most fantasy production to opposing tight ends.",
      "Because tight end production can be volatile, matchup data can be especially " +
        "useful when choosing between similarly projected players.",
    ],
  ],
  [
    "What does FPA mean in fantasy football?",
    [
      "FPA stands for Fantasy Points Allowed.",
      "It measures the fantasy production an NFL defense has allowed to opposing " +
        "players, and is usually broken down by position.",
    ],
  ],
  [
    "Is a higher Fantasy Points Allowed number better?",
    [
      "Generally, yes. A higher FPA means a defense has allowed more fantasy points " +
        "to that position, which usually represents a more favorable matchup.",
      "A lower FPA usually indicates a more difficult matchup.",
    ],
  ],
  [
    "What is Adjusted Fantasy Points Allowed?",
    [
      "Adjusted Fantasy Points Allowed, or aFPA, accounts for the strength of the " +
        "opponents a defense has faced.",
      "A defense that has faced several elite offenses may have a high raw FPA even " +
        "if the defense itself is not particularly weak. Adjusted FPA adds that " +
        "opponent context to provide a better view of matchup difficulty.",
    ],
  ],
  [
    "What is the difference between Raw FPA and Adjusted FPA?",
    [
      "Raw FPA measures how many fantasy points a defense has actually allowed. " +
        "Adjusted FPA accounts for the quality of the opponents that produced those " +
        "points.",
      "Raw FPA tells you what happened. Adjusted FPA helps provide context for why " +
        "it happened. The View switch above the table holds both, labeled FPA and " +
        "aFPA.",
    ],
  ],
  [
    "How do I use Fantasy Points Allowed for start/sit decisions?",
    [
      "Fantasy Points Allowed can help separate close lineup decisions.",
      "If two players have similar projections and expected workloads, the player " +
        "facing a defense that allows more fantasy points to his position may have " +
        "the more favorable matchup. FPA should be used alongside projections, " +
        "usage, injuries and game environment rather than as the only factor.",
    ],
  ],
  [
    "Can I see Fantasy Points Allowed for PPR, Half-PPR and Standard scoring?",
    [
      "Yes. Fantasy Points Allowed changes with the scoring format, because " +
        "receptions are worth different amounts in PPR, Half-PPR and Standard " +
        "leagues.",
      "Use the scoring controls above the table to select the format that matches " +
        "your league before comparing defensive matchups.",
    ],
  ],
  [
    "Does Fantasy Points Allowed predict future fantasy performance?",
    [
      "Not by itself.",
      "Fantasy Points Allowed describes how defenses have performed against a " +
        "position so far. Future results also depend on player usage, injuries, " +
        "offensive strength, game script and other factors. FPA is best used as a " +
        "matchup indicator rather than a standalone fantasy projection.",
    ],
  ],
  [
    "How are Fantasy Points Allowed rankings calculated?",
    [
      "Teams are ranked by the amount of fantasy production they allow at each " +
        "position. StatChasers tracks FPA separately for quarterbacks, running " +
        "backs, wide receivers and tight ends, then ranks every NFL defense against " +
        "the rest of the league.",
      "Rank 1 is the most points allowed, which is the softest matchup, and rank 32 " +
        "is the fewest.",
    ],
  ],
  [
    "Why are early-season FPA rankings blended with last season?",
    [
      "Early in the NFL season, one or two games can create misleading rankings.",
      "StatChasers uses the previous season as a preseason baseline and gradually " +
        "increases the weight of current-season data as the sample becomes more " +
        "reliable. The note above the table always says what the figures currently " +
        "are a mix of.",
    ],
  ],
  [
    "When does current-season data fully replace the preseason baseline?",
    [
      "The weighting changes throughout the season. Early weeks use a blend of the " +
        "previous season and current results, while later weeks rely increasingly " +
        "on current-season and recent rolling data.",
    ],
  ],
  [
    "What does OFF mean in the table?",
    [
      "OFF represents the overall fantasy production allowed by each defense across " +
        "the tracked fantasy positions. It provides a quick way to compare the " +
        "general strength or weakness of each defensive matchup.",
    ],
  ],
  [
    "How often are Fantasy Points Allowed rankings updated?",
    [
      "The rankings should be updated as new NFL games are completed, so that both " +
        "raw and adjusted FPA reflect the latest available results and matchup data.",
    ],
  ],
] as const;

function renderFaq(): string {
  // One fold per question, not one around the lot. The questions are the index
  // - somebody scanning for the one they arrived with has to see them without
  // opening anything - while nineteen ANSWERS below the table is the wall this
  // fold exists to prevent. So the questions show and the answers are shut.
  // Indexed either way: a crawler reads the DOM, not the open state.
  const items = FAQ.map(
    ([question, paragraphs]) =>
      `<details class="scf-faq-item">` +
      `<summary class="scf-faq-q-row">` +
      `<h3 class="scf-faq-q">${escapeHtml(question)}</h3>` +
      `</summary>` +
      // One .scf-faq-a per question even when the answer runs to two
      // paragraphs: the block is the answer, and the <p>s inside it are its
      // shape. A second sibling .scf-faq-a would be a second answer.
      `<div class="scf-faq-a">` +
      paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("") +
      `</div>` +
      `</details>`,
  ).join("");

  return (
    `<section class="scf-faq">` +
    `<h2 class="scf-faq-title">Fantasy Points Allowed FAQ</h2>` +
    `<div class="scf-faq-body">${items}</div>` +
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
function renderFaqSchema(options: FpaRenderOptions): string {
  const items = FAQ.map(([question, paragraphs]) => ({
    q: question,
    a: paragraphs.join(" "),
  }));

  if (options.embed) {
    return (
      `<script type="application/json" class="scf-faq-data">` +
      escapeJsonLd(JSON.stringify(items)) +
      `</script>`
    );
  }

  return (
    `<script type="application/ld+json">` +
    escapeJsonLd(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((entry) => ({
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

/**
 * The one sentence a crawler can quote: the softest defense per position,
 * from the table's own ranks (fpa-seo.ts). Above the controls, so it is the
 * first thing under the heading. Swapped with the table when the format or
 * view changes, because its figures are that view's.
 */
function renderAnswer(copy: FpaPageCopy): string {
  return copy.answer ? `<p class="scf-answer">${escapeHtml(copy.answer)}</p>` : "";
}

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
 * Related tools (mak, 2026-10-10): the position strength-of-schedule pages,
 * the projections and the start/sit tool. Under the table and the blend
 * note, above the FAQ; the same shape the SOS pages' Related block has.
 */
function renderRelated(): string {
  const links: { label: string; href: string }[] = [
    ...(["qb", "rb", "wr", "te"] as const).map((pos) => ({
      label: `${pos.toUpperCase()} Strength of Schedule`,
      href: `${SITE}/nfl/fantasy-football-strength-of-schedule/${pos}/`,
    })),
    { label: "Fantasy Football Projections", href: `${SITE}/redraft-command/fantasy-football-projections` },
    { label: "Who Should I Start?", href: `${SITE}/redraft-command/who-should-i-start` },
  ];
  return (
    `<nav class="scf-related" aria-labelledby="scf-related-title">` +
    `<h2 id="scf-related-title" class="scf-related-title">Related</h2>` +
    `<ul class="scf-related-list">` +
    links.map((l) => `<li><a href="${escapeHtml(l.href)}" target="_top">${escapeHtml(l.label)}</a></li>`).join("") +
    `</ul></nav>`
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

/* --------------------------------------------------------- page assembly */

export function renderFpaPage(
  data: FpaTableData,
  options: FpaRenderOptions = {},
): string {
  const copy = fpaPageCopy(data);
  // The FAQ describes fantasy points allowed in general, and the current page
  // carries it. An archive page repeating the nineteen answers would be the
  // same copy at a second address, so it links to Related and stops there.
  const live = data.kind === "live";
  return (
    `<div class="scf${options.embed ? " is-embed" : ""}" data-scf-root="1"` +
    ` data-season="${escapeHtml(String(data.season))}"` +
    ` data-kind="${escapeHtml(data.kind)}"` +
    ` data-format="${escapeHtml(data.format)}"` +
    ` data-view="${escapeHtml(data.view)}"` +
    (options.endpoint
      ? ` data-scf-endpoint="${escapeHtml(options.endpoint)}"`
      : "") +
    `>` +
    (options.embed ? "" : renderUpdated(copy)) +
    renderAnswer(copy) +
    renderSeasons(data, options) +
    renderControls(data, options) +
    renderTable(data, options) +
    renderDataMode(data) +
    renderLegend() +
    renderRelated() +
    (live ? renderFaq() : "") +
    `</div>` +
    // Outside the root div, like the other tools put it: the node describes the
    // page, and the plugin strips the embedded form before printing anyway.
    (live ? renderFaqSchema(options) : "") +
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
