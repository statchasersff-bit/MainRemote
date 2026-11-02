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

/** The usage tab's markup, so every FAQ on the hub folds the same way. */
export function renderFaqBlock(heading: string, items: FaqItem[], className: string): string {
  if (!items.length) return "";
  return (
    `<div class="sct-block ${e(className)}">` +
    `<h2 class="sct-h2">${e(heading)}</h2>` +
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
