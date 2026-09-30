/**
 * The player pages' FAQ system (mak, 2026-09-30).
 *
 * Every tab owns one search-intent cluster, and its FAQ asks only the
 * questions in it:
 *
 *   Overview  fantasy value, rank, start/sit, rosterability, role, matchups
 *   Stats     season and career totals, position-aware
 *   Game Log  last game, Week N, best and worst game
 *   Outlook   rest-of-season value, role, schedule, buy/sell
 *   Injury    status, playing this week, practice, history (state-aware)
 *   News      the current news cycle only
 *   Bio       age, height, weight, number, college, draft, experience
 *
 * Each tab builds a POOL of candidates from its own data. A candidate the data
 * cannot answer is null and simply drops out: nothing here guesses. This file
 * then selects (at most 15, one per intent key), spends a small internal-link
 * budget on the first answers that carry a link, and renders the section. The
 * visible questions are exactly the ones handed to the page's FAQPage node.
 */

import { escapeHtml } from "../render";
import type { PlayerRenderOptions } from "../player-render";
import type { PlayerPageData } from "./player-data";
import { titleCase } from "./title-case";

/** A link to a sibling tab, written as the sentence it sits in. */
export interface FaqLink {
  href: string;
  /** The whole sentence, which is the anchor: "See his full game log." */
  text: string;
  /** The analytics tag, as data-cta. */
  cta?: string;
}

export interface FaqCandidate {
  /** One per search intent: two candidates with a key never both show. */
  key: string;
  q: string;
  /** The answer, first sentence first. Plain text. */
  a: string;
  link?: FaqLink | null;
}

export interface FaqItem {
  q: string;
  html: string;
  text: string;
}

/** The ceiling (mak: 15, never forced). */
export const FAQ_MAX = 15;
/** Contextual links per FAQ section (mak: typically 2-5). */
export const FAQ_LINKS = 4;

const norm = (q: string): string => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Picks the questions: pool order is priority order. */
export function selectFaq(
  pool: Array<FaqCandidate | null | undefined | false>,
  max = FAQ_MAX,
  links = FAQ_LINKS,
): FaqItem[] {
  const keys = new Set<string>();
  const asked = new Set<string>();
  const out: FaqItem[] = [];
  let budget = links;
  for (const c of pool) {
    if (!c || !c.q || !c.a) continue;
    if (keys.has(c.key) || asked.has(norm(c.q))) continue;
    keys.add(c.key);
    asked.add(norm(c.q));
    const link = c.link && budget > 0 ? c.link : null;
    if (link) budget -= 1;
    out.push({
      q: c.q,
      html:
        escapeHtml(c.a) +
        (link ? ` <a href="${escapeHtml(link.href)}"${link.cta ? ` data-cta="${escapeHtml(link.cta)}"` : ""}>${escapeHtml(link.text)}</a>` : ""),
      text: c.a + (link ? ` ${link.text}` : ""),
    });
    if (out.length >= max) break;
  }
  return out;
}

export type FaqTab = "overview" | "stats" | "game-log" | "outlook" | "injury" | "news" | "bio";

/** The section's H2 (mak's list). */
export function faqHeading(tab: FaqTab, name: string): string {
  switch (tab) {
    case "overview":
      return `${name} Fantasy Football FAQ`;
    case "stats":
      return `${name} Stats FAQ`;
    case "game-log":
      return `${name} Game Log FAQ`;
    case "outlook":
      return `${name} Fantasy Outlook FAQ`;
    case "injury":
      return `${name} Injury FAQ`;
    case "news":
      return `${name} News FAQ`;
    case "bio":
      return `About ${name}: Bio FAQ`;
  }
}

/**
 * The FAQ section: an H2, then one fold per question, the first open. The
 * answers go to the page's FAQPage node word for word through faqSink.
 */
export function renderFaqSection(
  tab: FaqTab,
  data: PlayerPageData,
  items: FaqItem[],
  options: PlayerRenderOptions,
  extraClass = "",
): string {
  if (items.length === 0) return "";
  options.faqSink?.push(...items.map((f) => ({ question: f.q, answer: f.text })));
  const id = `scp-faq-${tab}-h`;
  return (
    `<section class="scp-ox-sec scp-tab-faq" aria-labelledby="${id}" data-faq-tab="${tab}">` +
    `<h2 class="scp-ox-h2" id="${id}">${escapeHtml(titleCase(faqHeading(tab, data.player.name)))}</h2>` +
    `<div class="scp-ox-faq${extraClass ? ` ${extraClass}` : ""}">` +
    items.map((f, i) => `<details${i === 0 ? " open" : ""}><summary>${escapeHtml(f.q)}</summary><p>${f.html}</p></details>`).join("") +
    `</div></section>`
  );
}

/** A sibling tab's canonical URL: the profile for the Overview, the section page otherwise. */
export function tabHref(data: PlayerPageData, options: PlayerRenderOptions, tab: FaqTab | "overview"): string {
  const base = `${options.playerPathPrefix ?? "/player/"}${data.player.slug}/`;
  return `${base}${tab === "overview" ? "" : `${tab}/`}${options.linkQuery ?? ""}`;
}

/* ------------------------------------------------------------- phrasing */

export const one = (v: number): string => v.toFixed(1).replace(/^-/, "−");
export const whole = (v: number): string => Math.round(v).toLocaleString("en-US");
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const word = (n: number): string => (n >= 0 && n <= 10 ? WORDS[n]! : String(n));
/** "2 touchdowns", "1 game": the count and its noun, which always agree. */
export const count = (n: number, noun: string, plural = `${noun}s`): string =>
  n === 0 ? `no ${plural}` : `${n} ${n === 1 ? noun : plural}`;
/** "a QB4 finish", "an RB14 finish". */
export const aPos = (pos: string): string => (pos === "RB" ? "an" : "a");
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
