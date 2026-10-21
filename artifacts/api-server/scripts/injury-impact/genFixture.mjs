/**
 * Generate tests/fixtures/injury-impact-source-<date>.json from the standalone
 * app's own code: the memo bodies cut verbatim out of pages/Dashboard.tsx and
 * run over the packed data for several filter states.
 *
 *   node scripts/injury-impact/genFixture.mjs <app>/artifacts/injury-impact/src/pages/Dashboard.tsx . tests/fixtures/injury-impact-source-<date>.json
 *
 * Committed (unlike the redraft port's generator) so a re-port after the app
 * changes starts from a working cutter: clone the app, run the data builder,
 * then this, and the test holds the model to the new numbers.
 */
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";

const [srcFile, appDir, outFile] = process.argv.slice(2);
const src = fs.readFileSync(srcFile, "utf8");
const lines = src.split("\n");

/** Walk from `start` (index of an opening brace) to its matching close, skipping strings and comments. */
function matchBrace(text, start) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      i = text.indexOf("\n", i);
      if (i < 0) return -1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i = text.indexOf("*/", i) + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i += 1;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "`") {
      i += 1;
      while (i < text.length && text[i] !== "`") {
        if (text[i] === "\\") i += 2;
        else if (text[i] === "$" && text[i + 1] === "{") {
          const end = matchBrace(text, i + 1);
          i = end + 1;
        } else i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** The body of `const NAME = useMemo(... => { BODY }, [deps]);` */
function memoBody(name) {
  const m = src.indexOf(`const ${name} = useMemo(`);
  if (m < 0) throw new Error(`no memo ${name}`);
  const arrow = src.indexOf("=>", m);
  const after = src.slice(arrow + 2).match(/^\s*\{/);
  if (after) {
    const open = arrow + 2 + after[0].length - 1;
    const close = matchBrace(src, open);
    return src.slice(open + 1, close);
  }
  // An expression body: `() => Array.from(...)`, up to the deps array.
  const deps = src.indexOf("\n    [", arrow);
  const comma = src.lastIndexOf(",", deps);
  return ` return (${src.slice(arrow + 2, comma)}); `;
}

/** A `const NAME = ...;` statement inside the component. */
function constStmt(name) {
  const re = new RegExp(`^  const ${name}(?::[^=]*)? = `, "m");
  const m = src.match(re);
  if (!m) throw new Error(`no const ${name}`);
  const start = m.index;
  // to the first ';' at brace depth 0
  let i = start + m[0].length;
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) break;
    i += 1;
  }
  return src.slice(start, i + 1);
}

// Prelude: module-level constants and helpers (no imports, no JSX components).
const preludeStart = lines.findIndex((l) => l.startsWith("const CHART_COLORS"));
const preludeEnd = lines.findIndex((l) => l.startsWith("/** Sortable, sticky header cell. */"));
const prelude = lines.slice(preludeStart, preludeEnd).join("\n");

const MEMOS = [
  "seasonOptions", "filteredPlayers", "injuryOutcomes", "draftCapitalRisk", "injuryPredictability", "agingWorkload",
  "injuryTiming", "injuryTypeRisk", "seasonTrends", "seasonMetrics", "regionHeatmap", "workloadRates", "draftedByPosition",
  "positionImpact", "injuryTypeBreakdown", "injuryCategoryOptions", "injuryTypeVisible", "injuryTypeDisplay",
  "chart1Data", "chart2Data", "avgGamesMissedData", "chart3Data", "injuryRateData", "chart4Data",
];
const CONSTS = ["POS4", "AGE_BUCKETS", "TYPE_CLASS_ORDER", "TYPE_CLASS_COLOR"];

let body = "";
for (const c of CONSTS) body += constStmt(c) + "\n";
// Memos in source order so each sees what it depends on.
const ordered = MEMOS.slice().sort((a, b) => src.indexOf(`const ${a} = useMemo(`) - src.indexOf(`const ${b} = useMemo(`));
for (const name of ordered) body += `const ${name} = (() => {${memoBody(name)}})();\n`;

const ts = `
${prelude}
export function compute(data, exposure, regression, panel, postReturn, season, adpRange, minGamesMissed, injuryPos, injuryCategory, injurySearch, showAllInjuries) {
  const position = "All";
${body}
  return { ${MEMOS.join(", ")} };
}
`;
const js = transformSync(ts, { loader: "ts", format: "esm", target: "es2022" }).code;
const modFile = path.join(appDir, ".injury-impact-cut.mjs");
fs.writeFileSync(modFile, js);
const { compute } = await import(path.resolve(modFile));

const read = (f) => JSON.parse(fs.readFileSync(path.join(appDir, "data", "injury-impact", f), "utf8"));
const analysis = read("analysis.json");
const exposure = read("exposure.json");
const regression = read("regression.json");
const panelPacked = read("panel.json");
const panel = panelPacked.rows.map((r) => Object.fromEntries(panelPacked.keys.map((k, i) => [k, r[i]])));
const postReturn = read("post-return.json");

const STATES = {
  all: { season: "All", adp: [1, 180], minGames: 1, injuryPos: "all", injuryCategory: "all", injurySearch: "", showAll: false },
  s2023: { season: "2023", adp: [1, 180], minGames: 1, injuryPos: "all", injuryCategory: "all", injurySearch: "", showAll: false },
  top60: { season: "All", adp: [1, 60], minGames: 1, injuryPos: "RB", injuryCategory: "all", injurySearch: "", showAll: true },
  mid: { season: "2021", adp: [25, 120], minGames: 4, injuryPos: "all", injuryCategory: "Lower Body", injurySearch: "kn", showAll: false },
};

const sanitize = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Set ? [...x] : typeof x === "number" && !Number.isFinite(x) ? String(x) : x)));

const out = { source: "RESEARCH-Injury-Impact-Analysis c6a49ce pages/Dashboard.tsx", states: {} };
for (const [name, s] of Object.entries(STATES)) {
  const r = compute(analysis, exposure, regression, panel, postReturn, s.season, s.adp, [s.minGames], s.injuryPos, s.injuryCategory, s.injurySearch, s.showAll);
  out.states[name] = sanitize({
    filters: s,
    filteredCount: r.filteredPlayers.length,
    injuryOutcomes: r.injuryOutcomes,
    draftCapitalRisk: r.draftCapitalRisk,
    seasonTrends: r.seasonTrends,
    seasonMetrics: r.seasonMetrics,
    regionHeatmap: r.regionHeatmap,
    draftedByPosition: r.draftedByPosition,
    positionImpact: r.positionImpact,
    injuryTypeBreakdown: r.injuryTypeBreakdown,
    injuryCategoryOptions: r.injuryCategoryOptions,
    injuryTypeVisible: r.injuryTypeVisible,
    injuryTypeDisplay: r.injuryTypeDisplay,
    chart1Data: r.chart1Data,
    chart2Data: r.chart2Data,
    avgGamesMissedData: r.avgGamesMissedData,
    injuryRateData: r.injuryRateData,
    chart4Count: r.chart4Data.length,
  });
  if (name === "all") {
    out.static = sanitize({
      seasonOptions: r.seasonOptions,
      injuryPredictability: r.injuryPredictability,
      agingWorkload: r.agingWorkload,
      injuryTiming: r.injuryTiming,
      injuryTypeRisk: r.injuryTypeRisk,
      workloadRates: r.workloadRates,
    });
  }
}
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`wrote ${outFile} (${Math.round(fs.statSync(outFile).size / 1024)} KB)`);
