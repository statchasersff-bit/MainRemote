/**
 * The Contracts & Salary Cap tab (mak's brief, 2026-11-05,
 * attached_assets/contracts1.png; the tab's own design since the same day,
 * when mak said "remove the old version of the contracts tab"): a
 * navy-and-gold banner whose heading is the tab's H2, one cut-scenario
 * strip, the contract sheet under a navy "2026 Contracts" head on the left,
 * and on the right four cards: Cap Position, Flexibility, Where a Release
 * Frees Cap and the season's Dead Money. The Worth note and the footnote
 * close it; the club FAQ follows as the section's tail.
 *
 * Presentation only. Every figure is the ContractsView; the sums are
 * contracts-render.ts's flexFigures(), and the money, sign, ordinal, span,
 * name and roster helpers are that module's exports.
 *
 * The block is the `[data-sct-ct]` root the bundle's wireCutScenario
 * (client/team.ts) drives: pick boxes, timing buttons, outputs and sort
 * heads. Every row prints both the pre- and post-June-1 release figures,
 * and the block's data-timing (which the bundle writes) picks the visible
 * pair, so Net if cut and Dead follow the toggle. Ids are `sct-ctp-`
 * prefixed.
 */

import { headshotImg } from "../headshot-html";
import { escapeHtml } from "../render";
import { premiumTabHead, premiumTabFrame } from "./premium-head";
import type { ContractLine, ContractsView, WorthDoc } from "./contracts";
import {
  RANK_BOTTOM_THIRD,
  RANK_TOP_THIRD,
  STATUS_WORD,
  flexFigures,
  lineKey,
  money,
  ordinal,
  playerCell,
  positionGroup,
  rosterPlayer,
  signed,
  signedCell,
  sortName,
  worthNote,
} from "./contracts-render";
import { getTeamHubUrl } from "./links";
import type { NflTeam } from "./teams";
import { getTeamByAbbreviation } from "./teams";

const e = escapeHtml;

/* ------------------------------------------------------------------ icons */

/** Gold line icons, inline so nothing is fetched; all decorative. */
const ICON = {
  sliders:
    `<svg class="sct-ctp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="9" cy="7" r="2.2" fill="#fff" stroke="currentColor" stroke-width="2"/>` +
    `<circle cx="15" cy="12" r="2.2" fill="#fff" stroke="currentColor" stroke-width="2"/>` +
    `<circle cx="8" cy="17" r="2.2" fill="#fff" stroke="currentColor" stroke-width="2"/>` +
    `</svg>`,
  doc:
    `<svg class="sct-ctp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M6 3h8l5 5v13H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M14 3v5h5M9 12h6M9 16h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  coins:
    `<svg class="sct-ctp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<ellipse cx="12" cy="6" rx="7" ry="2.6" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `</svg>`,
  bars:
    `<svg class="sct-ctp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="4" y="12" width="4" height="8" rx="1" fill="currentColor"/>` +
    `<rect x="10" y="7" width="4" height="13" rx="1" fill="currentColor"/>` +
    `<rect x="16" y="3" width="4" height="17" rx="1" fill="currentColor"/>` +
    `</svg>`,
  people:
    `<svg class="sct-ctp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="16.5" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M16 14.2c2.6.2 4.5 2 4.5 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`,
  tag:
    `<svg class="sct-ctp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M3 12V4h8l10 10-8 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="7.5" cy="8.5" r="1.6" fill="currentColor"/>` +
    `</svg>`,
};

/* ---------------------------------------------------------------- pieces */

/**
 * The rank chip, on the original's thirds rule (contracts-render.ts): the
 * top eleven and the bottom eleven are colored by whether more is good,
 * the middle ten stay neutral.
 */
function rankBadge(rank: number | null, sense: "more-is-good" | "more-is-bad" | "neutral" = "neutral"): string {
  if (rank === null) return "";
  let tone = "neutral";
  if (sense !== "neutral" && rank <= RANK_TOP_THIRD) tone = sense === "more-is-good" ? "good" : "bad";
  if (sense !== "neutral" && rank >= RANK_BOTTOM_THIRD) tone = sense === "more-is-good" ? "bad" : "good";
  return (
    `<span class="sct-ctp-rank" data-tone="${tone}"><span class="sct-ctp-num">${e(ordinal(rank))}</span> of 32` +
    `<span class="sct-visually-hidden"> clubs</span></span>`
  );
}

/** The headshot well: the roster index's photo, or an empty well. */
function face(team: NflTeam, p: ContractLine, size: number, cls: string): string {
  const id = rosterPlayer(team, p.name)?.id ?? null;
  const img = id
    ? headshotImg({
        src: null,
        id,
        className: `${cls}-img`,
        alt: "",
        variants: ["160"],
        width: size,
        height: size,
        loading: "lazy",
        extra: ` aria-hidden="true"`,
      })
    : null;
  return `<span class="${cls}" aria-hidden="true">${img ?? ""}</span>`;
}

function statusBadge(p: ContractLine): string {
  if (!p.status) return "";
  const tone = p.status === "IR" || p.status === "PUP" || p.status === "NFI" ? "hurt" : p.status === "SUSP" || p.status === "EXEMPT" ? "amber" : "ps";
  return `<abbr class="sct-ctp-status" data-tone="${tone}" title="${e(STATUS_WORD[p.status] ?? p.status)}">${e(p.status)}</abbr>`;
}

/** A small "i" the reader can hover; the text also reads to a screen reader. */
function info(text: string): string {
  return `<span class="sct-ctp-info" title="${e(text)}" tabindex="0"><span aria-hidden="true">i</span><span class="sct-visually-hidden"> ${e(text)}</span></span>`;
}

/* ---------------------------------------------------------------- banner */

function banner(team: NflTeam, v: ContractsView): string {
  const sub =
    `Every contract the ${team.nickname} carry against the ${v.season} cap, largest cap number first, ` +
    `then the cap ladder and where a release frees cap.`;
  return (
    // The tab's heading, in the banner: .sct-h2 is the house heading.
    premiumTabHead({
      hook: "sct-ctp-hero",
      icon: "contracts",
      art: "contracts",
      heading: `<h2 class="sct-h2 sct-up-h2 sct-ctp-title">${e(`${team.nickname} Contracts & Salary Cap`)}</h2>`,
      phoneTitle: "Contracts & Salary Cap",
      dek: sub,
    })
  );
}

/* ------------------------------------------------------------- simulator */

/**
 * The cut-scenario strip: the same hooks the original's bar carries
 * (data-sct-ct-scen, -timing, -out, -reset, -try), so the bundle wires it
 * the same way. "" without a cap page, as the original's is.
 */
function simulator(v: ContractsView): string {
  if (v.capSpace === null) return "";
  const first = v.cutCandidates[0];
  const hint = first
    ? ` <button type="button" class="sct-ctp-try" data-sct-ct-try="${e(lineKey(first))}">${e(`Try ${first.name}`)}</button>`
    : "";
  const metric = (label: string, key: string, value: string, lead = false): string =>
    `<div class="sct-ctp-metric${lead ? " is-lead" : ""}"><dt>${e(label)}</dt><dd><span class="sct-ctp-num" data-sct-ct-out="${key}">${value}</span></dd></div>`;
  return (
    `<section class="sct-ctp-sim" id="sct-ctp-sim" data-sct-ct-scen aria-labelledby="sct-ctp-sim-h">` +
    `<div class="sct-ctp-sim-inner">` +
    `<div class="sct-ctp-sim-lead">` +
    `<div class="sct-ctp-sim-head">` +
    ICON.sliders +
    `<h3 class="sct-ctp-sim-title" id="sct-ctp-sim-h">Cut Scenario</h3>` +
    `</div>` +
    `<p class="sct-ctp-sim-help">Pick players to see the cap after releasing them.${hint}</p>` +
    `</div>` +
    `<div class="sct-ctp-timing" role="group" aria-label="Release timing">` +
    `<button type="button" class="sct-ctp-timing-btn" data-sct-ct-timing="pre" aria-pressed="true">Before June 1</button>` +
    `<button type="button" class="sct-ctp-timing-btn" data-sct-ct-timing="post" aria-pressed="false">After June 1</button>` +
    `</div>` +
    `<dl class="sct-ctp-metrics">` +
    metric("Players cut", "count", "0") +
    metric("Cap freed", "freed", "$0") +
    metric("Dead money added", "added", "$0") +
    metric("Cap space after", "after", e(money(v.capSpace)), true) +
    `</dl>` +
    `<button type="button" class="sct-ctp-reset" data-sct-ct-reset hidden>Clear</button>` +
    `</div>` +
    // The other timing's result for the same picks, under the strip.
    `<p class="sct-ctp-sim-alt" data-sct-ct-out="alt" hidden></p>` +
    `</section>`
  );
}

/* ------------------------------------------------------------------ table */

function worthCell(p: ContractLine, doc: WorthDoc | null): string {
  if (!p.worth) {
    const why = p.fromCapPage
      ? "Not priced: the register has no deal for this player yet"
      : positionGroup(p.position) === "other"
        ? "Not priced: offensive linemen, kickers, punters and long snappers are outside the model"
        : doc
          ? `Not priced: the model needs ${doc.minGames} games this season`
          : "Not priced";
    return `<td class="sct-ctp-td is-num is-worth is-none" data-sort=""><abbr class="sct-ctp-fig" title="${e(why)}">-</abbr></td>`;
  }
  const w = p.worth;
  const tag = w.tag ? `<span class="sct-ctp-tag">${w.tag === "over" ? "Overpaid" : "Underpaid"}</span>` : "";
  return (
    `<td class="sct-ctp-td is-num is-worth${w.tag ? ` is-${w.tag}` : ""}" data-sort="${w.worth}">` +
    `<abbr class="sct-ctp-fig" title="${e(`Model estimate, not a salary: ${w.productionLabel}, ${ordinal(w.rank)} of ${w.of} ${w.group}s with a contract`)}">${e(money(w.worth))}</abbr>` +
    tag +
    `</td>`
  );
}

/** "save" frees cap, "cost" costs it, "zero" neither. */
function tone(m: number): string {
  return m > 0.0005 ? "save" : m < -0.0005 ? "cost" : "zero";
}

function row(team: NflTeam, p: ContractLine, scenario: boolean, doc: WorthDoc | null): string {
  const dash = (m: number): string => (m > 0 ? money(m) : "-");
  const est = p.cutEstimated ? `<span class="sct-ctp-est" title="Estimated from the deal's structure">*</span>` : "";
  const pick = scenario
    ? `<td class="sct-ctp-td is-pick"><input type="checkbox" class="sct-ctp-pick" data-sct-ct-pick` +
      ` aria-label="${e(`Cut ${p.name} in the scenario`)}"></td>`
    : "";
  const capTitle =
    p.capPct > 0
      ? `${p.capPct.toFixed(1)}% of the cap`
      : p.fromCapPage
        ? "Cap number from the cap page; the register has no cap row for this deal yet"
        : "Cap number";
  return (
    `<tr class="sct-ctp-row" data-sct-ct-row data-sct-ct-id="${e(lineKey(p))}" data-pre-save="${p.cutSave}" data-pre-dead="${p.cutDead}"` +
    ` data-post-save="${p.june1Save}" data-post-dead="${p.june1Dead}"${p.cutEstimated ? ` data-est="1"` : ""}>` +
    pick +
    `<th scope="row" class="sct-ctp-td is-player" data-sort="${e(sortName(p.name))}">` +
    `<span class="sct-ctp-player">${face(team, p, 30, "sct-ctp-face")}<span class="sct-ctp-who">${playerCell(p)}${statusBadge(p)}</span></span>` +
    `</th>` +
    `<td class="sct-ctp-td is-pos" data-sort="${e(p.position)}"><span class="sct-ctp-pos" data-group="${positionGroup(p.position)}">${e(p.position)}</span></td>` +
    `<td class="sct-ctp-td is-num is-cap" data-sort="${p.capNumber}"><abbr class="sct-ctp-fig" title="${e(capTitle)}">${e(money(p.capNumber))}</abbr></td>` +
    `<td class="sct-ctp-td is-num is-apy" data-sort="${p.apy > 0 ? p.apy : ""}"><abbr class="sct-ctp-fig" title="${e(p.value > 0 ? `${money(p.value)} total value` : "Average per year")}">${e(dash(p.apy))}</abbr></td>` +
    worthCell(p, doc) +
    `<td class="sct-ctp-td is-num is-gtd" data-sort="${p.guaranteed > 0 ? p.guaranteed : ""}">${e(dash(p.guaranteed))}</td>` +
    `<td class="sct-ctp-td is-span" data-sort="${p.yearSigned ?? ""}">${signedCell(p)}</td>` +
    // Both timings printed; the block's data-timing (written by the bundle
    // when the toggle is pressed) shows one pair. Signed either way.
    `<td class="sct-ctp-td is-num is-net" data-sct-ct-col="save" data-pre-tone="${tone(p.cutSave)}" data-post-tone="${tone(p.june1Save)}" data-sort="${p.cutSave}">` +
    `<span class="sct-ctp-fig is-pre">${e(signed(p.cutSave))}${est}</span>` +
    `<span class="sct-ctp-fig is-post">${e(signed(p.june1Save))}${est}</span>` +
    `</td>` +
    `<td class="sct-ctp-td is-num is-dead" data-sct-ct-col="dead" data-sort="${p.cutDead}">` +
    `<span class="sct-ctp-fig is-pre">${e(money(p.cutDead))}</span>` +
    `<span class="sct-ctp-fig is-post">${e(money(p.june1Dead))}</span>` +
    `</td>` +
    `</tr>`
  );
}

function sheet(team: NflTeam, v: ContractsView): string {
  const scenario = v.capSpace !== null;
  const th = (label: string, key: string, type: "num" | "text", cls: string, title: string, sorted = false): string =>
    `<th scope="col" class="sct-ctp-th ${cls}${sorted ? " is-sorted" : ""}"${sorted ? ` aria-sort="descending"` : ""}>` +
    `<button type="button" class="sct-ctp-sort" data-sct-ct-sort="${key}" data-sort-type="${type}" title="${e(title)}">${e(label)}</button>` +
    `</th>`;
  const sum = `${v.players.length} ${v.players.length === 1 ? "contract" : "contracts"} · Largest cap number first`;
  return (
    `<section class="sct-ctp-sheet" aria-labelledby="sct-ctp-sheet-h">` +
    `<div class="sct-ctp-head">` +
    ICON.doc +
    `<h3 class="sct-ctp-h3" id="sct-ctp-sheet-h">${e(`${v.season} Contracts`)}</h3>` +
    `<span class="sct-ctp-head-sum">${e(sum)}</span>` +
    `<span class="sct-ctp-slash" aria-hidden="true"></span>` +
    `</div>` +
    `<div class="sct-ctp-scroll" tabindex="0">` +
    `<table class="sct-ctp-table" data-sct-ct-table>` +
    `<caption class="sct-visually-hidden">${e(
      `${team.fullName} ${v.season} contracts: cap number, the deal's average, what a player producing like this is paid, guarantees, the seasons it runs, and the net cap change and dead money of a release under the selected June 1 timing.`,
    )}</caption>` +
    `<thead><tr>` +
    (scenario ? `<th scope="col" class="sct-ctp-th is-pick"><span class="sct-visually-hidden">Cut in scenario</span></th>` : "") +
    th("Player", "player", "text", "is-player", "Sort by surname") +
    th("Pos", "pos", "text", "is-pos", "Sort by position") +
    th("Cap hit", "cap", "num", "is-num is-cap", `${v.season} cap number, largest first; the share of the cap on hover`, true) +
    th("APY", "apy", "num", "is-num is-apy", "Average per year of the current deal; the total on hover") +
    th("Worth", "worth", "num", "is-num is-worth", "Our market valuation against the deal's average: what the league pays a player ranked where this one's production ranks this season. A model estimate, not a salary. Green, Worth above APY; red, below") +
    th("Gtd", "gtd", "num", "is-num is-gtd", "Guaranteed money at signing") +
    th("Length", "signed", "num", "is-span", "The deal's span: the year signed to its last season") +
    th("Net if cut", "save", "num", "is-num is-net", "Net cap change from a release under the selected timing: a plus frees cap, a minus costs it. A starred figure is estimated") +
    th("Dead", "dead", "num", "is-num is-dead", "Dead money left by a release under the selected timing") +
    `</tr></thead>` +
    `<tbody>${v.players.map((p) => row(team, p, scenario, v.worth)).join("")}</tbody>` +
    `</table>` +
    `</div>` +
    `</section>`
  );
}

/* ------------------------------------------------------------------ cards */

function cardHead(icon: string, id: string, title: string): string {
  return `<div class="sct-ctp-card-head">${icon}<h3 class="sct-ctp-card-h" id="${id}">${e(title)}</h3></div>`;
}

interface CardRow {
  label: string;
  value: string;
  sub?: string;
  rank?: string;
  title?: string;
  tone?: "good" | "bad";
}

function cardRow(r: CardRow): string {
  const label = r.title ? `<abbr title="${e(r.title)}">${e(r.label)}</abbr>` : e(r.label);
  return (
    `<li class="sct-ctp-crow">` +
    `<span class="sct-ctp-crow-label">${label}</span>` +
    `<span class="sct-ctp-crow-value"><span class="sct-ctp-num"${r.tone ? ` data-tone="${r.tone}"` : ""}>${r.value}</span>${r.rank ?? ""}</span>` +
    (r.sub ? `<span class="sct-ctp-crow-sub">${e(r.sub)}</span>` : "") +
    `</li>`
  );
}

/** The featured figure box: label, the big number, its rank. */
function featured(label: string, value: string, rank: string, title?: string, tone?: "good" | "bad"): string {
  const l = title ? `<abbr title="${e(title)}">${e(label)}</abbr>` : e(label);
  return (
    `<div class="sct-ctp-feature">` +
    `<span class="sct-ctp-feature-label">${l}</span>` +
    `<span class="sct-ctp-feature-value"><span class="sct-ctp-num"${tone ? ` data-tone="${tone}"` : ""}>${value}</span></span>` +
    (rank ? `<span class="sct-ctp-feature-rank">${rank}</span>` : "") +
    `</div>`
  );
}

function capPositionCard(v: ContractsView): string {
  const n = v.players.length;
  const lead =
    v.capSpace === null
      ? featured(`${v.season} cap committed`, e(money(v.committed)), rankBadge(v.committedRank), "Every cap number on the sheet, summed")
      : featured(`${v.season} cap space`, e(money(v.capSpace)), rankBadge(v.capSpaceRank, "more-is-good"), "Room under the cap on the cap page today");
  const rows: CardRow[] = [
    v.liabilities !== null
      ? {
          label: "Cap liabilities",
          value: e(money(v.liabilities)),
          sub: "Every contract plus dead money",
          title: "The club's total cap liabilities on the cap page: every contract, dead money and reserve lists",
        }
      : { label: "Cap commitments", value: e(money(v.committed)), sub: "Every contract on the sheet, summed", title: "Every cap number on the sheet, summed" },
    { label: "Top-51 total", value: e(money(v.top51)), rank: rankBadge(v.top51Rank), title: "The 51 largest cap numbers, summed: the offseason accounting rule" },
  ];
  return (
    `<section class="sct-ctp-card is-position" aria-labelledby="sct-ctp-pos-h">` +
    cardHead(ICON.coins, "sct-ctp-pos-h", "Cap Position") +
    `<p class="sct-ctp-card-strip"><span class="sct-ctp-num">${n}</span> ${n === 1 ? "contract" : "contracts"}</p>` +
    lead +
    `<ul class="sct-ctp-crows">${rows.map(cardRow).join("")}</ul>` +
    `</section>`
  );
}

function flexibilityCard(v: ContractsView): string {
  const { savers, costers, releasable, priced, surplus, deficit, locked, fair } = flexFigures(v);
  const deals = (n: number): string => `${n} ${n === 1 ? "deal" : "deals"}`;
  const gap = surplus + deficit;
  const strip = priced.length
    ? `<p class="sct-ctp-card-strip is-split">` +
      `<span><span class="sct-ctp-num">${v.tagged.over}</span> over</span>` +
      `<span><span class="sct-ctp-num">${v.tagged.under}</span> under</span>` +
      `<span><span class="sct-ctp-num">${fair}</span> fair</span>` +
      `</p>`
    : "";
  const rows: CardRow[] = [
    {
      label: "Locked in",
      value: e(money(locked)),
      sub: `Dead money if all ${deals(v.players.length)} were cut today`,
      title: "Bonus proration and guarantees already committed: the dead money the whole sheet would leave if every contract were released before June 1",
    },
    {
      label: "Value gap",
      value: priced.length ? e(signed(gap)) : "-",
      tone: priced.length ? (gap >= 0 ? "good" : "bad") : undefined,
      sub: priced.length ? `${signed(surplus)} under, ${money(deficit)} over` : "No deals priced yet",
      title: "Worth minus the deal's average, summed across every contract the model prices: a plus means the club pays less than production, a minus more. The split is the underpaid side against the overpaid side",
    },
  ];
  return (
    `<section class="sct-ctp-card is-flex" aria-labelledby="sct-ctp-flex-h">` +
    cardHead(ICON.bars, "sct-ctp-flex-h", "Flexibility") +
    strip +
    featured(
      "Cut savings",
      e(money(releasable)),
      "",
      "The cap freed by every release that frees money, summed, each before June 1. The largest deals cost cap to cut, so the top of the sheet shows none of this",
    ) +
    `<p class="sct-ctp-feature-sub">${e(
      costers.length ? `${deals(savers.length)} free cap, ${costers.length} would cost it.` : `${deals(savers.length)} that free cap, summed.`,
    )}</p>` +
    `<ul class="sct-ctp-crows">${rows.map(cardRow).join("")}</ul>` +
    `</section>`
  );
}

function releaseCard(team: NflTeam, v: ContractsView): string {
  if (v.cutCandidates.length === 0) return "";
  return (
    `<section class="sct-ctp-card is-release" aria-labelledby="sct-ctp-rel-h">` +
    cardHead(ICON.people, "sct-ctp-rel-h", "Where a Release Frees Cap") +
    // Fixed to the pre-June-1 figures, as the original rail is, and says so.
    `<p class="sct-ctp-card-dek">${e(`Releases before June 1 that clear the most ${v.season} cap, with the dead money each leaves.`)}` +
    info("A reading of the deal's structure, not a prediction that anyone is cut. These figures are the before-June-1 release math whichever timing the scenario shows. Tap a row to add that release to the cut scenario.") +
    `</p>` +
    `<ol class="sct-ctp-rel-list">` +
    v.cutCandidates
      .map(
        (p) =>
          `<li class="sct-ctp-rel" data-sct-ct-cut="${e(lineKey(p))}">` +
          face(team, p, 28, "sct-ctp-rel-face") +
          `<span class="sct-ctp-rel-who">${playerCell(p)}<span class="sct-ctp-pos" data-group="${positionGroup(p.position)}">${e(p.position)}</span></span>` +
          `<button type="button" class="sct-ctp-rel-nums" data-sct-ct-cut-tick aria-pressed="false" aria-label="${e(`Cut ${p.name} in the scenario`)}">` +
          `<span class="sct-ctp-rel-line"><span class="sct-ctp-rel-k">saves</span><span class="sct-ctp-num is-save">${e(money(p.cutSave))}</span></span>` +
          `<span class="sct-ctp-rel-line"><span class="sct-ctp-rel-k">dead</span><span class="sct-ctp-num">${e(money(p.cutDead))}</span></span>` +
          `</button>` +
          `</li>`,
      )
      .join("") +
    `</ol>` +
    `</section>`
  );
}

function deadCard(v: ContractsView): string {
  const n = v.dead.length;
  const itemized = v.dead.reduce((s, x) => s + x.amount, 0);
  const strip = n ? `<p class="sct-ctp-card-strip"><span class="sct-ctp-num">${n}</span> ${n === 1 ? "player" : "players"} carried</p>` : "";
  // The ledger as the cap page has it: untouched by the cut scenario (the
  // strip's "Dead money added" is the hypothetical).
  const lead =
    v.deadTotal === null
      ? featured("Contracts on the books", String(v.players.length), "")
      : featured("On the books", e(money(v.deadTotal)), rankBadge(v.deadRank, "more-is-bad"), "Dead money the cap page carries this season, before any release in the scenario");
  const reconcile =
    v.deadTotal !== null && n && Math.abs(v.deadTotal - itemized) >= 0.05
      ? `<p class="sct-ctp-card-dek">${e(`${money(itemized)} across the ${n} names below. ${money(v.deadTotal - itemized)} is carried without a name on the cap page.`)}</p>`
      : "";
  const fa = `<span class="sct-ctp-dead-fa" title="Free agent">FA</span>`;
  const crest = (abbr: string | null): string => {
    const club = abbr ? getTeamByAbbreviation(abbr) : null;
    if (!club?.logo) return fa;
    const label = `Now with the ${club.nickname}`;
    const img = `<img class="sct-ctp-dead-crest" src="${e(club.logo)}" alt="${e(label)}" width="20" height="20" loading="lazy" decoding="async">`;
    const href = getTeamHubUrl(club);
    return href ? `<a class="sct-ctp-dead-club" href="${e(href)}" title="${e(label)}">${img}</a>` : `<span class="sct-ctp-dead-club" title="${e(label)}">${img}</span>`;
  };
  const list =
    v.deadTotal !== null && n
      ? `<ol class="sct-ctp-dead-list">` +
        v.dead
          .map(
            (d) =>
              `<li class="sct-ctp-dead-row">` +
              `<span class="sct-ctp-dead-who">${crest(d.nowWith)}<span class="sct-ctp-dead-name">${e(d.name)}</span></span>` +
              `<span class="sct-ctp-num">${e(money(d.amount))}</span>` +
              `</li>`,
          )
          .join("") +
        `</ol>`
      : "";
  return (
    `<section class="sct-ctp-card is-dead" aria-labelledby="sct-ctp-dead-h">` +
    cardHead(ICON.tag, "sct-ctp-dead-h", `${v.season} Dead Money`) +
    strip +
    lead +
    reconcile +
    list +
    `</section>`
  );
}

/* --------------------------------------------------------------- section */

/** The whole tab, or "" when the view has no players. */
export function renderContractsPremium(team: NflTeam, v: ContractsView | null): string {
  if (!v || v.players.length === 0) return "";
  const foot =
    `Cap numbers are for the ${v.season} league year. Net if cut (a plus frees cap, a minus costs it) and dead money describe a standard release ` +
    `<span data-sct-ct-timing-word>before June 1</span>` +
    (v.hasSnapshot
      ? `; a starred figure is estimated from the deal's structure where the published release math is not available.`
      : `, estimated from the deal's structure: the remaining prorated bonus and guaranteed salary stay on the books, and the rest is freed.`);
  return (
    `<div class="sct-ctp" data-sct-ct` +
    (v.capSpace !== null ? ` data-cap-space="${v.capSpace}" data-dead-total="${v.deadTotal ?? 0}"` : "") +
    `>` +
    (simulator(v) ? premiumTabFrame(banner(team, v), simulator(v), { solo: true }) : banner(team, v)) +
    `<div class="sct-ctp-grid">` +
    `<div class="sct-ctp-main">${sheet(team, v)}</div>` +
    `<aside class="sct-ctp-rail" aria-label="${e(`${team.nickname} cap position, flexibility, release savings and dead money`)}">` +
    capPositionCard(v) +
    flexibilityCard(v) +
    releaseCard(team, v) +
    deadCard(v) +
    `</aside>` +
    `</div>` +
    worthNote(v) +
    `<p class="sct-note sct-ctp-foot">${foot}</p>` +
    `</div>`
  );
}
