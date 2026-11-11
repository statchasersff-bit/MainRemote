/**
 * The page-level FAQ block the Draft and Contracts tabs close with (mak's
 * specs, 2026-11-02), and the same questions as entries for the hub's
 * FAQPage node (both approved into the schema the same day).
 *
 * An answer is a list of parts: a paragraph, or a bulleted list. On the
 * page a list is a <ul>; in the schema its lines are joined with newlines,
 * so the structured answer still reads as the page's.
 */

import { escapeHtml } from "../render";
import type { OutlookFaq } from "./outlook-faq";

export type FaqPart = string | { list: string[] };

export interface FaqItem {
  question: string;
  answer: FaqPart[];
}

const e = escapeHtml;

function partHtml(part: FaqPart): string {
  if (typeof part === "string") return `<p class="sct-faq-a">${e(part)}</p>`;
  return `<ul class="sct-faq-a sct-faq-list">${part.list.map((li) => `<li>${e(li)}</li>`).join("")}</ul>`;
}

/** The "?" icon the match recaps' FAQ bar carries (recap-premium.ts BAR_ICON.faq). */
const FAQ_ICON =
  `<span class="sct-faq-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">` +
  `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
  `<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>` +
  `</g></svg></span>`;

/**
 * Every hub FAQ's heading: the match recaps' FAQ bar (mak, 2026-11-11: the
 * team FAQ header/container "more like match recaps"). The icon is
 * aria-hidden, so the heading's text is the question set's name alone.
 */
export function faqHeading(text: string): string {
  return `<h2 class="sct-h2 sct-faq-h2">${FAQ_ICON}${e(text)}</h2>`;
}

/** The usage tab's markup, so every FAQ on the hub folds the same way. */
export function renderFaqBlock(heading: string, items: FaqItem[], className: string): string {
  if (!items.length) return "";
  return (
    `<div class="sct-block ${e(className)}">` +
    faqHeading(heading) +
    `<div class="sct-faq">` +
    items
      .map(
        (q) =>
          `<details class="sct-faq-item">` +
          `<summary class="sct-faq-q-row"><h3 class="sct-faq-q">${e(q.question)}</h3></summary>` +
          q.answer.map(partHtml).join("") +
          `</details>`,
      )
      .join("") +
    `</div>` +
    `</div>`
  );
}

/** The same questions as the page's FAQPage entries. */
export function faqEntries(items: FaqItem[]): OutlookFaq[] {
  return items.map((q) => ({
    question: q.question,
    answer: q.answer.map((p) => (typeof p === "string" ? p : p.list.map((li) => `- ${li}`).join("\n"))).join("\n\n"),
  }));
}
