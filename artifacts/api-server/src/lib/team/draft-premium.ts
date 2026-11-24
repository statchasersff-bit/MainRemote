/**
 * The Draft tab (mak's brief, 2026-11-05, attached_assets/draftref.png;
 * approved and the old layout removed the same day): a navy-and-gold banner
 * carrying the heading, the class tables on the left under navy year
 * headers, and a rail on the right with the next draft's ledger, the Last 5
 * Drafts mix, the Round 1 list and the position group note.
 *
 * Presentation only. Every figure is the DraftView (team/draft.ts) the FAQ
 * reads too; the sentences are draft-render.ts's helpers.
 */

import { headshotImg } from "../headshot-html";
import { COLLEGE_LOGO_VARIANTS } from "../image-urls";
import { escapeHtml } from "../render";
import { premiumTabHead } from "./premium-head";
import type { CategoryShare, DraftCapitalView, DraftHistoryView, DraftPick, DraftSeason, DraftStatusDoc, DraftView, PickStatus } from "./draft";
import { CATEGORY_LABEL, collegeLogoFor, getDraftStatus, pickCategory, pickStatus } from "./draft";
import { collegeName, depthSlotCell, faceIdFor, nick, playerCell } from "./draft-render";
import type { NflTeam } from "./teams";
import { getTeamByAbbreviation } from "./teams";

const e = escapeHtml;

/* ------------------------------------------------------------------ icons */

/** Gold line icons, inline so nothing is fetched; all decorative. */
const ICON = {
  calendar:
    `<svg class="sct-drp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` +
    `<rect x="7" y="13" width="3" height="3" rx="0.6" fill="currentColor"/>` +
    `</svg>`,
  bars:
    `<svg class="sct-drp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="4" y="12" width="4" height="8" rx="1" fill="currentColor"/>` +
    `<rect x="10" y="7" width="4" height="13" rx="1" fill="currentColor"/>` +
    `<rect x="16" y="3" width="4" height="17" rx="1" fill="currentColor"/>` +
    `</svg>`,
  ribbon:
    `<svg class="sct-drp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="12" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` +
    `</svg>`,
  info:
    `<svg class="sct-drp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<path d="M12 11v6M12 7.5v.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
    `</svg>`,
};

/* ----------------------------------------------------------------- banner */

function banner(team: NflTeam, view: DraftView): string {
  const parts: string[] = [];
  if (view.capital) parts.push(`every pick the ${team.nickname} hold in the ${view.capital.draftYear} NFL Draft, round by round`);
  if (view.history) {
    parts.push(`the club's last ${view.history.seasons.length} draft classes, newest first, and the position groups it spent those picks on`);
  }
  const intro = parts.join(", then ");
  const sub = intro.charAt(0).toUpperCase() + intro.slice(1) + ".";
  return (
    // .sct-h2: the tab's heading, like every hub panel's.
    premiumTabHead({
      hook: "sct-drp-hero",
      icon: "draft",
      art: "draft",
      heading: `<h2 class="sct-h2 sct-up-h2 sct-drp-title">${e(`${team.nickname} Draft Picks & History`)}</h2>`,
      // Phones show this short title; the heading keeps its words (mak, 2026-11-14).
      phoneTitle: "Draft Picks & History",
      dek: sub,
    })
  );
}

/* ---------------------------------------------------------------- tables */

function face(team: NflTeam, pick: DraftPick): string {
  const id = faceIdFor(team, pick);
  const img = id
    ? headshotImg({
        src: null,
        id,
        className: "sct-drp-face-img",
        alt: "",
        variants: ["160"],
        width: 30,
        height: 30,
        loading: "lazy",
        extra: ` aria-hidden="true"`,
      })
    : null;
  return `<span class="sct-drp-face" aria-hidden="true">${img ?? ""}</span>`;
}

function college(name: string): string {
  const label = collegeName(name);
  const logo = label === "-" ? null : collegeLogoFor(name);
  const img = logo
    ? headshotImg({
        src: null,
        id: `ncaa:${logo.id}`,
        className: "sct-drp-crest-img",
        alt: "",
        variants: COLLEGE_LOGO_VARIANTS,
        sizes: "24px",
        width: 24,
        height: 24,
        loading: "lazy",
        extra: ` aria-hidden="true"`,
      })
    : null;
  return (
    `<span class="sct-drp-college">` +
    `<span class="sct-drp-crest" aria-hidden="true">${img ?? ""}</span>` +
    `<span class="sct-drp-college-name">${e(label)}</span>` +
    `</span>`
  );
}

/**
 * The badge's tone from the status key the original tab computes: green
 * for a player still active with the club, blue for the practice squad, red
 * for an injury list, amber for a trade or a suspension, navy-grey for a
 * cut, grey for a player out of the league.
 */
function tone(status: PickStatus): string {
  switch (status.key) {
    case "active":
      return "ok";
    case "ps":
      return "ps";
    case "ir":
    case "pup":
    case "nfi":
    case "reserve":
      return "hurt";
    case "traded":
    case "suspended":
    case "exempt":
      return "amber";
    case "waived":
    case "released":
    case "cut":
      return "cut";
    default:
      return "gone";
  }
}

/**
 * The status wording for 560px and under (mak, 2026-11-12): "Injured
 * reserve" reads "IR", "practice squad" "PS" (2026-11-12, so a status
 * cell stays two rows), and the leading "now" goes: "now on ATL practice
 * squad" reads "with ATL" (the club alone), "now with SF" "with SF", "now a free
 * agent" "free agent"; "Not on a roster" reads "Unrostered". Null when the
 * phone text is the same as the full one.
 */
function phoneStatusText(text: string): string | null {
  const short = text
    .replace(/^now on ([A-Z]{2,4}) .+$/, "with $1")
    .replace(/^now (?:on |a )?/, "")
    .replace(/injured reserve/gi, "IR")
    .replace(/practice squad/gi, "PS")
    .replace(/^not on a roster$/i, "Unrostered");
  return short === text ? null : short;
}

/**
 * The status wording, the short form at every width since 2026-11-21 (mak:
 * "use the shortened version", names aside): "IR", "Unrostered", "with ATL".
 */
function statusText(text: string, short: string | null = phoneStatusText(text)): string {
  return e(short || text);
}

/**
 * A player who left between seasons with no reason on the rosters reads
 * "Practice squad / with ARI" (their standing with the new club). On phones
 * it takes the departed rows' shape instead (mak, 2026-11-12): a neutral
 * "Left" badge over the club they are with now, "with ARI" (2026-11-12:
 * the club alone, not "ARI practice squad"). Null for every other row.
 */
function phoneMoved(status: PickStatus): { sub: string } | null {
  const m = status.sub?.match(/^with ([A-Z]{2,4})$/);
  if (!m) return null;
  const club = m[1]!;
  return { sub: `with ${club}` };
}

function statusCell(status: PickStatus): string {
  const label = status.label === "-" ? "" : status.label;
  const moved = phoneMoved(status);
  return (
    `<span class="sct-drp-status">` +
    (label
      // A player with another club reads "Left" in the neutral badge at every
      // width since 2026-11-21 (mak): "Active" in green read as active here.
      ? `<span class="sct-drp-badge" data-tone="${moved ? "cut" : tone(status)}" data-status="${e(status.key)}">${statusText(label, moved ? "Left" : undefined)}</span>`
      : `<span class="sct-drp-none">-</span>`) +
    (status.sub ? `<span class="sct-drp-status-sub">${statusText(status.sub, moved ? moved.sub : undefined)}</span>` : "") +
    `</span>`
  );
}

function yearCard(team: NflTeam, s: DraftSeason, statusDoc: DraftStatusDoc | null, currentSeason: number): string {
  const club = team.abbreviation.toLowerCase();
  const rows = s.picks
    .map((p) => {
      const status = pickStatus(p, club, statusDoc, currentSeason);
      return (
        `<tr class="sct-drp-row">` +
        `<td class="sct-drp-td is-num">${p.round}</td>` +
        `<td class="sct-drp-td is-num">${p.pick}</td>` +
        `<th scope="row" class="sct-drp-td is-player"><span class="sct-drp-player">${face(team, p)}${playerCell(p, team.abbreviation)}</span></th>` +
        `<td class="sct-drp-td is-pos"><span class="sct-drp-pos">${e(p.position)}</span>${depthSlotCell(p, club, statusDoc)}</td>` +
        `<td class="sct-drp-td is-college">${college(p.college)}</td>` +
        `<td class="sct-drp-td is-status">${statusCell(status)}</td>` +
        `</tr>`
      );
    })
    .join("");
  const caption = `${team.fullName} ${s.season} draft picks: round, pick, player, position, college, roster status.`;
  return (
    `<section class="sct-drp-year" aria-labelledby="sct-drp-y${s.season}">` +
    `<div class="sct-drp-year-head">` +
    `<span class="sct-drp-year-title">${ICON.calendar}<h3 class="sct-drp-h3" id="sct-drp-y${s.season}">${e(`${s.season} Draft`)}</h3></span>` +
    // The pick count alone at every width since 2026-11-21 (mak: the phone
    // version); the Round 1 count came off.
    `<span class="sct-drp-year-sum">${e(`${s.picks.length} ${s.picks.length === 1 ? "pick" : "picks"}`)}</span>` +
    // No gold double slash on the year heads (mak, 2026-11-08: "remove the double lines").
    `</div>` +
    `<div class="sct-drp-scroll" tabindex="0">` +
    `<table class="sct-drp-table">` +
    `<caption class="sct-visually-hidden">${e(caption)}</caption>` +
    `<thead><tr>` +
    `<th scope="col" class="sct-drp-th is-num">Rd</th>` +
    `<th scope="col" class="sct-drp-th is-num">Pick</th>` +
    `<th scope="col" class="sct-drp-th is-player">Player</th>` +
    `<th scope="col" class="sct-drp-th is-pos">Pos</th>` +
    // Reads "Col" at 560px and under (team.css draws it; mak, 2026-11-12).
    `<th scope="col" class="sct-drp-th is-college"><span class="sct-drp-st-full">College</span></th>` +
    `<th scope="col" class="sct-drp-th is-status">Status</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</div>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- capital */

type Round = DraftCapitalView["rounds"][number];

function clubMark(abbr: string): string {
  const club = getTeamByAbbreviation(abbr);
  const code = (club?.abbreviation ?? abbr).toUpperCase();
  const crest = club?.logo
    ? `<img class="sct-drp-dot-crest" src="${e(club.logo)}" alt="" width="14" height="14" loading="lazy" decoding="async">`
    : "";
  return `<span class="sct-drp-dot-club">${crest}${e(code)}</span>`;
}

/** "one own pick and three acquired picks; one own pick traded to the Eagles". */
function roundWords(round: Round): string {
  const own = round.holds.filter((h) => h.from === null).length;
  const got = round.holds.filter((h) => h.from !== null);
  const bits: string[] = [];
  if (own) bits.push(`${count(own)} own ${own === 1 ? "pick" : "picks"}`);
  if (got.length) {
    bits.push(`${count(got.length)} acquired ${got.length === 1 ? "pick" : "picks"} (from the ${got.map((h) => nick(h.from ?? "")).join(", ")})`);
  }
  let text = bits.length ? bits.join(" and ") : "no pick";
  if (round.sent.length) {
    text += `; ${count(round.sent.length)} own ${round.sent.length === 1 ? "pick" : "picks"} traded to the ${round.sent.map((s) => nick(s.to)).join(", ")}`;
  }
  return text;
}

function count(n: number): string {
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return words[n] ?? String(n);
}

function ledgerRow(round: Round): string {
  const marks: string[] = [];
  for (const h of round.holds) {
    marks.push(
      h.from === null
        ? `<span class="sct-drp-dot is-own"></span>`
        : `<span class="sct-drp-mark"><span class="sct-drp-dot is-from"></span>${clubMark(h.from)}</span>`,
    );
  }
  for (const s of round.sent) {
    marks.push(`<span class="sct-drp-mark"><span class="sct-drp-dot is-sent"></span>${clubMark(s.to)}</span>`);
  }
  const held = round.holds.length;
  return (
    `<li class="sct-drp-lrow${held === 0 ? " is-empty" : ""}">` +
    `<span class="sct-drp-lrd" aria-hidden="true">R${round.round}</span>` +
    `<span class="sct-visually-hidden">${e(`Round ${round.round}: ${roundWords(round)}; ${held} ${held === 1 ? "pick" : "picks"} held.`)}</span>` +
    `<span class="sct-drp-lmarks" aria-hidden="true">${marks.join("")}</span>` +
    `<span class="sct-drp-lcount" aria-hidden="true">${held}</span>` +
    `</li>`
  );
}

function capitalCard(team: NflTeam, c: DraftCapitalView): string {
  return (
    `<section class="sct-drp-card is-capital" aria-labelledby="sct-drp-cap-title">` +
    `<div class="sct-drp-card-head">${ICON.calendar}<h3 class="sct-drp-h3" id="sct-drp-cap-title">${e(`${c.draftYear} NFL Draft Picks`)}</h3>` +
    // The pick count in the head row at every width since 2026-11-21 (mak:
    // the phone version). The strip under it (picks, acquired, sent away),
    // the kicker and the compensatory footnote came off.
    `<span class="sct-drp-head-sum">${e(`${c.total} ${c.total === 1 ? "pick" : "picks"}`)}</span></div>` +
    `<div class="sct-drp-card-body">` +
    `<ol class="sct-drp-ledger" aria-label="${e(`${team.nickname} ${c.draftYear} draft picks by round`)}">` +
    c.rounds.map(ledgerRow).join("") +
    `</ol>` +
    `<p class="sct-drp-legend" aria-hidden="true">` +
    `<span><span class="sct-drp-dot is-own"></span>Own pick</span>` +
    `<span><span class="sct-drp-dot is-from"></span>Acquired</span>` +
    `<span><span class="sct-drp-dot is-sent"></span>Traded away</span>` +
    `</p>` +
    `</div>` +
    `</section>`
  );
}

/* --------------------------------------------------------------- history */

function shareRows(rows: CategoryShare[], total: number): string {
  const max = Math.max(...rows.map((r) => r.count), 1);
  const anyFirst = rows.some((r) => r.firstRounders > 0);
  return (
    `<div class="sct-drp-shares">` +
    `<ul class="sct-drp-share-list" aria-label="${e(`${total} picks by position group`)}">` +
    rows
      .map((r) => {
        const r1 = r.firstRounders
          ? `<span class="sct-drp-r1dot" title="${e(`${r.firstRounders} Round 1 ${r.firstRounders === 1 ? "pick" : "picks"}`)}"></span>` +
            `<span class="sct-visually-hidden">${e(`, including ${r.firstRounders} Round 1 ${r.firstRounders === 1 ? "pick" : "picks"}`)}</span>`
          : "";
        return (
          `<li class="sct-drp-share">` +
          `<span class="sct-drp-share-label">${e(r.label)}${r1}</span>` +
          `<span class="sct-drp-share-bar" aria-hidden="true"><span class="sct-drp-share-fill" style="${e(`width:${((r.count / max) * 100).toFixed(1)}%`)}"></span></span>` +
          `<span class="sct-drp-share-n"><b class="sct-drp-num">${r.count}</b></span>` +
          `<span class="sct-drp-share-pct">${e(r.pct.toFixed(0))}%</span>` +
          `</li>`
        );
      })
      .join("") +
    `</ul>` +
    (anyFirst ? `<p class="sct-drp-share-key"><span class="sct-drp-r1dot" aria-hidden="true"></span>Includes a Round 1 pick</p>` : "") +
    `</div>`
  );
}

function historyCard(h: DraftHistoryView): string {
  return (
    `<section class="sct-drp-card is-history" aria-labelledby="sct-drp-hist-title">` +
    `<div class="sct-drp-card-head">${ICON.bars}<h3 class="sct-drp-h3" id="sct-drp-hist-title">${e(`Last ${h.seasons.length} Drafts`)}</h3>` +
    // The count in the head row at every width since 2026-11-21 (mak: the
    // phone version); the strip and the takeaway line came off.
    `<span class="sct-drp-head-sum">${e(`${h.total} picks · ${h.firstRounders} in Round 1`)}</span></div>` +
    `<div class="sct-drp-card-body">` +
    (h.allPicks.length ? shareRows(h.allPicks, h.total) : "") +
    `</div>` +
    `</section>`
  );
}

function roundOneCard(team: NflTeam, picks: DraftPick[]): string {
  // Dressed like the year cards: navy head with the gold slash, the same
  // column-head band, zebra rows, faces and Barlow numerals.
  const body = picks.length
    ? `<table class="sct-drp-table is-r1">` +
      `<caption class="sct-visually-hidden">${e(`${team.nickname} Round 1 picks, newest first`)}</caption>` +
      `<thead><tr>` +
      `<th scope="col" class="sct-drp-th is-num">Year</th>` +
      `<th scope="col" class="sct-drp-th is-num">Pick</th>` +
      `<th scope="col" class="sct-drp-th is-player">Player</th>` +
      `<th scope="col" class="sct-drp-th is-pos">Pos</th>` +
      `</tr></thead><tbody>` +
      picks
        .map(
          (p) =>
            `<tr class="sct-drp-row sct-drp-r1">` +
            `<td class="sct-drp-td is-num sct-drp-r1-year">${p.season}</td>` +
            `<td class="sct-drp-td is-num sct-drp-r1-pick">${p.pick}</td>` +
            `<th scope="row" class="sct-drp-td is-player"><span class="sct-drp-player">${face(team, p)}${playerCell(p, team.abbreviation)}</span></th>` +
            `<td class="sct-drp-td is-pos"><span class="sct-drp-pos">${e(CATEGORY_LABEL[pickCategory(p)] ?? p.position)}</span></td>` +
            `</tr>`,
        )
        .join("") +
      `</tbody></table>`
    : `<p class="sct-drp-r1-none">No Round 1 picks in these drafts.</p>`;
  return (
    `<section class="sct-drp-card is-r1" aria-labelledby="sct-drp-r1-title">` +
    `<div class="sct-drp-card-head">${ICON.ribbon}<h3 class="sct-drp-h3" id="sct-drp-r1-title">Round 1 Picks</h3></div>` +
    `<div class="sct-drp-card-body is-flush">${body}</div>` +
    `</section>`
  );
}

function methodNote(): string {
  return (
    `<p class="sct-drp-method">${ICON.info}<span>Position groups are the broad ones: every lineman counts as OL or DL, every corner and safety as DB.</span></p>`
  );
}

/* --------------------------------------------------------------- section */

/**
 * The whole comparison, or "" when the view has nothing (the original tab
 * is "" too, so this never renders alone). Grid order at narrow widths is
 * set in CSS: banner, next draft's picks, the class tables, then the rest
 * of the rail.
 */
export function renderDraftPremium(team: NflTeam, view: DraftView, season: number): string {
  if (!view.capital && !view.history) return "";
  const statusDoc = getDraftStatus();
  const tables = view.history
    ? `<div class="sct-drp-main">${view.history.seasons.map((s) => yearCard(team, s, statusDoc, season)).join("")}</div>`
    : "";
  const rail =
    (view.capital ? capitalCard(team, view.capital) : "") +
    (view.history ? historyCard(view.history) + roundOneCard(team, view.history.roundOnePicks) + methodNote() : "");
  return (
    `<div class="sct-drp" data-sct-draft-premium>` +
    // No outer frame since 2026-11-10 (mak): the header bar, then the tables and rail on their own.
    banner(team, view) +
    `<div class="sct-drp-layout${tables ? "" : " is-rail-only"}">` +
    tables +
    `<aside class="sct-drp-rail" aria-label="${e(`${team.nickname} draft capital and history summary`)}">${rail}</aside>` +
    `</div>` +
    `</div>`
  );
}
