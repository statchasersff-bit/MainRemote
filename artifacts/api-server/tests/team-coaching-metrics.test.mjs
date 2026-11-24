/**
 * Coaching & Scheme metric labels on all 32 Coaching routes (team audit,
 * Task 2, 2026-11-24; WEB-043's findings, rechecked on the shared renderer).
 *
 * Every assertion runs for every club, against the served HTML and the
 * committed coaching file:
 *
 *   1. the play-calling span: the target-distribution heading, its scope line
 *      and the FAQ name the same seasons, read off the per-season prints the
 *      Season by Season table lists (gaps as separate runs), never "since
 *      2016";
 *   2. one period line near the top, derived from the data's cutoff week and
 *      games: "2026 regular season through Week N (G games) compared with the
 *      full 2025 regular season", plus the previous-staff clause for a new
 *      play-caller;
 *   3. rate changes in percentage points ("+3.0 pp"), never "%" or "pts",
 *      one precision per comparison row, and "percentage points" explained
 *      once;
 *   4. every rank with its direction and group ("3rd-highest of 32",
 *      "T-10th-fastest of 32"), recomputed here from the file with the
 *      project's rule (published values, ties share the better rank);
 *   5. every NFL benchmark from the same period as the team figure it sits
 *      beside (the current season's league rate in the table and the
 *      fourth-down card, the league's share over the same seasons on the
 *      distribution card), and no league average in the FAQ that the page
 *      does not show beside its team value;
 *   6. the in-progress season labeled with its games wherever it sits in a
 *      historical comparison (season table, career figures, chart, finishes,
 *      distribution and backfield cards), and never the "peak";
 *   7. the FAQ interprets rather than repeats: no rate, current points per
 *      game or current lead-back share restated in an answer.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { startServer, APP_DIR } from "./helpers/server.mjs";
import { startUpstreamReplay } from "./helpers/upstream-replay.mjs";

const coaching = JSON.parse(fs.readFileSync(path.join(APP_DIR, "data", "team", "coaching_2026.json"), "utf8"));
const SEASON = coaching.season;
const WEEK = coaching.snapshot.throughWeek;

let server;
let replay;
/** abbreviation -> { slug, doc } */
const pages = new Map();

const yearsText = (years) => {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < ys.length; ) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    runs.push(i === j ? String(ys[i]) : `${ys[i]}-${ys[j]}`);
    i = j + 1;
  }
  return runs.join(", ");
};
const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const num = (s) => Number(String(s).replace("−", "-").match(/-?\d+(?:\.\d+)?/)[0]);
const places = (s) => String(s).match(/\.(\d+)/)?.[1]?.length ?? 0;
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const prints = (t) => t.dossier.flatMap((d) => d.prints ?? []).filter((p) => ["WR", "RB", "TE"].every((k) => p.shares[k] != null && p.league[k] != null));
const faqItems = (doc) =>
  [...doc.querySelectorAll('[data-sct-faq-for="coaching"] .sct-faq-item')].map((d) => ({
    q: text(d.querySelector(".sct-faq-q")),
    a: [...d.querySelectorAll(".sct-faq-a")].map(text).join(" "),
  }));

before(async () => {
  replay = await startUpstreamReplay();
  server = await startServer(replay.env);
  const index = await (await fetch(`${server.origin}/team/`)).text();
  const slugs = [...new Set([...index.matchAll(/\/team\/([a-z0-9-]+)\//g)].map((m) => m[1]))];
  for (const slug of slugs) {
    const res = await fetch(`${server.origin}/team/${slug}/coaching/`);
    if (res.status !== 200) continue;
    const doc = new JSDOM(await res.text()).window.document;
    // The club is the one whose play-caller the card names.
    const name = text(doc.querySelector("#coaching-premium .sct-cp-name"));
    const abbr = Object.keys(coaching.teams).find((k) => coaching.teams[k].playCaller.name === name);
    if (abbr) pages.set(abbr, { slug, doc });
  }
});

after(async () => {
  await server?.stop();
  await replay?.stop();
});

const each = (fn) => {
  for (const [abbr, t] of Object.entries(coaching.teams)) {
    const p = pages.get(abbr);
    assert.ok(p, `${abbr}: a Coaching route`);
    fn(abbr, t, p.doc, p.slug);
  }
};

describe("all 32 Coaching routes (team audit, 2026-11-24)", () => {
  test("32 routes render a coaching panel", () => {
    assert.equal(pages.size, 32);
  });

  test("1. heading, scope line and FAQ name the same play-calling seasons, from the data", () => {
    each((abbr, t, doc) => {
      const ps = prints(t);
      const span = yearsText(ps.map((p) => p.year));
      const h = text(doc.querySelector(".sct-cpt-card.is-dist .sct-cpt-h4"));
      assert.equal(h, `Target Distribution Under ${t.playCaller.name.split(" ").pop()}${span ? `, ${span}` : ""}`, `${abbr} heading`);
      const all = text(doc.querySelector("#coaching")) + " " + faqItems(doc).map((f) => f.a).join(" ");
      assert.doesNotMatch(all, /since 2016/, `${abbr}: no "since 2016"`);
      const wrte = faqItems(doc).find((f) => /favor wide receivers or tight ends/.test(f.q));
      if (wrte && ps.some((p) => p.year < SEASON)) assert.ok(wrte.a.includes(`(${span})`), `${abbr} FAQ span: ${wrte.a}`);
      // The averaged figures and the league's are the prints' own, over the same seasons.
      if (ps.length) {
        const mean = (f) => ps.reduce((s, p) => s + f(p), 0) / ps.length;
        const wr = doc.querySelector(".sct-cpt-card.is-dist .sct-cpt-row");
        assert.equal(text(wr.querySelector(".sct-cpt-row-val b")), `${Math.round(mean((p) => p.shares.WR))}%`, `${abbr} WR share`);
        assert.equal(text(wr.querySelector(".sct-cpt-row-avg")), `NFL ${Math.round(mean((p) => p.league.WR))}%`, `${abbr} WR league`);
      }
    });
  });

  test("2. one period line near the top, from the cutoff week and games", () => {
    each((abbr, t, doc) => {
      const line = text(doc.querySelector("#coaching-premium .sct-cp-period"));
      const g = t.tendencies.samples.games;
      const newCaller = /prev/i.test(t.tendencies.priorLabel);
      assert.equal(
        line,
        `${SEASON} regular season through Week ${WEEK} (${g} game${g === 1 ? "" : "s"}) compared with the full ${SEASON - 1} regular season${newCaller ? ", when the previous staff called plays" : ""}. Rate changes are in percentage points (pp): 53.0% to 56.0% is +3.0 pp.`,
        abbr,
      );
      // It leads the tendencies section, ahead of the table it governs.
      const sec = doc.querySelector("#coaching-premium .sct-cp-section-body");
      assert.equal(sec.firstElementChild.className, "sct-cp-period", abbr);
      // "percentage points" is explained once on the page.
      assert.equal((text(doc.querySelector("#coaching")).match(/percentage points/g) ?? []).length, 1, `${abbr}: explained once`);
      if (newCaller) assert.match(text(doc.querySelector(".sct-cp-cont-note")), /context, not baseline/, `${abbr}: the continuity note stays`);
      // One cutoff everywhere on the tab, a club on bye that week included.
      const all = text(doc.querySelector("#coaching")) + " " + faqItems(doc).map((f) => f.a).join(" ");
      for (const m of all.matchAll(/(?:[Tt]hrough Week|[Tt]hru Wk) (1[0-8]|[1-9])/g)) assert.equal(Number(m[1]), WEEK, `${abbr}: "${m[0]}"`);
    });
  });

  test("3. rate changes in percentage points, one precision per row; pace in seconds", () => {
    each((abbr, t, doc) => {
      const panel = doc.querySelector("#coaching");
      assert.doesNotMatch(text(panel), /\bpts?\b/, `${abbr}: no "pts"`);
      for (const tr of doc.querySelectorAll("table.sct-cp-table tbody tr:not(.sct-cp-group-row)")) {
        const label = text(tr.querySelector(".sct-co-tlabel"));
        const chg = tr.querySelector(".sct-cp-chg-long") ?? tr.querySelector(".sct-cp-change");
        const pace = /pace/i.test(label);
        assert.match(text(chg), pace ? /^(steady|-|\d+\.\d seconds? (faster|slower))$/ : /^(steady|-|[+−]\d+\.\d pp)$/, `${abbr} ${label}`);
        const cells = [text(tr.querySelector(".is-prior")), text(tr.querySelector(".is-now")), text(tr.querySelector(".sct-cp-nfl-avg"))].filter((c) => c !== "-");
        assert.equal(new Set(cells.map(places)).size, 1, `${abbr} ${label}: one precision ${cells}`);
        if (/pp$/.test(text(chg))) assert.equal(places(text(chg)), places(cells[0]), `${abbr} ${label}: change at the row's precision`);
        // The change is the subtraction of the row's own values, rounded once
        // (the unrounded values where the file carries them).
        const row = t.tendencies.rows.find((r) => r.label === label);
        if (/pp$/.test(text(chg)) && row) {
          const d = (row.currentRaw ?? num(row.current)) - (row.priorRaw ?? num(row.prior));
          assert.equal(num(text(chg)), Number(d.toFixed(1)) || 0, `${abbr} ${label}: ${text(chg)}`);
        }
      }
      for (const b of doc.querySelectorAll(".sct-cpt-card.is-dist .sct-cpt-badge, .sct-cpt-card.is-score .sct-cpt-badge.is-gold, .sct-cpt-card.is-score .sct-cpt-badge.is-zero")) {
        assert.match(text(b), /^[+−]?\d+ pp$/, `${abbr} badge ${text(b)}`);
      }
      for (const d of doc.querySelectorAll(".sct-cs-delta[title]")) assert.match(d.getAttribute("title"), /pp (above|below) the league average|^Level with the league average/, abbr);
    });
  });

  test("4. every rank names its direction and group, in the sort order the project uses", () => {
    const values = (key) => Object.values(coaching.teams).map((t) => t.tendencies.rows.find((r) => r.key === key)).filter(Boolean).map((r) => num(r.current));
    each((abbr, t, doc) => {
      for (const tr of doc.querySelectorAll("table.sct-cp-table tbody tr:not(.sct-cp-group-row)")) {
        const label = text(tr.querySelector(".sct-co-tlabel"));
        const row = t.tendencies.rows.find((r) => r.label === label);
        const rank = tr.querySelector(".sct-cp-nfl-rank");
        if (!rank) continue;
        const pool = values(row.key);
        const me = num(row.current);
        const n = 1 + pool.filter((v) => (row.invert ? v < me : v > me)).length;
        const tied = pool.filter((v) => v === me).length > 1;
        assert.equal(text(rank), `${tied ? "T-" : ""}${ordinal(n)}-${row.invert ? "fastest" : "highest"} of ${pool.length}`, `${abbr} ${label}`);
        assert.match(rank.getAttribute("title"), new RegExp(`of ${pool.length} offenses, ${SEASON} through Week ${WEEK}$`), `${abbr} ${label} title`);
      }
      // Scoring ranks: the season table's head and pills, the career figure.
      const head = text(doc.querySelector("#coaching-seasons-premium th.is-rank"));
      assert.equal(head, "PPG rankof 32, 1st = most", `${abbr} season-table head`);
      for (const pill of doc.querySelectorAll("#coaching-seasons-premium .sct-cs-rank")) {
        assert.match(pill.getAttribute("title"), /^\d+(st|nd|rd|th) of 32 in points per game \(1st = most\)/, `${abbr} pill`);
      }
      for (const kv of doc.querySelectorAll(".sct-cc-kv.is-peak span, .sct-cc-kv dd span, .sct-cc-kpi.is-rank span")) {
        if (/^\d+(st|nd|rd|th)\b/.test(text(kv))) assert.match(text(kv), /of 32/, `${abbr} KPI ${text(kv)}`);
      }
      for (const f of faqItems(doc)) {
        for (const m of f.a.matchAll(/\b\d+(st|nd|rd|th)\b(?!-)( [a-z ]{0,30})?/g)) {
          // Tenure ordinals ("his 14th Chiefs season") are counts, not ranks.
          if (/^\d+(st|nd|rd|th) ([A-Z][a-z0-9]+ )?(season|consecutive)|Week|game/.test(f.a.slice(m.index, m.index + 40))) continue;
          assert.match(f.a.slice(m.index, m.index + 60), /^\d+(st|nd|rd|th)(-(highest|lowest|fastest))? of 32 in points per game|^\d+(st|nd|rd|th) (season|consecutive)/, `${abbr} FAQ rank: ${f.a}`);
        }
      }
    });
  });

  test("5. every benchmark comes from the same period as the figure beside it", () => {
    each((abbr, t, doc) => {
      const nflHead = [...doc.querySelectorAll("table.sct-cp-table thead th")].map(text)[4];
      assert.match(nflHead, new RegExp(`^NFL ${SEASON}`), `${abbr}: the table's NFL column is the ${SEASON} league over the same weeks`);
      for (const tr of doc.querySelectorAll("table.sct-cp-table tbody tr:not(.sct-cp-group-row)")) {
        const row = t.tendencies.rows.find((r) => r.label === text(tr.querySelector(".sct-co-tlabel")));
        assert.equal(num(text(tr.querySelector(".sct-cp-nfl-avg"))), num(row.nflAvg), `${abbr} ${row.label}: the file's league value`);
      }
      const fourth = [...doc.querySelectorAll(".sct-cpt-4d-k")].map(text);
      if (fourth.length) assert.ok(fourth.includes(`NFL avg ${SEASON}`), `${abbr} fourth-down benchmark labeled ${fourth}`);
      if (prints(t).length) assert.match(text(doc.querySelector(".sct-cpt-card.is-dist .sct-cpt-scope")), /^NFL: same (seasons|weeks)/, abbr);
      // No answer quotes a league average (or any rate) for the page to disagree with.
      for (const f of faqItems(doc)) assert.doesNotMatch(f.a, /\d+(\.\d+)?%/, `${abbr} FAQ "${f.q}" quotes a rate`);
    });
  });

  test("6. the in-progress season is labeled with its games wherever it meets past seasons, and is never the peak", () => {
    each((abbr, t, doc) => {
      const g = t.tendencies.samples.games;
      const games = `${g} game${g === 1 ? "" : "s"}`;
      const live = doc.querySelector("#coaching-seasons-premium tr.sct-cs-row.is-current");
      assert.ok(live, abbr);
      assert.equal(text(live.querySelector(".sct-cs-live")), `In progress · ${games}`, `${abbr} season table`);
      const cur = doc.querySelector(".sct-cc-kv.is-current");
      if (cur) assert.match(text(cur), new RegExp(`${games}$`), `${abbr} Current PPG`);
      const peak = doc.querySelector(".sct-cc-kv.is-peak");
      if (peak) assert.doesNotMatch(text(peak), new RegExp(`\\b${SEASON}\\b`), `${abbr}: peak is a finished season (${text(peak)})`);
      const pt = doc.querySelector(".sct-cc-svg.is-wide .sct-cc-pt.is-current");
      if (pt) assert.match(pt.getAttribute("aria-label"), new RegExp(`in progress, through Week ${WEEK}, ${games}`), `${abbr} chart point`);
      assert.doesNotMatch(text(doc.querySelector(".sct-cc-svg.is-wide")), /PEAK · CURRENT/, `${abbr}: no partial peak`);
      const fin = doc.querySelector(".sct-cf-table tr.is-current .sct-cf-stop-role");
      if (fin) assert.equal(text(fin), `Through Week ${WEEK}, ${games}`, `${abbr} finishes`);
      if (prints(t).some((p) => p.year === SEASON)) assert.match(text(doc.querySelector(".sct-cpt-card.is-dist .sct-cpt-scope")), new RegExp(`${SEASON} through Week ${WEEK}, ${games}`), `${abbr} distribution`);
      const bars = doc.querySelectorAll(".sct-cpt-card.is-back .sct-cpt-col");
      if (bars.length > 1) assert.match(text(doc.querySelector(".sct-cpt-card.is-back .sct-cpt-scope")), new RegExp(`: through Week ${WEEK}, ${games}$`), `${abbr} backfield`);
      const hist = faqItems(doc).find((f) => /been historically/.test(f.q));
      if (hist && /scoring/.test(hist.a) && new RegExp(`Week ${WEEK} of ${SEASON}`).test(hist.a)) assert.match(hist.a, new RegExp(`\\(${g} games, a season still in progress\\)`), abbr);
    });
  });

  test("7. the FAQ interprets: no current points per game or lead-back share restated", () => {
    each((abbr, t, doc) => {
      const cur = t.dossier.find((d) => d.current)?.seasons?.find((y) => y.year === SEASON);
      const lb = t.dossier.flatMap((d) => d.prints ?? []).find((p) => p.year === SEASON)?.leadBack;
      const answers = faqItems(doc).map((f) => f.a).join(" ");
      if (cur) assert.ok(!answers.includes(cur.ppg.toFixed(1)), `${abbr}: FAQ repeats ${cur.ppg}`);
      if (lb != null) assert.ok(!answers.includes(`${lb}%`), `${abbr}: FAQ repeats ${lb}%`);
      assert.doesNotMatch(answers, /points per game through Week/, abbr);
    });
  });
});
