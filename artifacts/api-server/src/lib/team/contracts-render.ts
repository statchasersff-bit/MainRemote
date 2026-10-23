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
 * a row says which.
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
import { getPlayerProfileUrl } from "./links";
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

function rankPill(rank: number | null): string {
  if (rank === null) return "";
  return (
    `<span class="sct-ct-rank"><span class="sct-ct-num">${e(ordinal(rank))}</span>` +
    `<span class="sct-visually-hidden"> of 32 clubs</span></span>`
  );
}

function playerCell(p: ContractLine): string {
  const href = getPlayerProfileUrl(p.name);
  return href
    ? `<a class="sct-ct-name sct-player-link" href="${e(href)}" target="_top">${e(p.name)}</a>`
    : `<span class="sct-ct-name">${e(p.name)}</span>`;
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

/* ------------------------------------------------------------------ strip */

function tiles(team: NflTeam, v: ContractsView): string {
  const tile = (value: string, label: string, extra = "", key = ""): string =>
    `<li class="sct-ct-tile"${key ? ` data-sct-ct-tile="${key}"` : ""}>` +
    `<span class="sct-ct-tile-label">${e(label)}</span>` +
    `<span class="sct-ct-tile-value"><span class="sct-ct-num"${key ? ` data-sct-ct-out="${key}"` : ""}>${e(value)}</span>${extra}</span>` +
    `</li>`;
  const space = v.capSpace === null
    ? tile(money(v.committed), `${v.season} cap committed`, rankPill(v.committedRank))
    : tile(money(v.capSpace), `${v.season} cap space`, rankPill(v.capSpaceRank), "space");
  const dead = v.deadTotal === null
    ? tile(String(v.players.length), "Contracts on the books")
    : tile(money(v.deadTotal), "Dead money", rankPill(v.deadRank), "dead");
  return (
    `<ul class="sct-ct-tiles" aria-label="${e(`${team.nickname} ${v.season} salary cap`)}">` +
    space +
    tile(money(v.top51), "Top-51 total", rankPill(v.top51Rank)) +
    dead +
    tile(
      v.largest ? money(v.largest.capNumber) : "-",
      v.largest ? `Largest cap hit · ${v.largest.name}` : "Largest cap hit",
    ) +
    `</ul>`
  );
}

/* ------------------------------------------------------------------- band */

/**
 * Four figures summed from the sheet's own rows, so the workspace opens as
 * analysis rather than a list: cap committed, the cap a release could free,
 * the cap a release could not, and how far the deals sit from their Worth.
 */
function band(v: ContractsView): string {
  const rows = v.players;
  const savers = rows.filter((p) => p.cutSave > 0);
  const releasable = savers.reduce((n, p) => n + p.cutSave, 0);
  const locked = rows.reduce((n, p) => n + p.cutDead, 0);
  const priced = rows.filter((p) => p.worth && p.apy > 0);
  let surplus = 0;
  let deficit = 0;
  for (const p of priced) {
    const diff = (p.worth?.worth ?? 0) - p.apy;
    if (diff > 0) surplus += diff;
    else deficit += diff;
  }
  const item = (label: string, value: string, sub: string, title: string, cls = ""): string =>
    `<div class="sct-ct-kpi${cls ? ` ${cls}` : ""}">` +
    `<span class="sct-ct-kpi-label"><abbr title="${e(title)}">${e(label)}</abbr></span>` +
    `<span class="sct-ct-kpi-value">${value}</span>` +
    `<span class="sct-ct-kpi-sub">${e(sub)}</span>` +
    `</div>`;
  const deals = (n: number): string => `${n} ${n === 1 ? "deal" : "deals"}`;
  return (
    `<div class="sct-ct-kpis" aria-label="${e(`${v.season} contract analysis`)}">` +
    (v.liabilities !== null
      ? item(
          `${v.season} cap liabilities`,
          e(money(v.liabilities)),
          `${rows.length} contracts plus dead money`,
          "The club's total cap liabilities on the cap page: every contract, dead money and reserve lists",
        )
      : item(
          `${v.season} cap commitments`,
          e(money(v.committed)),
          `${rows.length} contracts on the sheet`,
          "Every cap number on the sheet, summed",
        )) +
    item(
      "Cut savings on the sheet",
      e(money(releasable)),
      `${deals(savers.length)} that free cap, summed`,
      "The cap saved by every release that saves money, summed, each before June 1",
    ) +
    item(
      "Dead money if all released",
      e(money(locked)),
      `every deal on the sheet, summed`,
      "Bonus proration and guarantees already committed: the dead money the whole sheet would leave",
    ) +
    item(
      "Contract value gap",
      priced.length
        ? `<span class="sct-ct-kpi-gap is-up">${e(signed(surplus))}</span>` +
          `<span class="sct-ct-kpi-slash">/</span>` +
          `<span class="sct-ct-kpi-gap is-down">${e(money(deficit))}</span>`
        : "-",
      priced.length ? `across ${deals(priced.length)} priced` : "no deals priced yet",
      "Worth above the deal's average, summed, against Worth below it, across every contract the model prices",
      "is-gap",
    ) +
    `</div>`
  );
}

/* --------------------------------------------------------------- scenario */

function scenarioBar(v: ContractsView): string {
  if (v.capSpace === null) return "";
  return (
    `<div class="sct-ct-scen" data-sct-ct-scen>` +
    `<div class="sct-ct-scen-head">` +
    `<span class="sct-ct-scen-title">Cut scenario</span>` +
    `<span class="sct-ct-scen-help">Tick players to see the cap after releasing them.</span>` +
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
    `</div>`
  );
}

/* ------------------------------------------------------------------ table */

/** "2025 · 4 yrs · thru 2028": signed, length and last season in one cell. */
function signedCell(p: ContractLine): string {
  if (p.yearSigned === null) return "-";
  const length = p.years ? ` · ${p.years} ${p.years === 1 ? "yr" : "yrs"}` : "";
  const thru = p.finalYear !== null && p.finalYear !== p.yearSigned ? ` · thru ${p.finalYear}` : "";
  return `${p.yearSigned}${length}${thru}`;
}

/**
 * Worth, and under it how far the deal's average sits from it. The tint on
 * a tagged cell is the verdict; the line beneath is the size of it.
 */
function worthCell(p: ContractLine): string {
  if (!p.worth) return `<td class="sct-ct-td is-num is-worth-col is-muted" data-label="Worth">-</td>`;
  const w = p.worth;
  const diff = w.worth - p.apy;
  const delta =
    p.apy > 0 && Math.abs(diff) >= 0.05
      ? `<span class="sct-ct-delta ${diff > 0 ? "is-up" : "is-down"}">${e(signed(diff))}<span class="sct-ct-delta-vs"> vs APY</span></span>`
      : "";
  return (
    `<td class="sct-ct-td is-num is-worth-col is-worth${w.tag ? ` is-${w.tag}` : ""}" data-label="Worth">` +
    `<abbr class="sct-ct-fig" title="${e(`${w.productionLabel}, ${ordinal(w.rank)} of ${w.of} ${w.group}s with a contract`)}">${e(money(w.worth))}</abbr>` +
    delta +
    `</td>`
  );
}

/** Rows shown before "Show all": the top of the cap sheet (mak, 2026-10-23). */
export const ROWS_SHOWN = 10;

function row(p: ContractLine, scenario: boolean, more: boolean, maxSave: number): string {
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
    `<tr${more ? ` class="is-more"` : ""} data-sct-ct-row data-pre-save="${p.cutSave}" data-pre-dead="${p.cutDead}"` +
    ` data-post-save="${p.june1Save}" data-post-dead="${p.june1Dead}"${p.cutEstimated ? ` data-est="1"` : ""}>` +
    pick +
    `<th scope="row" class="sct-ct-td is-player">${playerCell(p)}${tagPill(p)}${statusPill(p)}</th>` +
    `<td class="sct-ct-td is-pos" data-label="Pos">${posChip(p)}</td>` +
    // Cap share and total value ride as titles rather than columns, so the
    // sheet is narrow enough for the release panel to sit beside it (mak,
    // 2026-10-23).
    `<td class="sct-ct-td is-num is-cap" data-label="Cap hit"><abbr class="sct-ct-fig" title="${e(p.capPct > 0 ? `${p.capPct.toFixed(1)}% of the cap` : p.fromCapPage ? "Cap number from the cap page; the register has no cap row for this deal yet" : "Cap number")}">${e(money(p.capNumber))}</abbr></td>` +
    `<td class="sct-ct-td is-num is-apy" data-label="APY"><abbr class="sct-ct-fig" title="${e(p.value > 0 ? `${money(p.value)} total value` : "Average per year")}">${e(dash(p.apy))}</abbr></td>` +
    worthCell(p) +
    `<td class="sct-ct-td is-num is-gtd" data-label="Gtd">${e(dash(p.guaranteed))}</td>` +
    `<td class="sct-ct-td is-muted is-signed" data-label="Signed">${e(signedCell(p))}</td>` +
    `<td class="sct-ct-td is-num is-save-col${saveClass}" data-label="Cut saves">` +
    `<span class="sct-ct-fig">${e(money(p.cutSave))}${p.cutEstimated ? `<span class="sct-ct-est" title="Estimated from the deal's structure">*</span>` : ""}</span>` +
    bar +
    `</td>` +
    `<td class="sct-ct-td is-num is-muted is-dead" data-label="Dead">${e(money(p.cutDead))}</td>` +
    `</tr>`
  );
}

function table(team: NflTeam, v: ContractsView): string {
  const scenario = v.capSpace !== null;
  const maxSave = v.players.reduce((n, p) => Math.max(n, p.cutSave), 0);
  const th = (label: string, cls = "", title = "", sorted = false): string =>
    `<th scope="col" class="sct-ct-th${cls ? ` ${cls}` : ""}${sorted ? " is-sorted" : ""}"${sorted ? ` aria-sort="descending"` : ""}>` +
    (title ? `<abbr title="${e(title)}">${e(label)}</abbr>` : e(label)) +
    `</th>`;
  const total = v.players.length;
  return (
    `<div class="sct-ct-scroll" tabindex="0">` +
    `<table class="sct-ct-table">` +
    `<caption class="sct-visually-hidden">${e(
      `${team.fullName} ${v.season} contracts: cap number, the deal's average, what a player producing like this is paid, guarantees, when it was signed and runs through, and the cap saved and left behind by a release before June 1.`,
    )}</caption>` +
    `<thead><tr>` +
    (scenario ? `<th scope="col" class="sct-ct-th is-pick"><span class="sct-visually-hidden">Cut in scenario</span></th>` : "") +
    th("Player", "is-player") +
    th("Pos", "is-pos") +
    // The sheet is ordered by cap number; the header says so.
    th("Cap hit", "is-num is-cap", `${v.season} cap number, largest first; the share of the cap on hover`, true) +
    th("APY", "is-num is-apy", "Average per year of the current deal; the total on hover") +
    th("Worth", "is-num is-worth-col", "Our model: what the league pays a player ranked where this one's production ranks") +
    th("Gtd", "is-num is-gtd", "Guaranteed money at signing") +
    th("Signed", "is-signed", "Year signed, length, and the deal's last season") +
    th("Cut saves", "is-num is-save-col", "Cap freed by a release before June 1; a starred figure is estimated") +
    th("Dead", "is-num is-dead", "Dead money left by a release before June 1") +
    `</tr></thead>` +
    `<tbody>${v.players.map((p, i) => row(p, scenario, i >= ROWS_SHOWN, maxSave)).join("")}</tbody>` +
    `</table>` +
    `</div>` +
    // The first ten rows by default, the rest behind the footer's button
    // (mak, 2026-10-23). Every row is in the HTML; the bundle hides the tail
    // and the button reveals it, so with scripting off the whole sheet reads
    // as before and the footer only counts it.
    `<div class="sct-ct-footbar">` +
    `<span class="sct-ct-count" data-sct-ct-count` +
    (total > ROWS_SHOWN
      ? ` data-closed="${e(`Showing top ${ROWS_SHOWN} of ${total}`)}" data-open="${e(`All ${total} contracts`)}">${e(`${total} contracts`)}`
      : `>${e(`${total} contracts`)}`) +
    `</span>` +
    (total > ROWS_SHOWN
      ? `<button type="button" class="sct-ct-more" data-sct-ct-more aria-expanded="false"` +
        ` data-more="${e(`Show all ${total} contracts`)}" data-less="Show the top ${ROWS_SHOWN}">` +
        `${e(`Show all ${total} contracts`)}</button>`
      : "") +
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
 * left unmatched rather than guessed.
 */
function rosterPlayer(team: NflTeam, name: string): NamedPlayer | null {
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
    `<p class="sct-ct-dek">${e(
      `The ${team.nickname} contracts a release before June 1 would clear the most ${v.season} cap on, with the dead money each would leave. A reading of the deal's structure, not a prediction that anyone is cut.`,
    )}</p>` +
    `<ol class="sct-ct-cut-list">` +
    v.cutCandidates
      .map(
        (p) =>
          // Photo, then the name with the position beneath it, then the two
          // figures as chips (mak, 2026-10-23, kept through the redesign at
          // mak's request): the face is what the eye finds first.
          `<li class="sct-ct-cut">` +
          cutPhoto(team, p) +
          `<span class="sct-ct-cut-who">${playerCell(p)}<span class="sct-ct-cut-pos" data-group="${positionGroup(p.position)}">${e(p.position)}</span></span>` +
          `<span class="sct-ct-cut-nums">` +
          `<span class="sct-ct-cut-save">saves <span class="sct-ct-num">${e(money(p.cutSave))}</span></span>` +
          `<span class="sct-ct-cut-dead">dead <span class="sct-ct-num">${e(money(p.cutDead))}</span></span>` +
          `</span>` +
          `</li>`,
      )
      .join("") +
    `</ol>` +
    `</aside>`
  );
}

function deadBlock(team: NflTeam, v: ContractsView): string {
  if (v.deadTotal === null || v.dead.length === 0) return "";
  const nick = (abbr: string): string => getTeamByAbbreviation(abbr)?.nickname ?? abbr.toUpperCase();
  return (
    `<div class="sct-ct-dead">` +
    `<h3 class="sct-ct-h3">${e(`${v.season} Dead Money`)} <span class="sct-ct-h3-sum"><span class="sct-ct-num">${e(money(v.deadTotal))}</span></span></h3>` +
    `<p class="sct-ct-dek">${e(
      `Cap dollars the ${team.nickname} are carrying for players no longer on the roster. Where a player is under contract elsewhere now, the club is named.`,
    )}</p>` +
    `<ol class="sct-ct-dead-list">` +
    v.dead
      .map(
        (d) =>
          `<li class="sct-ct-dead-row">` +
          `<span class="sct-ct-dead-who">${e(d.name)}` +
          (d.nowWith ? `<span class="sct-ct-dead-now">now with the ${e(nick(d.nowWith))}</span>` : "") +
          `</span>` +
          `<span class="sct-ct-num">${e(money(d.amount))}</span>` +
          `</li>`,
      )
      .join("") +
    `</ol>` +
    `</div>`
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
  const space =
    v.capSpace === null
      ? `${money(v.committed)} of ${v.season} cap committed across ${v.players.length} contracts`
      : `${money(v.capSpace)} of ${v.season} cap space${v.capSpaceRank ? `, ${ordinal(v.capSpaceRank)} most in the league,` : ""} with ${v.players.length} contracts on the books`;
  const tags =
    v.tagged.over + v.tagged.under > 0
      ? ` By this season's production, ${v.tagged.over} ${v.tagged.over === 1 ? "deal looks" : "deals look"} overpaid and ${v.tagged.under} underpaid.`
      : "";
  return (
    `<h2 class="sct-h2">${e(`${team.nickname} Contracts & Salary Cap`)}</h2>` +
    `<div class="sct-ct" data-sct-ct` +
    (v.capSpace !== null ? ` data-cap-space="${v.capSpace}" data-dead-total="${v.deadTotal ?? 0}"` : "") +
    `>` +
    `<p class="sct-ct-lede">${e(`The ${team.nickname} have ${space}.${tags} Every figure is in millions of dollars, largest cap number first.`)}</p>` +
    tiles(team, v) +
    // One surface for the analysis: the band, the scenario toolbar, and the
    // sheet with the release panel beside it (under it below 1000px).
    `<div class="sct-ct-work">` +
    band(v) +
    scenarioBar(v) +
    `<div class="sct-ct-main">` +
    `<div class="sct-ct-sheet">${table(team, v)}</div>` +
    cutRail(team, v) +
    `</div>` +
    `</div>` +
    deadBlock(team, v) +
    worthNote(v) +
    `<p class="sct-note sct-ct-foot">Cap numbers are for the ${e(String(v.season))} league year. Cut saves and dead money describe a standard release before June 1` +
    (v.hasSnapshot
      ? `; a starred figure is estimated from the deal's structure where the published release math is not available.`
      : `, estimated from the deal's structure: the remaining prorated bonus and guaranteed salary stay on the books, and the rest is freed.`) +
    `</p>` +
    `</div>`
  );
}
