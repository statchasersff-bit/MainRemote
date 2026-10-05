/**
 * Markup for the team hub's Usage & Opportunity Report.
 *
 * Server-rendered in full, like the rest of the hub: the week in the freshness
 * chip, every trail and every number is in the HTML the server sends, because
 * the weekly change IS the recrawl signal the spec asks for. The client bundle
 * only wires the + / − toggles (client/team.ts), and with scripting off every
 * advanced profile simply shows, expanded (see .sct-us-detail in team.css).
 *
 * Components, in the spec's order: header + freshness chip, intro, offensive
 * environment strip, the target tree, the backfield split (with run direction),
 * the pass-location map, the player table with expandable profiles, the
 * legend, the signal cards, and the closing paragraph. A component whose data
 * is missing is left out; the section as a whole is left out when the club has
 * no usage file entry, so the tab is never a set of empty cards.
 */

import { escapeHtml } from "../render";
import { slotChip } from "../team-render";
import { getPlayerPageUrl } from "./links";
import {
  BUY_LOW_SELL_HIGH_URL,
  DYNASTY_COMMAND_URL,
  DYNASTY_RANKINGS_URL,
  DYNASTY_TRADE_CALCULATOR_URL,
  PROJECTIONS_URL,
  RB_HANDCUFF_RANKINGS_URL,
  ROS_RANKINGS_URL,
  TRADE_CALCULATOR_URL,
  TRADE_FINDER_URL,
  WAIVER_WIRE_URL,
} from "../matchup/recap";
import type { NflTeam } from "./teams";
import { usageFaq, type UsageFaq } from "./usage-faq";
import {
  getTargetShareCliff,
  surname,
  type RunGap,
  type Trend,
  type UsagePlayer,
  type UsageRow,
  type UsageView,
  type Zone,
} from "./usage";
import {
  GAP_LABEL,
  TIER_LABEL,
  ZONE_LABEL,
  backfieldChips,
  backfieldTakeaways,
  bestGap,
  bestZone,
  environmentCards,
  passNote,
  profileNote,
  rankLine,
  roleLine,
  runNote,
  signalCopy,
  signed,
  situationShare,
  woprCaption,
  zoneOwner,
} from "./usage-copy";

export const REDRAFT_COMMAND_URL = "https://statchasers.com/redraft-command/";

const e = escapeHtml;

/* ------------------------------------------------------------------ colour */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `hex` mixed toward white by `amount` (0–1). */
function tint(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Ink that reads on `bg`. The coaching tab's coach card borrows it. */
export function inkOn(bg: string): string {
  return luminance(bg) > 0.4 ? "#0b1220" : "#ffffff";
}

const GOLD = "#d4af37";
const GRAYS = ["#94a3b8", "#cbd5e1", "#e2e8f0"];

/**
 * The segment palette: primary, a tint of it, secondary, a tint of that, the
 * StatChasers gold, then grays for depth.
 *
 * A secondary that cannot carry a segment - white (Colts, Jets), black
 * (Bengals), or near the primary - is swapped for a darkened tint of the
 * primary's complement in the house palette, so every club still gets four
 * distinguishable data colours.
 */
export function segmentPalette(team: NflTeam): string[] {
  const primary = team.primaryColor;
  let secondary = team.secondaryColor;
  const l = luminance(secondary);
  if (l > 0.8 || l < 0.02 || distance(primary, secondary) < 90) secondary = "#475569";
  return [primary, tint(primary, 0.45), secondary, tint(secondary, 0.45), GOLD, ...GRAYS];
}

/* ------------------------------------------------------------------- atoms */

function num(value: string, extra = ""): string {
  return `<span class="sct-us-num${extra ? ` ${extra}` : ""}">${e(value)}</span>`;
}

function h3(text: string): string {
  return `<h3 class="sct-us-h3">${e(text)}</h3>`;
}

function playerLink(p: UsagePlayer, className: string): string {
  const href = getPlayerPageUrl(p.slug);
  return href
    ? `<a class="${className} sct-player-link" href="${e(href)}" target="_top">${e(p.name)}</a>`
    : `<span class="${className}">${e(p.name)}</span>`;
}

/* --------------------------------------------------------- product bridges */

/*
 * Where the report hands off to a tool (mak, 2026-10-05): each section links
 * the tool that answers its own next question - rankings after the Target
 * Tree, waivers and (quietly) dynasty after the handcuff math, trades after
 * Buy Low / Sell High, projections after xFP, the matchup preview after the
 * pass map - and the close puts both Commands side by side. Roughly 3:1
 * redraft to dynasty: dynasty only where the question is succession or
 * long-term role. A tool whose address is not confirmed (null in
 * matchup/recap.ts) drops its link, and a line left with no link drops too.
 */

/** Where the report can send a reader next, decided by the page around it. */
export interface UsageLinks {
  /** This club's next matchup page, when the schedule has one. */
  matchup: { href: string; opponent: string } | null;
}

/**
 * `target="_top"` only for the site's absolute tool URLs: the hub's own
 * root-relative pages (the matchup preview) stay plain anchors like the tab
 * nav, since a sandboxed preview frame blocks a top-frame navigation outright.
 */
const topTarget = (href: string) => (/^https?:/.test(href) ? ` target="_top"` : "");

function tool(href: string | null, text: string, cta: string): string {
  return href
    ? `<a class="sct-textlink" href="${e(href)}"${topTarget(href)} data-cta="${e(cta)}">${e(text)}</a>`
    : "";
}

/** A one-line handoff under a section: the question in bold, then the link. */
function bridge(lead: string, html: string, quiet = false): string {
  return html ? `<p class="sct-us-bridge${quiet ? " is-quiet" : ""}"><strong>${e(lead)}</strong> ${html}</p>` : "";
}

interface Segment {
  label: string;
  short: string;
  share: number;
  color: string;
  title: string;
}

/** A 100% stacked bar and its legend. The Target Tree and the backfield share it. */
function stackedBar(segments: Segment[], ariaLabel: string, legendTail = ""): string {
  const shown = segments.filter((s) => s.share > 0);
  const bar = shown
    .map((s) => {
      const ink = inkOn(s.color);
      return (
        `<span class="sct-us-seg" style="flex:${s.share.toFixed(2)} 1 0;background:${s.color};color:${ink}" title="${e(s.title)}">` +
        (s.share >= 5 ? `<span class="sct-us-seg-pct">${e(`${s.share.toFixed(1)}%`)}</span>` : "") +
        (s.share >= 9 ? `<span class="sct-us-seg-name">${e(s.short)}</span>` : "") +
        `</span>`
      );
    })
    .join("");
  const legend = shown
    .map(
      (s) =>
        `<li class="sct-us-key"><span class="sct-us-swatch" style="background:${s.color}" aria-hidden="true"></span>` +
        `${e(s.label)} <span class="sct-us-key-val">${e(`${s.share.toFixed(1)}%`)}</span></li>`,
    )
    .join("");
  return (
    `<div class="sct-us-bar" role="img" aria-label="${e(ariaLabel)}">${bar}</div>` +
    `<ul class="sct-us-keys">${legend}${legendTail ? `<li class="sct-us-key is-def">${e(legendTail)}</li>` : ""}</ul>`
  );
}

/* -------------------------------------------------------------- components */

function header(view: UsageView): string {
  return (
    `<div class="sct-us-head">` +
    `<h2 class="sct-h2">Usage &amp; Opportunity Report</h2>` +
    `<p class="sct-us-fresh"><span class="sct-us-live" aria-hidden="true"></span>` +
    `Updated through Week ${view.throughWeek} · refreshed daily</p>` +
    `</div>`
  );
}

/**
 * The intro, in mak's wording (2026-10-03). The cliff paragraph keeps its
 * numbers live from our own 2017-2025 measurement
 * (data/team/target_share_cliff.json), and is left out if that file is.
 */
function intro(): string {
  const cliff = getTargetShareCliff();
  const paras = [
    "Fantasy production follows opportunity, not the other way around. That is why this report focuses on who is actually on the field and where the ball is going before the box score catches up.",
    "The essentials are target share, snap share, and red-zone touches. Expand a player profile for deeper usage metrics including first-read share, air-yards share, expected fantasy points (xFP), and fantasy points over expected (FPOE). xFP measures the fantasy value of a player's opportunities, while FPOE shows how far his actual production finished above or below that expectation.",
    "When route data is available, we also track route share, targets per route run (TPRR), and yards per route run (YPRR). These help separate players who are simply on the field from players who are actually earning opportunities when they run routes.",
    ...(cliff
      ? [
          `Since ${cliff.seasons.slice(0, 4)}, receivers with a 20%+ target share have averaged ${cliff.above20.ppg} fantasy points per game, compared with ${cliff.from10to20.ppg} for receivers between 10–20%. That gap is why this report exists.`,
        ]
      : []),
    "Follow the opportunity before the fantasy points follow it.",
  ];
  return `<div class="sct-us-intro">${paras.map((t) => `<p>${e(t)}</p>`).join("")}</div>`;
}

function introCta(): string {
  return (
    `<div class="sct-us-cta">` +
    `<p class="sct-us-cta-title">Turn usage into a roster decision</p>` +
    `<p class="sct-us-cta-body">Redraft Command uses these same opportunity trends alongside projections and market data to update player values, lineup decisions, trades and waiver recommendations for your league.</p>` +
    `<a class="sct-us-btn" href="${e(REDRAFT_COMMAND_URL)}" target="_top" data-cta="redraft-command-usage-intro">Open Redraft Command</a>` +
    `</div>`
  );
}

/**
 * "RB1, 48% of RB touches", with the slot as the hub's position chip - the
 * one Depth Chart, News and the Outlook cards print, so a position wears the
 * same colour on every tab. A role that is not a plain slot stays text.
 */
function roleCell(row: UsageRow): string {
  const line = roleLine(row);
  const slot = /^[A-Z]{1,3}\d+$/.test(row.role) && line.startsWith(row.role) ? row.role : "";
  if (!slot) return `<span class="sct-us-role">${e(line)}</span>`;
  const rest = line.slice(slot.length).replace(/^\s*[,·]\s*/, "");
  return (
    `<span class="sct-us-role">${slotChip(slot, true)}` +
    (rest ? ` <span>${e(rest)}</span>` : "") +
    `</span>`
  );
}

function environment(view: UsageView): string {
  const cards = environmentCards(view);
  if (cards.length === 0) return "";
  return (
    `<ul class="sct-us-env" aria-label="Offensive environment">` +
    cards
      .map(
        (c) =>
          `<li class="sct-us-envcard">` +
          `<span class="sct-us-label">${e(c.label)}</span>` +
          num(c.value, "is-big") +
          `<span class="sct-us-rank ${c.good ? "is-good" : "is-context"}">${e(c.rank)}</span>` +
          `<span class="sct-us-envnote">${e(c.note)}</span>` +
          `</li>`,
      )
      .join("") +
    `</ul>`
  );
}

function targetTree(view: UsageView, team: NflTeam): string {
  const tgt = view.team.targets;
  if (!tgt) return "";
  const palette = segmentPalette(team);
  const receivers = [...view.all].filter((p) => p.targets > 0).sort((a, b) => b.targets - a.targets);
  const top = receivers.slice(0, 5);
  const next = receivers.slice(5, 8);
  const rest = receivers.slice(8);
  const share = (n: number) => (100 * n) / tgt;
  const segs: Segment[] = top.map((p, i) => ({
    label: p.name,
    short: surname(p.name),
    share: share(p.targets),
    color: palette[i]!,
    title: `${p.name} - ${share(p.targets).toFixed(1)}% target share`,
  }));
  const sum = (ps: UsagePlayer[]) => ps.reduce((s, p) => s + p.targets, 0);
  if (next.length) {
    const names = next.map((p) => surname(p.name)).join("/");
    segs.push({ label: names, short: names, share: share(sum(next)), color: palette[5]!, title: `${names} - ${share(sum(next)).toFixed(1)}% target share` });
  }
  if (rest.length) {
    segs.push({ label: "Everyone else", short: "Others", share: share(sum(rest)), color: palette[6]!, title: `Everyone else - ${share(sum(rest)).toFixed(1)}% target share` });
  }
  return (
    `<div class="sct-us-card">` +
    h3("The Target Tree") +
    `<p class="sct-us-sub">${e(`All ${tgt} ${team.nickname} targets through Week ${view.throughWeek}`)}</p>` +
    stackedBar(segs, `${team.nickname} target shares: ${segs.map((s) => `${s.label} ${s.share.toFixed(1)}%`).join(", ")}`) +
    bridge(
      "What are these targets worth?",
      `See how changing target shares show up in our ${tool(ROS_RANKINGS_URL, "Rest-of-Season Rankings", "ros-rankings-usage-tree")}.`,
    ) +
    `</div>`
  );
}

const SITUATIONS: Array<[keyof UsagePlayer["situation"], string]> = [
  ["early", "Early downs"],
  ["third", "Third down"],
  ["rz", "Red zone (in-20)"],
  ["in10", "Inside the 10"],
  ["twoMin", "Two-minute drill"],
  ["trailing", "Trailing by 7+"],
];

function backfield(view: UsageView, team: NflTeam): string {
  const rbs = view.rbs.filter((p) => p.wopp > 0);
  if (rbs.length === 0) return "";
  const shown = rbs.slice(0, 3);
  const palette = segmentPalette(team);
  const total = rbs.reduce((s, p) => s + p.wopp, 0);
  const others = rbs.slice(3);
  const segs: Segment[] = shown.map((p, i) => ({
    label: p.name,
    short: surname(p.name),
    share: (100 * p.wopp) / total,
    color: palette[[0, 2, 4][i]!]!,
    title: `${p.name} - ${((100 * p.wopp) / total).toFixed(1)}% of weighted opportunities`,
  }));
  if (others.length) {
    const w = others.reduce((s, p) => s + p.wopp, 0);
    segs.push({ label: "Other backs", short: "Others", share: (100 * w) / total, color: palette[5]!, title: `Other backs - ${((100 * w) / total).toFixed(1)}%` });
  }
  const bar = stackedBar(
    segs,
    `${team.nickname} weighted opportunities: ${segs.map((s) => `${s.label} ${s.share.toFixed(1)}%`).join(", ")}`,
  );

  // The grid: highest share in each row is the owner, in green.
  const totals = view.team.rbSituationTotals;
  const grid =
    `<div class="sct-us-grid" role="table" aria-label="Share of the running backs' carries plus targets, by situation" style="--us-cols:${shown.length}">` +
    `<div class="sct-us-grow is-head" role="row"><span role="columnheader">Situation</span>` +
    shown.map((p) => `<span role="columnheader">${e(surname(p.name))}</span>`).join("") +
    `</div>` +
    SITUATIONS.map(([key, label]) => {
      const values = shown.map((p) => situationShare(view, p, key));
      const max = Math.max(...values.map((v) => v ?? -1));
      return (
        `<div class="sct-us-grow" role="row"><span class="sct-us-gsit" role="rowheader">${e(label)}` +
        `<span class="sct-us-gn">${e(`${totals[key]} opps`)}</span></span>` +
        values
          .map((v, i) => {
            if (v == null) return `<span class="sct-us-gcell" role="cell">–</span>`;
            const owner = v === max && v > 0;
            return (
              `<span class="sct-us-gcell${owner ? " is-owner" : ""}" role="cell" title="${e(`${shown[i]!.name}: ${shown[i]!.situation[key]} of ${totals[key]}`)}">` +
              `<span class="sct-us-gbar"><span style="width:${v}%"></span></span>` +
              `<span class="sct-us-gval">${v}%</span></span>`
            );
          })
          .join("") +
        `</div>`
      );
    }).join("") +
    `</div>` +
    `<p class="sct-us-fine">Share of the backs' carries + targets in each situation. Snap-by-snap splits need the league's participation data, which is published after the season.</p>`;

  const chips = backfieldChips(view);
  const chipHtml = chips.length
    ? `<ul class="sct-us-chips">` +
      chips.map((c) => `<li class="sct-us-chip">${num(c.value)}<span>${e(c.caption)}</span></li>`).join("") +
      `</ul>`
    : "";

  const takeaways = backfieldTakeaways(view);
  const takeawayHtml = takeaways.length
    ? `<div class="sct-us-takeaways">` +
      takeaways.map((t) => `<p class="sct-us-takeaway"><strong>${e(t.lead)}</strong> ${e(t.body)}</p>`).join("") +
      `</div>`
    : "";

  // The handcuff takeaway names the two backs: "The Henderson math if
  // Stevenson misses time:". No takeaway, no handoff.
  const cuff = takeaways.map((t) => t.lead.match(/^The (.+) math if (.+) misses time:$/)).find(Boolean);
  const byName = (last: string) => view.rbs.find((p) => surname(p.name) === last);
  const rb2 = cuff ? byName(cuff[1]!) : undefined;
  const rb1 = cuff ? byName(cuff[2]!) : undefined;
  const handoff =
    rb1 && rb2
      ? bridge(
          "Need the handcuff?",
          WAIVER_WIRE_URL
            ? `Check whether ${e(rb2.name)} is available in your leagues with the ${tool(WAIVER_WIRE_URL, "Waiver Wire Scanner", "waiver-wire-usage-handcuff")}.`
            : `See where ${e(rb2.name)} ranks in our ${tool(RB_HANDCUFF_RANKINGS_URL, "RB Handcuff Rankings", "rb-handcuffs-usage-handcuff")}.`,
        ) +
        // Succession is a dynasty question, so this is where Dynasty Command
        // earns a link - a quieter one, under the redraft action.
        (DYNASTY_RANKINGS_URL && DYNASTY_TRADE_CALCULATOR_URL
          ? bridge(
              "Thinking longer term?",
              `Compare ${e(rb1.name)} and ${e(rb2.name)} in ${tool(DYNASTY_RANKINGS_URL, "Dynasty Rankings", "dynasty-rankings-usage-handcuff")} or price a deal in the ${tool(DYNASTY_TRADE_CALCULATOR_URL, "Dynasty Trade Calculator", "dynasty-trade-calc-usage-handcuff")}.`,
              true,
            )
          : bridge(
              "Thinking longer term?",
              DYNASTY_COMMAND_URL
                ? `Weigh ${e(rb1.name)}'s and ${e(rb2.name)}'s future roles in ${tool(DYNASTY_COMMAND_URL, "Dynasty Command", "dynasty-command-usage-handcuff")}.`
                : "",
              true,
            ))
      : "";

  return (
    `<div class="sct-us-card">` +
    h3("The Backfield Split") +
    `<p class="sct-us-sub">Who gets the backfield's work - weighted opportunities count a target as two carries, a better view of RB opportunity than raw touches alone.</p>` +
    bar +
    grid +
    chipHtml +
    takeawayHtml +
    handoff +
    runDirection(view) +
    `</div>`
  );
}

const GAPS: RunGap[] = ["LE", "LT", "MID", "RT", "RE"];

function runDirection(view: UsageView): string {
  const runs = view.team.runs;
  const total = GAPS.reduce((s, g) => s + runs[g].att, 0);
  if (total < 10) return "";
  const best = bestGap(view);
  const cells = GAPS.map((g) => {
    const r = runs[g];
    return (
      `<li class="sct-us-gap${g === best ? " is-best" : ""}">` +
      num(r.ypc != null ? r.ypc.toFixed(1) : "–", "is-big") +
      `<span class="sct-us-gap-att">${e(`${r.att} att`)}</span>` +
      `<span class="sct-us-label">${e(GAP_LABEL[g])}</span>` +
      `</li>`
    );
  }).join("");
  const note = runNote(view);
  return (
    `<div class="sct-us-run">` +
    `<h4 class="sct-us-h4">Run Direction - carries &amp; yards per carry by gap</h4>` +
    `<ul class="sct-us-line" aria-hidden="true"><li>LT</li><li>LG</li><li>C</li><li>RG</li><li>RT</li></ul>` +
    `<ul class="sct-us-gaps">${cells}</ul>` +
    `<p class="sct-us-fine">Designed runs only; "Middle" includes runs behind either guard.</p>` +
    (note ? `<p class="sct-us-note">${e(note)}</p>` : "") +
    `</div>`
  );
}

const ZONES: Zone[][] = [
  ["DL", "DM", "DR"],
  ["SL", "SM", "SR"],
];

function passMap(view: UsageView, team: NflTeam, links: UsageLinks): string {
  const zones = view.team.zones;
  const all = Object.values(zones).reduce((s, z) => s + (z?.att ?? 0), 0);
  if (all < 20) return "";
  const qb = view.qb;
  const qbName = qb ? surname(qb.name) : "The offense";
  const best = bestZone(view);
  const maxShare = Math.max(...Object.values(zones).map((z) => z?.share ?? 0), 1);
  const cell = (k: Zone) => {
    const z = zones[k];
    const share = z?.share ?? 0;
    const owner = zoneOwner(view, k);
    // Heat: a team-colour tint weighted by volume. The gold zone overrides it.
    const alpha = (0.05 + 0.3 * (share / maxShare)).toFixed(2);
    return (
      `<li class="sct-us-zone${k === best ? " is-best" : ""}"` +
      (k === best ? "" : ` style="background:color-mix(in srgb, var(--team-primary) ${Math.round(Number(alpha) * 100)}%, var(--sc-surface))"`) +
      `>` +
      num(`${share}%`, "is-big") +
      `<span class="sct-us-zone-ypa">${e(z?.ypa != null ? `${z.ypa.toFixed(1)} YPA` : "no attempts")}</span>` +
      `<span class="sct-us-label">${e(ZONE_LABEL[k])}${owner ? ` · ${e(owner)}` : ""}</span>` +
      `</li>`
    );
  };
  const note = passNote(view, qbName, team.nickname);
  return (
    `<div class="sct-us-card">` +
    h3(`Where ${qbName} Attacks`) +
    `<p class="sct-us-sub">${e(`Share of ${qbName}'s ${view.team.passerZoneAttempts ? `${view.team.passerZoneAttempts} mapped ` : ""}pass attempts & yards per attempt by field zone - through Week ${view.throughWeek}`)}</p>` +
    `<div class="sct-us-field">` +
    `<ul class="sct-us-zones">${ZONES[0]!.map(cell).join("")}</ul>` +
    `<p class="sct-us-los"><span>Line of scrimmage · deep = 20+ air yards</span></p>` +
    `<ul class="sct-us-zones">${ZONES[1]!.map(cell).join("")}</ul>` +
    `</div>` +
    (note ? `<p class="sct-us-note">${e(note)}</p>` : "") +
    (links.matchup
      ? bridge(
          "What comes next?",
          `See how this usage profile lines up with the ${e(links.matchup.opponent)} in the ${tool(links.matchup.href, `${team.nickname} Fantasy Matchup Preview`, "matchup-preview-usage-passmap")}.`,
        )
      : "") +
    `</div>`
  );
}

/* ------------------------------------------------------------------- table */

function sparkline(t: Trend, unit: string): string {
  const values = t.trail;
  const known = values.filter((v): v is number => v != null);
  if (known.length === 0) return "";
  const max = Math.max(...known, 1);
  const raw = values.map((v, i) => `W${t.trailWeeks[i]} ${v == null ? "DNP" : `${v}${unit}`}`).join(" · ");
  const bars = values
    .map((v, i) => {
      const h = v == null ? 4 : Math.max(8, Math.round((100 * v) / max));
      return `<span class="sct-us-spark-bar${i === values.length - 1 ? " is-last" : ""}${v == null ? " is-dnp" : ""}" style="height:${h}%"></span>`;
    })
    .join("");
  return `<span class="sct-us-spark is-${t.direction}" role="img" aria-label="${e(raw)}" title="${e(raw)}">${bars}</span>`;
}

function deltaCaption(t: Trend, places: number): string {
  if (t.delta == null || t.baseWeek == null) return "";
  if (t.direction === "flat") return `<span class="sct-us-delta is-flat">steady</span>`;
  return `<span class="sct-us-delta is-${t.direction}">${e(`${signed(t.delta, places)} vs W${t.baseWeek}`)}</span>`;
}

function shareCell(value: number | null, t: Trend, places: number): string {
  if (value == null) return `<td class="sct-us-td">–</td>`;
  return (
    `<td class="sct-us-td"><div class="sct-us-share">` +
    `<span>${num(`${value.toFixed(places)}%`, "is-mid")}${deltaCaption(t, places)}</span>` +
    sparkline(t, "%") +
    `</div></td>`
  );
}

function woprCell(p: UsagePlayer): string {
  if (p.pos === "WR" || p.pos === "TE") {
    const w = p.wopr ?? 0;
    const line = p.pos === "TE" ? 0.45 : 0.6;
    const scale = 0.9;
    return (
      `<td class="sct-us-td">` +
      `${num(w.toFixed(2), "is-wopr")}<span class="sct-us-cap">${e(woprCaption(p))}</span>` +
      `<span class="sct-us-gauge" role="img" aria-label="${e(`WOPR ${w.toFixed(2)}; elite line ${line.toFixed(2)}`)}">` +
      `<span class="sct-us-gauge-fill" style="width:${Math.min(100, (100 * w) / scale).toFixed(0)}%"></span>` +
      `<span class="sct-us-gauge-mark" style="left:${((100 * line) / scale).toFixed(1)}%"></span></span>` +
      `</td>`
    );
  }
  const caption = p.pos === "QB" ? "every dropback" : `touch share ${p.touchShare ?? 0}%`;
  const width = p.pos === "QB" ? 100 : (p.touchShare ?? 0);
  return (
    `<td class="sct-us-td">${num("-", "is-wopr")}<span class="sct-us-cap">${e(caption)}</span>` +
    `<span class="sct-us-gauge is-plain" role="img" aria-label="${e(caption)}"><span class="sct-us-gauge-fill" style="width:${width}%"></span></span></td>`
  );
}

function rzCell(row: UsageRow): string {
  const p = row.player;
  const trail = row.rz.trail.map((v) => (v == null ? "–" : String(v))).join(" · ");
  const rising = row.rz.direction === "up";
  return (
    `<td class="sct-us-td">${num(String(p.rzTouches), "is-mid")}${rising ? `<span class="sct-us-up" aria-label="rising"> ▲</span>` : ""}` +
    `<span class="sct-us-cap">${e(trail)}${row.leadsRz ? " - leads team" : ""}</span></td>`
  );
}

interface Metric {
  label: string;
  value: string | null;
  pct: number | null;
  tone?: "hot" | "cold" | "neutral";
}

function tone(pct: number | null): "hot" | "cold" | "neutral" {
  if (pct == null) return "neutral";
  if (pct >= 67) return "hot";
  if (pct <= 33) return "cold";
  return "neutral";
}

const fmt = (v: number | null | undefined, suffix = "", places = 1) =>
  v == null ? null : `${v.toFixed(places)}${suffix}`;

function metricsFor(row: UsageRow, view: UsageView): Metric[] {
  const p = row.player;
  const q = p.pct;
  if (p.pos === "WR" || p.pos === "TE") {
    const adotTone = (p.adot ?? 0) >= 13.5 ? "cold" : "neutral";
    return [
      { label: "First-read share", value: fmt(p.firstReadShare, "%"), pct: q.firstReadShare ?? null },
      { label: "Air-yards share", value: fmt(p.airYardsShare, "%"), pct: q.airYardsShare ?? null },
      { label: "aDOT", value: fmt(p.adot), pct: q.adot ?? null, tone: adotTone },
      { label: "End-zone targets", value: String(p.ezTargets), pct: q.ezTargets ?? null },
      { label: "xFP / game", value: fmt(p.xfpPerGame), pct: q.xfpPerGame ?? null },
      { label: "FPOE / game", value: p.fpoePerGame == null ? null : signed(p.fpoePerGame), pct: q.fpoePerGame ?? null },
    ];
  }
  if (p.pos === "RB") {
    return [
      { label: "Touch share (RB room)", value: fmt(p.touchShare, "%", 0), pct: q.touchShare ?? null },
      { label: "Red-zone share (RB room)", value: fmt(p.rzOppShare, "%", 0), pct: q.rzOppShare ?? null },
      { label: "Green-zone carries (in-10)", value: String(p.gzCarries), pct: q.gzCarries ?? null },
      { label: "Target share", value: fmt(p.targetShare, "%"), pct: q.targetShare ?? null },
      { label: "Weighted opps / active game", value: fmt(p.woppPerGame), pct: q.woppPerGame ?? null },
      { label: "xFP / game", value: fmt(p.xfpPerGame), pct: q.xfpPerGame ?? null },
      { label: "FPOE / game", value: p.fpoePerGame == null ? null : signed(p.fpoePerGame), pct: q.fpoePerGame ?? null },
      { label: "Yards after contact / att", value: fmt(p.yacPerAtt), pct: q.yacPerAtt ?? null },
    ];
  }
  const in10 = view.team.env.in10PassRate;
  return [
    { label: "Green-zone carries (in-10)", value: String(p.gzCarries), pct: q.gzCarries ?? null },
    { label: "Designed-run rate", value: fmt(p.designedRunRate, "%"), pct: q.designedRunRate ?? null },
    { label: "Scramble rate", value: fmt(p.scrambleRate, "%"), pct: q.scrambleRate ?? null },
    { label: "aDOT", value: fmt(p.passAdot), pct: q.passAdot ?? null, tone: "neutral" },
    { label: "xFP / game", value: fmt(p.xfpPerGame), pct: q.xfpPerGame ?? null },
    { label: "FPOE / game", value: p.fpoePerGame == null ? null : signed(p.fpoePerGame), pct: q.fpoePerGame ?? null },
    { label: "Sack rate", value: fmt(p.sackRate, "%"), pct: q.sackRate ?? null },
    {
      label: "Team pass rate inside the 10",
      value: fmt(in10.value, "%", 0),
      pct: in10.rank != null ? Math.round((100 * (32 - in10.rank)) / 31) : null,
    },
  ];
}

function detailRow(row: UsageRow, view: UsageView, id: string): string {
  const metrics = metricsFor(row, view).filter((m) => m.value != null);
  const note = profileNote(row, view);
  const pos = row.player.pos;
  const blocks = metrics
    .map((m) => {
      const t = m.tone ?? tone(m.pct);
      const label = m.pct == null ? "" : `${m.pct}th percentile vs. NFL ${pos}s`;
      return (
        `<li class="sct-us-metric">` +
        `<span class="sct-us-metric-top"><span class="sct-us-metric-label">${e(m.label)}</span>${num(m.value!)}</span>` +
        (m.pct != null
          ? `<span class="sct-us-pbar is-${t}" role="img" aria-label="${e(label)}" title="${e(label)}"><span style="width:${Math.max(3, m.pct)}%"></span></span>`
          : "") +
        `</li>`
      );
    })
    .join("");
  return (
    `<tr class="sct-us-detail" id="${e(id)}" hidden>` +
    `<td colspan="7" class="sct-us-td">` +
    `<ul class="sct-us-metrics">${blocks}</ul>` +
    `<p class="sct-us-pnote"><strong>${e(note.thesis)}</strong>${e(note.body)}</p>` +
    `</td></tr>`
  );
}

function table(view: UsageView, team: NflTeam): string {
  if (view.rows.length === 0) return "";
  const rows = view.rows
    .map((row) => {
      const p = row.player;
      const id = `usage-${team.abbreviation}-${p.id.replace(/[^a-z0-9]/gi, "")}`;
      const rank = rankLine(p);
      const tsCell =
        p.pos === "QB"
          ? `<td class="sct-us-td">${num("-", "is-mid")}<span class="sct-us-cap">the passer</span></td>`
          : shareCell(p.targetShare, row.ts, 1);
      return (
        `<tr class="sct-us-row">` +
        `<td class="sct-us-td is-toggle"><button type="button" class="sct-us-toggle" aria-expanded="false" aria-controls="${e(id)}"` +
        ` aria-label="${e(`Show ${p.name}'s advanced profile`)}"><span aria-hidden="true">+</span></button></td>` +
        `<th scope="row" class="sct-us-td is-player">${playerLink(p, "sct-us-name")}` +
        roleCell(row) +
        (rank ? `<span class="sct-us-lrank">${e(rank)}</span>` : "") +
        `</th>` +
        woprCell(p) +
        tsCell +
        shareCell(p.snapShare, row.snap, 0) +
        rzCell(row) +
        `<td class="sct-us-td"><span class="sct-us-tier is-${row.tier}">${e(TIER_LABEL[row.tier])}</span></td>` +
        `</tr>` +
        detailRow(row, view, id)
      );
    })
    .join("");
  return (
    `<div class="sct-us-scroll" tabindex="0" role="region" aria-label="${e(`${team.nickname} player usage`)}">` +
    `<table class="sct-us-table">` +
    `<thead><tr>` +
    `<th scope="col" class="sct-us-th"><span class="sct-us-sr">Profile</span></th>` +
    `<th scope="col" class="sct-us-th">Player</th>` +
    `<th scope="col" class="sct-us-th">Opportunity (WOPR)</th>` +
    `<th scope="col" class="sct-us-th">Target share</th>` +
    `<th scope="col" class="sct-us-th">Snap share</th>` +
    `<th scope="col" class="sct-us-th">RZ opportunities</th>` +
    `<th scope="col" class="sct-us-th">Read</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div>`
  );
}

function projectionsBridge(view: UsageView): string {
  // A big opportunity/production gap is exactly what the buy/sell board prices.
  const gap = view.rows.some((r) => Math.abs(r.player.fpoePerGame ?? 0) >= 3);
  return bridge(
    "Compare opportunity with what comes next:",
    `see current weekly and rest-of-season expectations in ${tool(PROJECTIONS_URL, "Fantasy Football Projections", "projections-usage-xfp")}.` +
      (gap && BUY_LOW_SELL_HIGH_URL
        ? ` Large opportunity/production gaps also feed the ${tool(BUY_LOW_SELL_HIGH_URL, "Buy Low & Sell High board", "blsh-usage-xfp")}.`
        : ""),
  );
}

function legend(): string {
  const items: Array<[string, string, string]> = [
    ["set", "Set & forget", "20%+ target share or locked bell-cow role - start everywhere"],
    ["starter", "Starter", "17–19% target share or a lead back's full workload - weekly lineup play"],
    ["flex", "Flex", "15–16% share or a committee lead - matchup-dependent"],
    ["volatile", "Volatile", "under 15% - deep leagues only"],
    ["stash", "Stash", "the role behind the role"],
    ["", "WOPR", "1.5 × target share + 0.7 × air-yards share"],
    ["", "+ button", "opens the full advanced profile - first-read share, air-yards share, xFP/FPOE - with percentile bars vs. the league"],
  ];
  return (
    `<details class="sct-us-key-help">` +
    `<summary class="sct-us-key-sum">How to read this table</summary>` +
    `<ul class="sct-us-legend">` +
    items
      .map(
        ([tier, label, text]) =>
          `<li>${tier ? `<span class="sct-us-tier is-${tier}">${e(label)}</span>` : `<strong>${e(label)}:</strong>`} ${e(text)}</li>`,
      )
      .join("") +
    `</ul></details>`
  );
}

function signals(view: UsageView): string {
  if (view.signals.length === 0) return "";
  return (
    `<div class="sct-us-signals">` +
    view.signals
      .map((s) => {
        const c = signalCopy(s);
        return (
          `<article class="sct-us-signal is-${s.kind}">` +
          `<p class="sct-us-kind">${e(c.label)}</p>` +
          `<h3 class="sct-us-h3">${playerLink(s.row.player, "sct-us-signal-name")}</h3>` +
          `<p class="sct-us-signal-body">${e(c.body)}</p>` +
          `<ul class="sct-us-proof">` +
          c.proof.map((pr) => `<li>${num(pr.value, "is-mid")}<span>${e(pr.caption)}</span></li>`).join("") +
          `</ul></article>`
        );
      })
      .join("") +
    `</div>`
  );
}

function tradeBlock(view: UsageView): string {
  const names = view.signals
    .filter((s) => s.kind === "buy" || s.kind === "sell")
    .map((s) => surname(s.row.player.name));
  if (names.length === 0) return "";
  const who = names.length > 1 ? `${names[0]} or ${names[1]}` : names[0]!;
  return (
    `<div class="sct-us-cta is-trade">` +
    `<p class="sct-us-cta-title">Turn the usage signal into a trade</p>` +
    `<p class="sct-us-cta-body">Check ${e(who)} in the ${tool(TRADE_CALCULATOR_URL, "Fantasy Football Trade Analyzer", "trade-analyzer-usage-signals")} to see current value, compare both sides of a deal and measure the impact on your actual roster.` +
    (TRADE_FINDER_URL ? ` Not sure what offer to make? Use the ${tool(TRADE_FINDER_URL, "Trade Finder", "trade-finder-usage-signals")} to find realistic partners and packages in your league.` : "") +
    `</p>` +
    (BUY_LOW_SELL_HIGH_URL
      ? `<p class="sct-us-cta-more">See every current riser and faller on the ${tool(BUY_LOW_SELL_HIGH_URL, "Buy Low, Sell High & Trade Targets", "blsh-usage-signals")} board.</p>`
      : "") +
    `</div>`
  );
}

/**
 * The close: the line on how usage feeds our pricing, then both Commands side
 * by side with what each does with this data, then a row of direct tools.
 * It stands in for the hub's shared "Use this research" block, which the
 * Usage tab hides.
 */
function conversion(view: UsageView, team: NflTeam, links: UsageLinks): string {
  const product = (title: string, lead: string, items: string[], href: string | null, cta: string) =>
    href
      ? `<article class="sct-us-product">` +
        `<p class="sct-us-product-title">${e(title)}</p>` +
        `<p class="sct-us-product-lead">${e(lead)}</p>` +
        `<ul class="sct-us-product-list">${items.map((i) => `<li>${e(i)}</li>`).join("")}</ul>` +
        `<a class="sct-us-btn" href="${e(href)}" target="_top" data-cta="${e(cta)}">${e(`Open ${title}`)}</a>` +
        `</article>`
      : "";
  const row = [
    tool(TRADE_CALCULATOR_URL, "Trade Analyzer", "trade-analyzer-usage-footer"),
    tool(WAIVER_WIRE_URL, "Waiver Wire", "waiver-wire-usage-footer"),
    tool(ROS_RANKINGS_URL, "Rest of Season Rankings", "ros-rankings-usage-footer"),
    links.matchup ? tool(links.matchup.href, `${team.nickname} Matchup Preview`, "matchup-preview-usage-footer") : "",
  ].filter(Boolean);
  return (
    `<div class="sct-us-convert">` +
    `<h3 class="sct-us-h3">Put this usage data to work</h3>` +
    closing(view) +
    `<div class="sct-us-products">` +
    product(
      "Redraft Command",
      "Use current usage, projections and player values against your actual roster for:",
      ["Lineup decisions", "Trades", "Waivers", "Rest-of-season value"],
      REDRAFT_COMMAND_URL,
      "redraft-command-usage-footer",
    ) +
    product(
      "Dynasty Command",
      "Use current role changes alongside long-term values for:",
      ["Dynasty rankings", "Dynasty trades", "Roster direction", "Future picks"],
      DYNASTY_COMMAND_URL,
      "dynasty-command-usage-footer",
    ) +
    `</div>` +
    (row.length ? `<p class="sct-us-toolrow">${row.join(`<span aria-hidden="true"> · </span>`)}</p>` : "") +
    `</div>`
  );
}

function closing(view: UsageView): string {
  const riser = view.signals.find((s) => s.kind === "buy")?.row.player;
  return (
    `<p class="sct-us-close">Usage trends are one of the core inputs behind our player pricing - ` +
    `<a class="sct-textlink" href="${e(REDRAFT_COMMAND_URL)}" target="_top">Redraft Command</a> ` +
    `re-runs every player's value as these shares move, so ${riser ? `a riser like ${e(surname(riser.name))}` : "a riser"} gets repriced before your leaguemates notice.</p>`
  );
}

/**
 * An answer with its links: each link's phrase is wrapped where it already
 * sits in the text, so the visible words are the schema's words.
 */
function faqAnswer(q: UsageFaq): string {
  // Links in text order, each searched for after the last one, so a phrase
  // can never match inside an anchor already written.
  let html = e(q.answer);
  let from = 0;
  for (const l of q.links ?? []) {
    const phrase = e(l.text);
    const at = html.indexOf(phrase, from);
    if (at < 0) continue;
    const a = tool(l.href, l.text, l.cta);
    html = html.slice(0, at) + a + html.slice(at + phrase.length);
    from = at + a.length;
  }
  return html;
}

/* ------------------------------------------------------------------ public */

export interface UsageSection {
  html: string;
  /** The tab's visible FAQ, rendered below the tools block like the others. */
  faqHtml: string;
  /** The same questions for the page's FAQPage node (approved by mak 2026-09-30). */
  faq: Array<{ question: string; answer: string }>;
}

export function renderUsageSection(
  view: UsageView | null,
  team: NflTeam,
  links: UsageLinks = { matchup: null },
): UsageSection {
  if (!view) return { html: "", faqHtml: "", faq: [] };
  const html =
    `<div class="sct-block sct-us">` +
    header(view) +
    intro() +
    introCta() +
    environment(view) +
    targetTree(view, team) +
    backfield(view, team) +
    passMap(view, team, links) +
    table(view, team) +
    legend() +
    projectionsBridge(view) +
    signals(view) +
    tradeBlock(view) +
    conversion(view, team, links) +
    `</div>`;

  // mak's question list (2026-10-05), in the FAQPage too (usage FAQ schema
  // approved 2026-09-30). The link sits outside every .sct-faq-a so the
  // schema's answers and the visible answers are the same text.
  const faq = usageFaq(view, team);
  const faqHtml = faq.length
    ? `<div class="sct-block">` +
      `<h2 class="sct-h2">Common questions</h2>` +
      `<div class="sct-faq">` +
      faq
        .map(
          (q) =>
            `<details class="sct-faq-item">` +
            `<summary class="sct-faq-q-row"><h3 class="sct-faq-q">${e(q.question)}</h3></summary>` +
            `<p class="sct-faq-a">${faqAnswer(q)}</p>` +
            `</details>`,
        )
        .join("") +
      `</div>` +
      `<p class="sct-faq-more"><a class="sct-textlink" href="#usage">See the full usage report</a></p>` +
      `</div>`
    : "";
  return { html, faqHtml, faq };
}
