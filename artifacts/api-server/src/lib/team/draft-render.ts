/**
 * Markup for the team hub's Draft tab.
 *
 * Server-rendered in full like the tabs beside it. One continuous view since
 * 2026-10-29 (the panels sat behind the Depth Chart tab's pill switch before
 * that): the next draft's picks by round, then the last five drafts with the
 * position groups they leaned on, each panel under its own title.
 *
 * No FAQ and no address of its own: a hub-only panel, like Coaching, until
 * a public URL is approved.
 */

import { headshotImg } from "../headshot-html";
import { COLLEGE_LOGO_VARIANTS } from "../image-urls";
import { escapeHtml } from "../render";
import { rosterPlayer } from "./contracts-render";
import { getPlayerProfileUrl } from "./links";
import type { NflTeam } from "./teams";
import { getTeamByAbbreviation } from "./teams";
import type {
  CategoryShare,
  DraftCapitalView,
  DraftHistoryView,
  DraftPick,
  DraftSeason,
  DraftStatusDoc,
  DraftView,
} from "./draft";
import { CATEGORY_LABEL, collegeLogoFor, getDraftStatus, pickCategory, pickStatus } from "./draft";
import { depthSlotFor } from "./depth-charts";

const e = escapeHtml;

/** "Texans", or the code when a club is unknown to the site. */
function nick(abbr: string): string {
  return getTeamByAbbreviation(abbr)?.nickname ?? abbr.toUpperCase();
}

/* ------------------------------------------------------------- picks view */

/**
 * The card is a capital sheet (mak's critique, 2026-10-29): the title, one
 * stat strip, one kicker line, a seven-row dot ledger and a legend, in
 * place of four tiles and seven near-empty round cards. Each round is a
 * row of dots: a filled navy dot for an own pick held, a gold dot with the
 * club's crest and code for an acquired pick, a hollow red-ringed dot with
 * the club it went to for an own pick traded away.
 */

type Round = DraftCapitalView["rounds"][number];

/** "Round 5", "Rounds 5-7", "Rounds 2 and 5", "Rounds 2, 5 and 7". */
function roundList(rounds: number[]): string {
  if (rounds.length === 0) return "";
  if (rounds.length === 1) return `Round ${rounds[0]}`;
  const first = rounds[0] ?? 0;
  const last = rounds[rounds.length - 1] ?? 0;
  const contiguous = last - first === rounds.length - 1;
  if (contiguous && rounds.length > 2) return `Rounds ${first}-${last}`;
  return `Rounds ${rounds.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * One line that says what the numbers do not: where the capital is stacked
 * or bare, and whether Day 2 (Rounds 2-3) gained anything. Rule-based, so
 * every club gets a true sentence from the same file.
 */
function capitalKicker(c: DraftCapitalView): string {
  const multi = c.rounds.filter((r) => r.holds.length > 1).map((r) => r.round);
  const empty = c.rounds.filter((r) => r.holds.length === 0).map((r) => r.round);
  const fromRounds = c.rounds.filter((r) => r.holds.some((h) => h.from !== null)).map((r) => r.round);
  const day2Added = fromRounds.some((r) => r === 2 || r === 3);

  let lead: string;
  if (multi.length) lead = `Extra capital in ${roundList(multi)}`;
  else if (fromRounds.length) lead = `Acquired picks sit in ${roundList(fromRounds)}`;
  else if (empty.length === 0 && c.sent.length === 0) lead = "One own pick in every round, none added";
  else lead = "Own picks only";

  let tail: string | null;
  if (empty.length) tail = `no pick in ${roundList(empty)}`;
  else if (c.acquired && !day2Added) tail = "nothing added on Day 2";
  else if (c.acquired) tail = "Day 2 capital added";
  else if (c.sent.length) tail = `${countWord(c.sent.length).toLowerCase()} own ${c.sent.length === 1 ? "pick" : "picks"} traded away`;
  else tail = null;
  return tail ? `${lead}; ${tail}.` : `${lead}.`;
}

/**
 * "8 picks · 4 acquired · 3 sent away", figures in the display face. The
 * first-rounder count is not here: the R1 row of the ledger shows it, and
 * four items wrap in the rail.
 */
function capitalStrip(c: DraftCapitalView): string {
  const item = (n: number, label: string): string =>
    `<span class="sct-dr-strip-item"><span class="sct-dr-num">${n}</span> ${e(label)}</span>`;
  return (
    `<p class="sct-dr-strip">` +
    item(c.total, c.total === 1 ? "pick" : "picks") +
    item(c.acquired, "acquired") +
    item(c.sent.length, "sent away") +
    `</p>`
  );
}

/** A club's crest and code beside a dot: "CHI" with the Bears' mark. */
function clubMark(abbr: string): string {
  const club = getTeamByAbbreviation(abbr);
  const code = (club?.abbreviation ?? abbr).toUpperCase();
  const crest = club?.logo
    ? `<img class="sct-dr-dot-crest" src="${e(club.logo)}" alt="" width="14" height="14" loading="lazy" decoding="async">`
    : "";
  return `<span class="sct-dr-dot-club">${crest}${e(code)}</span>`;
}

function ledgerRow(team: NflTeam, round: Round): string {
  const dots: string[] = [];
  for (const h of round.holds) {
    dots.push(
      h.from === null
        ? `<span class="sct-dr-dot is-own" title="Own pick"><span class="sct-visually-hidden">Own pick</span></span>`
        : `<span class="sct-dr-mark is-from" title="${e(`From the ${nick(h.from)}`)}">` +
            `<span class="sct-dr-dot is-from"><span class="sct-visually-hidden">Acquired from the ${e(nick(h.from))}</span></span>` +
            clubMark(h.from) +
            `</span>`,
    );
  }
  for (const s of round.sent) {
    dots.push(
      `<span class="sct-dr-mark is-sent" title="${e(`Own pick traded to the ${nick(s.to)}`)}">` +
        `<span class="sct-dr-dot is-sent"><span class="sct-visually-hidden">Own pick traded to the ${e(nick(s.to))}</span></span>` +
        clubMark(s.to) +
        `</span>`,
    );
  }
  const count = round.holds.length;
  return (
    `<li class="sct-dr-row${count === 0 ? " is-empty" : ""}" data-count="${count}">` +
    `<span class="sct-dr-rd"><span class="sct-visually-hidden">Round </span><span class="sct-dr-num" aria-hidden="true">R</span><span class="sct-dr-num">${round.round}</span></span>` +
    `<span class="sct-dr-dots">${dots.join("") || `<span class="sct-dr-none">no pick</span>`}</span>` +
    `<span class="sct-dr-row-count"><span class="sct-dr-num">${count}</span><span class="sct-visually-hidden"> ${count === 1 ? "pick" : "picks"} held</span></span>` +
    `</li>`
  );
}

function capitalLegend(): string {
  const item = (cls: string, label: string): string =>
    `<span class="sct-dr-legend-item"><span class="sct-dr-dot ${cls}" aria-hidden="true"></span>${e(label)}</span>`;
  return (
    `<p class="sct-dr-legend">` +
    item("is-own", "Own pick") +
    item("is-from", "Acquired") +
    item("is-sent", "Traded away") +
    `</p>`
  );
}

/** "Two" for a sentence that opens on a count; digits past nine. */
function countWord(n: number): string {
  const words = ["None", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  return words[n] ?? String(n);
}

function renderCapital(team: NflTeam, c: DraftCapitalView): string {
  return (
    `<section class="sct-dr-panel sct-dr-cap" data-sct-dr-panel="picks">` +
    `<h3 class="sct-dr-h3">${e(`${c.draftYear} NFL Draft Picks`)}</h3>` +
    capitalStrip(c) +
    `<p class="sct-dr-kicker">${e(capitalKicker(c))}</p>` +
    `<ol class="sct-dr-ledger" aria-label="${e(`${team.nickname} ${c.draftYear} draft picks by round`)}">` +
    c.rounds.map((r) => ledgerRow(team, r)).join("") +
    `</ol>` +
    capitalLegend() +
    `<p class="sct-note sct-dr-foot">Compensatory picks are awarded in March and join the rounds then. Pick ownership updates when a trade moves a pick.</p>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- history view */

/**
 * The count leads and the share trails: at 43 picks "11" is the fact and
 * "26%" the gloss, so the numeral is the big one and the percentage sits
 * small beside it.
 */
function shareBars(title: string, rows: CategoryShare[], total: number): string {
  if (rows.length === 0) return "";
  const max = Math.max(...rows.map((r) => r.count), 1);
  const anyFirst = rows.some((r) => r.firstRounders > 0);
  // A gold dot on a group that drew a Round 1 pick ties the bars to the
  // Round 1 list beside them: 3 of 13 OL picks were first-rounders, DB's
  // 10 picks yielded one.
  const marker = (r: CategoryShare): string =>
    r.firstRounders > 0
      ? `<span class="sct-dr-share-r1" title="${e(`${r.firstRounders} Round 1 ${r.firstRounders === 1 ? "pick" : "picks"}`)}">` +
        `<span class="sct-visually-hidden">, including ${r.firstRounders} Round 1 ${r.firstRounders === 1 ? "pick" : "picks"}</span></span>`
      : "";
  return (
    `<div class="sct-dr-shares">` +
    `<h4 class="sct-dr-h4">${e(title)}</h4>` +
    `<ul class="sct-dr-share-list" aria-label="${e(`${title}: ${total} picks by position group`)}">` +
    rows
      .map(
        (r) =>
          `<li class="sct-dr-share">` +
          `<span class="sct-dr-share-label">${e(r.label)}${marker(r)}</span>` +
          `<span class="sct-dr-share-bar" aria-hidden="true">` +
          `<span class="sct-dr-share-fill" style="${e(`width:${((r.count / max) * 100).toFixed(1)}%`)}"></span>` +
          `</span>` +
          `<span class="sct-dr-share-pct"><span class="sct-dr-num">${r.count}</span>` +
          `<span class="sct-dr-share-count">${e(r.pct.toFixed(0))}%</span></span>` +
          `</li>`,
      )
      .join("") +
    `</ul>` +
    (anyFirst
      ? `<p class="sct-dr-share-key"><span class="sct-dr-share-r1" aria-hidden="true"></span>includes a Round 1 pick</p>`
      : "") +
    `</div>`
  );
}

/**
 * The Round 1 picks as a timeline of rows, newest first, in one container:
 * "2026 · Caleb Lomu · OL · Pick 28" (mak's critique, 2026-10-29: the
 * bordered chips had "the empty-card disease"). The chip names the broad
 * group, the same granularity as the bars beside it, so an OT does not
 * sit next to a chart with no OT row. "Pick 28" is the site's wording for
 * a draft slot (the Bio tab's "Round 1 · Pick 3").
 */
function roundOneList(team: NflTeam, picks: DraftPick[]): string {
  const body =
    picks.length === 0
      ? `<p class="sct-dr-r1-none">No Round 1 picks in these drafts.</p>`
      : `<ol class="sct-dr-r1-list" aria-label="${e(`${team.nickname} Round 1 picks, newest first`)}">` +
        picks
          .map(
            (p) =>
              `<li class="sct-dr-r1">` +
              `<span class="sct-dr-r1-year"><span class="sct-dr-num">${p.season}</span></span>` +
              `${playerCell(p)}` +
              `<span class="sct-dr-pos">${e(CATEGORY_LABEL[pickCategory(p)] ?? p.position)}</span>` +
              `<span class="sct-dr-r1-meta">${e(`Pick ${p.pick}`)}</span>` +
              `</li>`,
          )
          .join("") +
        `</ol>`;
  return `<div class="sct-dr-shares sct-dr-r1-box"><h4 class="sct-dr-h4">Round 1 picks</h4>${body}</div>`;
}

/**
 * The one line the bars hide: where the club's draft capital goes. The
 * larger of the two blocs (OL, DL and DB against QB, RB, WR and TE) and
 * its share, so "58% of picks spent on OL, DL and DB" says the thing the
 * nine rows only imply.
 */
function historyKicker(h: DraftHistoryView): string {
  if (h.total === 0) return "";
  const sum = (cats: string[]): number =>
    h.allPicks.filter((r) => cats.includes(r.category)).reduce((n, r) => n + r.count, 0);
  const lines = sum(["OL", "DL", "DB"]);
  const skill = sum(["QB", "RB", "WR", "TE"]);
  const [count, label] = lines >= skill ? [lines, "OL, DL and DB"] : [skill, "QB, RB, WR and TE"];
  const pct = Math.round((count / h.total) * 100);
  return `${pct}% of picks spent on ${label}.`;
}

function playerCell(pick: DraftPick): string {
  const href = getPlayerProfileUrl(pick.name);
  return href
    ? `<a class="sct-dr-name sct-player-link" href="${e(href)}" target="_top">${e(pick.name)}</a>`
    : `<span class="sct-dr-name">${e(pick.name)}</span>`;
}

/**
 * The pick's headshot through the image route (2026-10-29, mak: "add player
 * images"): by the Sleeper id the register run paired, or, for a pick the
 * crosswalk has not met, by name on this club's roster. A player with no
 * pairing, or whom Sleeper has no photo of, keeps a bare well so the names
 * stay aligned and nobody wears another player's face.
 */
function faceWell(team: NflTeam, pick: DraftPick): string {
  const id = pick.sleeperId ?? rosterPlayer(team, pick.name)?.id ?? null;
  const img = id
    ? headshotImg({
        src: null,
        id,
        className: "sct-dr-face-img",
        alt: "",
        variants: ["160"],
        width: 36,
        height: 36,
        loading: "lazy",
        extra: ` aria-hidden="true"`,
      })
    : null;
  return `<span class="sct-dr-face" aria-hidden="true">${img ?? ""}</span>`;
}

/** Face, then the name: the Player column's cell. */
function playerWithFace(team: NflTeam, pick: DraftPick): string {
  return `<span class="sct-dr-player">${faceWell(team, pick)}${playerCell(pick)}</span>`;
}

/**
 * The school's crest beside its name (same date, "add college images"),
 * fitted whole in a small square; a school the pairing lacks keeps an empty
 * square so the names line up down the column.
 */
function collegeCell(college: string): string {
  const name = collegeName(college);
  const logo = name === "-" ? null : collegeLogoFor(college);
  const img = logo
    ? headshotImg({
        src: null,
        id: `ncaa:${logo.id}`,
        className: "sct-dr-crest-img",
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
    `<span class="sct-dr-college">` +
    `<span class="sct-dr-crest" aria-hidden="true">${img ?? ""}</span>` +
    `<span class="sct-dr-college-name">${e(name)}</span>` +
    `</span>`
  );
}

/**
 * One scheme for the register's school names: the abbreviations it carries
 * ("Ohio St.", "Boston Col.") written out, so a column does not mix
 * "Connecticut" with "Penn St.".
 */
const COLLEGE_WORDS: Array<[RegExp, string]> = [
  [/\bSt\.$/, "State"],
  [/\bCol\.$/, "College"],
  [/\bTenn\. /, "Tennessee "],
  [/^NW /, "Northwest "],
  [/^SE /, "Southeast "],
  [/^S\.F\. Austin$/, "Stephen F. Austin"],
];

export function collegeName(college: string): string {
  let name = college.trim();
  if (!name) return "-";
  for (const [pattern, word] of COLLEGE_WORDS) name = name.replace(pattern, word);
  return name;
}

/**
 * The pick's depth chart slot under their position: "LT2", "EDGE4", "CB2",
 * in the chart's own slot names (mak, 2026-10-29: "add their depth chart
 * position"). Read off the chart of the club the player is with now, so a
 * traded or waived player shows where they sit on the new club's chart and
 * the Status column says which club that is. Empty when no chart lists them.
 */
function depthSlotCell(pick: DraftPick, club: string, statusDoc: DraftStatusDoc | null): string {
  const entry = pick.gsisId ? statusDoc?.players[pick.gsisId] : undefined;
  const now = entry?.now;
  if (now && (now.kind === "none" || now.kind === "retired")) return "";
  const where = (now?.club ?? club).toUpperCase();
  const slot = depthSlotFor(pick.name, where);
  if (!slot) return "";
  const text = `${slot.slot}${slot.rank}`;
  return `<span class="sct-dr-slot" title="${e(`${text} on the ${where} depth chart`)}">${e(text)}</span>`;
}

/* The Games-of-possible column came out on 2026-10-29 (mak: "remove the
   games of 7, games of 24, etc column"); the view still computes `possible`
   and each pick's `games` for anything that wants them later. */

function seasonTable(team: NflTeam, s: DraftSeason, currentSeason: number): string {
  const { season, picks, showProBowls } = s;
  const statusDoc = getDraftStatus();
  const club = team.abbreviation.toLowerCase();
  let lastRound = 0;
  const rows = picks
    .map((p) => {
      const status = pickStatus(p, club, statusDoc, currentSeason);
      const starts = p.round !== lastRound;
      // No is-gone class: a player who left reads like one who stayed (mak,
      // 2026-10-29: "do not fade out players who are not on the team").
      const classes = starts && lastRound !== 0 ? "is-round-start" : "";
      lastRound = p.round;
      return (
        `<tr${classes ? ` class="${classes}"` : ""}>` +
        `<td class="sct-dr-td is-num is-round${starts ? "" : " is-round-again"}">${p.round}</td>` +
        `<td class="sct-dr-td is-num">${p.pick}</td>` +
        `<th scope="row" class="sct-dr-td is-player">${playerWithFace(team, p)}</th>` +
        `<td class="sct-dr-td is-pos"><span class="sct-dr-pos">${e(p.position)}</span>${depthSlotCell(p, club, statusDoc)}</td>` +
        `<td class="sct-dr-td is-college">${collegeCell(p.college)}</td>` +
        `<td class="sct-dr-td is-status"><span class="sct-dr-status" data-status="${status.key}">${e(status.label)}</span>` +
        (status.sub ? `<span class="sct-dr-status-sub">${e(status.sub)}</span>` : "") +
        `</td>` +
        (showProBowls ? `<td class="sct-dr-td is-num is-pb${p.proBowls ? " has-pb" : ""}">${p.proBowls}</td>` : "") +
        `</tr>`
      );
    })
    .join("");
  const firsts = picks.filter((p) => p.round === 1).length;
  const caption =
    `${team.fullName} ${season} draft picks: round, pick, player, position, college, roster status` +
    (showProBowls ? " and Pro Bowl selections." : ".");
  return (
    `<div class="sct-dr-season">` +
    `<div class="sct-dr-season-head">` +
    `<h4 class="sct-dr-h4">${e(`${season} Draft`)}</h4>` +
    `<span class="sct-dr-season-sum">${e(
      `${picks.length} ${picks.length === 1 ? "pick" : "picks"} · ${firsts} in Round 1`,
    )}</span>` +
    `</div>` +
    `<div class="sct-dr-scroll" tabindex="0">` +
    `<table class="sct-dr-table${showProBowls ? " has-pb" : ""}">` +
    `<caption class="sct-visually-hidden">${e(caption)}</caption>` +
    `<thead><tr>` +
    `<th scope="col" class="sct-dr-th is-num">Rd</th>` +
    `<th scope="col" class="sct-dr-th is-num">Pick</th>` +
    `<th scope="col" class="sct-dr-th is-player">Player</th>` +
    `<th scope="col" class="sct-dr-th is-pos">Pos</th>` +
    `<th scope="col" class="sct-dr-th is-college">College</th>` +
    `<th scope="col" class="sct-dr-th is-status">Status</th>` +
    (showProBowls ? `<th scope="col" class="sct-dr-th is-num is-pb">Pro Bowls</th>` : "") +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</div>` +
    `</div>`
  );
}

/**
 * The "Last 5 Drafts" card: the position mix and the Round 1 chips, in a
 * card of their own (mak, 2026-10-29) that rides in the rail beside the
 * class tables. The section's heading and lede live in the card, so the
 * title reads once. The tables are renderClasses(), the wide column.
 */
function renderHistoryCard(team: NflTeam, h: DraftHistoryView): string {
  const span = `${h.firstSeason}-${h.lastSeason}`;
  const item = (n: number, label: string): string =>
    `<span class="sct-dr-strip-item"><span class="sct-dr-num">${n}</span> ${e(label)}</span>`;
  const kicker = historyKicker(h);
  return (
    `<section class="sct-dr-panel sct-dr-hist-card" data-sct-dr-panel="history" aria-labelledby="sct-dr-hist-title">` +
    `<h3 class="sct-dr-h3" id="sct-dr-hist-title">${e(`Last ${h.seasons.length} Drafts`)}</h3>` +
    `<p class="sct-dr-strip">` +
    item(h.total, `picks, ${span}`) +
    item(h.firstRounders, "in Round 1") +
    `</p>` +
    (kicker ? `<p class="sct-dr-kicker">${e(kicker)}</p>` : "") +
    `<div class="sct-dr-hist-boxes">` +
    shareBars("All picks", h.allPicks, h.total) +
    roundOneList(team, h.roundOnePicks) +
    `</div>` +
    `<p class="sct-note sct-dr-foot">Position groups are the broad ones: every lineman counts as OL or DL, every corner and safety as DB.</p>` +
    `</section>`
  );
}

/**
 * The five class tables: the wide column. The footnote that explained the
 * Status column, the Pro Bowl rule and the name links came out on
 * 2026-10-29 (mak: "remove text ...").
 */
function renderClasses(team: NflTeam, h: DraftHistoryView, currentSeason: number): string {
  return (
    `<div class="sct-dr-classes">` +
    h.seasons.map((s) => seasonTable(team, s, currentSeason)).join("") +
    `</div>`
  );
}

/* ---------------------------------------------------------------- section */

/**
 * The whole tab, or "" when neither file has this club, which drops the tab
 * from the strip rather than mounting an empty panel.
 *
 * One continuous view since 2026-10-29 (mak: "there is no need to have two
 * tabs"): no view switch. Later that day the two cards (next draft's picks,
 * then the Last 5 Drafts mix) became a rail on the right, with the class
 * tables filling the wide column beside them; under 900px the rail stacks
 * above the tables, cards first.
 */
export function renderDraftSection(team: NflTeam, view: DraftView, season: number): string {
  const rail: string[] = [];
  const parts: string[] = [];
  if (view.capital) {
    rail.push(renderCapital(team, view.capital));
    parts.push(`every pick the ${team.nickname} hold in the ${view.capital.draftYear} NFL Draft, round by round`);
  }
  if (view.history) {
    rail.push(renderHistoryCard(team, view.history));
    parts.push(
      `the club's last ${view.history.seasons.length} draft classes, newest first, and the position groups it spent those picks on`,
    );
  }
  if (rail.length === 0) return "";

  const intro = parts.join(", then ");
  const note = `<p class="sct-note sct-dr-note">${e(intro.charAt(0).toUpperCase() + intro.slice(1) + ".")}</p>`;
  const classes = view.history ? renderClasses(team, view.history, season) : "";

  return (
    `<h2 class="sct-h2">${e(`${team.nickname} Draft Picks & History`)}</h2>` +
    `<div class="sct-dr">${note}` +
    `<div class="sct-dr-grid${classes ? "" : " is-rail-only"}">` +
    `<aside class="sct-dr-rail">${rail.join("")}</aside>` +
    classes +
    `</div>` +
    `</div>`
    // The club-specific FAQ (draft-faq.ts, mak 2026-11-02) is the section's
    // tail, placed by team-render.ts like every other tab's questions.
  );
}
