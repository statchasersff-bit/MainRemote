/**
 * The premium "WRs Like Garrett Wilson" comparison rail (mak's brief and
 * mockup attached_assets/comparison 1.png, 2026-11-05). Rendered UNDER the
 * existing peers rail wherever that rail is mounted - every tab carries it
 * above its FAQ - never in place of it: both stay until mak approves one.
 *
 * Same neighborhood, same order, same ranks, same figure: data.peers is the
 * slice of the position's table the existing rail draws (player-data.ts
 * positionalFinish / neighborhood), the current player found by id. The
 * three supporting metrics are per-game box-score rates over the same games
 * the rank counts (PositionPeer.perGame) - observed, so the figure is "PPG"
 * (or "PTS" while the rail ranks by points scored), never "Proj PPG".
 *
 * Markup is `scp-pr-` prefixed and every rule in player.css starts
 * `.scp .scp-pr`, so nothing here reaches the rail above it. The strip
 * carries `data-scp-peers` so the client centers the marked card when the
 * strip scrolls, as it does for the existing rail.
 */

import { escapeHtml } from "../render";
import { headshotImg } from "../headshot-html";
import type { PeerPerGame, PlayerPageData, PositionPeer } from "./player-data";

const POSITION_WORDS: Record<string, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
  K: "kickers",
};

/* ------------------------------------------------------------------- icons */

const svg = (body: string): string =>
  `<svg class="scp-pr-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ICON = {
  users: svg(
    `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="3"/><path d="M15.5 14.5a5.5 5.5 0 0 1 6 5"/>`,
  ),
  target: svg(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>`),
  bars: svg(`<path d="M4 20V13M10 20V6M16 20v-9M22 20H2"/>`),
  trophy: svg(
    `<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4M8.5 21h7M9.5 18h5"/>`,
  ),
  run: svg(`<circle cx="15" cy="4.5" r="1.8"/><path d="M10 21l2.5-6-3-2.5 3.5-5 3 2.5 3.5.5M8 13l-3 1.5M13.5 15.5 16 21"/>`),
  pass: svg(`<path d="M3 17c4-9 10-13 18-13-1 8-5 14-13 18"/><path d="M8 16l-1 4M12 12l5 5"/>`),
};

/** A faint football outline, the hero's right-hand decoration. */
const BALL =
  `<svg class="scp-pr-ball" viewBox="0 0 160 100" aria-hidden="true" focusable="false">` +
  `<ellipse cx="80" cy="50" rx="72" ry="38" fill="none" stroke="currentColor" stroke-width="2"/>` +
  `<path d="M22 50h116" stroke="currentColor" stroke-width="1" opacity=".6"/>` +
  `<path d="M60 40v20M70 38v24M80 37v26M90 38v24M100 40v20M56 50h48" stroke="currentColor" stroke-width="2"/>` +
  `</svg>`;

/* ----------------------------------------------------------------- metrics */

interface Metric {
  icon: string;
  value: number;
  label: string;
  digits: number;
}

/**
 * Three per-game rates for the position, from the brief's mapping. Nothing
 * is derived beyond a division by games played; a position outside the
 * mapping prints no panel rather than a borrowed one.
 */
function metricsFor(pos: string, r: PeerPerGame): Metric[] | null {
  if (pos === "QB") {
    return [
      { icon: ICON.pass, value: r.passAtt, label: "Pass Att/G", digits: 1 },
      { icon: ICON.bars, value: r.passYds, label: "Pass Yds/G", digits: 1 },
      { icon: ICON.trophy, value: r.passTd, label: "Pass TD/G", digits: 2 },
    ];
  }
  if (pos === "RB") {
    return [
      { icon: ICON.run, value: r.carries, label: "Carries/G", digits: 1 },
      { icon: ICON.bars, value: r.rushYds, label: "Rush Yds/G", digits: 1 },
      { icon: ICON.target, value: r.targets, label: "Targets/G", digits: 1 },
    ];
  }
  if (pos === "WR" || pos === "TE") {
    return [
      { icon: ICON.target, value: r.targets, label: "Targets/G", digits: 1 },
      { icon: ICON.bars, value: r.recYds, label: "Rec Yds/G", digits: 1 },
      { icon: ICON.trophy, value: r.recTd, label: "Rec TD/G", digits: 2 },
    ];
  }
  if (pos === "K") {
    return [
      { icon: ICON.target, value: r.fgm, label: "FG Made/G", digits: 1 },
      { icon: ICON.bars, value: r.fga, label: "FG Att/G", digits: 1 },
      { icon: ICON.trophy, value: r.xpm, label: "XP Made/G", digits: 1 },
    ];
  }
  return null;
}

/* -------------------------------------------------------------------- card */

function renderCard(
  row: PositionPeer,
  pos: string,
  unit: string,
  href: string | null,
): string {
  const team = row.team;
  const metrics = row.games > 0 ? metricsFor(pos, row.perGame) : null;
  const portrait =
    `<span class="scp-pr-photo"${team ? ` style="--pr-team:${escapeHtml(team.primaryColor)}"` : ""}>` +
    (headshotImg({
      src: row.headshot,
      id: row.id,
      className: "scp-pr-img",
      alt: "",
      variants: ["f160", "f350"],
      sizes: "200px",
      width: 200,
      height: 145,
      loading: "lazy",
    }) ?? "") +
    `<span class="scp-pr-rank">${escapeHtml(`${pos}${row.rank}`)}</span>` +
    `</span>`;

  const body =
    `<span class="scp-pr-name">${escapeHtml(row.name)}</span>` +
    `<span class="scp-pr-main">` +
    `<span class="scp-pr-club">` +
    (team
      ? `<img class="scp-pr-logo" src="${escapeHtml(team.logo)}" alt="" aria-hidden="true" loading="lazy" decoding="async" width="32" height="32" />` +
        `<b>${escapeHtml(team.code)}</b>`
      : `<b class="is-fa">FA</b>`) +
    `</span>` +
    `<span class="scp-pr-value"><b>${escapeHtml(row.value.toFixed(1))}</b><small>${escapeHtml(unit)}</small></span>` +
    `</span>` +
    (metrics
      ? `<span class="scp-pr-metrics">` +
        metrics
          .map(
            (m) =>
              `<span class="scp-pr-metric">${m.icon}<b>${escapeHtml(m.value.toFixed(m.digits))}</b><span>${escapeHtml(m.label)}</span></span>`,
          )
          .join("") +
        `</span>`
      : `<span class="scp-pr-metrics is-none"><span>No per-game splits</span></span>`);

  const sr = `<span class="scp-sr">${escapeHtml(
    `${pos}${row.rank}, ${row.value.toFixed(1)} ${unit}${team ? `, ${team.fullName}` : ""}`,
  )}</span>`;

  if (row.isCurrent || !href) {
    return (
      `<div class="scp-pr-card${row.isCurrent ? " is-current" : ""}"${row.isCurrent ? ` aria-current="page"` : ""}>` +
      (row.isCurrent ? `<span class="scp-pr-here">You are here</span>` : "") +
      portrait +
      body +
      sr +
      `</div>`
    );
  }
  return `<a class="scp-pr-card" href="${escapeHtml(href)}" target="_top">${portrait}${body}${sr}</a>`;
}

/* ------------------------------------------------------------------- block */

export function renderPeersPremium(
  data: PlayerPageData,
  options: { playerPathPrefix?: string; linkQuery?: string },
): string {
  const peers = data.peers;
  if (!peers || peers.rows.length < 2) return "";
  const prefix = options.playerPathPrefix ?? "/player/";
  const query = options.linkQuery ?? "";
  const pos = peers.position;
  const unit = peers.measure === "ppg" ? "PPG" : "PTS";
  const words = POSITION_WORDS[pos] ?? `${pos}s`;
  // The rail is a slice of a rank table, so the subtitle says that and no
  // more: not "role and usage profile", which the neighborhood does not
  // measure.
  const sub =
    peers.measure === "ppg"
      ? `Nearby ${words} in ${peers.season} fantasy points per game.`
      : `Nearby ${words} in ${peers.season} fantasy points scored.`;
  const id = "scp-pr-h";

  const cards = peers.rows
    .map((row) => renderCard(row, pos, unit, row.slug ? `${prefix}${row.slug}/${query}` : null))
    .join("");

  return (
    `<div class="scp-pr-wrap">` +
    `<p class="scp-pr-flag"><b>New design</b><span>comparison</span></p>` +
    `<section class="scp-pr" aria-labelledby="${id}">` +
    `<header class="scp-pr-hero">` +
    `<span class="scp-pr-ico">${ICON.users}</span>` +
    `<span class="scp-pr-rule" aria-hidden="true"></span>` +
    `<div class="scp-pr-hero-t">` +
    `<h2 class="scp-pr-title" id="${id}">${escapeHtml(`${pos}s Like ${data.player.name}`)}</h2>` +
    `<p class="scp-pr-sub">${escapeHtml(sub)}</p>` +
    `</div>` +
    BALL +
    `<span class="scp-pr-stripes" aria-hidden="true"></span>` +
    `</header>` +
    `<div class="scp-pr-body">` +
    `<div class="scp-pr-strip" data-scp-peers data-count="${peers.rows.length}">${cards}</div>` +
    `</div></section></div>`
  );
}
