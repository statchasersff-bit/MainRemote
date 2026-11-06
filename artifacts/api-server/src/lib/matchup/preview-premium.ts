/**
 * The upcoming matchup page in the team pages' premium design (mak,
 * 2026-11-06: "apply a similar design/style/build as we have on our team
 * pages to our upcoming matchups pages"). Built as a comparison under the
 * old decision layer, then APPROVED the same day ("i prefer the new design
 * ... remove the old one"): this IS the upcoming page now, top and body; the
 * FAQ, the Dynasty line and the Next steps footer from preview-render.ts
 * follow it.
 *
 * Design borrowed from the team hub: the header's navy-to-royal hero with
 * slanted logo panels, gold dividers, white crest circles and white KPI
 * cards (team-header.ts, .sct-tpb); the shared tab banner (premium-head.ts,
 * .sct-up-head); the Schedule tab's navy-bar cards and dark snapshot rail
 * (.sct-shp). Data: nothing new - the same Preview the layer above reads.
 *
 * Headings: the page's outline is the old layer's, unchanged
 * ([[seo-changes-need-approval]]): the H1 (visually hidden, as it was) in the
 * hero, and each card's title is the H2 the old section carried, same text
 * and id ("The Call", "{pair} Matchup Leverage", ...).
 */

import { escapeHtml } from "../render";
import { headshotImg } from "../headshot-html";
import { getPlayerProfileUrl } from "../team/links";
import type { NflTeam } from "../team/teams";
import { allowPhrase, ordinal, type Pos, type Preview, type PreviewSide } from "./preview";
import {
  favLine,
  implyRank,
  ml,
  weatherText,
  type PreviewRenderContext,
} from "./preview-render";
import { SLOTS, starters } from "./preview-starters";
import { gameKeys, KEY_WORD } from "./preview-keys";
import { BATTLE_WORD, type BattlePlayer } from "./preview-extras";
import { teamComparison, type CompareCell } from "./preview-compare";
import { fantasyImpact, FORMATS, TAKEAWAY_WORD, type FantasyImpact } from "./preview-fantasy";
import { bettingOutlook } from "./preview-betting";
import { START_SIT_URL } from "./recap";

const e = escapeHtml;
const one = (n: number): string => n.toFixed(1);
const exact = (n: number): string => String(Math.round(n * 100) / 100);
const code = (t: NflTeam): string => t.code.toUpperCase();
const pairOf = (p: Preview): string => `${p.away.team.nickname} vs ${p.home.team.nickname}`;

/* ------------------------------------------------------------- icons */

const svg = (d: string, size = 22): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;

const ICON = {
  matchup: svg(`<path d="M4 20l7-7"/><path d="M4 13l7 7"/><circle cx="17" cy="7" r="3.2"/><path d="M14 17l6-6"/><path d="M20 17v-6h-6"/>`, 30),
  spread: svg(`<path d="M4 12h16"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>`),
  total: svg(`<path d="M5 19V9"/><path d="M10 19V5"/><path d="M15 19v-7"/><path d="M20 19V8"/>`),
  target: svg(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6"/>`),
  money: svg(`<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v.01M18 15v.01"/>`),
  call: svg(`<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.2l5.9-.9z"/>`),
  lineup: svg(`<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><path d="M16 4.6a3.2 3.2 0 0 1 0 6.3"/><path d="M18 14.4c1.9.8 3 2.7 3 5.6"/>`),
  lever: svg(`<path d="M3 20h18"/><path d="M5 16l14-6"/><path d="M12 13v7"/><circle cx="5" cy="16" r="1.6"/>`),
  trend: svg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  keys: svg(`<circle cx="8" cy="15" r="4.2"/><path d="M11 12l9-9"/><path d="M16 7l3 3"/><path d="M13.5 9.5l2 2"/>`),
  compare: svg(`<path d="M12 4v16"/><path d="M4 8h5M4 12h6M4 16h4"/><path d="M15 8h5M14 12h6M16 16h4"/>`),
  injury: svg(`<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>`),
  clock: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`),
  tv: svg(`<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8"/><path d="M9 2l3 4 3-4"/>`),
  venue: svg(`<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>`),
  weather: svg(`<path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z"/>`),
};

/* ------------------------------------------------------------ helpers */

function face(sleeperId: string | null, side: string, size = 40): string {
  const img = sleeperId
    ? (headshotImg({ src: null, id: sleeperId, className: "sct-mpp-face-img", alt: "", variants: ["160"], width: size, height: size, loading: "lazy" }) ?? "")
    : "";
  return `<span class="sct-mpp-face is-${side}" aria-hidden="true">${img}</span>`;
}

function playerLink(name: string): string {
  const url = getPlayerProfileUrl(name);
  return url ? `<a href="${e(url)}">${e(name)}</a>` : e(name);
}

/** A card with the Schedule tab's navy bar: gold icon, the section's H2, a tag at the right, the gold slash. */
function card(hook: string, id: string, icon: string, title: string, tag: string, body: string): string {
  return (
    `<section class="sct-mpp-card ${hook}" aria-labelledby="${e(id)}">` +
    `<div class="sct-mpp-head"><span class="sct-mpp-icon">${icon}</span>` +
    `<h2 class="sct-mpp-h" id="${e(id)}">${e(title)}</h2>` +
    (tag ? `<span class="sct-mpp-tag">${e(tag)}</span>` : "") +
    `<span class="sct-mpp-slash" aria-hidden="true"></span></div>` +
    `<div class="sct-mpp-body">${body}</div>` +
    `</section>`
  );
}

/** Quartile tone for a defense's points-allowed rank (1st = most allowed = softest). */
function softTone(rank: number | null): string {
  if (rank === null) return "mid";
  return rank <= 8 ? "soft" : rank <= 16 ? "lean-soft" : rank <= 24 ? "lean-tough" : "tough";
}

/* --------------------------------------------------------------- hero */

function hero(p: Preview, ctx: PreviewRenderContext): string {
  const { away, home, meeting, line } = p;
  const isDivision =
    away.team.conference === home.team.conference && away.team.divisionName === home.team.divisionName;
  const eyebrow = [
    String(meeting.season),
    meeting.weekLabel,
    isDivision ? `${away.team.conference} ${away.team.divisionName} rivalry` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const panel = (s: PreviewSide) =>
    `<div class="sct-mpp-panel is-${s.key}" aria-hidden="true"><span class="sct-mpp-panel-fill"></span>` +
    (s.team.logo ? `<span class="sct-mpp-crest"><img src="${e(s.team.logo)}" alt="" width="84" height="84" loading="lazy" decoding="async"></span>` : "") +
    `</div>`;
  const ident = (s: PreviewSide) =>
    `<div class="sct-mpp-ident is-${s.key}">` +
    `<p class="sct-mpp-name">${e(s.team.fullName)}</p>` +
    `<p class="sct-mpp-rec"><b>${e(s.record ?? "-")}</b><span>${s.key === "home" ? "Home" : "Away"}</span></p>` +
    `<a class="sct-mpp-hub" href="${e(ctx.hub(s.team))}">Team hub<span aria-hidden="true"> →</span></a>` +
    `</div>`;

  const kpi = (icon: string, label: string, value: string, sub: string) =>
    `<li class="sct-mpp-kpi"><span class="sct-mpp-kpi-icon">${icon}</span><span class="sct-mpp-kpi-div" aria-hidden="true"></span>` +
    `<span class="sct-mpp-kpi-text"><span class="sct-mpp-kpi-label">${e(label)}</span><span class="sct-mpp-kpi-value">${e(value)}</span>` +
    (sub ? `<span class="sct-mpp-kpi-sub">${e(sub)}</span>` : "") +
    `</span></li>`;
  let kpis = "";
  if (line && line.spread !== null && line.total !== null && away.implied !== null && home.implied !== null) {
    kpis =
      `<ul class="sct-mpp-kpis" aria-label="Betting lines">` +
      kpi(ICON.spread, "Spread", favLine(line.spread, away.team, home.team), line.spreadOpen !== null ? `Opened ${favLine(line.spreadOpen, away.team, home.team)}` : "") +
      kpi(ICON.total, "Total", exact(line.total), line.totalOpen !== null ? `Opened ${exact(line.totalOpen)}` : "") +
      kpi(ICON.target, `${code(away.team)} implied`, exact(away.implied), implyRank(away.impliedRank, p.slateCount, meeting.week)) +
      kpi(ICON.target, `${code(home.team)} implied`, exact(home.implied), implyRank(home.impliedRank, p.slateCount, meeting.week)) +
      kpi(ICON.money, "Moneyline", `${code(home.team)} ${ml(line.moneyline.home)}`, `${code(away.team)} ${ml(line.moneyline.away)}`) +
      `</ul>`;
  }

  const weather = weatherText(p);
  const fact = (icon: string, text: string | null) =>
    text ? `<li class="sct-mpp-fact"><span class="sct-mpp-fact-icon">${icon}</span>${e(text)}</li>` : "";
  const facts =
    fact(ICON.clock, [ctx.date.replace(/, \d{4}$/, ""), ctx.time].filter(Boolean).join(" · ")) +
    fact(ICON.tv, ctx.network) +
    fact(ICON.venue, meeting.venue ?? null) +
    fact(ICON.weather, weather);

  return (
    `<header class="sct-mpp-hero" aria-label="${e(`${p.away.team.fullName} at ${p.home.team.fullName}`)}">` +
    `<div class="sct-mpp-decor" aria-hidden="true"><span class="sct-mpp-bands"></span><span class="sct-mpp-topline"></span></div>` +
    // No heading in the hero since 2026-11-06: the page's one H1 is the
    // visible preview banner under it ("Packers vs. Patriots: Week 9 Game
    // Preview", mak's SEO brief).
    `<div class="sct-mpp-match">` +
    panel(away) +
    `<p class="sct-mpp-eyebrow">${e(eyebrow)}</p>` +
    ident(away) +
    `<span class="sct-mpp-at" aria-label="at">@</span>` +
    ident(home) +
    panel(home) +
    `</div>` +
    kpis +
    (facts ? `<ul class="sct-mpp-facts">${facts}<li class="sct-mpp-fact is-note">${e(lineNote(p))}</li></ul>` : "") +
    `</header>`
  );
}

/**
 * The odds' freshness under the hero (data check, 2026-11-06): a line seen
 * more than twelve hours ago says when; a stale one never reaches the page
 * (buildPreview drops it).
 */
function lineNote(p: Preview): string {
  if (p.lineSeenMs === null) return "Lines move - check your book";
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(p.lineSeenMs);
  return `Lines as of ${when} ET`;
}

/* ------------------------------------------------------------- banner */

/**
 * The preview banner, and since 2026-11-06 the page's visible H1 (an H2 in
 * an embed, which the plugin promotes through data-sct-hero-heading): the
 * general game search first, fantasy as one part of it (mak's SEO brief).
 */
function banner(p: Preview, ctx: PreviewRenderContext): string {
  return (
    `<header class="sct-up-head sct-mpp-banner">` +
    `<span class="sct-up-head-icon">${ICON.matchup}</span>` +
    `<span class="sct-up-head-rule" aria-hidden="true"></span>` +
    `<div class="sct-up-head-text"><${ctx.headingTag} class="sct-up-h2 sct-mpp-title" id="${e(ctx.headingId)}" data-sct-hero-heading>${e(ctx.heading)}</${ctx.headingTag}>` +
    `<p class="sct-up-dek">${e(`Odds, keys to the game, recent form, player matchups, injuries and fantasy starts for ${p.meeting.weekLabel}.`)}</p></div>` +
    `</header>`
  );
}

/* --------------------------------------------------------------- call */

function callCard(p: Preview): string {
  if (!p.call) return "";
  const pos = 50 + p.call.lean * 45;
  const body =
    `<p class="sct-mpp-thesis">${e(p.call.thesis)}.</p>` +
    `<p class="sct-mpp-copy">${e(p.call.paragraph)}</p>` +
    `<div class="sct-mpp-meter" aria-hidden="true"><span class="sct-mpp-meter-track"></span><span class="sct-mpp-meter-dot" style="left:${pos.toFixed(1)}%"></span></div>` +
    `<div class="sct-mpp-meter-labels" aria-hidden="true"><span>${e(code(p.away.team))} controls</span><span>Competitive</span><span>${e(code(p.home.team))} controls</span></div>` +
    `<p class="sct-visually-hidden">${e(p.call.leanText)}</p>` +
    (p.call.detail && p.call.detail !== p.call.paragraph
      ? `<details class="sct-mpp-why"><summary>Why?</summary><p>${e(p.call.detail)}</p></details>`
      : "") +
    (START_SIT_URL ? `<a class="sct-mpp-link" href="${e(START_SIT_URL)}">Deciding between two players? Compare in Start/Sit →</a>` : "");
  return card("is-call", "pv-call", ICON.call, "The Call", "Game script", body);
}

/* ---------------------------------------------------- keys to the game */

/**
 * Three NFL matchups that could decide the game (mak, 2026-11-06), under
 * The Call: chosen and worded in preview-keys.ts from the two teams' season
 * stats and starters' designations, every figure with its league rank.
 */
function keysCard(p: Preview): string {
  const keys = gameKeys(p);
  if (!keys.length) return "";
  const items = keys
    .map(
      (k, i) =>
        `<li class="sct-mpp-key" data-kind="${k.kind}"${k.side ? ` data-side="${k.side}"` : ""}>` +
        `<p class="sct-mpp-key-kick"><span class="sct-mpp-key-n">${String(i + 1).padStart(2, "0")}</span>${e(KEY_WORD[k.kind])}</p>` +
        `<h3 class="sct-mpp-key-q">${e(k.question)}</h3>` +
        `<p class="sct-mpp-key-copy">${e(k.copy)}</p>` +
        `<p class="sct-mpp-key-focus"><b>Focus</b>${k.focus.map((f) => `<span>${e(f)}</span>`).join("")}</p>` +
        `</li>`,
    )
    .join("");
  return card(
    "is-keys",
    "pv-keys",
    ICON.keys,
    `${pairOf(p)} Keys to the Game`,
    `${keys.length} matchups to watch`,
    `<ol class="sct-mpp-keys">${items}</ol>` +
      `<p class="sct-mpp-keys-note">Season-to-date team stats. Ranks are among all 32 teams, 1st the best; for a defense, 1st allows the fewest.</p>`,
  );
}

/* ------------------------------------------------------------ recent form */

/**
 * Each team's last five results and its scoring over them against the
 * season (mak, 2026-11-06; preview-extras.ts teamForm()).
 */
function formCard(p: Preview): string {
  const column = (s: PreviewSide) => {
    const f = p.form[s.key];
    if (!f) return "";
    const chips = f.games
      .map(
        (g) =>
          `<li class="sct-mpp-form-g" data-wlt="${g.outcome}" title="${e(`${g.weekLabel}: ${g.outcome} ${g.pf}-${g.pa} ${g.homeAway === "away" ? "at" : "vs"} ${g.opp}`)}">` +
          `<b>${g.outcome}</b><span>${e(`${g.homeAway === "away" ? "@" : "vs"} ${g.opp}`)}</span><small class="sct-mpp-num">${g.pf}-${g.pa}</small></li>`,
      )
      .join("");
    const trend = (label: string, recent: number, season: number, lowerIsBetter: boolean) => {
      const diff = recent - season;
      const tone = Math.abs(diff) < 1 ? "even" : (diff < 0) === lowerIsBetter ? "up" : "down";
      const arrow = Math.abs(diff) < 1 ? "" : diff > 0 ? "▲" : "▼";
      return (
        `<li class="sct-mpp-form-t" data-tone="${tone}"><span class="sct-mpp-form-k">${e(label)}</span>` +
        `<b class="sct-mpp-num">${one(recent)}</b><span class="sct-mpp-form-s">${e(`last ${f.games.length}`)}</span>` +
        `<span class="sct-mpp-form-vs">${e(`${one(season)} season`)}</span>` +
        `<span class="sct-mpp-form-d sct-mpp-num">${arrow ? `${arrow} ` : ""}${e(`${diff >= 0 ? "+" : "−"}${one(Math.abs(diff))}`)}</span></li>`
      );
    };
    return (
      `<div class="sct-mpp-col is-${s.key}">` +
      `<p class="sct-mpp-colhead">` +
      (s.team.logo ? `<img src="${e(s.team.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : "") +
      `<span>${e(s.team.nickname)}</span><small>${e(`Last ${f.games.length}: ${f.record}`)}</small></p>` +
      `<ol class="sct-mpp-form-games" aria-label="${e(`${s.team.nickname} last ${f.games.length} results, oldest first`)}">${chips}</ol>` +
      `<ul class="sct-mpp-form-trend">${trend("Points scored", f.recent.pf, f.season.pf, false)}${trend("Points allowed", f.recent.pa, f.season.pa, true)}</ul>` +
      `</div>`
    );
  };
  const body = column(p.away) + column(p.home);
  if (!body) return "";
  return card("is-form", "pv-form", ICON.trend, `${pairOf(p)} Recent Form`, "Last five games", `<div class="sct-mpp-cols">${body}</div>`);
}

/* --------------------------------------------------------- player battles */

/**
 * The QB against the pass rush, the tackles against the edges, the top
 * target against the secondary and the lead back against the front, for
 * each offense (mak, 2026-11-06; preview-extras.ts battlesFor()). Units are
 * paired, never one-on-one assignments.
 */
function battlesCard(p: Preview): string {
  // Collapsed (mak, 2026-11-06): each side is photos with the name and the
  // position under them; the stats and the note open below on tap.
  const clean = (n: string) => n.replace(/ \(Q\)$/, "");
  const surname = (n: string) => n.split(/\s+/).slice(1).join(" ") || n;
  const photo = (x: BattlePlayer, side: string) => {
    const img = headshotImg({
      src: x.photo.src,
      id: x.photo.id,
      className: "sct-mpp-face-img",
      alt: "",
      variants: ["160"],
      width: 36,
      height: 36,
      loading: "lazy",
    });
    return `<span class="sct-mpp-face is-${side}" aria-hidden="true">${img ?? ""}</span>`;
  };
  const people = (list: BattlePlayer[], cls: string, side: string) =>
    `<span class="sct-mpp-bt-side ${cls}">` +
    list
      .map(
        (x) =>
          `<span class="sct-mpp-bt-p">${photo(x, side)}` +
          // The last name only under the photo (mak, 2026-11-06): everything
          // after the first name, so "Van Ness" and "Cox Jr." stay whole; the
          // full name is the title and what a screen reader hears.
          `<span class="sct-mpp-bt-name" title="${e(clean(x.name))}"><span aria-hidden="true">${e(surname(clean(x.name)))}</span>` +
          `<span class="sct-visually-hidden">${e(clean(x.name))}</span>` +
          `${/ \(Q\)$/.test(x.name) ? `<span class="sct-mpp-badge is-q" title="Questionable">Q</span>` : ""}</span>` +
          `<span class="sct-mpp-bt-pos">${e(x.role)}</span></span>`,
      )
      .join("") +
    `</span>`;
  const stats = (list: BattlePlayer[]) =>
    list
      .filter((x) => x.stat)
      .map((x) => `<li><b>${playerLink(clean(x.name))}</b> ${e(x.stat)}</li>`)
      .join("");
  const block = (o: PreviewSide, d: PreviewSide) => {
    const list = p.battles[o.key];
    if (!list.length) return "";
    return (
      // The Injury Watch's box (mak, 2026-11-06): team-color top edge, a
      // light header with the count at the right, divided rows.
      `<div class="sct-mpp-col sct-mpp-bt-block is-${o.key}">` +
      `<p class="sct-mpp-colhead">` +
      (o.team.logo ? `<img src="${e(o.team.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : "") +
      `<span>${e(`${o.team.nickname} Offense vs ${d.team.nickname} Defense`)}</span>` +
      `<small>${list.length} ${list.length === 1 ? "battle" : "battles"}</small></p>` +
      `<ol class="sct-mpp-bt-list">` +
      list
        .map(
          (b) =>
            `<li class="sct-mpp-bt" data-kind="${b.kind}"><details class="sct-mpp-bt-d"><summary>` +
            `<span class="sct-mpp-bt-kind">${e(BATTLE_WORD[b.kind])}<span class="sct-mpp-inj-chev" aria-hidden="true"></span></span>` +
            `<span class="sct-mpp-bt-row">${people(b.offense, "is-off", o.key)}<span class="sct-mpp-bt-vs" aria-label="against">vs</span>${people(b.defense, "is-def", d.key)}</span>` +
            `</summary><div class="sct-mpp-bt-more">` +
            `<ul class="sct-mpp-bt-stats">${stats(b.offense)}${stats(b.defense)}</ul>` +
            (b.note ? `<p class="sct-mpp-bt-note">${e(b.note)}</p>` : "") +
            `</div></details></li>`,
        )
        .join("") +
      `</ol></div>`
    );
  };
  const body = block(p.away, p.home) + block(p.home, p.away);
  if (!body) return "";
  // No title bar or outer frame since 2026-11-06 (mak), like the Injury
  // Watch above it in the rail; named for assistive tech.
  return (
    `<section class="sct-mpp-card is-battles" aria-label="${e(`${pairOf(p)} player battles`)}">` +
    `<div class="sct-mpp-body">${body}` +
    `<p class="sct-mpp-keys-note">Defensive numbers are regular-season totals. Depth-chart starters; players listed Out are skipped.</p></div>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- starters */

function startersCard(p: Preview): string {
  const { away, home } = p;
  if (!away.fpa || !home.fpa || !away.roster.length || !home.roster.length) return "";
  const column = (s: PreviewSide, opp: PreviewSide) => {
    const rows = SLOTS.flatMap(({ pos, n }) =>
      starters(s.roster, pos, n).map((r, i) => {
        const slot = n === 1 ? pos : `${pos}${i + 1}`;
        const ppr = s.ppr[r.id];
        const rank = opp.fpa!.byPos[pos].rank;
        const st = (r.injuryStatus ?? "").toLowerCase();
        const badge = st === "questionable" ? `<span class="sct-mpp-badge is-q" title="Questionable">Q</span>` : st === "doubtful" ? `<span class="sct-mpp-badge is-d" title="Doubtful">D</span>` : "";
        return (
          `<li class="sct-mpp-st">` +
          `<span class="sct-mpp-slot" data-pos="${pos}">${e(slot)}</span>` +
          face(r.id, s.key) +
          `<span class="sct-mpp-st-id"><span class="sct-mpp-st-name">${playerLink(r.name)}${badge}</span>` +
          `<span class="sct-mpp-pill" data-tone="${softTone(rank)}">${e(`${allowPhrase(rank)} vs ${pos}`)}</span></span>` +
          `<span class="sct-mpp-st-pts"><b class="sct-mpp-num">${ppr ? one(ppr.ppg) : "-"}</b>` +
          `<small>${ppr && ppr.posRank !== null ? `${pos}${ppr.posRank}` : "-"}</small></span>` +
          `</li>`
        );
      }),
    );
    return (
      `<div class="sct-mpp-col is-${s.key}">` +
      `<p class="sct-mpp-colhead">` +
      (s.team.logo ? `<img src="${e(s.team.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : "") +
      `<span>${e(s.team.nickname)} starters</span><small>vs ${e(code(opp.team))} defense</small></p>` +
      `<ul class="sct-mpp-st-list" aria-label="${e(`${s.team.fullName} starters`)}">${rows.join("")}</ul>` +
      `</div>`
    );
  };
  return card("is-starters", "sct-mu-st-h", ICON.lineup, `${pairOf(p)} Starters vs the Defense`, `${p.meeting.season} season · PPR · PPG`, `<div class="sct-mpp-cols">${column(away, home)}${column(home, away)}</div>`);
}

/* ------------------------------------------------------ betting outlook */

/**
 * Betting Outlook (mak's brief, 2026-11-06), under Fantasy Football Impact.
 * Model and rules in preview-betting.ts: the stored line (one book, never
 * named, never called a consensus), angles from the season numbers, records
 * against closing lines. No props (no data), no picks, no probabilities.
 */
function bettingCard(p: Preview): string {
  const b = bettingOutlook(p);
  const tr = p.trends;
  if (!b && !tr.away && !tr.home) return "";
  const stamp =
    b?.seenAt
      ? new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(b.seenAt) + " ET"
      : null;
  const market = b
    ? `<div class="sct-mpp-bo-sec"><p class="sct-mpp-ff-h">Market Snapshot</p>` +
      `<p class="sct-mpp-bo-src">One sportsbook's line, not a consensus${stamp ? ` · Updated ${e(stamp)}` : ""}</p>` +
      `<table class="sct-mpp-bo-mkt"><caption class="sct-visually-hidden">Opening and current lines</caption>` +
      `<thead><tr><th scope="col"><span class="sct-visually-hidden">Market</span></th><th scope="col">Open</th><th scope="col">Current</th><th scope="col">Move</th></tr></thead><tbody>` +
      b.market
        .map(
          (m) =>
            `<tr${m.label === "Moneyline" ? ` class="is-ml"` : ""}><th scope="row">${e(m.label)}</th>` +
            `<td>${m.open ? e(m.open) : "-"}</td>` +
            // Moneyline: one team's price per line, never split mid-price.
            `<td><b class="sct-mpp-num">${m.label === "Moneyline" ? m.current.split(" · ").map((x) => `<span class="sct-mpp-bo-ml">${e(x)}</span>`).join("") : e(m.current)}</b></td>` +
            `<td class="sct-mpp-bo-move">${m.move ? e(m.move) : "-"}</td></tr>`,
        )
        .join("") +
      `</tbody></table></div>`
    : `<p class="sct-mpp-ff-none">No current line is available for this game.</p>`;
  const angles = b?.angles.length
    ? `<div class="sct-mpp-bo-sec"><p class="sct-mpp-ff-h">What the Numbers Suggest</p><ul class="sct-mpp-bo-angles">` +
      b.angles
        .map(
          (a) =>
            `<li><p class="sct-mpp-bo-ah"><span class="sct-mpp-bo-cat">${e(a.category)}</span>${e(a.headline)}</p>` +
            `<p class="sct-mpp-bo-at">${e(a.text)}</p></li>`,
        )
        .join("") +
      `</ul></div>`
    : "";
  const rec = (r: { w: number; l: number; p: number }) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
  const ou = (r: { o: number; u: number; p: number }) => `${r.o}-${r.u}${r.p ? `-${r.p}` : ""}`;
  const trendCol = (s: PreviewSide) => {
    const t = tr[s.key];
    if (!t) return "";
    const row = (value: string, label: string) => `<li><b class="sct-mpp-num">${e(value)}</b><span>${e(label)}</span></li>`;
    const more =
      row(`${rec(t.venueAts)} ATS`, `${t.venueAts.venue === "home" ? "At home" : "On the road"} · ${t.venueAts.games} games`) +
      (t.roleAts && t.roleAts.games ? row(`${rec(t.roleAts)} ATS`, `As ${t.roleAts.role} · ${t.roleAts.games} games`) : "") +
      row(`${ou(t.last5Ou)} O/U`, `Last ${t.last5Games} games`);
    return (
      `<div class="sct-mpp-bo-team is-${s.key}">` +
      `<p class="sct-mpp-bo-tname">${s.team.logo ? `<img src="${e(s.team.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async">` : ""}${e(s.team.nickname)}</p>` +
      `<ul class="sct-mpp-bo-rec">${row(`${rec(t.ats)} ATS`, `Season · ${t.games} games`)}${row(`${rec(t.last5Ats)} ATS`, `Last ${t.last5Games} games`)}${row(`${ou(t.ou)} O/U`, `Season · ${t.games} games`)}</ul>` +
      `<details class="sct-mpp-bo-more"><summary>View more trends<span class="sct-mpp-inj-chev" aria-hidden="true"></span></summary><ul class="sct-mpp-bo-rec">${more}</ul></details>` +
      `</div>`
    );
  };
  const trends =
    tr.away || tr.home
      ? `<div class="sct-mpp-bo-sec"><p class="sct-mpp-ff-h">Betting Trends</p>` +
        `<div class="sct-mpp-bo-trends">${trendCol(p.away)}${trendCol(p.home)}</div>` +
        `<p class="sct-mpp-keys-note">Records are against each game's closing line this regular season; pushes are the third number. O/U is over-under-push. Context, not a prediction.</p></div>`
      : "";
  return card(
    "is-betting",
    "pv-betting",
    ICON.money,
    `${pairOf(p)} Betting Outlook`,
    "Odds, context & trends",
    market +
      angles +
      trends +
      `<p class="sct-mpp-bo-legal">For research only, not betting advice. Must be 21+ and in a legal jurisdiction to wager. Gambling problem? Call 1-800-GAMBLER.</p>`,
  );
}

/* ------------------------------------------------ fantasy football impact */

/**
 * Fantasy Football Impact (mak's brief, 2026-11-06), added under Matchup
 * Leverage, which stays as it is. Model in preview-fantasy.ts; each scoring
 * format is rendered and the switch (wireSegTabs) shows one, so a format
 * change refetches nothing. The table's team / position filters are
 * wireRowFilters() in client/team.ts.
 */
function fantasyCard(p: Preview): string {
  const impacts = FORMATS.map((f) => ({ f, impact: fantasyImpact(p, f.id) })).filter((x) => x.impact);
  if (!impacts.length) return "";
  const badge = (status: string | null) =>
    status === "Questionable" || status === "Doubtful"
      ? `<span class="sct-mpp-badge ${status === "Doubtful" ? "is-d" : "is-q"}" title="${e(status)}">${status === "Doubtful" ? "D" : "Q"}</span>`
      : "";
  const matchWord = { favorable: "Favorable", neutral: "Neutral", tough: "Tough" } as const;
  const panel = ({ f, impact }: { f: (typeof FORMATS)[number]; impact: FantasyImpact | null }, i: number) => {
    const im = impact!;
    const takeaways = im.takeaways.length
      ? `<ol class="sct-mpp-ff-list">` +
        im.takeaways
          .map(
            (t) =>
              `<li class="sct-mpp-ff-item" data-kind="${t.kind}">${face(t.player.sleeperId, t.player.side, 52)}` +
              `<div class="sct-mpp-ff-body"><p class="sct-mpp-ff-top"><span class="sct-mpp-ff-name">${playerLink(t.player.name)}${badge(t.player.status)}</span>` +
              `<span class="sct-mpp-ff-kind">${e(TAKEAWAY_WORD[t.kind])}</span></p>` +
              `<p class="sct-mpp-ff-meta">${e(`${t.player.team} · ${t.player.pos} · ${one(t.player.ppg)} ${f.label}/G`)}</p>` +
              `<p class="sct-mpp-ff-text">${e(t.text)}</p></div></li>`,
          )
          .join("") +
        `</ol>`
      : `<p class="sct-mpp-ff-none">No unusually strong fantasy matchup edges stand out in this game; every starter's numbers are below.</p>`;
    const teams = [p.away, p.home].map((s) => s.team.code.toUpperCase());
    const fbtn = (key: string, value: string, label: string, on: boolean) =>
      `<button type="button" data-filter="${key}" data-value="${e(value)}" aria-pressed="${on}">${e(label)}</button>`;
    const rows = im.players
      .map(
        (pl) =>
          `<tr data-team="${e(pl.team)}" data-pos="${pl.pos}">` +
          `<th scope="row"><span class="sct-mpp-ff-pl">${face(pl.sleeperId, pl.side, 28)}<span><span class="sct-mpp-ff-pname">${playerLink(pl.name)}${badge(pl.status)}</span>` +
          // Team and position under the name, no column of their own (mak,
          // 2026-11-06); the rank joins them on phones, where its column hides.
          `<small class="sct-mpp-ff-sub2">${e(`${pl.pos} · ${pl.team}`)}` +
          (pl.posRank !== null ? `<span class="sct-mpp-ff-rk-xs">${e(` · ${pl.pos}${pl.posRank}`)}</span>` : "") +
          `</small></span></span></th>` +
          `<td class="sct-mpp-ff-num"><b class="sct-mpp-num">${one(pl.ppg)}</b></td>` +
          `<td class="sct-mpp-ff-rank">${pl.posRank !== null ? e(`${pl.pos}${pl.posRank}`) : "-"}</td>` +
          `<td class="sct-mpp-ff-mu" data-mu="${pl.matchup}"><b>${matchWord[pl.matchup]}</b>` +
          (pl.oppRank !== null ? `<small>${e(`${allowPhrase(pl.oppRank)} ${pl.pos} pts allowed`)}</small>` : "") +
          `</td></tr>`,
      )
      .join("");
    return (
      `<div class="sct-mpp-ff-panel" role="tabpanel" id="pv-ff-${f.id}" aria-labelledby="pv-ff-tab-${f.id}"${i === 0 ? "" : " hidden"}>` +
      `<p class="sct-mpp-ff-h">Matchup Takeaways</p>` +
      takeaways +
      `<details class="sct-mpp-ff-all"><summary><span><b>All Starter Outlooks</b><small>Season production and opponent matchups for both teams.</small></span>` +
      `<span class="sct-mpp-inj-chev" aria-hidden="true"></span></summary>` +
      `<div class="sct-mpp-ff-filters" data-sct-row-filter>` +
      `<span class="sct-mpp-ff-fgroup" role="group" aria-label="Team">${fbtn("team", "all", "All", true)}${teams.map((t) => fbtn("team", t, t, false)).join("")}</span>` +
      `<span class="sct-mpp-ff-fgroup" role="group" aria-label="Position">${fbtn("pos", "all", "All", true)}${(["QB", "RB", "WR", "TE"] as const).map((x) => fbtn("pos", x, x, false)).join("")}</span>` +
      `</div>` +
      `<table class="sct-mpp-ff-table" data-filterable><caption class="sct-visually-hidden">${e(`Starters, ${f.short} season points per game and opponent matchup`)}</caption>` +
      `<thead><tr><th scope="col">Player</th><th scope="col">PPG</th>` +
      `<th scope="col" class="sct-mpp-ff-rank">PPG Rank</th><th scope="col">Matchup</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>` +
      `<p class="sct-mpp-keys-note">PPG and PPG rank are ${e(f.short)} season figures, not weekly projections. Matchup is the opponent's rank in ${e(f.short)} points allowed at the position: 1st-10th favorable, 23rd-32nd tough.</p>` +
      `</details></div>`
    );
  };
  const tabs = impacts
    .map(
      ({ f }, i) =>
        `<button type="button" role="tab" id="pv-ff-tab-${f.id}" aria-controls="pv-ff-${f.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${e(f.label)}</button>`,
    )
    .join("");
  const body =
    `<div class="sct-mpp-ff">` +
    impacts.map(panel).join("") +
    `</div>` +
    (START_SIT_URL
      ? `<div class="sct-mpp-ff-cta"><div><b>Have a lineup decision?</b><p>Compare players using your league's scoring and roster settings.</p></div>` +
        `<a class="sct-mpp-ff-btn" href="${e(START_SIT_URL)}" data-cta="preview-fantasy-startsit">Open Start/Sit <span aria-hidden="true">↗</span></a></div>`
      : "");
  // The scoring switch sits in the title bar (mak, 2026-11-06), so the card
  // itself is the tab group.
  return (
    `<section class="sct-mpp-card is-fantasy" aria-labelledby="pv-fantasy" data-sct-seg-tabs>` +
    `<div class="sct-mpp-head"><span class="sct-mpp-icon">${ICON.lineup}</span>` +
    `<h2 class="sct-mpp-h" id="pv-fantasy">${e(`${pairOf(p)} Fantasy Football Impact`)}</h2>` +
    `<div class="sct-mpp-ff-fmt" role="tablist" aria-label="Scoring format">${tabs}</div>` +
    `<span class="sct-mpp-slash" aria-hidden="true"></span></div>` +
    `<div class="sct-mpp-body">${body}</div>` +
    `</section>`
  );
}

/* ------------------------------------------------------ team comparison */

/**
 * Team Comparison (mak's brief, 2026-11-06), replacing the Team Matchup
 * card: Offense / Defense / Advanced tabs over one three-column table, each
 * value with its rank among 32 teams; the edge gets a weight and a team-color
 * underline only past EVEN_RANKS. Data and definitions in preview-compare.ts;
 * the tabs are wired by wireSegTabs() in client/team.ts (no fetch on switch).
 * The H2 keeps the old card's id, pv-snap.
 */
function compareCard(p: Preview): string {
  const cmp = teamComparison({ team: p.away.team, stats: p.away.stats }, { team: p.home.team, stats: p.home.stats });
  if (!cmp) return "";
  const { away, home } = p;
  const rank = (c: CompareCell) => (c.rank === null ? "" : `${c.tied ? "T-" : ""}${ordinal(c.rank)}`);
  // One line per side (mak, 2026-11-06): "331.6 17th" on the left, "8th
  // 367.1" on the right, the value on the outside edge. A missing value is
  // "-" (house rule: no em dashes).
  const cell = (c: CompareCell, side: "away" | "home", adv: boolean) => {
    const value = `<b class="sct-mpp-num">${c.value === null ? "-" : e(c.value)}</b>`;
    const r = rank(c) ? `<small>${e(rank(c))}</small>` : "";
    return (
      `<td class="sct-mpp-cmp-v is-${side}${adv ? " is-adv" : ""}"><span class="sct-mpp-cmp-vw">` +
      (side === "away" ? value + r : r + value) +
      `</span></td>`
    );
  };
  const team = (s: PreviewSide) =>
    `<div class="sct-mpp-cmp-team is-${s.key}">` +
    (s.team.logo ? `<img src="${e(s.team.logo)}" alt="" width="28" height="28" loading="lazy" decoding="async">` : "") +
    `<span class="sct-mpp-cmp-name">${e(s.team.nickname)}</span><span class="sct-mpp-cmp-code">${e(code(s.team))}</span></div>`;
  const tabs = cmp.tabs
    .map(
      (t, i) =>
        `<button type="button" role="tab" class="sct-mpp-cmp-tab" id="pv-cmp-tab-${t.id}" aria-controls="pv-cmp-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${e(t.label)}</button>`,
    )
    .join("");
  const panels = cmp.tabs
    .map(
      (t, i) =>
        `<div class="sct-mpp-cmp-panel" role="tabpanel" id="pv-cmp-${t.id}" aria-labelledby="pv-cmp-tab-${t.id}"${i === 0 ? "" : " hidden"}>` +
        `<table class="sct-mpp-cmp-table">` +
        `<caption class="sct-visually-hidden">${e(`${t.label}: ${away.team.nickname} vs ${home.team.nickname}, ${cmp.season} season, with NFL ranks`)}</caption>` +
        `<colgroup><col class="is-side"><col class="is-metric"><col class="is-side"></colgroup>` +
        `<thead class="sct-visually-hidden"><tr><th scope="col">${e(away.team.nickname)}</th><th scope="col">Metric</th><th scope="col">${e(home.team.nickname)}</th></tr></thead>` +
        `<tbody>` +
        t.rows
          .map(
            (r) =>
              `<tr data-edge="${r.edge ?? "none"}">` +
              cell(r.away, "away", r.edge === "away") +
              `<th scope="row"><span class="sct-mpp-cmp-k">${e(r.label)}</span>` +
              `<button type="button" class="sct-mpp-cmp-info" aria-label="${e(`About ${r.label}: ${r.tooltip}`)}" data-tip="${e(r.tooltip)}">i</button></th>` +
              cell(r.home, "home", r.edge === "home") +
              `</tr>`,
          )
          .join("") +
        `</tbody></table></div>`,
    )
    .join("");
  const through = cmp.throughWeek ? ` Season to date through Week ${cmp.throughWeek}.` : "";
  return card(
    "is-compare",
    "pv-snap",
    ICON.compare,
    "Team Comparison",
    `${cmp.season} Season`,
    `<div class="sct-mpp-cmp" data-sct-seg-tabs>` +
      `<div class="sct-mpp-cmp-teams">${team(away)}${team(home)}</div>` +
      `<div class="sct-mpp-cmp-tabs" role="tablist" aria-label="Team comparison">${tabs}</div>` +
      panels +
      `</div>` +
      `<p class="sct-mpp-keys-note">Rankings are among 32 NFL teams; 1st is best.${through}</p>`,
  );
}

/* ------------------------------------------------------------ injuries */

function injuryCard(p: Preview): string {
  const column = (s: PreviewSide) => {
    const rows = p.injuries[s.key];
    const listed = rows.filter((r) => r.chip !== "OK");
    const clean = rows.some((r) => r.chip === "OK");
    return (
      `<div class="sct-mpp-col is-${s.key}">` +
      `<p class="sct-mpp-colhead">` +
      (s.team.logo ? `<img src="${e(s.team.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : "") +
      `<span>${e(`${s.team.nickname} Injury Watch`)}</span><small>${listed.length} designated</small></p>` +
      (listed.length
        ? `<ul class="sct-mpp-inj-list">` +
          listed
            .map(
              // Name, then the position and designation tags to its right (mak,
              // 2026-11-06, after a brief try with the tag on the photo).
              (r) =>
                // Collapsed by default (mak, 2026-11-06): the photo, name,
                // position and designation; the note opens under them. Native
                // <details>, so it works without script and from the keyboard.
                `<li class="sct-mpp-inj"><details class="sct-mpp-inj-d"><summary>${face(r.sleeperId, s.key, 36)}` +
                `<span class="sct-mpp-inj-top"><span class="sct-mpp-inj-name">${playerLink(r.name)}</span>` +
                (r.pos ? `<span class="sct-mpp-slot" data-pos="${e(r.pos)}">${e(r.pos)}</span>` : "") +
                // The short code keeps the row on one line in the rail; the full
                // designation is the tag's title and accessible name.
                `<span class="sct-mpp-status" data-status="${e(r.chip)}" title="${e(r.status)}" aria-label="${e(r.status)}">${e(r.chip)}</span></span>` +
                `<span class="sct-mpp-inj-chev" aria-hidden="true"></span></summary>` +
                `<p class="sct-mpp-inj-note">${e(r.fallout)}</p></details></li>`,
            )
            .join("") +
          `</ul>`
        : "") +
      (clean ? `<p class="sct-mpp-inj-foot">No ${listed.length ? "other " : ""}5%+ rostered ${e(s.team.nickname)} carry a designation.</p>` : "") +
      `</div>`
    );
  };
  // No title bar since 2026-11-06 (mak: "remove" the heading): the two team
  // columns sit straight in the rail, the section named for assistive tech.
  return (
    `<section class="sct-mpp-card is-injuries" aria-label="${e(`${pairOf(p)} injury report`)}">` +
    `<div class="sct-mpp-body"><div class="sct-mpp-cols">${column(p.away)}${column(p.home)}</div></div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- rail */

/** Kickoff conditions; the impact note only when a threshold is met (preview-extras.ts). */
function conditionsRail(p: Preview): string {
  const c = p.conditions;
  if (!c) return "";
  const rows: Array<[string, string]> = c.indoor
    ? [["Roof", "Indoors"]]
    : ([
        ["Kickoff", [c.tempF !== null ? `${Math.round(c.tempF)}°F` : null, c.sky].filter(Boolean).join(" · ")],
        ["Wind", c.windMph !== null ? `${Math.round(c.windMph)} mph` : ""],
        ["Rain chance", c.precipPct !== null ? `${Math.round(c.precipPct)}%` : ""],
        ["Roof", c.indoor === false ? "Outdoors" : ""],
      ] as Array<[string, string]>).filter(([, v]) => v);
  if (!rows.length) return "";
  const note = c.indoor
    ? `<p class="sct-mpp-cond-note">Indoors: weather is not a factor.</p>`
    : c.impact
      ? `<p class="sct-mpp-cond-impact"><b>Game impact</b>${e(c.impact)}</p>`
      : `<p class="sct-mpp-cond-note">No weather concerns at kickoff.</p>`;
  return (
    `<section class="sct-mpp-rail-card sct-mpp-cond${c.impact ? " is-impact" : ""}" aria-label="Game conditions">` +
    `<p class="sct-mpp-rail-h">Game Conditions</p>` +
    `<dl class="sct-mpp-cond-list">${rows.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join("")}</dl>` +
    note +
    `</section>`
  );
}

function h2hRail(p: Preview, ctx: PreviewRenderContext): string {
  const h = p.h2h;
  if (!h || !h.games.length) return "";
  const games = h.games
    .slice(0, 5)
    .map((m) => {
      const s = m.score!;
      const aw = s.away > s.home;
      const hw = s.home > s.away;
      return (
        `<li><a class="sct-mpp-h2h-game" href="${e(ctx.game(m))}"><span class="sct-mpp-h2h-when">${e(`${m.season} · ${m.weekLabel}`)}</span>` +
        `<span class="sct-mpp-h2h-score"><span${aw ? ` class="is-win"` : ""}>${e(code(m.away))} ${s.away}</span>` +
        `<span${hw ? ` class="is-win"` : ""}>${e(code(m.home))} ${s.home}</span></span></a></li>`
      );
    })
    .join("");
  return (
    `<section class="sct-mpp-rail-card" aria-labelledby="pv-h2h">` +
    `<h2 class="sct-mpp-rail-h" id="pv-h2h">${e(`${pairOf(p)} Head-to-Head`)}</h2>` +
    `<div class="sct-mpp-h2h-top"><div><b class="sct-mpp-num">${e(h.record)}</b><span>Series since ${h.since}</span></div>` +
    (h.avgPoints !== null ? `<div><b class="sct-mpp-num">${one(h.avgPoints)}</b><span>Avg total</span></div>` : "") +
    `</div>` +
    `<ol class="sct-mpp-h2h-list">${games}</ol>` +
    `</section>`
  );
}

function ctaRail(ctx: PreviewRenderContext): string {
  return (
    `<section class="sct-mpp-cta" aria-label="Redraft Command">` +
    `<p class="sct-mpp-cta-h">Need the call for your actual team?</p>` +
    `<p>Connect your league in Redraft Command to compare these players against your real starters, bench and scoring.</p>` +
    `<a class="sct-mpp-cta-btn" href="${e(ctx.redraftUrl)}" data-cta="preview-premium-redraft">Set My Lineup →</a>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- page */

/** The breadcrumb over the hero, then the hero: the page's top. */
export function renderMatchupPreviewTop(p: Preview, ctx: PreviewRenderContext): string {
  return (
    `<div class="sct-mpp is-top">` +
    `<nav class="sct-mpp-crumbs" aria-label="Breadcrumb"><ol>` +
    `<li><a href="${e(ctx.breadcrumbRoot)}">StatChasers</a></li>` +
    `<li>NFL Matchups</li>` +
    `<li aria-current="page">${e(`${p.away.team.nickname} at ${p.home.team.nickname}, ${p.meeting.weekLabel}`)}</li>` +
    `</ol></nav>` +
    hero(p, ctx) +
    `</div>`
  );
}

/** The banner, the cards and the rail; `tail` (FAQ, Dynasty line, Next steps) closes it. */
export function renderMatchupPreviewBody(p: Preview, ctx: PreviewRenderContext, tail = ""): string {
  return (
    `<div class="sct-mpp" data-sct-matchup-premium>` +
    banner(p, ctx) +
    `<div class="sct-mpp-layout">` +
    `<div class="sct-mpp-main">${compareCard(p)}${callCard(p)}${keysCard(p)}${formCard(p)}${fantasyCard(p)}${bettingCard(p)}</div>` +
    `<aside class="sct-mpp-rail" aria-label="Game facts">${conditionsRail(p)}${h2hRail(p, ctx)}${injuryCard(p)}${battlesCard(p)}${ctaRail(ctx)}</aside>` +
    `</div>` +
    `</div>` +
    tail
  );
}
