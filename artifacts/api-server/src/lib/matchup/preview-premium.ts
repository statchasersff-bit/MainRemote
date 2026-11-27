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
import { playerProfileUrl, type PlayerLinkRef } from "../team/links";
import type { NflTeam } from "../team/teams";
import { allowPhrase, ordinal, type Preview, type PreviewSide } from "./preview";
import {
  favLine,
  implyRank,
  ml,
  weatherText,
  type PreviewRenderContext,
} from "./preview-render";
import { NO_DESIGNATION_YET, PENDING, type WeekReport } from "./availability";
import { gameKeys, KEY_WORD } from "./preview-keys";
import { composePreview } from "./preview-narrative";
import { BATTLE_WORD, type BattlePlayer } from "./preview-extras";
import { teamComparison, type CompareCell } from "./preview-compare";
import { fantasyImpact, FORMATS, TAKEAWAY_WORD, type FantasyImpact } from "./preview-fantasy";
import { bettingOutlook, streak } from "./preview-betting";
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
  h2h: svg(`<path d="M7 4L3 8l4 4"/><path d="M3 8h14"/><path d="M17 12l4 4-4 4"/><path d="M21 16H7"/>`),
};

/* ------------------------------------------------------------ helpers */

function face(sleeperId: string | null, side: string, size = 40, tag: string | null = null): string {
  const img = sleeperId
    ? (headshotImg({ src: null, id: sleeperId, className: "sct-mpp-face-img", alt: "", variants: ["160"], width: size, height: size, loading: "lazy" }) ?? "")
    : "";
  return withFaceTag(`<span class="sct-mpp-face is-${side}" aria-hidden="true">${img}</span>`, tag);
}

/**
 * The injury tag on the photo's top-right corner, for phones (mak,
 * 2026-11-11: at 560px and under "put the injury tags on top right of player
 * image"). The photo clips its contents, so a tagged photo sits in a holder
 * that carries a copy of the tag; CSS shows the copy and visually hides the
 * inline tag on phones (screen readers keep reading the inline one), and
 * hides the copy above 560px.
 */
function withFaceTag(faceHtml: string, tag: string | null): string {
  if (!tag) return faceHtml;
  return `<span class="sct-mpp-facewrap">${faceHtml}<span class="sct-mpp-ftag" data-status="${e(tag)}" aria-hidden="true">${e(tag)}</span></span>`;
}

/** The short tag a status line gets on the photo ("Q", "D", "IR", ...). */
const statusTag = (status: string | null): string | null =>
  status === "Questionable" ? "Q" : status === "Doubtful" ? "D" : null;

/** A name linked by the row's ids (or its club and position when it has none). */
function playerLink(name: string, ref: PlayerLinkRef): string {
  const url = playerProfileUrl(name, ref);
  return url ? `<a href="${e(url)}">${e(name)}</a>` : e(name);
}

/** A card with the Schedule tab's navy bar: gold icon, the section's H2, a tag at the right, the gold slash. */
/**
 * A heading's text with a phone label (mak, 2026-11-11: at 560px and under
 * "Patriots vs Lions Keys to the Game" reads "Keys to the Game"). The full
 * text stays the H2's text in the source ([[seo-changes-need-approval]]);
 * the short label is CSS-generated from data-short, so it adds no text to
 * the heading, and the full text is only visually hidden on phones.
 */
function headText(full: string, short?: string): string {
  return short
    ? `<span class="sct-mpp-hfull">${e(full)}</span><span class="sct-mpp-hshort" data-short="${e(short)}" aria-hidden="true"></span>`
    : e(full);
}

/**
 * A rail card's title with the main cards' bar pieces (icon, slanted lines)
 * for phones (mak, 2026-11-11: at 560px and under Game Conditions and
 * Head-to-Head match the Fantasy / Betting bars). Both pieces are
 * aria-hidden and CSS-hidden above 560px, so the heading's text and the
 * desktop rail are unchanged.
 */
function railBar(icon: string): { lead: string; tail: string } {
  return {
    lead: `<span class="sct-mpp-rail-ico" aria-hidden="true">${icon}</span>`,
    tail: `<span class="sct-mpp-rail-slash" aria-hidden="true"></span>`,
  };
}

function card(hook: string, id: string, icon: string, title: string, tag: string, body: string, short?: string): string {
  return (
    `<section class="sct-mpp-card ${hook}" aria-labelledby="${e(id)}">` +
    `<div class="sct-mpp-head"><span class="sct-mpp-icon">${icon}</span>` +
    `<h2 class="sct-mpp-h" id="${e(id)}">${headText(title, short)}</h2>` +
    (tag ? `<span class="sct-mpp-tag">${e(tag)}</span>` : "") +
    `<span class="sct-mpp-slash" aria-hidden="true"></span></div>` +
    `<div class="sct-mpp-body">${body}</div>` +
    `</section>`
  );
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
    `<header class="sct-mpp-hero is-teams" aria-label="${e(`${p.away.team.fullName} at ${p.home.team.fullName}`)}">` +
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
 * The phone header (mak, 2026-11-11: at 560px and under the five odds cards
 * "take up more space than the teams themselves"). One white surface (the
 * split club colors were removed the same day): one compact team row, each
 * team block linking to its hub; kickoff + network and venue; spread and
 * total as one full-width row linking to the
 * Betting Outlook card, whose market block carries the rest (opening lines,
 * moneyline, implied totals and ranks, the line note). CSS shows it and hides
 * the full hero at 560px and under; above that it is display:none.
 */
function mobileHead(p: Preview, ctx: PreviewRenderContext): string {
  const { away, home, meeting, line } = p;
  const team = (s: PreviewSide) =>
    `<a class="sct-mpp-mh-team is-${s.key}" href="${e(ctx.hub(s.team))}">` +
    `<span class="sct-mpp-mh-logo" aria-hidden="true">${s.team.logo ? `<img src="${e(s.team.logo)}" alt="" width="38" height="38" loading="lazy" decoding="async">` : ""}</span>` +
    `<span class="sct-mpp-mh-text"><span class="sct-mpp-mh-name">${e(s.team.fullName)}</span>` +
    `<span class="sct-mpp-mh-rec">${e(s.record ?? "-")} · ${s.key === "home" ? "Home" : "Away"}<span class="sct-visually-hidden">, team hub</span></span></span>` +
    `</a>`;
  const when = [ctx.date.replace(/, \d{4}$/, ""), ctx.time, ctx.network].filter(Boolean).join(" · ");
  const odds =
    line && (line.spread !== null || line.total !== null)
      ? // A full-width row under the strip: the lines left, the destination
        // right (mak, 2026-11-11: "Betting → on the right so the destination
        // is clear").
        `<a class="sct-mpp-mh-odds" href="#pv-betting">` +
        `<span class="sct-mpp-mh-odds-val">` +
        [line.spread !== null ? favLine(line.spread, away.team, home.team) : null, line.total !== null ? `O/U ${exact(line.total)}` : null]
          .filter(Boolean)
          .map((x) => e(x as string))
          .join(" · ") +
        `</span><span class="sct-mpp-mh-odds-go">Betting<span aria-hidden="true"> →</span></span></a>`
      : "";
  return (
    `<div class="sct-mpp-mh">` +
    `<div class="sct-mpp-mh-band">` +
    `<p class="sct-mpp-mh-week">${e(`${meeting.season} · ${meeting.weekLabel}`)}</p>` +
    `<div class="sct-mpp-mh-row">${team(away)}<span class="sct-mpp-mh-at" aria-hidden="true">@</span>${team(home)}</div>` +
    `</div>` +
    `<div class="sct-mpp-mh-info">` +
    (when ? `<p class="sct-mpp-mh-when">${e(when)}</p>` : "") +
    (meeting.venue ? `<p class="sct-mpp-mh-venue">${e(meeting.venue)}</p>` : "") +
    `</div>` +
    odds +
    `</div>`
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
    `<div class="sct-up-head-text"><${ctx.headingTag} class="sct-up-h2 sct-mpp-title" id="${e(ctx.headingId)}" data-sct-hero-heading>` +
    // Phones (mak, 2026-11-11): "Week 10 Game Preview" only, no dek. The
    // full heading stays the H1's text ([[seo-changes-need-approval]]),
    // visually hidden there; the short label is CSS-drawn from data-short.
    `<span class="sct-mpp-title-full">${e(ctx.heading)}</span><span class="sct-mpp-title-short" data-short="${e(`${p.meeting.weekLabel} Game Preview`)}" aria-hidden="true"></span>` +
    `</${ctx.headingTag}>` +
    `<p class="sct-up-dek">${e(`Odds, keys to the game, recent form, player matchups, injuries and fantasy starts for ${p.meeting.weekLabel}.`)}</p></div>` +
    `</header>`
  );
}

/* --------------------------------------------------------------- call */

/**
 * The Game Preview (mak's 2026-11-18 brief): the written preview from
 * preview-narrative.ts over The Call's projected-script meter, one section
 * rather than two explaining the same game. Falls back to The Call's own
 * thesis and short read when the engine has nothing to tell.
 */
function callCard(p: Preview): string {
  const story = composePreview(p);
  if (!p.call && !story) return "";
  const pos = p.call ? 50 + p.call.lean * 45 : 50;
  const lead = story
    ? `<p class="sct-mpp-thesis sct-mpp-pv-head">${e(story.headline)}</p>` +
      `<div class="sct-mpp-pv-copy" data-storylines="${e(story.storylines.join(" "))}">${story.paragraphs.map((x) => `<p class="sct-mpp-copy">${e(x)}</p>`).join("")}</div>`
    : `<p class="sct-mpp-thesis">${e(p.call!.thesis)}.</p><p class="sct-mpp-copy">${e(p.call!.paragraph)}</p>`;
  if (!p.call) {
    return card("is-call", "pv-call", ICON.call, "Game Preview", p.meeting.weekLabel, lead);
  }
  const body =
    lead +
    `<p class="sct-mpp-pv-script">Projected script</p>` +
    `<div class="sct-mpp-meter" aria-hidden="true"><span class="sct-mpp-meter-track"></span><span class="sct-mpp-meter-dot" style="left:${pos.toFixed(1)}%"></span></div>` +
    `<div class="sct-mpp-meter-labels" aria-hidden="true"><span>${e(code(p.away.team))} controls</span><span>Competitive</span><span>${e(code(p.home.team))} controls</span></div>` +
    `<p class="sct-visually-hidden">${e(p.call.leanText)}</p>` +
    (p.call.detail && p.call.detail !== p.call.paragraph
      ? `<details class="sct-mpp-why"><summary>Why?</summary><p>${e(p.call.detail)}</p></details>`
      : "") +
    (START_SIT_URL ? `<a class="sct-mpp-link" href="${e(START_SIT_URL)}">Deciding between two players? Compare in Start/Sit →</a>` : "");
  return card("is-call", "pv-call", ICON.call, "Game Preview", p.meeting.weekLabel, body);
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
        // Why it could decide the game, and who the numbers favor (mak's
        // 2026-11-18 brief), where the generic Focus tags used to sit.
        `<p class="sct-mpp-key-why">${e(k.why)}</p>` +
        (k.edge
          ? `<p class="sct-mpp-key-edge" data-side="${k.edge}"><b>Edge</b><span>${e((k.edge === "away" ? p.away : p.home).team.nickname)}</span></p>`
          : "") +
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
      `<p class="sct-mpp-keys-note">Season-to-date team stats. Ranks are out of 32 teams, 1st the best; for a defense, 1st allows the fewest.</p>`,
    "Keys to the Game",
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
      // Better or worse in words (mak's 2026-11-18 brief): fewer points
      // allowed is an improvement, so a falling number can be good news and
      // an arrow alone read it the wrong way.
      const verdict = tone === "even" ? "Steady" : tone === "up" ? "Better" : "Worse";
      return (
        `<li class="sct-mpp-form-t" data-tone="${tone}"><span class="sct-mpp-form-k">${e(label)}</span>` +
        `<b class="sct-mpp-num">${one(recent)}</b><span class="sct-mpp-form-s">${e(`last ${f.games.length}`)}</span>` +
        `<span class="sct-mpp-form-vs">${e(`${one(season)} season`)}</span>` +
        `<span class="sct-mpp-form-d sct-mpp-num">${e(`${diff >= 0 ? "+" : "−"}${one(Math.abs(diff))}`)} <span class="sct-mpp-form-arr">${verdict}</span></span></li>`
      );
    };
    return (
      `<div class="sct-mpp-col is-${s.key}">` +
      `<p class="sct-mpp-colhead">` +
      (s.team.logo ? `<img src="${e(s.team.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : "") +
      `<span>${e(s.team.nickname)}</span><small><span class="sct-mpp-form-rlab">${e(`Last ${f.games.length}: `)}</span>${e(f.record)}</small></p>` +
      `<ol class="sct-mpp-form-games" aria-label="${e(`${s.team.nickname} last ${f.games.length} results, oldest first`)}">${chips}</ol>` +
      `<ul class="sct-mpp-form-trend">${trend("Points scored", f.recent.pf, f.season.pf, false)}${trend("Points allowed", f.recent.pa, f.season.pa, true)}</ul>` +
      `</div>`
    );
  };
  const body = column(p.away) + column(p.home);
  if (!body) return "";
  return card("is-form", "pv-form", ICON.trend, `${pairOf(p)} Recent Form`, "Last five games", `<div class="sct-mpp-cols">${body}</div>`, "Last 5 Games");
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
    return withFaceTag(`<span class="sct-mpp-face is-${side}" aria-hidden="true">${img ?? ""}</span>`, / \(Q\)$/.test(x.name) ? "Q" : null);
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
  // The club's own roster gave the Sleeper id where it has him and the
  // defenders' season file its GSIS id; anyone with neither is matched by
  // name only inside his club and position.
  const battleRef = (x: BattlePlayer, club: PreviewSide): PlayerLinkRef =>
    x.photo.id || x.gsisId
      ? { sleeperId: x.photo.id ?? null, gsisId: x.gsisId ?? null }
      : { team: club.team.abbreviation, pos: x.role };
  const stats = (list: BattlePlayer[], club: PreviewSide) =>
    list
      .filter((x) => x.stat)
      .map((x) => `<li><b>${playerLink(clean(x.name), battleRef(x, club))}</b> ${e(x.stat)}</li>`)
      .join("");
  // Phones (mak, 2026-11-11): the collapsed row is surnames only, so the
  // photo, position and stat line of each player open underneath instead.
  // CSS-hidden above 560px, where the face-off row already shows them and
  // the stats list below carries the numbers; aria-hidden, as it repeats
  // the summary and that list for screen readers.
  const who = (list: BattlePlayer[], side: string) =>
    list
      .map(
        (x) =>
          `<li>${photo(x, side)}<span class="sct-mpp-bt-who-t"><b>${e(clean(x.name))}</b><small>${e(x.role)}</small></span>` +
          (x.stat ? `<span class="sct-mpp-bt-who-s">${e(x.stat)}</span>` : "") +
          `</li>`,
      )
      .join("");
  const pairOfKind = (side: "away" | "home", kind: string): "first" | "second" | "solo" => {
    const other = p.battles[side === "away" ? "home" : "away"];
    if (!other.some((b) => b.kind === kind)) return "solo";
    return side === "away" ? "first" : "second";
  };
  const block = (o: PreviewSide, d: PreviewSide) => {
    const list = p.battles[o.key];
    if (!list.length) return "";
    return (
      // The Injury Watch's box (mak, 2026-11-06): team-color top edge, a
      // light header with the count at the right, divided rows.
      `<div class="sct-mpp-col sct-mpp-bt-block is-${o.key}">` +
      // The section icon rather than the club logo (mak, 2026-11-27): the
      // head reads like the main cards' (Game Preview, Team Comparison).
      `<p class="sct-mpp-colhead"><span class="sct-mpp-colhead-ico" aria-hidden="true">${ICON.compare}</span>` +
      `<span>${e(`${o.team.nickname} Offense vs ${d.team.nickname} Defense`)}</span>` +
      `<small>${list.length} ${list.length === 1 ? "battle" : "battles"}</small></p>` +
      `<ol class="sct-mpp-bt-list">` +
      list
        .map(
          (b) =>
            // data-pair: on phones the two offenses' battles of one kind
            // share a row under one label (mak, 2026-11-11: "instead of
            // writing Quarterback vs Pass Rush two times, just combine those
            // rows"); "first" carries the label, "second" drops it.
            `<li class="sct-mpp-bt" data-kind="${b.kind}" data-pair="${pairOfKind(o.key, b.kind)}"><details class="sct-mpp-bt-d"><summary>` +
            `<span class="sct-mpp-bt-kind"><span>${e(BATTLE_WORD[b.kind])}</span><span class="sct-mpp-inj-chev" aria-hidden="true"></span></span>` +
            `<span class="sct-mpp-bt-row">${people(b.offense, "is-off", o.key)}<span class="sct-mpp-bt-vs" aria-label="against">vs</span>${people(b.defense, "is-def", d.key)}</span>` +
            `</summary><div class="sct-mpp-bt-more">` +
            `<ul class="sct-mpp-bt-who" aria-hidden="true">${who(b.offense, o.key)}${who(b.defense, d.key)}</ul>` +
            `<ul class="sct-mpp-bt-stats">${stats(b.offense, o)}${stats(b.defense, d)}</ul>` +
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
  // Phones (mak, 2026-11-11, as the Injury Watch): one container under the
  // main cards' bar, the two "Offense vs Defense" headings hidden and every
  // battle in one list. The bar is CSS-hidden above 560px.
  const count = p.battles.away.length + p.battles.home.length;
  const bar =
    `<div class="sct-mpp-head sct-mpp-bt-bar"><span class="sct-mpp-icon">${ICON.compare}</span>` +
    `<p class="sct-mpp-h">Player Battles</p>` +
    `<span class="sct-mpp-tag">${count} ${count === 1 ? "battle" : "battles"}</span>` +
    `<span class="sct-mpp-slash" aria-hidden="true"></span></div>`;
  return (
    `<section class="sct-mpp-card is-battles" aria-label="${e(`${pairOf(p)} player battles`)}">` +
    bar +
    `<div class="sct-mpp-body"><p class="sct-mpp-bt-cols" aria-hidden="true"><span>Offense</span><span>Defense</span></p>${body}` +
    `<p class="sct-mpp-keys-note">Defensive numbers are regular-season totals. Depth-chart starters; players listed Out are skipped.</p></div>` +
    `</section>`
  );
}

/* ----------------------------------------------------------- starters */

/* ------------------------------------------------------ betting outlook */

/**
 * Betting Outlook (mak's brief, 2026-11-06), under Fantasy Football Impact.
 * Compacted 2026-11-07 (mak: "show the number once, explain its significance
 * once, and let visitors expand"): three market tiles (current big, opened
 * small, move), one Betting Form table (last-5 and season ATS / O/U plus the
 * last-5 margin vs the spread), one Scoring Trends table (actual points vs
 * the average closing O/U), ONE key insight, then each team's last five
 * against the closing line behind a collapsed disclosure. One footer line.
 * Model and rules in preview-betting.ts. No props, picks or provider names.
 */
const recText = (r: { w: number; l: number; p: number }) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}`;
const ouText = (r: { o: number; u: number; p: number }) => `${r.o}-${r.u}${r.p ? `-${r.p}` : ""}`;
const ATS_WORD = { w: "Covered", l: "Did not cover", p: "Push" } as const;
const OU_WORD = { o: "Over", u: "Under", p: "Push" } as const;
const handicapText = (n: number): string => (n === 0 ? "PK" : n > 0 ? `+${n}` : `−${Math.abs(n)}`);
const signedOne = (n: number): string => (n > 0 ? `+${one(n)}` : n < 0 ? `−${one(Math.abs(n))}` : "0.0");
/** A term with its definition on hover / long-press. */
const term = (label: string, title: string): string => `<abbr title="${e(title)}">${e(label)}</abbr>`;
const T_ATS = "Against the spread: covered (W), did not cover (L) or push (P), each game against its own closing spread";
const T_OU = "Over/under: the final combined score against that game's closing total";

function chip(kind: "ats" | "ou", v: "w" | "l" | "p" | "o" | "u", title: string): string {
  return `<span class="sct-mpp-bo-chip" data-k="${kind}" data-v="${v}" title="${e(title)}">${v.toUpperCase()}</span>`;
}

function teamMark(s: PreviewSide, size = 18): string {
  return s.team.logo ? `<img src="${e(s.team.logo)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">` : "";
}

function bettingCard(p: Preview): string {
  const b = bettingOutlook(p);
  const tr = p.trends;
  if (!b && !tr.away && !tr.home) return "";
  const sides = [p.away, p.home].filter((s) => tr[s.key] && tr[s.key]!.recent.length);
  const sec = (title: string, body: string) => `<div class="sct-mpp-bo-sec"><p class="sct-mpp-ff-h">${e(title)}</p>${body}</div>`;
  const teamCell = (s: PreviewSide) => `<th scope="row"><span class="sct-mpp-bo-tm">${teamMark(s)}${e(code(s.team))}</span></th>`;

  /* 1. Market: three tiles */
  const stamp = b?.seenAt
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(b.seenAt) + " ET"
    : null;
  const arrow = (dir: string | null) => (dir === "up" ? "↑" : dir === "down" ? "↓" : dir === "toward" ? "→" : "");
  // Line movement, not the line again (mak's 2026-11-18 brief: the header
  // already carries the current spread, total and moneyline): each tile leads
  // with how the number moved since it opened, open and current under it.
  // The moneyline has no opening price here, so it stays in the header only.
  const tile = (m: NonNullable<typeof b>["market"][number]) =>
    `<li class="sct-mpp-bo-tile"><span class="sct-mpp-bo-tl">${e(`${m.label} movement`)}</span>` +
    `<b class="sct-mpp-num"${m.dir ? ` data-dir="${m.dir}"` : ""}>${m.dir && m.dir !== "none" ? `<span aria-hidden="true">${arrow(m.dir)} </span>` : ""}${e(m.move ?? "No opening line")}</b>` +
    `<span class="sct-mpp-bo-tsub">${m.open ? `Opened ${e(m.open)} · Now ${e(m.current)}` : `Now ${e(m.current)}`}</span>` +
    `</li>`;
  const market = b
    ? `<div class="sct-mpp-bo-sec"><ul class="sct-mpp-bo-tiles" aria-label="Line movement">${b.market.filter((m) => m.label !== "Moneyline").map(tile).join("")}</ul>` +
      // The implied totals on one line under the strip, for phones, where
      // the compact header leaves them out (mak, 2026-11-11: "Implied points
      // · NE 24.5 · DET 27"; the weekly ranks stay with the desktop hero).
      // CSS-hidden above 560px.
      (p.away.implied !== null && p.home.implied !== null
        ? `<p class="sct-mpp-bo-implied"><span class="sct-mpp-bo-tl">Implied points</span>` +
          [p.away, p.home].map((s) => ` · <span>${e(code(s.team))}</span> <b class="sct-mpp-num">${e(exact(s.implied!))}</b>`).join("") +
          `</p>`
        : "") +
      `<p class="sct-mpp-bo-src">One sportsbook's line, not a consensus${stamp ? ` · Updated ${e(stamp)}` : ""}<span class="sct-mpp-bo-note"> · ${e(lineNote(p))}</span></p></div>`
    : `<p class="sct-mpp-ff-none">No current line is available for this game.</p>`;

  // Phones (mak, 2026-11-11: "one compact footer for the source, update
  // time, and existing betting notice"): the source line leads the legal
  // line there and its own line under the strip is CSS-hidden; above 560px
  // this lead is hidden instead.
  const srcLead = b
    ? `<span class="sct-mpp-bo-srclead">One sportsbook's line, not a consensus${stamp ? ` · Updated ${e(stamp)}` : ""} · ${e(lineNote(p))}. </span>`
    : "";

  // Phones (mak, 2026-11-11): the Key insight is cut there, and the one fact
  // it held that the tables do not show, a current over/under streak, rides
  // the team's Recent Results row ("Under in 3 straight"). Only a streak of
  // three or more that is shorter than the last-five sample: a 5-0 run is
  // already the table's O/U L5. CSS-hidden above 560px.
  const streakTag = (t: NonNullable<typeof tr.away>) => {
    const st = streak(t, "ou");
    if (st.n < 3 || st.n >= t.recent.length || (st.v !== "o" && st.v !== "u")) return "";
    return `<span class="sct-mpp-bo-streak" data-v="${st.v}">${st.v === "o" ? "Over" : "Under"} in ${st.n} straight</span>`;
  };

  /* 2. Betting Form: one table, both teams */
  const form = sides.length
    ? sec(
        "Betting Form",
        `<table class="sct-mpp-bo-tbl"><caption class="sct-visually-hidden">Betting records against the closing line</caption>` +
          `<thead><tr><th scope="col">Team</th><th scope="col">${term("ATS", T_ATS)} L5</th><th scope="col">${term("O/U", T_OU)} L5</th>` +
          `<th scope="col">${term("ATS", T_ATS)} season</th><th scope="col">${term("O/U", T_OU)} season</th>` +
          `<th scope="col">${term("+/− L5", "Average final margin against the closing spread over the last five games")}</th></tr></thead><tbody>` +
          sides
            .map((s) => {
              const t = tr[s.key]!;
              return (
                `<tr>${teamCell(s)}<td class="sct-mpp-num is-key">${recText(t.last5Ats)}</td><td class="sct-mpp-num is-key">${ouText(t.last5Ou)}</td>` +
                `<td class="sct-mpp-num">${recText(t.ats)}</td><td class="sct-mpp-num">${ouText(t.ou)}</td>` +
                `<td class="sct-mpp-num">${e(signedOne(t.recentAvg.vsSpread))}</td></tr>`
              );
            })
            .join("") +
          `</tbody></table>`,
      )
    : "";

  /* 3. Scoring Trends: actual points vs the closing O/U, last 5 */
  const scoring = sides.length
    ? sec(
        "Scoring Trends · Last 5",
        `<table class="sct-mpp-bo-tbl"><caption class="sct-visually-hidden">Points per game over the last five games and the average closing over/under</caption>` +
          `<thead><tr><th scope="col">Team</th><th scope="col">Scored</th><th scope="col">Allowed</th><th scope="col">Actual total</th>` +
          `<th scope="col">${term("Avg closing O/U", "The average closing total (over/under line) of the same five games")}</th><th scope="col">Diff</th></tr></thead><tbody>` +
          sides
            .map((s) => {
              const a = tr[s.key]!.recentAvg;
              const d = Math.round((a.combined - a.total) * 10) / 10;
              return (
                `<tr>${teamCell(s)}<td class="sct-mpp-num">${one(a.scored)}</td><td class="sct-mpp-num">${one(a.allowed)}</td>` +
                `<td class="sct-mpp-num is-key">${one(a.combined)}</td><td class="sct-mpp-num">${one(a.total)}</td>` +
                `<td class="sct-mpp-num sct-mpp-bo-diff" data-dir="${d > 0 ? "up" : d < 0 ? "down" : "flat"}">${e(signedOne(d))}</td></tr>`
              );
            })
            .join("") +
          `</tbody></table>`,
      )
    : "";

  /* 4. Key insight: one, or none */
  const insight = b?.insight
    ? `<div class="sct-mpp-bo-sec"><p class="sct-mpp-bo-key"><span class="sct-mpp-bo-cat">Key insight</span>${e(b.insight)}</p></div>`
    : "";

  /* 5. Recent results: collapsed per team */
  const results = sides.length
    ? sec(
        "Recent Results",
        sides
          .map((s) => {
            const t = tr[s.key]!;
            return (
              `<details class="sct-mpp-bo-games"><summary>${teamMark(s)}<span>${e(s.team.nickname)} · last ${t.recent.length} games</span>${streakTag(t)}<span class="sct-mpp-inj-chev" aria-hidden="true"></span></summary>` +
              `<table class="sct-mpp-bo-gt"><caption class="sct-visually-hidden">${e(`${s.team.fullName} last ${t.recent.length} games against the closing line`)}</caption>` +
              `<thead><tr><th scope="col">Wk</th><th scope="col">Opp</th><th scope="col">Final</th><th scope="col">Spread</th><th scope="col">${term("ATS", T_ATS)}</th><th scope="col">Total</th><th scope="col">${term("O/U", T_OU)}</th></tr></thead><tbody>` +
              t.recent
                .map((g) => {
                  const wl = g.own > g.allowed ? "W" : g.own < g.allowed ? "L" : "T";
                  return (
                    `<tr><td>${g.week}</td><td>${g.home ? "vs" : "@"} ${e(g.oppCode)}</td>` +
                    `<td class="sct-mpp-num">${wl} ${g.own}-${g.allowed}</td>` +
                    `<td class="sct-mpp-num">${e(handicapText(g.handicap))}</td>` +
                    `<td>${chip("ats", g.ats, `${ATS_WORD[g.ats]} by ${signedOne(g.vsSpread)}`)}<span class="sct-visually-hidden">${ATS_WORD[g.ats]}</span><small class="sct-mpp-bo-by">${e(signedOne(g.vsSpread))}</small></td>` +
                    `<td class="sct-mpp-num">${g.total}</td>` +
                    `<td>${chip("ou", g.ou, `${OU_WORD[g.ou]}: ${g.own + g.allowed} points`)}<span class="sct-visually-hidden">${OU_WORD[g.ou]}</span><small class="sct-mpp-bo-by">${g.own + g.allowed}</small></td></tr>`
                  );
                })
                .join("") +
              `</tbody></table></details>`
            );
          })
          .join(""),
      )
    : "";

  return card(
    "is-betting",
    "pv-betting",
    ICON.money,
    `${pairOf(p)} Betting Outlook`,
    "Odds, context & trends",
    market +
      form +
      scoring +
      insight +
      results +
      `<p class="sct-mpp-bo-legal">${srcLead}Records use each game's closing line; pushes count. Context, not a prediction or betting advice. 21+ and legal jurisdictions only. Gambling problem? Call 1-800-GAMBLER.</p>`,
    "Betting Outlook",
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
              `<li class="sct-mpp-ff-item" data-kind="${t.kind}">${face(t.player.sleeperId, t.player.side, 52, statusTag(t.player.status))}` +
              `<div class="sct-mpp-ff-body"><p class="sct-mpp-ff-top"><span class="sct-mpp-ff-name">${playerLink(t.player.name, { sleeperId: t.player.sleeperId })}${badge(t.player.status)}</span>` +
              `<span class="sct-mpp-ff-kind">${e(TAKEAWAY_WORD[t.kind])}</span></p>` +
              // "Fantasy PPG" for quarterbacks, whose points barely move with
              // reception scoring (mak's 2026-11-18 brief); the format's own
              // name for everyone else.
              `<p class="sct-mpp-ff-meta">${e(`${t.player.pos} · ${t.player.team} · ${one(t.player.ppg)} ${t.player.pos === "QB" ? "Fantasy PPG" : `${f.label} PPG`}`)}</p>` +
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
          `<th scope="row"><span class="sct-mpp-ff-pl">${face(pl.sleeperId, pl.side, 28, statusTag(pl.status))}<span><span class="sct-mpp-ff-pname">${playerLink(pl.name, { sleeperId: pl.sleeperId })}${badge(pl.status)}</span>` +
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
    `<h2 class="sct-mpp-h" id="pv-fantasy">${headText(`${pairOf(p)} Fantasy Football Impact`, "Fantasy Impact")}</h2>` +
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

/** A designation in words; "Pending" (availability.ts) has none for this game yet. */
function statusLabel(status: string, p: Preview): string {
  return status === PENDING ? NO_DESIGNATION_YET : status;
}

/**
 * The count beside an Injury Watch heading (WEB-039): only this week's
 * official game designations are "designated"; reserve lists and players
 * with no designation yet are listed and counted apart, so the number always
 * matches the rows it names.
 */
function listingCount(rows: Preview["injuries"]["away"]): string {
  const n = (k: string) => rows.filter((r) => r.listing === k).length;
  const parts = [`${n("designated")} designated`];
  if (n("reserve")) parts.push(`${n("reserve")} reserve`);
  if (n("pending")) parts.push(`${n("pending")} game designation pending`);
  return parts.join(" · ");
}

/** "Nov 24", in Eastern time: the day the report was read. */
const REPORT_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/**
 * The report a count stands on (WEB-039 verify pass, 2026-11-24): "0
 * designated" means nothing until the club's game statuses for THIS week are
 * out, so the count says which report it read, or that none is out yet.
 */
function reportTag(r: WeekReport | undefined, weekLabel: string): string {
  if (!r || r.state === "missing") return `${weekLabel} report not out yet`;
  if (r.state === "pending") return `${weekLabel} game statuses not out yet`;
  return r.fetchedAt !== null ? `report as of ${REPORT_DAY.format(r.fetchedAt)}` : `${weekLabel} report`;
}

function injuryCard(p: Preview): string {
  const column = (s: PreviewSide) => {
    const rows = p.injuries[s.key];
    const listed = rows.filter((r) => r.listing !== "clean");
    const clean = rows.some((r) => r.listing === "clean");
    const report = p.injuryReports?.[s.key];
    const final = report?.state === "final";
    return (
      `<div class="sct-mpp-col is-${s.key}">` +
      // The section icon rather than the club logo (mak, 2026-11-27), as
      // the main cards' heads.
      `<p class="sct-mpp-colhead"><span class="sct-mpp-colhead-ico" aria-hidden="true">${ICON.injury}</span>` +
      `<span>${e(`${s.team.nickname} Injury Watch`)}</span><small>${e(`${listingCount(rows)} · ${reportTag(report, p.meeting.weekLabel)}`)}</small></p>` +
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
                `<li class="sct-mpp-inj" data-listing="${e(r.listing)}"><details class="sct-mpp-inj-d"><summary>${face(r.sleeperId, s.key, 36, r.chip)}` +
                `<span class="sct-mpp-inj-top"><span class="sct-mpp-inj-name">${playerLink(r.name, r.sleeperId ? { sleeperId: r.sleeperId } : { team: s.team.abbreviation, pos: r.pos })}</span>` +
                (r.pos ? `<span class="sct-mpp-slot" data-pos="${e(r.pos)}">${e(r.pos)}</span>` : "") +
                // The team code, shown only on phones where both teams share
                // one list (mak, 2026-11-11).
                `<span class="sct-mpp-inj-team">${e(code(s.team))}</span>` +
                // The short code keeps the row on one line in the rail; the full
                // designation is the tag's title and accessible name.
                `<span class="sct-mpp-status" data-status="${e(r.chip)}" title="${e(statusLabel(r.status, p))}" aria-label="${e(statusLabel(r.status, p))}">${e(r.chip)}</span></span>` +
                `<span class="sct-mpp-inj-chev" aria-hidden="true"></span></summary>` +
                `<p class="sct-mpp-inj-note">${e(r.fallout)}</p></details></li>`,
            )
            .join("") +
          `</ul>`
        : "") +
      (clean
        ? final
          ? `<p class="sct-mpp-inj-foot">No ${listed.length ? "other " : ""}5%+ rostered ${e(s.team.nickname)} carry a designation.</p>`
          : `<p class="sct-mpp-inj-foot">No ${listed.length ? "other " : ""}5%+ rostered ${e(s.team.nickname)} have a ${e(p.meeting.weekLabel)} game designation yet.</p>`
        : "") +
      `</div>`
    );
  };
  // No title bar since 2026-11-06 (mak: "remove" the heading): the two team
  // columns sit straight in the rail, the section named for assistive tech.
  // Phones (mak, 2026-11-11): one container under the main cards' bar, the
  // two team headings hidden and both teams in one list. The bar is CSS-hidden
  // above 560px, where the two team boxes keep their own headings.
  // The phones' single bar: the report state when both clubs agree on it.
  const both = [p.injuryReports?.away, p.injuryReports?.home];
  const totalReport =
    both.every((r) => r?.state === "final")
      ? reportTag({ state: "final", fetchedAt: Math.max(...both.map((r) => r?.fetchedAt ?? 0)) || null }, p.meeting.weekLabel)
      : both.every((r) => r?.state !== "final")
        ? `${p.meeting.weekLabel} game statuses not out yet`
        : null;
  const total = listingCount([...p.injuries.away, ...p.injuries.home]) + (totalReport ? ` · ${totalReport}` : "");
  const bar =
    `<div class="sct-mpp-head sct-mpp-inj-bar"><span class="sct-mpp-icon">${ICON.injury}</span>` +
    `<p class="sct-mpp-h">Injury Watch</p>` +
    `<span class="sct-mpp-tag">${e(total)}</span>` +
    `<span class="sct-mpp-slash" aria-hidden="true"></span></div>`;
  return (
    `<section class="sct-mpp-card is-injuries" aria-label="${e(`${pairOf(p)} injury report`)}">` +
    bar +
    `<div class="sct-mpp-body"><div class="sct-mpp-cols">${column(p.away)}${column(p.home)}</div></div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- rail */

/** Kickoff conditions; the impact note only when a threshold is met (preview-extras.ts). */
function conditionsRail(p: Preview): string {
  const c = p.conditions;
  if (!c) return "";
  // No forecast for an outdoor game: no card (mak, 2026-11-11), rather than
  // "Roof: Outdoors / No weather concerns" with nothing behind it. Indoor
  // games keep theirs: the roof is the fact there.
  if (!c.indoor && c.tempF === null && !c.sky && c.windMph === null && c.precipPct === null) return "";
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
      : c.windMph !== null && c.precipPct !== null
        ? `<p class="sct-mpp-cond-note">No weather concerns at kickoff: wind and rain are below the levels that affect play.</p>`
        : // Without a wind and rain forecast there is nothing to clear the
          // game on (mak's 2026-11-18 brief), so the card says what it lacks.
          `<p class="sct-mpp-cond-note">Wind and rain forecasts are not available yet.</p>`;
  return (
    `<section class="sct-mpp-rail-card sct-mpp-cond${c.impact ? " is-impact" : ""}" aria-label="Game conditions">` +
    `<p class="sct-mpp-rail-h">${railBar(ICON.weather).lead}<span class="sct-mpp-rail-t">Game Conditions</span>${railBar(ICON.weather).tail}</p>` +
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
  // A thin or old series reads as one line (mak's 2026-11-18 brief: "keep
  // concise when the historical sample is small, old or not predictive"):
  // one meeting, or none in the last two seasons.
  const newest = h.games[0]!;
  const thin = h.games.length === 1 || newest.season < p.meeting.season - 2;
  if (thin) {
    const s = newest.score!;
    return (
      `<section class="sct-mpp-rail-card is-thin" aria-labelledby="pv-h2h">` +
      `<h2 class="sct-mpp-rail-h" id="pv-h2h">${railBar(ICON.h2h).lead}<span class="sct-mpp-rail-t">${headText(`${pairOf(p)} Head-to-Head`, "Head-to-Head")}</span>${railBar(ICON.h2h).tail}</h2>` +
      `<p class="sct-mpp-h2h-thin">Last met in <a href="${e(ctx.game(newest))}">${e(`${newest.season} ${newest.weekLabel}`)}</a>: ` +
      `${e(`${code(newest.away)} ${s.away}, ${code(newest.home)} ${s.home}`)}. ` +
      `${e(`Series since ${h.since}: ${h.record}`)}${h.games.length === 1 ? " in one meeting" : ""}.</p>` +
      `</section>`
    );
  }
  return (
    `<section class="sct-mpp-rail-card" aria-labelledby="pv-h2h">` +
    `<h2 class="sct-mpp-rail-h" id="pv-h2h">${railBar(ICON.h2h).lead}<span class="sct-mpp-rail-t">${headText(`${pairOf(p)} Head-to-Head`, "Head-to-Head")}</span>${railBar(ICON.h2h).tail}</h2>` +
    `<div class="sct-mpp-h2h-top"><div><b class="sct-mpp-num">${e(h.record)}</b><span>Series since ${h.since}</span></div>` +
    (h.avgPoints !== null ? `<div><b class="sct-mpp-num">${one(h.avgPoints)}</b><span>Avg total</span></div>` : "") +
    `</div>` +
    `<ol class="sct-mpp-h2h-list">${games}</ol>` +
    `</section>`
  );
}

/**
 * The fantasy tools card's art (mak, 2026-11-11: "the faint image on the
 * right" as the premium tab headers wear it, "a tool focused image"): a
 * trade - two player cards swapped by a pair of arrows -, a lineup sheet
 * with checked slots, and comparison bars with a rising trend. Same 260 x
 * 90 frame and stroke as the headers' art (team/premium-head.ts); shown on
 * phones only, faint white behind the copy.
 */
const CTA_ART =
  `<svg class="sct-mpp-cta-art" viewBox="0 0 260 90" width="260" height="90" aria-hidden="true" focusable="false">` +
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  // Trade: two player cards (head, shoulders, name line) and the swap arrows.
  `<rect x="6" y="14" width="34" height="46" rx="4"/><circle cx="23" cy="29" r="6"/><path d="M13 46c2-6 6-8 10-8s8 2 10 8"/><path d="M14 53h18"/>` +
  `<rect x="58" y="30" width="34" height="46" rx="4"/><circle cx="75" cy="45" r="6"/><path d="M65 62c2-6 6-8 10-8s8 2 10 8"/><path d="M66 69h18"/>` +
  `<path d="M44 20c8-6 18-6 24 2"/><path d="M64 15l4 7-8 1"/>` +
  `<path d="M54 80c-8 6-18 6-24-2"/><path d="M34 85l-4-7 8-1"/>` +
  `</g>` +
  // Lineup sheet: slot rows, three checked.
  `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<rect x="110" y="8" width="62" height="76" rx="5"/><path d="M110 22h62"/><path d="M118 15h22"/>` +
  `<path d="M118 32l3 3 5-6"/><path d="M132 32h30"/>` +
  `<path d="M118 46l3 3 5-6"/><path d="M132 46h24"/>` +
  `<path d="M118 60l3 3 5-6"/><path d="M132 60h28"/>` +
  `<circle cx="122" cy="74" r="3"/><path d="M132 74h20"/>` +
  `</g>` +
  // Compare: paired bars and a rising trend.
  `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M188 82h66"/>` +
  `<rect x="192" y="50" width="9" height="32" rx="2"/><rect x="204" y="38" width="9" height="44" rx="2"/>` +
  `<rect x="224" y="42" width="9" height="40" rx="2"/><rect x="236" y="20" width="9" height="62" rx="2"/>` +
  `<path d="M190 34l18-12 14 6 26-20"/><path d="M240 8h8v8"/>` +
  `</g></svg>`;

function ctaRail(ctx: PreviewRenderContext): string {
  // Phones (mak, 2026-11-11) word it "Play Fantasy Football?" (the card sits
  // under The Call there); each pair is toggled by CSS at 560px, so only one
  // version is ever displayed or read. Same link either way.
  const two = (desk: string, phone: string) =>
    `<span class="sct-mpp-cta-d">${e(desk)}</span><span class="sct-mpp-cta-m">${e(phone)}</span>`;
  return (
    `<section class="sct-mpp-cta" aria-label="Redraft Command">` +
    CTA_ART +
    `<p class="sct-mpp-cta-h">${two("Need the call for your actual team?", "Play Fantasy Football?")}</p>` +
    `<p>${two(
      "Connect your league in Redraft Command to compare these players against your real starters, bench and scoring.",
      "Take your game to the next level with StatChasers. Analyze trades, optimize your lineup, compare players, and make smarter decisions with our free fantasy football tools.",
    )}</p>` +
    `<a class="sct-mpp-cta-btn" href="${e(ctx.redraftUrl)}" data-cta="preview-premium-redraft">${two("Set My Lineup →", "Explore Fantasy Tools →")}</a>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- page */

/**
 * The hero: the page's top. The visible breadcrumb over it ("StatChasers /
 * NFL Matchups / Cardinals at Chiefs, Week 11") was removed at mak's request,
 * 2026-11-18; the page's BreadcrumbList schema is untouched.
 */
export function renderMatchupPreviewTop(p: Preview, ctx: PreviewRenderContext): string {
  return (
    `<div class="sct-mpp is-top">` +
    hero(p, ctx) +
    mobileHead(p, ctx) +
    `</div>`
  );
}

/** The banner, the cards and the rail; `tail` (FAQ, Dynasty line, Next steps) closes it. */
export function renderMatchupPreviewBody(p: Preview, ctx: PreviewRenderContext, tail = ""): string {
  return (
    `<div class="sct-mpp" data-sct-matchup-premium>` +
    banner(p, ctx) +
    `<div class="sct-mpp-layout">` +
    // The order of mak's 2026-11-18 brief: the written preview first, then
    // the comparison, the keys, form, fantasy and betting; in the rail the
    // injuries lead (availability before fantasy decisions), then the player
    // battles, conditions and the head-to-head.
    `<div class="sct-mpp-main">${callCard(p)}${compareCard(p)}${keysCard(p)}${formCard(p)}${fantasyCard(p)}${bettingCard(p)}</div>` +
    `<aside class="sct-mpp-rail" aria-label="Game facts">${injuryCard(p)}${battlesCard(p)}${conditionsRail(p)}${h2hRail(p, ctx)}${ctaRail(ctx)}</aside>` +
    `</div>` +
    `</div>` +
    tail
  );
}
