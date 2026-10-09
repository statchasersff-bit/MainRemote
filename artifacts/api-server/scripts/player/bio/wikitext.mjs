/**
 * Wikipedia's player infobox, read with code (no language model): the
 * "Infobox gridiron football biography" template (and its older names) at the
 * top of a player's article, from the article's wikitext.
 *
 * Returns only what the template states, cleaned of markup:
 *   high_school, college[], draft {year, round, pick} or undrafted {year},
 *   teams [{team, from, to, offseason}], highlights {superBowls[], proBowls,
 *   allProFirst}.
 * A field the template leaves blank, or writes in a shape this file does not
 * recognize, is left out rather than guessed.
 */

/** Club names in Wikipedia's pastteams lists, by era, to StatChasers codes. */
export const TEAM_NAMES = {
  "Arizona Cardinals": "ARI", "Phoenix Cardinals": "ARI", "St. Louis Cardinals": "ARI",
  "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL", "Denver Broncos": "DEN",
  "Detroit Lions": "DET", "Green Bay Packers": "GB", "Houston Texans": "HOU",
  "Indianapolis Colts": "IND", "Baltimore Colts": "IND", "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Oakland Raiders": "LV", "Los Angeles Raiders": "LV",
  "Los Angeles Chargers": "LAC", "San Diego Chargers": "LAC",
  "Los Angeles Rams": "LAR", "St. Louis Rams": "LAR",
  "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN", "New England Patriots": "NE",
  "New Orleans Saints": "NO", "New York Giants": "NYG", "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT", "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN", "Tennessee Oilers": "TEN", "Houston Oilers": "TEN",
  "Washington Commanders": "WAS", "Washington Football Team": "WAS", "Washington Redskins": "WAS",
};

const INFOBOX = /\{\{\s*Infobox\s+(gridiron football biography|NFL biography|NFL player|NFL athlete|American football biography)\b/i;

/** The text of the template starting at `start` ("{{..."), braces balanced. */
function template(text, start) {
  let depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth += 1;
      i += 1;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Top-level "|" split: pipes inside {{ }} and [[ ]] belong to them. */
function splitTop(body) {
  const parts = [];
  let depthT = 0;
  let depthL = 0;
  let cur = "";
  for (let i = 0; i < body.length; i += 1) {
    const two = body.slice(i, i + 2);
    if (two === "{{") (depthT += 1), (cur += two), (i += 1);
    else if (two === "}}") (depthT -= 1), (cur += two), (i += 1);
    else if (two === "[[") (depthL += 1), (cur += two), (i += 1);
    else if (two === "]]") (depthL -= 1), (cur += two), (i += 1);
    else if (body[i] === "|" && depthT === 0 && depthL === 0) {
      parts.push(cur);
      cur = "";
    } else cur += body[i];
  }
  parts.push(cur);
  return parts;
}

export function infoboxParams(wikitext) {
  const m = INFOBOX.exec(wikitext ?? "");
  if (!m) return null;
  const t = template(wikitext, m.index);
  if (!t) return null;
  const params = {};
  for (const part of splitTop(t.slice(2, -2)).slice(1)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return params;
}

/** Wikitext to plain text: refs, comments and footnotes out; links to their labels. */
export function clean(s) {
  let out = String(s ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<br\s*\/?>/gi, " ");
  // Footnote templates go entirely; nowrap and similar keep their text.
  for (let i = 0; i < 5; i += 1) {
    out = out
      .replace(/\{\{\s*(efn|refn|ref|sfn|cite)[^{}]*\}\}/gi, "")
      .replace(/\{\{\s*(nowrap|small|nobr)\s*\|([^{}]*)\}\}/gi, "$2");
  }
  return out
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const int = (v) => {
  const n = Number.parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

/** "{{ubl|a|b}}", "* a\n* b" or "a, b" to a list of items, markup intact. */
function items(raw) {
  const ubl = /^\{\{\s*(ubl|unbulleted list|plainlist|flatlist)\s*\|([\s\S]*)\}\}$/i.exec(raw.trim());
  if (ubl) return splitTop(ubl[2]).map((x) => x.replace(/^\s*\*\s*/, "").trim()).filter(Boolean);
  if (/^\s*\*/m.test(raw)) return raw.split(/\n/).map((x) => x.replace(/^\s*\*\s*/, "").trim()).filter(Boolean);
  // "Nebraska (2018–2021)<br />Kansas State": a break separates schools.
  return raw.split(/<br\s*\/?>|\n/i).map((x) => x.trim()).filter(Boolean);
}

function highSchool(raw) {
  if (!raw) return null;
  const name = clean(raw.replace(/\{\{\s*nowrap\s*\|\s*\([\s\S]*?\)\s*\}\}/gi, "")).replace(/\s*\([^)]*\)\s*$/, "").trim();
  const place = /\(([^()]*)\)\s*$/.exec(clean(raw))?.[1] ?? null;
  return name ? { name, place } : null;
}

function colleges(raw) {
  if (!raw) return null;
  const list = items(raw)
    .map((x) => clean(x).replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter((x) => x && !/^\s*$/.test(x));
  return list.length ? list : null;
}

/** One pastteams line: "[[Team]] ({{NFL Year|2016|2020}})", "–present", "*" footnote. */
export function teamLine(line) {
  const text = clean(line.replace(/^\s*\*\s*/, "").replace(/\{\{\s*(NFL Year|nfly|NFLY|NFL year)\s*\|([^{}]*)\}\}/g, (_, __, args) => args.split("|").filter((a) => /^\d{4}$/.test(a.trim())).join("–")));
  const nameM = /^([^(]+?)\s*\(/.exec(text) ?? /^(.+)$/.exec(text);
  const name = nameM?.[1]?.replace(/\*$/, "").trim();
  const code = name ? TEAM_NAMES[name] : undefined;
  if (!code) return null;
  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (years.length === 0) return null;
  return {
    team: code,
    name,
    from: Math.min(...years),
    to: /present/i.test(text) ? null : Math.max(...years),
    // "*" marks an offseason or practice-squad-only stint in these boxes.
    offseason: /\)\s*\*|\*\s*$|\d\*/.test(text) || /practice squad/i.test(text),
  };
}

function highlights(raw) {
  const out = { superBowls: [], proBowls: null, allProFirst: null };
  if (!raw) return out;
  for (const line of raw.split(/\n/)) {
    const text = line.replace(/^\s*\*\s*/, "");
    const count = /^(\d+)\s*×/.exec(clean(text))?.[1];
    if (/Super Bowl champion/i.test(text)) {
      out.superBowls = [...text.matchAll(/\[\[Super Bowl ([LXVI]+|\d+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]);
    } else if (/^\s*(\d+×\s*)?\[\[Pro Bowl\]\]/i.test(text)) {
      out.proBowls = count ? Number(count) : 1;
    } else if (/^\s*(\d+×\s*)?First-team \[\[All-Pro\]\]/i.test(text)) {
      out.allProFirst = count ? Number(count) : 1;
    }
  }
  return out;
}

/** The infobox's facts, or null when the article has no recognized infobox. */
export function parseInfobox(wikitext) {
  const p = infoboxParams(wikitext);
  if (!p) return null;
  const draftYear = int(p.draftyear);
  const undraftedYear = int(p.undraftedyear);
  const teams = (p.pastteams ?? "")
    .split(/\n/)
    .filter((l) => /^\s*\*/.test(l))
    .map(teamLine)
    .filter(Boolean);
  return {
    high_school: highSchool(p.high_school),
    college: colleges(p.college),
    draft: draftYear && int(p.draftround) && int(p.draftpick) ? { year: draftYear, round: int(p.draftround), pick: int(p.draftpick) } : null,
    undrafted: !draftYear && undraftedYear ? { year: undraftedYear } : null,
    teams,
    highlights: highlights(p.highlights),
  };
}

/** Super Bowl name ("LI", "50") to the season it ended: LI -> 2016. */
export function superBowlSeason(name) {
  if (/^\d+$/.test(name)) return Number(name) + 1965;
  const v = { I: 1, V: 5, X: 10, L: 50 };
  let n = 0;
  for (let i = 0; i < name.length; i += 1) {
    const a = v[name[i]] ?? 0;
    const b = v[name[i + 1]] ?? 0;
    n += a < b ? -a : a;
  }
  return n > 0 ? n + 1965 : null;
}
