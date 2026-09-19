/**
 * Markup for Fantasy Points Allowed.
 *
 * Server-only, like team-render.ts and player-render.ts. The whole table — all
 * 32 defenses, every rank, both views — is in the response, and client/fpa.ts
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
 *    lying by omission. The data-mode line is therefore not a footnote — it sits
 *    above the table, before anything it qualifies.
 *
 * A note on colour. Rank 1 is the softest defense and rank 32 the toughest,
 * with league average in the middle — that is a DIVERGING scale, not an ordinal
 * one, so it takes two hues either side of a neutral rather than one ramp.
 * Green is the exploitable pole and red the one to avoid, and only the top and
 * bottom twelve are tinted at all — the eight ranks around the median stay white.
 * Red-green is the pair colour blindness erases, so the arms are NOT symmetric:
 * red runs 0.080 darker than its green mirror, which is what keeps the mirrored
 * pairs at ΔE 15.6 under protanopia and 7.5 under deuteranopia rather than ~1.
 * 7.5 is the floor band, legal only because there is a second encoding — every
 * tinted cell prints its rank, and the rows arrive sorted by it. See fpa.css for
 * the full derivation.
 */

import { escapeHtml } from "./render";
import type { FpaRow, FpaTableData, FpaView } from "./fpa/fpa-data";
import { FANTASY_POSITIONS, type ScoringFormat } from "./fpa/nflverse";

export interface FpaRenderOptions {
  /**
   * Embedded inside a statchasers.com page: drops the standalone chrome and
   * demotes the title to an <h2>, because the host page supplies the H1.
   */
  embed?: boolean;
  /** Where the control links point. Defaults to this app's own /fpa. */
  basePath?: string;
  /** Where a team link points. Defaults to this app's own /team/. */
  teamPathPrefix?: string;
  /** Carried onto internal links so embed mode stays embed mode. */
  linkQuery?: string;
  /** Rendered for testability; the cache keys on the data, not on this. */
  now?: number;
}

const DASH = "—";

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
 * them — FPA and aFPA — rather than describing them. "Raw" and "Adjusted"
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
 * the shape is the point — a defense two places either side of average is not
 * a matchup, so tinting it spends the reader's attention on noise. Only the
 * twelve that are genuinely exploitable and the twelve that are genuinely
 * hard get a colour.
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
   * one. Both are in the markup and CSS shows one — but with display:none, not
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
      `${base}/download.csv?format=${data.format}&view=${data.view}`,
    )}" rel="nofollow" download>Download CSV</a>` +
    `</div>`
  );
}

/**
 * What the numbers currently are.
 *
 * Above the table, not below it: it qualifies everything underneath, and a
 * caveat a reader meets after forming an opinion has not done its job.
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
    `<td class="scf-cell" data-tier="${tier}" data-sort="${entry.fpa}">` +
    `<span class="scf-fpa">${escapeHtml(num(entry.fpa))}</span>` +
    `<span class="scf-rank" title="${escapeHtml(
      `${ordinal(entry.rank)} most points allowed — ${TIER_LABEL[tier]}`,
    )}">${entry.rank}</span>` +
    `</td>`
  );
}

function renderRow(row: FpaRow, options: FpaRenderOptions): string {
  const prefix = options.teamPathPrefix ?? "/team/";
  const query = options.linkQuery ?? "";

  // Crest, then the abbreviation with the full name under it. The abbreviation
  // is what a reader scanning 32 rows actually matches on — it is how the team
  // is written everywhere else in fantasy — and the full name below it is there
  // for anyone who does not know the three letters cold.
  const identity =
    `<span class="scf-team-id">` +
    `<span class="scf-team-abbr">${escapeHtml(row.abbr)}</span>` +
    `<span class="scf-team-name">${escapeHtml(row.name)}</span>` +
    `</span>`;

  const name = row.team
    ? `<a class="scf-team-link" href="${escapeHtml(
        `${prefix}${row.team.slug}${query}`,
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
      "The four positions summed — the whole fantasy offense",
    )}">OFF</th>` +
    // Named for the season rather than "Games Played". Early in a season the
    // figure is mostly LAST season's, so a bare "Games Played: 1" beside it
    // reads as the sample the number came from, which it is not.
    `<th scope="col" class="scf-th-games" data-sort-type="number" title="${escapeHtml(
      `${data.season} games played. Early in the season the figures are still ` +
        `mostly the prior season's — see the note above.`,
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
 * Present because the cells are tinted, and a colour scale with no key is a
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
 * for the reader already looking at the table — which is why it is the only
 * part with headings. Everything else here deliberately ships none, because the
 * WordPress page owns the H1 and a fragment that invents its own outline fights
 * it. An FAQ is the exception: the question IS the structure, and a <p> in bold
 * would be a heading that no crawler and no screen reader can see.
 *
 * Below the table, not above it. Somebody who arrived from a search for "what
 * is adjusted fantasy points allowed" gets their answer either way; somebody
 * who came to read the table should not have to scroll past an essay first.
 */
const FAQ: readonly (readonly [string, string])[] = [
  [
    "What is Fantasy Points Allowed in fantasy football?",
    "Fantasy Points Allowed, or FPA, measures how many fantasy points a defense " +
      "gives up to a specific position. A higher FPA generally means the matchup " +
      "has been more favorable for fantasy production, while a lower FPA suggests " +
      "the defense has limited that position more effectively.",
  ],
  [
    "What is Adjusted Fantasy Points Allowed?",
    "Adjusted Fantasy Points Allowed, or aFPA, adjusts raw FPA for strength of " +
      "schedule. Instead of treating every opponent equally, it accounts for " +
      "whether a defense has faced strong or weak offenses. This makes it easier " +
      "to compare defenses that have played very different schedules.",
  ],
  [
    "Is a higher Fantasy Points Allowed number better for fantasy players?",
    "Usually, yes. A higher FPA means that defense has allowed more fantasy " +
      "production to the position you are evaluating. For example, a defense " +
      "ranked near the top in FPA allowed to wide receivers may represent a more " +
      "favorable matchup for opposing WRs.",
  ],
  [
    "What does a low FPA mean?",
    "A low FPA means a defense has allowed relatively few fantasy points to that " +
      "position. That can indicate a more difficult matchup, although FPA should " +
      "be considered alongside player talent, usage, injuries, game environment " +
      "and sample size.",
  ],
  [
    "What is the difference between Raw and Adjusted FPA?",
    "Raw FPA shows the fantasy points a defense has actually allowed. Adjusted " +
      "FPA accounts for the quality of the offenses and players that defense has " +
      "faced. Raw FPA tells you what happened; adjusted FPA provides more context " +
      "for how difficult the schedule was.",
  ],
  [
    "How are Fantasy Points Allowed rankings calculated?",
    "Teams are ranked by the amount of fantasy production they allow at each " +
      "position. StatChasers tracks FPA separately for quarterbacks, running " +
      "backs, wide receivers and tight ends, then ranks every NFL defense against " +
      "the rest of the league.",
  ],
  [
    "Can I view Fantasy Points Allowed for PPR, Half-PPR and Standard scoring?",
    "Yes. Use the scoring controls above the table to switch between Standard, " +
      "Half-PPR and PPR scoring. Rankings and fantasy points allowed will update " +
      "based on the selected scoring format.",
  ],
  [
    "Why are early-season FPA rankings blended with last season?",
    "Early in the NFL season, one or two games can create misleading rankings. " +
      "StatChasers uses the previous season as a preseason baseline and gradually " +
      "increases the weight of current-season data as the sample becomes more " +
      "reliable.",
  ],
  [
    "When does current-season data fully replace the preseason baseline?",
    "The weighting changes throughout the season. Early weeks use a blend of the " +
      "previous season and current results, while later weeks rely increasingly " +
      "on current-season and recent rolling data.",
  ],
  [
    "How should I use Fantasy Points Allowed for start/sit decisions?",
    "FPA is best used as a matchup tool, not as the only reason to start or bench " +
      "a player. Combine matchup strength with expected volume, role, injuries, " +
      "projected game script and the player\u2019s normal fantasy production.",
  ],
  [
    "Does a favorable FPA matchup guarantee a good fantasy performance?",
    "No. FPA describes how a defense has performed against a position, but " +
      "individual outcomes can vary significantly. A strong matchup improves the " +
      "environment, but player usage and game conditions still matter.",
  ],
  [
    "What does OFF mean in the table?",
    "OFF represents the overall fantasy production allowed by each defense across " +
      "the tracked fantasy positions. It provides a quick way to compare the " +
      "general strength or weakness of each defensive matchup.",
  ],
  [
    "How often are Fantasy Points Allowed rankings updated?",
    "The rankings should be updated as new NFL games are completed so that both " +
      "raw and adjusted FPA reflect the latest available results and matchup data.",
  ],
] as const;

function renderFaq(): string {
  // One fold per question, not one around the lot. The questions are the index
  // — somebody scanning for the one they arrived with has to see them without
  // opening anything — while thirteen ANSWERS below the table is the wall this
  // fold exists to prevent. So the questions show and the answers are shut.
  // Indexed either way: a crawler reads the DOM, not the open state.
  const items = FAQ.map(
    ([question, answer]) =>
      `<details class="scf-faq-item">` +
      `<summary class="scf-faq-q-row">` +
      `<h3 class="scf-faq-q">${escapeHtml(question)}</h3>` +
      `</summary>` +
      `<p class="scf-faq-a">${escapeHtml(answer)}</p>` +
      `</details>`,
  ).join("");

  return (
    `<section class="scf-faq">` +
    `<h2 class="scf-faq-title">Fantasy Points Allowed FAQ</h2>` +
    `<div class="scf-faq-body">${items}</div>` +
    `</section>`
  );
}

/* --------------------------------------------------------- page assembly */

export function renderFpaPage(
  data: FpaTableData,
  options: FpaRenderOptions = {},
): string {
  return (
    `<div class="scf${options.embed ? " is-embed" : ""}" data-scf-root="1"` +
    ` data-season="${escapeHtml(String(data.season))}"` +
    ` data-format="${escapeHtml(data.format)}"` +
    ` data-view="${escapeHtml(data.view)}">` +
    renderControls(data, options) +
    renderDataMode(data) +
    renderTable(data, options) +
    renderLegend() +
    renderFaq() +
    `</div>`
  );
}

/**
 * The page when nothing has been ingested.
 *
 * An honest empty state rather than a table of zeroes, and it says what to run
 * — because the only person who ever sees this is whoever is setting the tool
 * up. Readers never reach it: the shortcode renders nothing at all in that case
 * and leaves the host page intact.
 */
export function renderFpaEmpty(options: FpaRenderOptions = {}): string {
  return (
    `<div class="scf${options.embed ? " is-embed" : ""}" data-scf-root="1" data-empty="1">` +
    `<p class="scf-empty">${escapeHtml(
      "No Fantasy Points Allowed data has been ingested yet. Run `pnpm --filter @workspace/api-server run ingest-fpa`.",
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
