/**
 * The team hub's Contracts tab: the shared pieces of its markup.
 *
 * The tab itself is contracts-premium.ts (mak's brief, 2026-11-05, approved
 * the same day; the original workspace of 2026-10-23 - lede, cap tiles,
 * scenario toolbar, sheet, ledger rail, release panel and dead-money block -
 * came out when mak said "remove the old version"). What is left here is
 * what the block reads from the view and prints the same way the original
 * did: the money, sign, ordinal, span and name helpers, the status words,
 * the position groups, the flexibility sums (the only arithmetic: sums of
 * the view's own figures), the roster lookup behind the headshots, and the
 * Worth note. renderContractsSection() hands the block to team-render.ts.
 *
 * No FAQ of its own address: a hub-only panel like Draft and Coaching,
 * until a public URL is approved.
 */

import { escapeHtml } from "../render";
import { getPlayerProfileUrl } from "./links";
import { nameKeysForTeam, playerForSearchKey } from "./roster";
import type { NamedPlayer } from "./roster";
import type { NflTeam } from "./teams";
import type { ContractLine, ContractsView, WorthDoc } from "./contracts";
import { renderContractsPremium } from "./contracts-premium";

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
export function signed(m: number): string {
  return m > 0.0005 ? `+${money(m)}` : money(m);
}

export const ordinal = (n: number): string => {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

export const STATUS_WORD: Record<string, string> = {
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

export function playerCell(p: ContractLine): string {
  const href = getPlayerProfileUrl(p.name);
  return href
    ? `<a class="sct-ct-name sct-player-link" href="${e(href)}" target="_top">${e(p.name)}</a>`
    : `<span class="sct-ct-name">${e(p.name)}</span>`;
}

/**
 * The color family a position label wears (mak, 2026-10-23): WR blue, RB
 * green, TE yellow, QB red, every defender brown. Linemen and specialists
 * stay neutral.
 */
export function positionGroup(position: string): string {
  const p = position.toUpperCase();
  if (p === "QB") return "qb";
  if (p === "RB" || p === "FB" || p === "HB") return "rb";
  if (p === "WR") return "wr";
  if (p === "TE") return "te";
  if (/^(ED|EDGE|IDL|DL|DE|DT|NT|LB|ILB|OLB|MLB|CB|S|SS|FS|SAF|DB)$/.test(p)) return "def";
  return "other";
}

/**
 * One key per player shared by the sheet row, the release card and the
 * scenario's cold-start hint, so a click on a card ticks the row.
 */
export function lineKey(p: ContractLine): string {
  return p.otcId !== null ? `otc-${p.otcId}` : `n-${nameKey(p.name)}`;
}

/**
 * The Flexibility card's arithmetic, in one place so the original ledger
 * and the premium comparison (contracts-premium.ts) cannot disagree: sums
 * of the view's own figures, nothing derived.
 */
export interface FlexFigures {
  savers: ContractLine[];
  costers: ContractLine[];
  /** Cap freed by every release that frees money, summed, pre-June 1. */
  releasable: number;
  /** Deals the Worth model prices (Worth and an APY). */
  priced: ContractLine[];
  /** Worth minus APY summed over the underpaid side (plus) and the overpaid side (minus). */
  surplus: number;
  deficit: number;
  /** Dead money if every contract on the sheet were released before June 1. */
  locked: number;
  /** Priced deals carrying neither tag. */
  fair: number;
}

export function flexFigures(v: ContractsView): FlexFigures {
  const rows = v.players;
  const savers = rows.filter((p) => p.cutSave > 0);
  const costers = rows.filter((p) => p.cutSave < 0);
  const releasable = savers.reduce((n, p) => n + p.cutSave, 0);
  const priced = rows.filter((p) => p.worth && p.apy > 0);
  let surplus = 0;
  let deficit = 0;
  for (const p of priced) {
    const diff = (p.worth?.worth ?? 0) - p.apy;
    if (diff > 0) surplus += diff;
    else deficit += diff;
  }
  const locked = rows.reduce((n, p) => n + p.cutDead, 0);
  const fair = Math.max(0, priced.length - v.tagged.over - v.tagged.under);
  return { savers, costers, releasable, priced, surplus, deficit, locked, fair };
}

/**
 * "2025-2028": the deal's span, the year signed to its last season (mak,
 * 2026-10-30: "just say length for the column header and show it as a
 * range"). A one-season deal is its year alone. The title keeps the count
 * of years for the hover.
 */
export function signedCell(p: ContractLine): string {
  if (p.yearSigned === null) return "-";
  const last = p.finalYear ?? (p.years ? p.yearSigned + p.years - 1 : null);
  const span = last !== null && last !== p.yearSigned ? `${p.yearSigned}-${last}` : String(p.yearSigned);
  const years = p.years ? `${p.years} ${p.years === 1 ? "year" : "years"}` : "";
  return years ? `<abbr title="${e(years)}">${e(span)}</abbr>` : e(span);
}

/** Rows shown before "Show all": the top of the cap sheet (mak, 2026-10-23). */

/** "Milton Williams" -> "Williams, Milton": the Player column's sort key (suffix dropped). */
export function sortName(name: string): string {
  const parts = name.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, "").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}` : name;
}

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

export function worthNote(v: ContractsView): string {
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

/**
 * The whole tab, or "" when the register has no roster for this club: the
 * premium Contracts & Salary Cap block (contracts-premium.ts; mak's brief,
 * 2026-11-05, approved the same day). Its banner heading is the tab's H2.
 * The club-specific FAQ (contracts-faq.ts, mak 2026-11-02) is the section's
 * tail, placed by team-render.ts like every other tab's.
 */
export function renderContractsSection(team: NflTeam, v: ContractsView | null): string {
  if (!v) return "";
  return renderContractsPremium(team, v);
}
