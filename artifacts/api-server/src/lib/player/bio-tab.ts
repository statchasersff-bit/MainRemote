/**
 * The Bio tab's spec sections (mak's "Build Instructions: StatChasers Bio Tab
 * for Every Player", 2026-09-30). Since mak's follow-up the same day they
 * replace the tab's old narrative and career timeline; the FAQ stays last.
 *
 *   1. bio text                 full width under the tab's "{Name} Bio"
 *                               heading (spec 2.2; mak 2026-10-01 moved the
 *                               Quick Facts out of its sidebar)
 *   2. Career Timeline          one block per stop, width = time there (2.3)
 *   3. Every Stop in His Career stop cards + sidebar (2.4, 2.5): Quick Facts
 *      and the Redraft Command card above "More on", then the inline Redraft
 *      Command prompt (2.6)
 *   4. Trades / Trades and Team Changes
 *                               each row dated to its source's precision (2.7)
 *
 * The byline, the transactions lede and source line, and the footer (spec
 * 2.9) were all removed at mak's request, 2026-10-01: nothing on the tab
 * names its sources or update time any more.
 *
 * Fantasy wording (mak, option A): the bio text, stop sentences and footer are
 * purely biographical. Fantasy appears only in the Redraft Command card, the
 * inline Redraft Command prompt and the "best fantasy season" stop chip
 * (.is-rc, .scp-bo-cta, .scp-bo-best); tests/player.test.mjs holds that line.
 *
 * Page facts come from bio-tab-data.ts. Not built, pending mak: the SEO items
 * (2.11: title, description, Person/ProfilePage JSON-LD, the index rule), the
 * spec's FAQ (the tab's existing FAQ already answers its questions), and the
 * model stages (prose from a language model, review queue).
 */

import { escapeHtml } from "../render";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { lastName, teamInk } from "./header";
import { titleCase } from "./title-case";
import { outlookShort } from "./outlook-tab";
import { sectionHref } from "./sections";
import type { BioPageFacts, BioStop } from "./bio-tab-data";

const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

function open(id: string, heading: string, lede = ""): string {
  return (
    `<section class="scp-ox-sec" aria-labelledby="${id}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase(heading))}</h2>` +
    (lede ? `<p class="scp-ox-lede">${escapeHtml(lede)}</p>` : "")
  );
}

const years = (s: BioStop, now: string): string => (s.current ? `${s.from}–${now}` : s.from === s.to ? String(s.from) : `${s.from}–${s.to}`);

/* ----------------------------------------------------- 1. bio + quick facts */

/**
 * The Quick Facts and Redraft Command panels. They sit in the career section's
 * sidebar, directly above "More on {last}"; when the career section cannot
 * render they fall back to a sidebar beside the bio text, so a player with no
 * stop data still shows them.
 */
function sidePanels(data: PlayerPageData, page: BioPageFacts): string {
  const last = lastName(data.player.name);
  const rc = `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`;
  const facts = page.quick.map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd>`).join("");
  return (
    (facts ? `<div class="scp-ox-panel scp-bo-facts"><h3>Quick Facts</h3><dl class="scp-bo-grid">${facts}</dl></div>` : "") +
    (page.status === "active"
      ? `<div class="scp-ox-panel is-rc"><h3>Redraft Command</h3>` +
        `<p>${escapeHtml(`See how Redraft Command values ${last} for the rest of ${data.leagueSeason ?? data.season}.`)}</p>` +
        `<a class="scp-ox-btn" href="${escapeHtml(rc)}" data-cta="redraft-command-bio-sidebar">${escapeHtml(`Open ${last} in Redraft Command`)} <span aria-hidden="true">→</span></a></div>`
      : "")
  );
}

// No byline (mak, 2026-10-01): the footer's "Last updated" carries the date.
function renderLead(data: PlayerPageData, page: BioPageFacts, panels: string): string {
  const prose = page.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  if (!prose && !panels) return "";
  const body = prose ? `<div class="scp-ox-prose scp-bo-prose">${prose}</div>` : "";
  return (
    // No heading of its own: the tab's "{Name} Bio" heading sits right above.
    `<section class="scp-ox-sec scp-bo-lead" aria-label="${escapeHtml(`${data.player.name} bio`)}">` +
    (panels
      ? `<div class="scp-ox-read"><div>${body}</div><aside class="scp-ox-aside" aria-label="Quick facts">${panels}</aside></div>`
      : body) +
    `</section>`
  );
}

/* ----------------------------------- 2. the journey + what happened at each */

/**
 * One section, two readings of the same career (mak, 2026-10-01, merging the
 * old "Career Timeline" and "Every Stop in His Career"): the timeline shows
 * how LONG each stop was, the list under it says WHAT happened there. The
 * list's stat chips are gone - "17 games, 4,018 pass yds, 27 TD" repeated the
 * figures printed on the block directly above - and the one chip that was not
 * a repeat, the best fantasy season, moved up onto the block as a small gold
 * line. College stays the last line of the list, since the timeline starts at
 * the NFL.
 */
function renderCareer(data: PlayerPageData, page: BioPageFacts, options: PlayerRenderOptions, panels: string): string {
  const stops = page.stops;
  if (stops.length === 0 && !page.college) return "";
  const last = lastName(data.player.name);

  /* The timeline. */
  let figure = "";
  let lede = "";
  if (stops.length > 0) {
    const teams = new Set(stops.map((s) => s.code)).size;
    const seasons = page.axis.length;

    // Columns: each stop's width in seasons, with a spacer for a season no stop covers.
    const cols: string[] = [];
    const cells: string[] = [];
    stops.forEach((s, i) => {
      const prev = stops[i - 1];
      if (prev && s.from > prev.to + 1) {
        cols.push(`${s.from - prev.to - 1}fr`);
        cells.push(`<div class="scp-bo-gap" aria-hidden="true"></div>`);
      }
      cols.push(`${s.width}fr`);
      cells.push(
        `<div class="scp-bo-stop${s.current ? " is-cur" : ""}" role="listitem" style="--c:${escapeHtml(s.primary)};--a:${escapeHtml(s.accent)}">` +
          `<div class="scp-bo-band"><span class="scp-bo-ab">${escapeHtml(s.short)}</span>` +
          `<span class="scp-bo-yrs">${escapeHtml(years(s, "now"))}</span>` +
          `<span class="scp-bo-sr">${escapeHtml(` ${s.name}`)}</span></div>` +
          `<div class="scp-bo-st"><b>${escapeHtml(s.rail.big)}</b>${escapeHtml(s.rail.rest)}</div>` +
          // One of the bio's three marked fantasy spots (the class is the
          // fantasy-wording test's allowance), moved here from the stop list.
          (s.best ? `<div class="scp-bo-best">${escapeHtml(`Best: ${s.best.points.toFixed(1)} pts (${s.best.season})`)}</div>` : "") +
          `</div>`,
      );
    });
    const minWidth = Math.max(760, stops.length * 72);
    lede = page.coversCareer
      ? `${stops.length} ${stops.length === 1 ? "stop" : "stops"} with ${teams} ${teams === 1 ? "team" : "teams"} in ${seasons} ${seasons === 1 ? "season" : "seasons"}. ` +
        `Each block's width is the time he spent there.`
      : `His career from ${page.axis[0]} on, where StatChasers' game logs begin. Each block's width is the time he spent there.`;
    const pos = data.player.position ?? "";
    const what = pos === "QB" ? "passing" : pos === "RB" ? "rushing and receiving" : pos === "K" ? "kicking" : "receiving";
    const thru = data.gameLog?.length && data.season === (data.leagueSeason ?? data.season) ? ` ${data.season} through Week ${Math.max(...data.gameLog.map((e) => e.week))}.` : "";
    figure =
      `<figure class="scp-bo-journey">` +
      `<div class="scp-bo-rail" role="list" style="grid-template-columns:${cols.join(" ")};min-width:${minWidth}px">${cells.join("")}</div>` +
      `<div class="scp-bo-axis" aria-hidden="true" style="grid-template-columns:repeat(${seasons},1fr);min-width:${minWidth}px">${page.axis.map((y) => `<span>${y}</span>`).join("")}</div>` +
      `<figcaption class="scp-bo-note">${escapeHtml(`Regular-season ${what} stats with each team.${thru}`)}</figcaption>` +
      `</figure>`;
  }

  /* The stop list: team, years and the sentences - the numbers are right above. */
  const cards = [...stops].reverse().map((s) => {
    const tag = s.spell > 1 ? `, ${["", "", "second", "third", "fourth"][s.spell] ?? `${s.spell}th`} stint` : "";
    return (
      `<li style="--c:${escapeHtml(s.primary)}"><div class="scp-bo-ev">` +
      `<h3>${escapeHtml(s.name)}${s.current ? ` <span class="scp-bo-chip">Current team</span>` : ""}` +
      `<span class="scp-bo-yr">${escapeHtml(years(s, "present") + tag)}</span></h3>` +
      (s.sentences.length ? `<p>${escapeHtml(s.sentences.join(" "))}</p>` : "") +
      `</div></li>`
    );
  });
  if (page.college) {
    cards.push(
      `<li class="is-college"><div class="scp-bo-ev"><h3>${escapeHtml(`College: ${page.college.names.join(", ")}`)}</h3></div></li>`,
    );
  }

  const prefix = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}`;
  const q = options.linkQuery ?? "";
  const rows: string[] = [];
  if (page.seasonsPlayed > 0) {
    rows.push(`<dt>Career stats</dt><dd><a href="${escapeHtml(`${prefix}/stats/${q}`)}">${escapeHtml(page.seasonsPlayed === 1 ? "1 season" : page.coversCareer ? `All ${page.seasonsPlayed} seasons` : `${page.seasonsPlayed} seasons since ${page.axis[0]}`)}</a></dd>`);
    rows.push(`<dt>Game log</dt><dd><a href="${escapeHtml(`${prefix}/game-log/${q}`)}">Every game</a></dd>`);
  }
  // Each row only when the player has the tab it points at: a link to a
  // section URL with no section behind it just 302s back here.
  const injuryHref = sectionHref(data, options, "injury");
  if (injuryHref) rows.push(`<dt>Injury history</dt><dd><a href="${escapeHtml(injuryHref)}">Injury tab</a></dd>`);
  // The link, not the Outlook tab's fantasy label ("QB2, streamer"): the bio
  // carries no fantasy wording outside its three marked places.
  const outlookHref = sectionHref(data, options, "outlook");
  if (page.status === "active" && outlookShort(data) && outlookHref) {
    rows.push(`<dt>${escapeHtml(`${data.leagueSeason ?? data.season} outlook`)}</dt><dd><a href="${escapeHtml(outlookHref)}">Outlook tab</a></dd>`);
  }
  if (data.team && page.status === "active") {
    rows.push(`<dt>Team</dt><dd><a href="${escapeHtml(`${options.teamPathPrefix ?? "/team/"}${data.team.slug}/${q}`)}">${escapeHtml(data.team.nickname)}</a></dd>`);
  }
  // Quick Facts and the Redraft Command card first, "More on {last}" below.
  const aside =
    `<aside class="scp-ox-aside" aria-label="${escapeHtml(`More on ${last}`)}">` +
    panels +
    `<div class="scp-ox-panel"><h3>${escapeHtml(`More on ${last}`)}</h3><dl class="scp-bo-grid is-links">${rows.join("")}</dl></div></aside>`;

  const rc = `${REDRAFT_COMMAND_URL}?player=${encodeURIComponent(data.player.slug)}`;
  const inline =
    page.status === "active"
      ? `<div class="scp-bo-cta"><span>${escapeHtml(`${page.seasonsPlayed > 1 && page.coversCareer ? `${page.seasonsPlayed} seasons of history` : "His history"}, one question: is he worth a roster spot now?`)}</span>` +
        `<a href="${escapeHtml(rc)}" data-cta="redraft-command-bio-inline">Check his rest-of-season value in Redraft Command</a></div>`
      : "";

  return (
    open("scp-bo-journey-h", "Career timeline", lede) +
    figure +
    `<div class="scp-ox-read"><div>` +
    `<h3 class="scp-bo-stophead" id="scp-bo-stops-h">What happened at each stop</h3>` +
    (stops.length > 1 ? `<p class="scp-bo-stopnote">Most recent first.</p>` : "") +
    `<ol class="scp-bo-stops">${cards.join("")}</ol>` +
    `</div>${aside}</div>${inline}</section>`
  );
}

/* ----------------------------------------------------- 4. transactions */

const TX_CLASS: Record<string, string> = { Traded: "is-trade", Drafted: "is-draft", Signed: "is-sign", "Re-signed": "is-sign", Claimed: "is-sign", Contract: "is-deal", Tender: "is-deal", Tag: "is-deal", Joined: "is-join" };

function renderTransactions(page: BioPageFacts): string {
  if (page.transactions.length === 0) return "";
  const rows = page.transactions
    .map(
      (t) =>
        `<li><time datetime="${escapeHtml(t.date)}">${escapeHtml(t.when)}</time>` +
        `<span class="scp-bo-tx ${TX_CLASS[t.type] ?? ""}">${escapeHtml(t.type)}</span><span>${escapeHtml(t.text)}</span></li>`,
    )
    .join("");
  // Not "Transactions" until signings, releases and contracts are covered:
  // the list must not look like a complete history. No lede or source line
  // (mak, 2026-10-01).
  const heading = page.hasDatedMoves ? "Transactions" : page.tradesOnly ? "Trades" : "Trades and team changes";
  return open("scp-bo-tx-h", heading) + `<ol class="scp-bo-txlog">${rows}</ol></section>`;
}

/* --------------------------------------------------------------- the tab */

// No footer either (mak, 2026-10-01): the sources paragraph and "Last
// updated" line went with the byline.
export function renderBioTab(data: PlayerPageData, options: PlayerRenderOptions = {}): string {
  const page = data.bioPage;
  if (!page) return "";
  const panels = sidePanels(data, page);
  const career = renderCareer(data, page, options, panels);
  const body = renderLead(data, page, career ? "" : panels) + career + renderTransactions(page);
  if (!body) return "";
  const ink = teamInk(data.team);
  return `<div class="scp-ox scp-st scp-bo"${ink ? ` style="--scp-team:${escapeHtml(ink)}"` : ""}>${body}</div>`;
}
