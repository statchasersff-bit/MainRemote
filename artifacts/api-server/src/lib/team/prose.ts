/**
 * Long prose as shorter paragraphs, for the phone reading of the Outlook tab
 * (mak, 2026-11-14). Presentation only: never rewords anything.
 */

/** Words that end in a period without ending a sentence ("A.J.", "St. Brown", "No. 1"). */
const NOT_A_STOP = /(?:^|\s|\()(?:[A-Z]|[A-Z]\.[A-Z]|Jr|Sr|St|Mr|Dr|No|vs|Wk|Mt|Ft|Lt|Gen|Rev|Inc|Co|etc|approx|ca|e\.g|i\.e)\.$/;

/** The text's sentences, words untouched; a period after an abbreviation or an initial is not a stop. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]["\u201d\u2019)]?\s+(?=["\u201c(]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].trimEnd().length;
    if (NOT_A_STOP.test(text.slice(start, end))) continue;
    out.push(text.slice(start, end));
    start = m.index + m[0].length;
  }
  out.push(text.slice(start));
  return out.filter((s) => s.trim() !== "");
}

/**
 * A long block of prose as shorter paragraphs (mak, 2026-11-14: "break dense
 * content into shorter paragraphs"), cut only between sentences and as evenly
 * as the sentences allow, about 300 characters each. Nothing is reworded: the
 * paragraphs joined with a space are the original text.
 */
export function paragraphs(text: string, target = 300): string[] {
  const parts = sentences(text);
  const n = Math.min(parts.length, Math.ceil(text.length / target));
  if (n <= 1) return [text];
  const out: string[] = [];
  let cur: string[] = [];
  let done = 0;
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    cur.push(s);
    done += s.length + 1;
    const left = parts.length - i - 1;
    if (out.length < n - 1 && left > 0 && done >= ((out.length + 1) * text.length) / n) {
      out.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}
