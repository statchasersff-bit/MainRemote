/**
 * Every tool's tables, armed against Divi's table rules.
 *
 * Divi prints, inside the content column a tool is embedded in:
 *
 *   .entry-content table:not(.variations)  frame + 15px margin     (0,2,1)
 *   .entry-content tr td / tr th           padding 6/9px 24px,
 *                                          th #555 + weight 700    (0,1,2)
 *   #left-area table th                    color #666              (1,0,2)
 *
 * Measured 2026-09-29 by diffing computed styles of each real embed fragment,
 * bare vs under those rules loaded after the tool's stylesheet: FPA, schedule,
 * player, team/matchup and RB handcuffs all lost some of it — player and the
 * matchup tables every cell's padding. These tests hold the shape of the fix;
 * the measurement is what proved it (zero differences at 375, 500 and 1200px,
 * in both load orders, and the bare pages unchanged).
 *
 * Static, over the stylesheet text: a new table rule written without the
 * prefix is the regression, and it is invisible until a page is embedded.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (file) => readFileSync(path.join(PUBLIC, file), "utf8");

/** Every selector in a stylesheet, comments removed, lists split. */
function selectors(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const m of bare.matchAll(/([^{};]+)\{/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith("@")) continue;
    let depth = 0;
    let cur = "";
    for (const ch of prelude) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim().replace(/\s+/g, " "));
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim().replace(/\s+/g, " "));
  }
  return out.filter(Boolean);
}

describe("the table frame outranks `.entry-content table:not(.variations)`", () => {
  for (const [file, table] of [
    ["fpa.css", ".scf table.scf-table:not(.variations)"],
    ["schedule.css", ".scs table.scs-matrix:not(.variations)"],
    ["player.css", ".scp table.scp-table:not(.variations)"],
    ["rb-handcuffs.css", ".rbh table.rbh-table:not(.variations)"],
    ["rankings.css", ".scr table.scr-table:not(.variations)"],
    ["player-stats.css", ".sca table.sca-table:not(.variations)"],
  ]) {
    test(file, () => {
      assert.ok(selectors(read(file)).includes(table), `${file} is missing ${table}`);
    });
  }

  test("team.css resets all eight of its tables at id weight", () => {
    assert.ok(
      selectors(read("team.css")).includes(
        ":is(.sct, #sct-table-armour) :is(.sct-hist, .sct-mu-linescore, .sct-mu-table, .sct-mu-ps-table, .sct-rb-table, .sct-ss-table, .sct-fp-table, .sct-rb-mini)",
      ),
    );
  });
});

describe("header ink survives `#left-area table th`", () => {
  // An id outranks any number of classes; only `!important` or id weight wins.
  for (const [file, rule] of [
    ["fpa.css", /\.scf \.scf-table thead th \{[^}]*color: #fff !important/],
    ["schedule.css", /\.scs \.scs-matrix thead th \{[^}]*color: hsl\(var\(--scs-muted-foreground\)\) !important/],
    ["player.css", /\.scp \.scp-table tfoot th \{[^}]*color: var\(--sc-navy\) !important/],
    ["rb-handcuffs.css", /\.rbh \.rbh-table thead th \{[^}]*color: #fff !important/],
  ]) {
    test(file, () => assert.match(read(file).replace(/\/\*[\s\S]*?\*\//g, ""), rule));
  }
});

describe("whole table families are lifted, so no rule is left behind", () => {
  test("every player.css selector naming .scp-table starts at the root", () => {
    const loose = selectors(read("player.css")).filter(
      (s) => /\.scp-table\b/.test(s) && !s.startsWith(".scp ") && !s.startsWith("#"),
    );
    assert.deepEqual(loose, [], "these lose to `.entry-content tr td` on an embedded page");
  });

  test("every team.css selector naming a table carries the id-weight prefix", () => {
    const roots = /\.sct-(?:hist|mu-linescore|mu-table|mu-ps-table|rb-table|us-table)\b(?!-)/;
    const loose = selectors(read("team.css")).filter(
      (s) => roots.test(s) && !s.startsWith(":is(.sct, #sct-table-armour) "),
    );
    assert.deepEqual(loose, [], "these lose to Divi's table rules on an embedded page");
  });

  test("every team.css selector in the Usage report carries the id-weight prefix", () => {
    // Divi's `.entry-content ul`, `p:last-of-type` and heading rules outrank a
    // one-class rule; measured in the Divi sim 2026-09-30. The family is lifted
    // whole, so its rules still rank against each other as written.
    const loose = selectors(read("team.css")).filter(
      (s) => /\.sct-us\b/.test(s) && !s.startsWith(":is(.sct, #sct-table-armour)"),
    );
    assert.deepEqual(loose, [], "these lose to Divi's element rules on an embedded page");
  });

  test("every sos.css selector naming its table, a list or a link carries the id-weight prefix", () => {
    // `#left-area ul` and `#left-area table th` are id weight; so is this prefix.
    const all = selectors(read("sos.css"));
    const loose = all.filter(
      (s) =>
        (/\.scsos-table\b/.test(s) || /\bul\.scsos-/.test(s) || /\ba\.scsos-/.test(s)) &&
        !s.startsWith(":is(.scsos, #scsos-armour) "),
    );
    assert.deepEqual(loose, [], "these lose to Divi's rules on an embedded page");
    assert.ok(
      all.includes(":is(.scsos, #scsos-armour) table.scsos-table"),
      "the table frame itself must be armed",
    );
  });

  test("the id in the prefix is never an element's id", () => {
    // Its only job is weight. A real element carrying it would be styled as a
    // tool root by every table rule in team.css.
    const src = path.resolve(PUBLIC, "..", "src");
    const hits = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.ts$/.test(entry.name) && /sct-table-armour|scsos-armour/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(src);
    assert.deepEqual(hits, []);
  });
});

