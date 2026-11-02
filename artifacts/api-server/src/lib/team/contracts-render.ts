/**
 * Markup for the team hub's Contracts tab.
 *
 * Server-rendered in full, in this order: the lede, a strip of four cap
 * tiles, then one analysis workspace: a band of four derived figures, the
 * cut-scenario toolbar (inert without scripting; client/team.ts
 * wireCutScenario drives it), the contract sheet largest cap number first
 * with a pick box per row and a footer that opens the rest of it, and the
 * release panel beside the sheet. Under the workspace: the dead-money
 * block and a note on how Worth is built. The cut figures are the cap
 * page's where it has the player and the builder's estimate otherwise, and
 * a row says which. The cut column is a SIGNED net figure ("Net if cut"):
 * a plus frees cap, a minus costs it, so the top of the sheet reads as what
 * it is (releases that cost cap) rather than as savings gone wrong.
 *
 * Everything here is presentation. The figures come from contracts.ts as
 * they are; the only arithmetic in this file is sums of those figures for
 * the band and the proportions the bars are drawn at.
 *
 * No FAQ and no address of its own: a hub-only panel like Draft and
 * Coaching, until a public URL is approved.
 */

import { headshotImg } from "../headshot-html";
import { escapeHtml } from "../render";
import { getPlayerProfileUrl, getTeamHubUrl } from "./links";
import { nameKeysForTeam, playerForSearchKey } from "./roster";
import type { NamedPlayer } from "./roster";
import type { NflTeam } from "./teams";
import { getTeamByAbbreviation } from "./teams";
import type { ContractLine, ContractsView, WorthDoc } from "./contracts";

const e = escapeHtml;

/** "$23.7M", "$919K", "-$5.5M", "$0"; input in millions. */
export function money(m: number): string {
  if (!Number.isFinite(m) || Math.abs(m) < 0.0005) return "$0";
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  if (abs >= 1) return `${sign}$${abs.toFixed(1)}M`;
  return `${sign}$${Math.round(abs * 1000)}K`;
}

/** money() with an explicit "+" on a positive figure, for a difference. */
function signed(m: number): string {
  return m > 0.0005 ? `+${money(m)}` : money(m);
}

const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

const STATUS_WORD: Record<string, string> = {
  IR: "Injured reserve",
  PUP: "Physically unable to perform",
  PS: "Practice squad",
  SUSP: "Suspended",
  NFI: "Non-football injury",
  EXEMPT: "Commissioner exempt",
};

/**
 * The rank chip, colored by goodness (mak's critique, 2026-10-29): ranks
 * count "most in the league", so for cap space a low number is good and
 * for dead money it is bad; `sense` says which. "neutral" (spending) is
 * plain. The band rule is thirds of the league (mak, 2026-10-30): the top
 * eleven and the bottom eleven get the color, the middle ten stay grey.
 */
export const RANK_TOP_THIRD = 11;
export const RANK_BOTTOM_THIRD = 22;

function rankPill(rank: number | null, sense: "more-is-good" | "more-is-bad" | "neutral" = "neutral"): string {
  if (rank === null) return "";
  let tone = "";
  if (sense !== "neutral" && rank <= RANK_TOP_THIRD) tone = sense === "more-is-good" ? " is-good" : " is-bad";
  if (sense !== "neutral" && rank >= RANK_BOTTOM_THIRD) tone = sense === "more-is-good" ? " is-bad" : " is-good";
  return (
    `<span class="sct-ct-rank${tone}"><span class="sct-ct-num">${e(ordinal(rank))}</span>` +
    `<span class="sct-visually-hidden"> of 32 clubs</span></span>`
  );
}

function playerCell(p: ContractLine): string {
  const href = getPlayerProfileUrl(p.name);
  return href
    ? `<a class="sct-ct-name sct-player-link" href="${e(href)}" target="_top">${e(p.name)}</a>`
    : `<span class="sct-ct-name">${e(p.name)}</span>`;
}

/**
 * The headshot in a small round well ahead of the name, as the Draft tab's
 * class tables have it (mak, 2026-10-30: the two tabs share one design).
 * A player without a photo keeps the empty well, so the names stay in one
 * column.
 */
function faceWell(team: NflTeam, p: ContractLine): string {
  const id = rosterPlayer(team, p.name)?.id ?? null;
  const img = id
    ? headshotImg({
        src: null,
        id,
        className: "sct-ct-face-img",
        alt: "",
        variants: ["160"],
        width: 32,
        height: 32,
        loading: "lazy",
        extra: ` aria-hidden="true"`,
      })
    : null;
  return `<span class="sct-ct-face" aria-hidden="true">${img ?? ""}</span>`;
}

function playerWithFace(team: NflTeam, p: ContractLine): string {
  // The Overpaid / Underpaid tag sits under the Worth figure (mak,
  // 2026-10-30), not beside the name.
  return `<span class="sct-ct-player">${faceWell(team, p)}<span class="sct-ct-who">${playerCell(p)}${statusPill(p)}</span></span>`;
}

function tagPill(p: ContractLine): string {
  const tag = p.worth?.tag;
  if (!tag) return "";
  return `<span class="sct-ct-tag is-${tag}">${tag === "over" ? "Overpaid" : "Underpaid"}</span>`;
}

function statusPill(p: ContractLine): string {
  if (!p.status) return "";
  return `<abbr class="sct-ct-status" title="${e(STATUS_WORD[p.status] ?? p.status)}">${e(p.status)}</abbr>`;
}

/**
 * The color family a position label wears (mak, 2026-10-23): WR blue, RB
 * green, TE yellow, QB red, every defender brown. Linemen and specialists
 * stay neutral.
 */
function positionGroup(position: string): string {
  const p = position.toUpperCase();
  if (p === "QB") return "qb";
  if (p === "RB" || p === "FB" || p === "HB") return "rb";
  if (p === "WR") return "wr";
  if (p === "TE") return "te";
  if (/^(ED|EDGE|IDL|DL|DE|DT|NT|LB|ILB|OLB|MLB|CB|S|SS|FS|SAF|DB)$/.test(p)) return "def";
  return "other";
}

function posChip(p: ContractLine): string {
  if (!p.position) return "";
  return `<span class="sct-ct-pos" data-group="${positionGroup(p.position)}">${e(p.position)}</span>`;
}

/**
 * One key per player shared by the sheet row, the release card and the
 * scenario's cold-start hint, so a click on a card ticks the row.
 */
function lineKey(p: ContractLine): string {
  return p.otcId !== null ? `otc-${p.otcId}` : `n-${nameKey(p.name)}`;
}

/** A small "i" the reader can hover; the text also reads to a screen reader. */
function info(text: string): string {
  return `<span class="sct-ct-info" title="${e(text)}"><span aria-hidden="true">i</span><span class="sct-visually-hidden"> ${e(text)}</span></span>`;
}

/* ------------------------------------------------------------------ strip */

/**
 * The rail's ledger (mak's critique, 2026-10-29): the eight cap figures as
 * three labeled groups, each row label left, value right in tabular
 * numerals with its rank chip, the caption dimmed beneath. One lead figure
 * per group is set larger with the club's accent: cap space, cut savings,
 * dead money. The groups are the three questions the figures answer:
 * where the club stands, what it could do, and what is sunk. The cap-space
 * and dead-money values keep their data-sct-ct-out hooks, so the cut
 * scenario still writes the after-cuts figures into them.
 */
interface LedgerRow {
  label: string;
  value: string;
  /** The caption, plain text. */
  sub?: string;
  /** The caption as markup (a linked name); wins over `sub`. */
  subHtml?: string;
  rank?: string;
  title?: string;
  lead?: boolean;
  /** Context rather than state (the theoretical dead money): the value dims. */
  dim?: boolean;
  key?: string;
  cls?: string;
}

function ledgerRow(r: LedgerRow): string {
  const label = r.title ? `<abbr title="${e(r.title)}">${e(r.label)}</abbr>` : e(r.label);
  const sub = r.subHtml ?? (r.sub ? e(r.sub) : "");
  return (
    `<li class="sct-ct-lg-row${r.lead ? " is-lead" : ""}${r.dim ? " is-dim" : ""}${r.cls ? ` ${r.cls}` : ""}"${r.key ? ` data-sct-ct-tile="${r.key}"` : ""}>` +
    `<span class="sct-ct-lg-label">${label}</span>` +
    `<span class="sct-ct-lg-value"><span class="sct-ct-num"${r.key ? ` data-sct-ct-out="${r.key}"` : ""}>${r.value}</span></span>` +
    (r.rank ? `<span class="sct-ct-lg-rank">${r.rank}</span>` : "") +
    (sub ? `<span class="sct-ct-lg-sub">${sub}</span>` : "") +
    `</li>`
  );
}

/** "83 contracts · 7 overpaid": the Draft cards' stat strip, figures in the display face. */
function strip(items: Array<[number | string, string]>): string {
  return (
    `<p class="sct-ct-strip">` +
    items.map(([n, label]) => `<span class="sct-ct-strip-item"><span class="sct-ct-num">${e(String(n))}</span> ${e(label)}</span>`).join("") +
    `</p>`
  );
}

function ledgerGroup(title: string, stripLine: string, rows: LedgerRow[], tail = ""): string {
  return (
    `<section class="sct-ct-lg">` +
    `<h3 class="sct-ct-lg-h">${e(title)}</h3>` +
    stripLine +
    `<ul class="sct-ct-lg-rows">${rows.map(ledgerRow).join("")}</ul>` +
    tail +
    `</section>`
  );
}

function ledger(team: NflTeam, v: ContractsView): string {
  const rows = v.players;
  const savers = rows.filter((p) => p.cutSave > 0);
  const costers = rows.filter((p) => p.cutSave < 0);
  const releasable = savers.reduce((n, p) => n + p.cutSave, 0);
  const priced = rows.filter((p) => p.worth && p.apy > 0);
  const deals = (n: number): string => `${n} ${n === 1 ? "deal" : "deals"}`;
  let surplus = 0;
  let deficit = 0;
  for (const p of priced) {
    const diff = (p.worth?.worth ?? 0) - p.apy;
    if (diff > 0) surplus += diff;
    else deficit += diff;
  }

  // Cap position: where the club stands.
  const position: LedgerRow[] = [
    v.capSpace === null
      ? { label: `${v.season} cap committed`, value: e(money(v.committed)), rank: rankPill(v.committedRank), lead: true }
      : { label: `${v.season} cap space`, value: e(money(v.capSpace)), rank: rankPill(v.capSpaceRank, "more-is-good"), lead: true, key: "space" },
    v.liabilities !== null
      ? {
          label: "Cap liabilities",
          value: e(money(v.liabilities)),
          sub: "every contract plus dead money",
          title: "The club's total cap liabilities on the cap page: every contract, dead money and reserve lists",
        }
      : {
          label: "Cap commitments",
          value: e(money(v.committed)),
          sub: "every contract on the sheet, summed",
          title: "Every cap number on the sheet, summed",
        },
    { label: "Top-51 total", value: e(money(v.top51)), rank: rankPill(v.top51Rank) },
  ];
  // The kicker line under the rows ("$4.8M free today; ... Cut scenario") went 2026-11-02 (mak).

  // Flexibility: what the club could do.
  const locked = rows.reduce((n, p) => n + p.cutDead, 0);
  const flexibility: LedgerRow[] = [
    {
      label: "Cut savings",
      value: e(money(releasable)),
      sub: costers.length
        ? `${deals(savers.length)} free cap, ${costers.length} would cost it`
        : `${deals(savers.length)} that free cap, summed`,
      title: "The cap freed by every release that frees money, summed, each before June 1. The largest deals cost cap to cut, so the top of the sheet shows none of this",
      lead: true,
    },
    // The counterpart to Cut savings (moved here from the Dead Money card,
    // mak, 2026-11-02): the sheet's sunk money, what a release cannot free.
    {
      label: "Locked in",
      value: e(money(locked)),
      sub: `dead money if all ${deals(rows.length)} were cut today`,
      title: "Bonus proration and guarantees already committed: the dead money the whole sheet would leave if every contract were released before June 1",
      dim: true,
    },
    {
      label: "Value gap",
      value: priced.length
        ? `<span class="sct-ct-kpi-gap ${surplus + deficit >= 0 ? "is-up" : "is-down"}">${e(signed(surplus + deficit))}</span>`
        : "-",
      // Dollars only: the header line above carries the counts.
      sub: priced.length ? `${signed(surplus)} under, ${money(deficit)} over` : "no deals priced yet",
      title: "Worth minus the deal's average, summed across every contract the model prices: a plus means the club pays less than production, a minus more. The split is the underpaid side against the overpaid side",
    },
  ];

  // Dead money moved to its own card at the foot of the rail (mak,
  // 2026-11-02: one Dead Money surface, the three figures over the list).

  // One scope line per card, in one shape, each reconciling with its rows
  // (mak's critique, 2026-10-30): the league year is page context and lives
  // in the intro and the sheet's head, not here.
  const positionStrip = strip([[rows.length, rows.length === 1 ? "contract" : "contracts"]]);
  const fair = Math.max(0, priced.length - v.tagged.over - v.tagged.under);
  const flexStrip = priced.length
    ? strip([
        [v.tagged.over, "over"],
        [v.tagged.under, "under"],
        [fair, "fair"],
      ])
    : "";
  return (
    `<div class="sct-ct-ledger" aria-label="${e(`${team.nickname} ${v.season} salary cap`)}">` +
    ledgerGroup("Cap Position", positionStrip, position) +
    ledgerGroup("Flexibility", flexStrip, flexibility) +
    `</div>`
  );
}

/** The Dead Money card's three figures: what is sunk. */
function deadRows(v: ContractsView): LedgerRow[] {
  const rows = v.players;
  const itemized = v.dead.reduce((n, x) => n + x.amount, 0);
  return [
    v.deadTotal === null
      ? { label: "Contracts on the books", value: String(rows.length), lead: true }
      : {
          label: "On the books",
          value: e(money(v.deadTotal)),
          rank: rankPill(v.deadRank, "more-is-bad"),
          lead: true,
          key: "dead",
          // The cap page's total runs $0.4M-$1.5M above its own named rows
          // for every club (mak, 2026-11-02: "when added up, it doesn't
          // equal 46.2"); the rank is built on the total, so it stays the
          // figure, and the line under it reconciles it with the list.
          sub:
            v.dead.length && Math.abs(v.deadTotal - itemized) >= 0.05
              ? `${money(itemized)} across the ${v.dead.length} names below; ${money(v.deadTotal - itemized)} more is carried without a name on the cap page`
              : undefined,
        },
    // "If all released" moved to Flexibility as "Locked in" and "Largest
    // hit" went (mak, 2026-11-02): the list below is the rest of the card.
  ];
}

/* --------------------------------------------------------------- scenario */

function scenarioBar(v: ContractsView): string {
  if (v.capSpace === null) return "";
  // The empty bar names a first tick: the release that frees the most cap.
  const first = v.cutCandidates[0];
  const hint = first
    ? ` <button type="button" class="sct-ct-scen-try" data-sct-ct-try="${e(lineKey(first))}">${e(`Try ${first.name}`)}</button>`
    : "";
  return (
    `<div class="sct-ct-scen" id="sct-ct-scen" data-sct-ct-scen>` +
    `<div class="sct-ct-scen-head">` +
    `<span class="sct-ct-scen-title">Cut scenario</span>` +
    `<span class="sct-ct-scen-help">Tick players to see the cap after releasing them.${hint}</span>` +
    `</div>` +
    `<div class="sct-ct-scen-body">` +
    `<div class="sct-ct-scen-timing" role="group" aria-label="Release timing">` +
    `<button type="button" class="sct-ct-scen-btn" data-sct-ct-timing="pre" aria-pressed="true">Before June 1</button>` +
    `<button type="button" class="sct-ct-scen-btn" data-sct-ct-timing="post" aria-pressed="false">After June 1</button>` +
    `</div>` +
    `<dl class="sct-ct-scen-out">` +
    `<div><dt>Players cut</dt><dd><span class="sct-ct-num" data-sct-ct-out="count">0</span></dd></div>` +
    `<div><dt>Cap freed</dt><dd><span class="sct-ct-num" data-sct-ct-out="freed">$0</span></dd></div>` +
    `<div><dt>Dead money added</dt><dd><span class="sct-ct-num" data-sct-ct-out="added">$0</span></dd></div>` +
    `<div class="is-result"><dt>Cap space after</dt><dd><span class="sct-ct-num" data-sct-ct-out="after">${e(money(v.capSpace))}</span></dd></div>` +
    `</dl>` +
    `<button type="button" class="sct-ct-scen-reset" data-sct-ct-reset hidden>Clear</button>` +
    `</div>` +
    // The other timing's result for the same picks, under the bar.
    `<span class="sct-ct-scen-alt" data-sct-ct-out="alt" hidden></span>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ table */

/**
 * "2025-2028": the deal's span, the year signed to its last season (mak,
 * 2026-10-30: "just say length for the column header and show it as a
 * range"). A one-season deal is its year alone. The title keeps the count
 * of years for the hover.
 */
function signedCell(p: ContractLine): string {
  if (p.yearSigned === null) return "-";
  const last = p.finalYear ?? (p.years ? p.yearSigned + p.years - 1 : null);
  const span = last !== null && last !== p.yearSigned ? `${p.yearSigned}-${last}` : String(p.yearSigned);
  const years = p.years ? `${p.years} ${p.years === 1 ? "year" : "years"}` : "";
  return years ? `<abbr title="${e(years)}">${e(span)}</abbr>` : e(span);
}

/**
 * Worth, and under it how far the deal's average sits from it. The tint on
 * a tagged cell is the verdict; the line beneath is the size of it.
 */
function worthCell(p: ContractLine, doc: WorthDoc | null): string {
  if (!p.worth) {
    const why = p.fromCapPage
      ? "Not priced: the register has no deal for this player yet"
      : positionGroup(p.position) === "other"
        ? "Not priced: offensive linemen, kickers, punters and long snappers are outside the model"
        : doc
          ? `Not priced: the model needs ${doc.minGames} games this season`
          : "Not priced";
    return `<td class="sct-ct-td is-num is-worth-col is-muted" data-label="Worth" data-sort=""><abbr class="sct-ct-fig" title="${e(why)}">-</abbr></td>`;
  }
  const w = p.worth;
  // The "-$7.9M vs APY" line came out on 2026-10-30 (mak): the figure, the
  // cell's tint and the tag beneath it carry the verdict.
  return (
    `<td class="sct-ct-td is-num is-worth-col is-worth${w.tag ? ` is-${w.tag}` : ""}" data-label="Worth" data-sort="${w.worth}">` +
    `<abbr class="sct-ct-fig" title="${e(`${w.productionLabel}, ${ordinal(w.rank)} of ${w.of} ${w.group}s with a contract`)}">${e(money(w.worth))}</abbr>` +
    tagPill(p) +
    `</td>`
  );
}

/** Rows shown before "Show all": the top of the cap sheet (mak, 2026-10-23). */

/** "Milton Williams" -> "Williams, Milton": the Player column's sort key (suffix dropped). */
function sortName(name: string): string {
  const parts = name.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, "").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}` : name;
}

function row(team: NflTeam, p: ContractLine, scenario: boolean, maxSave: number, doc: WorthDoc | null): string {
  const dash = (m: number): string => (m > 0 ? money(m) : "-");
  const saveClass = p.cutSave > 0 ? " is-save" : p.cutSave < 0 ? " is-cost" : "";
  // The bar ranks the sheet's releasable cap at a glance: drawn only where a
  // release frees money, against the largest such figure on the sheet.
  const bar =
    p.cutSave > 0 && maxSave > 0
      ? `<span class="sct-ct-bar" aria-hidden="true"><i style="width:${Math.max(4, Math.round((p.cutSave / maxSave) * 100))}%"></i></span>`
      : "";
  const pick = scenario
    ? `<td class="sct-ct-td is-pick"><input type="checkbox" class="sct-ct-pick" data-sct-ct-pick` +
      ` aria-label="${e(`Cut ${p.name} in the scenario`)}"></td>`
    : "";
  return (
    `<tr data-sct-ct-row data-sct-ct-id="${e(lineKey(p))}" data-pre-save="${p.cutSave}" data-pre-dead="${p.cutDead}"` +
    ` data-post-save="${p.june1Save}" data-post-dead="${p.june1Dead}"${p.cutEstimated ? ` data-est="1"` : ""}>` +
    pick +
    // data-sort: the column's value for the head's sort buttons (team.ts);
    // an empty one sorts last whichever way the column runs.
    `<th scope="row" class="sct-ct-td is-player" data-sort="${e(sortName(p.name))}">${playerWithFace(team, p)}</th>` +
    `<td class="sct-ct-td is-pos" data-label="Pos" data-sort="${e(p.position)}">${posChip(p)}</td>` +
    // Cap share and total value ride as titles rather than columns, so the
    // sheet is narrow enough for the release panel to sit beside it (mak,
    // 2026-10-23).
    `<td class="sct-ct-td is-num is-cap" data-label="Cap hit" data-sort="${p.capNumber}"><abbr class="sct-ct-fig" title="${e(p.capPct > 0 ? `${p.capPct.toFixed(1)}% of the cap` : p.fromCapPage ? "Cap number from the cap page; the register has no cap row for this deal yet" : "Cap number")}">${e(money(p.capNumber))}</abbr></td>` +
    `<td class="sct-ct-td is-num is-apy" data-label="APY" data-sort="${p.apy > 0 ? p.apy : ""}"><abbr class="sct-ct-fig" title="${e(p.value > 0 ? `${money(p.value)} total value` : "Average per year")}">${e(dash(p.apy))}</abbr></td>` +
    worthCell(p, doc) +
    `<td class="sct-ct-td is-num is-gtd" data-label="Gtd" data-sort="${p.guaranteed > 0 ? p.guaranteed : ""}">${e(dash(p.guaranteed))}</td>` +
    `<td class="sct-ct-td is-muted is-signed" data-label="Length" data-sort="${p.yearSigned ?? ""}">${signedCell(p)}</td>` +
    // Signed: "+$3.7M" frees cap, "-$20.8M" costs it (the column is the net
    // of a release, and the sheet's top is all minus).
    `<td class="sct-ct-td is-num is-save-col${saveClass}" data-label="If cut" data-sort="${p.cutSave}">` +
    `<span class="sct-ct-fig">${e(signed(p.cutSave))}${p.cutEstimated ? `<span class="sct-ct-est" title="Estimated from the deal's structure">*</span>` : ""}</span>` +
    bar +
    `</td>` +
    `<td class="sct-ct-td is-num is-muted is-dead" data-label="Dead" data-sort="${p.cutDead}">${e(money(p.cutDead))}</td>` +
    `</tr>`
  );
}

function table(team: NflTeam, v: ContractsView): string {
  const scenario = v.capSpace !== null;
  const maxSave = v.players.reduce((n, p) => Math.max(n, p.cutSave), 0);
  // Sortable heads (mak, 2026-11-02): each label is a button the bundle
  // wires (team.ts); a numeric column opens largest first, a text column
  // A to Z, and a second press flips it. The explanation stays on hover,
  // and only the sorted column shows a direction mark (team.css).
  const th = (label: string, key: string, type: "num" | "text", cls = "", title = "", sorted = false): string =>
    `<th scope="col" class="sct-ct-th${cls ? ` ${cls}` : ""}${sorted ? " is-sorted" : ""}"${sorted ? ` aria-sort="descending"` : ""}>` +
    `<button type="button" class="sct-ct-sort" data-sct-ct-sort="${key}" data-sort-type="${type}"${title ? ` title="${e(title)}"` : ""}>${e(label)}</button>` +
    `</th>`;
  return (
    `<div class="sct-ct-scroll" tabindex="0">` +
    `<table class="sct-ct-table">` +
    `<caption class="sct-visually-hidden">${e(
      `${team.fullName} ${v.season} contracts: cap number, the deal's average, what a player producing like this is paid, guarantees, the seasons it runs, and the net cap change and dead money of a release before June 1.`,
    )}</caption>` +
    `<thead><tr>` +
    (scenario ? `<th scope="col" class="sct-ct-th is-pick"><span class="sct-visually-hidden">Cut in scenario</span></th>` : "") +
    th("Player", "player", "text", "is-player", "Sort by surname") +
    th("Pos", "pos", "text", "is-pos", "Sort by position") +
    // The sheet opens ordered by cap number; the header says so.
    th("Cap hit", "cap", "num", "is-num is-cap", `${v.season} cap number, largest first; the share of the cap on hover`, true) +
    th("APY", "apy", "num", "is-num is-apy", "Average per year of the current deal; the total on hover") +
    th("Worth", "worth", "num", "is-num is-worth-col", "Our market valuation against the deal's average: what the league pays a player ranked where this one's production ranks this season. Green, Worth above APY; red, below") +
    th("Gtd", "gtd", "num", "is-num is-gtd", "Guaranteed money at signing") +
    th("Length", "signed", "num", "is-signed", "The deal's span: the year signed to its last season") +
    th("Net if cut", "save", "num", "is-num is-save-col", "Net cap change from a release before June 1: a plus frees cap, a minus costs it. A starred figure is estimated") +
    th("Dead", "dead", "num", "is-num is-dead", "Dead money left by a release before June 1") +
    `</tr></thead>` +
    `<tbody>${v.players.map((p) => row(team, p, scenario, maxSave, v.worth)).join("")}</tbody>` +
    `</table>` +
    // The whole sheet, every contract open (mak, 2026-10-30: "show full
    // table"); the ten-row fold and its footer are gone. The season head
    // above the sheet carries the count.
    `</div>`
  );
}

/* ------------------------------------------------------------------ panel */

/** The roster index's folding of a name: "Ja'Marr Chase" -> "jamarrchase". */
function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const NAME_SUFFIXES = ["jr", "sr", "ii", "iii", "iv", "v"];

/**
 * The roster index's player for a register name, on this club only. The
 * register and the roster disagree on suffixes ("Kevin Byard" against
 * "Kevin Byard III", "Robert Beal Jr." against "Robert Beal"), so a miss is
 * retried without the suffix and then against the club's own keys with one
 * added. A name the index holds for another club, or for two players, is
 * left unmatched rather than guessed. The Draft tab borrows it for the picks
 * the id crosswalk has not met yet (this spring's class).
 */
export function rosterPlayer(team: NflTeam, name: string): NamedPlayer | null {
  const club = team.abbreviation.toLowerCase();
  const onClub = (key: string): NamedPlayer | null => {
    const hit = playerForSearchKey(key);
    return hit && hit.team === club ? hit : null;
  };
  const words = name.trim().split(/\s+/);
  const last = (words.at(-1) ?? "").toLowerCase().replace(/\./g, "");
  const bare = NAME_SUFFIXES.includes(last) && words.length > 2 ? nameKey(words.slice(0, -1).join(" ")) : null;
  const tries = [nameKey(name), ...(bare ? [bare] : [])];
  for (const key of tries) {
    const hit = onClub(key);
    if (hit) return hit;
  }
  const clubKeys = nameKeysForTeam(club);
  for (const key of tries) {
    const withSuffix = clubKeys.find((k) => NAME_SUFFIXES.some((sfx) => k === key + sfx));
    if (withSuffix) return onClub(withSuffix);
  }
  return null;
}

/**
 * The player's headshot from the roster index, when the name resolves to a
 * player on this club; the same photo pipeline the depth chart cards use. A
 * player it cannot place keeps a bare well rather than someone else's face.
 */
function cutPhoto(team: NflTeam, p: ContractLine): string {
  const hit = rosterPlayer(team, p.name);
  const img = hit
    ? headshotImg({
        src: null,
        id: hit.id,
        className: "sct-ct-cut-photo",
        alt: "",
        variants: ["160"],
        width: 40,
        height: 40,
        loading: "lazy",
        extra: ` aria-hidden="true"`,
      })
    : null;
  return `<span class="sct-ct-cut-well" aria-hidden="true">${img ?? ""}</span>`;
}

function cutRail(team: NflTeam, v: ContractsView): string {
  if (v.cutCandidates.length === 0) return "";
  return (
    `<aside class="sct-ct-cuts" aria-labelledby="sct-ct-cuts-h">` +
    `<h3 class="sct-ct-h3" id="sct-ct-cuts-h">Where a Release Frees Cap</h3>` +
    // One line, with the disclaimer behind an "i" (still read aloud).
    `<p class="sct-ct-dek">${e(`Releases before June 1 that clear the most ${v.season} cap, with the dead money each leaves.`)}` +
    info("A reading of the deal's structure, not a prediction that anyone is cut. Tap a card to add that release to the cut scenario.") +
    `</p>` +
    `<ol class="sct-ct-cut-list">` +
    v.cutCandidates
      .map(
        (p) =>
          // Photo, then the name with the position beneath it, then the two
          // figures as chips (mak, 2026-10-23, kept through the redesign at
          // mak's request): the face is what the eye finds first.
          // The card is a second handle on the row's pick box: a tap on it
          // (anywhere but the name) ticks the player in the scenario, and
          // the chips are the keyboard's button for the same.
          `<li class="sct-ct-cut" data-sct-ct-cut="${e(lineKey(p))}">` +
          cutPhoto(team, p) +
          `<span class="sct-ct-cut-who">${playerCell(p)}<span class="sct-ct-cut-pos" data-group="${positionGroup(p.position)}">${e(p.position)}</span></span>` +
          `<button type="button" class="sct-ct-cut-nums" data-sct-ct-cut-tick aria-pressed="false" aria-label="${e(`Cut ${p.name} in the scenario`)}">` +
          `<span class="sct-ct-cut-save">saves <span class="sct-ct-num">${e(money(p.cutSave))}</span></span>` +
          `<span class="sct-ct-cut-dead">dead <span class="sct-ct-num">${e(money(p.cutDead))}</span></span>` +
          `</button>` +
          `</li>`,
      )
      .join("") +
    `</ol>` +
    `</aside>`
  );
}

function deadBlock(team: NflTeam, v: ContractsView): string {
  if (v.players.length === 0) return "";
  // One Dead Money card (mak, 2026-11-02): the ledger's three figures, then
  // every player the cap still carries. The lead row is the figure the cut
  // scenario rewrites.
  const figures =
    (v.dead.length ? strip([[v.dead.length, v.dead.length === 1 ? "player carried" : "players carried"]]) : "") +
    `<ul class="sct-ct-lg-rows">${deadRows(v).map(ledgerRow).join("")}</ul>`;
  if (v.deadTotal === null || v.dead.length === 0) {
    return (
      `<section class="sct-ct-dead" aria-labelledby="sct-ct-dead-h">` +
      `<h3 class="sct-ct-lg-h" id="sct-ct-dead-h">${e(`${v.season} Dead Money`)}</h3>` +
      figures +
      `</section>`
    );
  }
  // The club a player is under contract with now, as its crest beside the
  // name, linked to that club's hub (mak, 2026-10-30: the crest, not "now
  // with the Jaguars"); the words stay in the alt text for a screen reader.
  // A player no register carries reads "FA".
  const fa = `<span class="sct-ct-dead-fa" title="Free agent">FA</span>`;
  const crest = (abbr: string | null): string => {
    const club = abbr ? getTeamByAbbreviation(abbr) : null;
    if (!club?.logo) return fa;
    const label = `Now with the ${club.nickname}`;
    const img = `<img class="sct-ct-dead-now" src="${e(club.logo)}" alt="${e(label)}" width="22" height="22" loading="lazy" decoding="async">`;
    const href = getTeamHubUrl(club);
    return href
      ? `<a class="sct-ct-dead-club" href="${e(href)}" title="${e(label)}">${img}</a>`
      : `<span class="sct-ct-dead-club" title="${e(label)}">${img}</span>`;
  };
  return (
    `<section class="sct-ct-dead" aria-labelledby="sct-ct-dead-h">` +
    `<h3 class="sct-ct-lg-h" id="sct-ct-dead-h">${e(`${v.season} Dead Money`)}</h3>` +
    figures +
    // The explanatory line went 2026-11-02 (mak); the crests keep their
    // "Now with the ..." alt text and the FA mark its title.
    `<ol class="sct-ct-dead-list sct-ct-dead-dek">` +
    v.dead
      .map(
        (d) =>
          `<li class="sct-ct-dead-row">` +
          // Mark first, then the name (mak, 2026-10-30), so the names
          // line up down the column whatever each row carries.
          `<span class="sct-ct-dead-who">${crest(d.nowWith)}${e(d.name)}</span>` +
          `<span class="sct-ct-num">${e(money(d.amount))}</span>` +
          `</li>`,
      )
      .join("") +
    `</ol>` +
    `</section>`
  );
}

function worthNote(v: ContractsView): string {
  const w: WorthDoc | null = v.worth;
  if (!w) return "";
  const pct = Math.round((w.ratio - 1) * 100);
  return (
    `<details class="sct-ct-how">` +
    `<summary>How Worth and the Overpaid / Underpaid tags are built</summary>` +
    `<div class="sct-ct-how-body">` +
    `<p>Worth is what the league is paying players ranked where this one's production ranks this season, through Week ${e(String(w.throughWeek))}. ` +
    `Quarterbacks, backs, receivers and tight ends are ranked by PPR fantasy points per game; defenders by a tackle-and-havoc score per game (tackles, tackles for loss, hits, sacks, passes defended, forced and recovered fumbles, interceptions, touchdowns). ` +
    `A player needs ${e(String(w.minGames))} games. Offensive linemen, kickers, punters and long snappers are not priced.</p>` +
    `<p>Within each position group, every contract on the books league-wide is sorted by average per year. A player ranked 3rd in production reads the 3rd-highest average, smoothed across the deals either side of it. ` +
    `Overpaid means the deal's average is at least ${e(String(pct))}% above Worth; Underpaid means Worth is at least ${e(String(pct))}% above the average. Both need the larger figure to reach ${e(money(w.floor))}, and a rookie contract is never Overpaid. ` +
    `Coverage players are scored on tackles and pass breakups, which undersells a corner nobody throws at; read the tag as a prompt, not a verdict.</p>` +
    `</div>` +
    `</details>`
  );
}

/* ---------------------------------------------------------------- section */

/** The whole tab, or "" when the register has no roster for this club. */
export function renderContractsSection(team: NflTeam, v: ContractsView | null): string {
  if (!v) return "";
  // The Draft tab's intro line (mak, 2026-10-30: the two tabs share one
  // design): what the tab holds, in order. The figures the old lede
  // carried live in the ledger cards beside the sheet.
  const intro =
    `Every contract the ${team.nickname} carry against the ${v.season} cap, largest cap number first, ` +
    `then the cap ledger and where a release frees cap.`;
  const scenario = scenarioBar(v);
  const sum = `${v.players.length} ${v.players.length === 1 ? "contract" : "contracts"} · largest cap number first`;
  return (
    `<h2 class="sct-h2">${e(`${team.nickname} Contracts & Salary Cap`)}</h2>` +
    `<div class="sct-ct" data-sct-ct` +
    (v.capSpace !== null ? ` data-cap-space="${v.capSpace}" data-dead-total="${v.deadTotal ?? 0}"` : "") +
    `>` +
    `<p class="sct-note sct-ct-note">${e(intro)}</p>` +
    // Two columns (mak, 2026-10-29): the scenario toolbar and the sheet on
    // the left; on the right a rail of the cap ledger (the eight figures in
    // three groups), the release panel and the dead-money list. Below
    // 1000px the rail stacks above the sheet.
    `<div class="sct-ct-grid">` +
    `<div class="sct-ct-col">` +
    (scenario ? `<div class="sct-ct-work">${scenario}</div>` : "") +
    `<div class="sct-ct-season-head">` +
    `<h4 class="sct-ct-h4">${e(`${v.season} Contracts`)}</h4>` +
    `<span class="sct-ct-season-sum">${e(sum)}</span>` +
    `</div>` +
    `<div class="sct-ct-sheet">${table(team, v)}</div>` +
    `</div>` +
    // The dead-money ledger closes the rail (mak, 2026-10-30): the cap
    // ledger, the release panel, then every player the cap still carries.
    `<aside class="sct-ct-rail">` +
    ledger(team, v) +
    cutRail(team, v) +
    deadBlock(team, v) +
    `</aside>` +
    `</div>` +
    worthNote(v) +
    `<p class="sct-note sct-ct-foot">Cap numbers are for the ${e(String(v.season))} league year. Net if cut (a plus frees cap, a minus costs it) and dead money describe a standard release before June 1` +
    (v.hasSnapshot
      ? `; a starred figure is estimated from the deal's structure where the published release math is not available.`
      : `, estimated from the deal's structure: the remaining prorated bonus and guaranteed salary stay on the books, and the rest is freed.`) +
    `</p>` +
    `</div>`
    // The club-specific FAQ (contracts-faq.ts, mak 2026-11-02) is the
    // section's tail, placed by team-render.ts like every other tab's.
  );
}

