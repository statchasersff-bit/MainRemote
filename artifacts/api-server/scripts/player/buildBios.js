import fs from 'fs';
import path from 'path';
import { DATA_DIR as SC_DATA_DIR } from "./paths.mjs";

const DATA_DIR = SC_DATA_DIR;
const PLAYERS_FILE = path.resolve(DATA_DIR, 'players.json');
const INDEXED_FILE = path.resolve(DATA_DIR, 'indexed_players.json');
const DRAFT_FILE = path.resolve(DATA_DIR, 'draft.json');
const GAME_LOGS_DIR = path.resolve(DATA_DIR, 'game_logs');
const OUTPUT_FILE = path.resolve(DATA_DIR, 'bios.json');

const TEAM_ALIAS_MAP = {
  JAC: 'JAX', WSH: 'WAS', OAK: 'LV', STL: 'LAR', SD: 'LAC', LA: 'LAR',
};
function normalizeTeam(t) { return t ? (TEAM_ALIAS_MAP[t] || t) : t; }

const TEAM_FULL = {
  ARI:'Arizona Cardinals',ATL:'Atlanta Falcons',BAL:'Baltimore Ravens',BUF:'Buffalo Bills',
  CAR:'Carolina Panthers',CHI:'Chicago Bears',CIN:'Cincinnati Bengals',CLE:'Cleveland Browns',
  DAL:'Dallas Cowboys',DEN:'Denver Broncos',DET:'Detroit Lions',GB:'Green Bay Packers',
  HOU:'Houston Texans',IND:'Indianapolis Colts',JAX:'Jacksonville Jaguars',KC:'Kansas City Chiefs',
  LAC:'Los Angeles Chargers',LAR:'Los Angeles Rams',LV:'Las Vegas Raiders',MIA:'Miami Dolphins',
  MIN:'Minnesota Vikings',NE:'New England Patriots',NO:'New Orleans Saints',NYG:'New York Giants',
  NYJ:'New York Jets',PHI:'Philadelphia Eagles',PIT:'Pittsburgh Steelers',SEA:'Seattle Seahawks',
  SF:'San Francisco 49ers',TB:'Tampa Bay Buccaneers',TEN:'Tennessee Titans',WAS:'Washington Commanders',
};

const CURRENT_YEAR = 2025;

const BREAKOUT_THRESHOLDS = { QB: 19, RB: 14, WR: 13, TE: 10.5 };

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getFantasyPoints(stats, format) {
  let pts = 0;
  pts += (stats.pass_yd ?? 0) * 0.04;
  pts += (stats.pass_td ?? 0) * 4;
  pts += (stats.pass_int ?? 0) * -1;
  pts += (stats.rush_yd ?? 0) * 0.1;
  pts += (stats.rush_td ?? 0) * 6;
  pts += (stats.rec_yd ?? 0) * 0.1;
  pts += (stats.rec_td ?? 0) * 6;
  pts += (stats.fgm ?? 0) * 3;
  pts += (stats.xpm ?? 0) * 1;
  if (format === 'ppr') pts += (stats.rec ?? 0) * 1;
  else if (format === 'half') pts += (stats.rec ?? 0) * 0.5;
  return Math.round(pts * 100) / 100;
}

function getEntryPoints(stats, format) {
  if (format === 'ppr') return stats.pts_ppr ?? getFantasyPoints(stats, format);
  if (format === 'half') return stats.pts_half_ppr ?? getFantasyPoints(stats, format);
  return getFantasyPoints(stats, format);
}

function hasParticipation(stats, position) {
  if ((stats.off_snp ?? 0) > 0) return true;
  if (position === 'QB') return (stats.pass_att ?? 0) > 0 || (stats.rush_att ?? 0) > 0;
  if (position === 'K') return (stats.fga ?? 0) > 0 || (stats.xpa ?? 0) > 0;
  return (stats.rec_tgt ?? 0) > 0 || (stats.rec ?? 0) > 0 || (stats.rush_att ?? 0) > 0;
}

const logCache = {};
function loadGameLogs(season) {
  if (logCache[season]) return logCache[season];
  const f = path.resolve(GAME_LOGS_DIR, `${season}.json`);
  if (!fs.existsSync(f)) { logCache[season] = {}; return {}; }
  logCache[season] = JSON.parse(fs.readFileSync(f, 'utf8'));
  return logCache[season];
}

function getAvailableSeasons() {
  return fs.readdirSync(GAME_LOGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => parseInt(f.replace('.json', '')))
    .sort((a, b) => a - b);
}

function buildSeasonStats(playerId, position, season) {
  const logs = loadGameLogs(season);
  const pLogs = logs[playerId] || [];
  const played = pLogs.filter(e => hasParticipation(e.stats, position));
  if (played.length === 0) return null;

  const totalPts = played.reduce((sum, e) => sum + getEntryPoints(e.stats, 'ppr'), 0);
  const ppg = totalPts / played.length;

  let pass_yd = 0, pass_td = 0, pass_att = 0, pass_cmp = 0, pass_int = 0;
  let rush_yd = 0, rush_td = 0, rush_att = 0;
  let rec_yd = 0, rec_td = 0, rec = 0, rec_tgt = 0;

  const weeklyPts = [];

  for (const e of played) {
    const s = e.stats;
    pass_yd += s.pass_yd ?? 0; pass_td += s.pass_td ?? 0;
    pass_att += s.pass_att ?? 0; pass_cmp += s.pass_cmp ?? 0;
    pass_int += s.pass_int ?? 0;
    rush_yd += s.rush_yd ?? 0; rush_td += s.rush_td ?? 0;
    rush_att += s.rush_att ?? 0;
    rec_yd += s.rec_yd ?? 0; rec_td += s.rec_td ?? 0;
    rec += s.rec ?? 0; rec_tgt += s.rec_tgt ?? 0;
    weeklyPts.push(getEntryPoints(s, 'ppr'));
  }

  const mean = ppg;
  const variance = weeklyPts.length > 1
    ? weeklyPts.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (weeklyPts.length - 1)
    : 0;
  const weeklyStdDev = Math.sqrt(variance);

  return {
    year: season, games: played.length, ppg, totalPts, weeklyStdDev,
    passing: { yards: pass_yd, tds: pass_td, atts: pass_att, cmps: pass_cmp, ints: pass_int },
    rushing: { yards: rush_yd, tds: rush_td, atts: rush_att },
    receiving: { yards: rec_yd, tds: rec_td, recs: rec, tgts: rec_tgt },
  };
}

function computeDerived(pos, seasons, draft) {
  const rookieYear = draft?.year || draft?.rookie_year || (seasons.length > 0 ? seasons[0].year : null);

  const bestSeason = seasons.length > 0
    ? seasons.reduce((best, s) => s.ppg > best.ppg ? s : best, seasons[0])
    : null;

  const threshold = BREAKOUT_THRESHOLDS[pos] || 14;
  // Breakout = first season crossing the threshold AFTER at least one season below it.
  // If the earliest season in the dataset already meets the threshold we cannot confirm
  // a breakout occurred within the data window, so we leave it null.
  let breakoutSeason = null;
  for (let i = 1; i < seasons.length; i++) {
    const hadBelowThreshold = seasons.slice(0, i).some(s => s.ppg < threshold);
    if (hadBelowThreshold && seasons[i].ppg >= threshold && seasons[i].games >= 8) {
      breakoutSeason = seasons[i];
      break;
    }
  }

  let trend = null;
  if (seasons.length >= 2) {
    const last = seasons[seasons.length - 1];
    const prev = seasons[seasons.length - 2];
    trend = last.ppg - prev.ppg;
  }

  const last3 = seasons.slice(-3);
  const avgGamesLast3 = last3.length > 0
    ? last3.reduce((sum, s) => sum + s.games, 0) / last3.length
    : null;

  const lastSeason = seasons.length > 0 ? seasons[seasons.length - 1] : null;

  return { rookieYear, bestSeason, breakoutSeason, trend, avgGamesLast3, lastSeason };
}

function roleDescriptor(pos, lastSeason) {
  if (!lastSeason) return 'depth option';
  const threshold = BREAKOUT_THRESHOLDS[pos] || 14;
  if (lastSeason.games >= 10 && lastSeason.ppg >= threshold) return 'high-end fantasy starter';
  if (lastSeason.games >= 10) return 'weekly fantasy option';
  return 'depth option';
}

function buildSnapshotBullets({ name, pos, team, draft, seasons, derived }) {
  const bullets = [];
  const teamFull = TEAM_FULL[team] || team;

  if (draft && draft.year && draft.round && draft.pick) {
    bullets.push(`Drafted ${draft.year}: Round ${draft.round}, Pick ${draft.pick} (${draft.draft_team || team})`);
  }

  if (derived.rookieYear) {
    const role = roleDescriptor(pos, derived.lastSeason);
    bullets.push(`Entered the league in ${derived.rookieYear} and developed into a ${role}.`);
  }

  if (derived.breakoutSeason) {
    const label = pos === 'QB' ? 'QB1-level' : 'starter-level';
    bullets.push(`Broke out in ${derived.breakoutSeason.year}, establishing ${label} fantasy production.`);
  }

  if (derived.bestSeason && (!derived.breakoutSeason || derived.bestSeason.year !== derived.breakoutSeason.year)) {
    bullets.push(`Career peak: ${derived.bestSeason.year} (${derived.bestSeason.ppg.toFixed(1)} PPG).`);
  }

  if (derived.avgGamesLast3 !== null && seasons.length >= 2) {
    if (derived.avgGamesLast3 >= 14) {
      bullets.push(`Generally available year-to-year, averaging ${derived.avgGamesLast3.toFixed(1)} games over the last ${Math.min(seasons.length, 3)} seasons.`);
    } else if (derived.avgGamesLast3 <= 11) {
      bullets.push(`Availability has been a factor recently, averaging ${derived.avgGamesLast3.toFixed(1)} games over the last ${Math.min(seasons.length, 3)} seasons.`);
    }
  }

  if (derived.lastSeason) {
    const lastGames = derived.lastSeason.games;
    if (lastGames >= 10) {
      bullets.push(`Enters ${CURRENT_YEAR + 1} as the ${teamFull} ${pos} with a clear role in the offense.`);
    } else {
      bullets.push(`Enters ${CURRENT_YEAR + 1} with role volatility that can swing weekly fantasy outcomes.`);
    }
  }

  return bullets.slice(0, 6);
}

function buildStyle({ pos, seasons, derived }) {
  const recent = derived.lastSeason;
  if (!recent) return null;

  let howHeWins = '';
  let howHeWinsTags = [];
  let fantasyTranslation = '';
  let fantasyTranslationTags = [];

  if (pos === 'QB') {
    const rushYPG = recent.games > 0 ? recent.rushing.yards / recent.games : 0;
    const passYPG = recent.games > 0 ? recent.passing.yards / recent.games : 0;
    const isDual = rushYPG >= 25 || recent.rushing.tds >= 3;

    if (isDual) {
      howHeWins = 'Creates production with both arm and legs, extending plays and adding rushing value when passing efficiency dips.';
      howHeWinsTags.push('Dual-threat');
      if (rushYPG >= 35) howHeWinsTags.push('Rushing floor');
    } else {
      howHeWins = 'Wins with pocket passing and volume-driven production when the offense is operating efficiently.';
      howHeWinsTags.push('Pocket passer');
    }
    if (passYPG >= 260) howHeWinsTags.push('Volume passer');
    if (recent.passing.tds >= 20) howHeWinsTags.push('Red-zone threat');
    if (rushYPG >= 15 && !isDual) howHeWinsTags.push('Scrambler');

    const ppgStable = derived.trend !== null ? Math.abs(derived.trend) < 3 : false;
    if (ppgStable && seasons.length >= 2) howHeWinsTags.push('Stable weekly role');

    if (isDual) {
      fantasyTranslation = 'Weekly ceiling is driven by multi-touchdown games, while rushing attempts stabilize floor even in quieter passing weeks.';
      fantasyTranslationTags.push('Rushing floor', 'High ceiling');
    } else {
      fantasyTranslation = 'Value is tied closely to passing efficiency and TD production. Volume games create the ceiling.';
      fantasyTranslationTags.push('TD-driven', 'Volume-dependent');
    }
    if (recent.ppg >= 20) fantasyTranslationTags.push('Elite weekly output');
    else if (recent.ppg >= 15) fantasyTranslationTags.push('Solid starter');
  }

  if (pos === 'RB') {
    const tgtPerGame = recent.games > 0 ? recent.receiving.tgts / recent.games : 0;
    const recPerGame = recent.games > 0 ? recent.receiving.recs / recent.games : 0;
    const passGameRole = tgtPerGame >= 3 || recent.receiving.tgts > 30;
    const rushDominant = recent.rushing.atts > 150;
    const goalLine = recent.rushing.tds >= 6;
    const carriesPerGame = recent.games > 0 ? recent.rushing.atts / recent.games : 0;

    if (passGameRole) {
      howHeWins = 'Produces through a blend of rushing volume and receiving usage, keeping weekly output stable across game scripts.';
      howHeWinsTags.push('Pass-game role');
    } else {
      howHeWins = 'Primarily a rushing-based producer whose weekly output is tied to carries and touchdown opportunities.';
      howHeWinsTags.push('Volume runner');
    }
    if (carriesPerGame >= 15) howHeWinsTags.push('Workhorse');
    if (goalLine) howHeWinsTags.push('Goal-line equity');
    if (tgtPerGame >= 4) howHeWinsTags.push('Target earner');

    if (passGameRole) {
      fantasyTranslation = 'Floor comes from consistent target volume; ceiling spikes when rushing TDs and receiving work converge.';
      fantasyTranslationTags.push('Volume-driven', 'PPR boost');
    } else {
      fantasyTranslation = 'Fantasy production tracks directly with carry volume and TD opportunities. Standard/half formats benefit most.';
      fantasyTranslationTags.push('Rushing floor', 'TD equity');
    }
    if (recent.ppg >= 14) fantasyTranslationTags.push('High weekly ceiling');
  }

  if (pos === 'WR') {
    const tgtPerGame = recent.games > 0 ? recent.receiving.tgts / recent.games : 0;
    const highVolume = tgtPerGame >= 7 || recent.receiving.tgts > 100;
    const ypc = recent.receiving.recs > 0 ? recent.receiving.yards / recent.receiving.recs : 0;
    const deepThreat = ypc >= 15;
    const redZone = recent.receiving.tds >= 7;
    const weeklyVariance = recent.weeklyStdDev;

    if (highVolume) {
      howHeWins = 'Functions as a primary read in the passing game, stacking targets and converting volume into consistent weekly production.';
      howHeWinsTags.push('Target earner');
    } else if (deepThreat) {
      howHeWins = 'Operates as an explosive, downfield option—lower target volume but high leverage looks that can spike weeks.';
      howHeWinsTags.push('Deep threat');
    } else {
      howHeWins = 'Profiles as a complementary receiver whose fantasy output swings with weekly usage and efficiency.';
      howHeWinsTags.push('Complementary');
    }
    if (ypc <= 11 && recent.receiving.recs > 40) howHeWinsTags.push('YAC-driven');
    if (redZone) howHeWinsTags.push('Red-zone threat');
    if (recent.rushing.atts > 15) howHeWinsTags.push('Rushing usage');
    if (weeklyVariance >= 10) howHeWinsTags.push('Spike-week profile');

    if (highVolume) {
      fantasyTranslation = 'Floor comes from consistent target volume; ceiling spikes when deep targets and red-zone looks converge.';
      fantasyTranslationTags.push('Volume-driven', 'High floor');
    } else if (deepThreat) {
      fantasyTranslation = 'Boom/bust profile where weekly output can be volatile. Spike weeks drive season-long value.';
      fantasyTranslationTags.push('Boom/Bust', 'High weekly ceiling');
    } else {
      fantasyTranslation = 'Depth piece whose value is situational and format-dependent.';
      fantasyTranslationTags.push('Role-dependent');
    }
    if (redZone) fantasyTranslationTags.push('TD upside');
  }

  if (pos === 'TE') {
    const tgtPerGame = recent.games > 0 ? recent.receiving.tgts / recent.games : 0;
    const highVolume = tgtPerGame >= 5 || recent.receiving.tgts > 80;
    const redZone = recent.receiving.tds >= 5;

    if (highVolume) {
      howHeWins = 'Wins through steady involvement underneath, relying on target volume more than splash plays.';
      howHeWinsTags.push('Volume TE', 'Target earner');
    } else if (redZone) {
      howHeWins = 'Provides fantasy value through high-leverage red-zone usage, with weekly output often tied to touchdowns.';
      howHeWinsTags.push('Red-zone role');
    } else {
      howHeWins = 'Functions as a secondary receiving option with blocking duties, generating situational fantasy value.';
      howHeWinsTags.push('Complementary role');
    }
    if (recent.receiving.recs > 50) howHeWinsTags.push('PPR asset');
    if (redZone && !highVolume) howHeWinsTags.push('TD-dependent');

    if (highVolume) {
      fantasyTranslation = 'One of the rare TEs who provides consistent weekly production. Position advantage is significant in PPR.';
      fantasyTranslationTags.push('Positional edge', 'PPR star');
    } else if (redZone) {
      fantasyTranslation = 'Floor can be thin without a touchdown, but red-zone usage creates spike-week potential.';
      fantasyTranslationTags.push('TD-dependent', 'Spike potential');
    } else {
      fantasyTranslation = 'Streaming candidate whose value comes from TD-dependent weeks and favorable matchups.';
      fantasyTranslationTags.push('TD-dependent', 'Streaming option');
    }
  }

  if (!howHeWins) return null;
  return {
    how_he_wins: howHeWins,
    how_he_wins_tags: howHeWinsTags.slice(0, 4),
    fantasy_translation: fantasyTranslation,
    fantasy_translation_tags: fantasyTranslationTags.slice(0, 4),
  };
}

function buildTimeline({ pos, draft, seasons, derived }) {
  const timeline = [];

  if (draft && draft.year && draft.round && draft.pick) {
    const college = draft.college ? ` out of ${draft.college}` : '';
    timeline.push({
      label: String(draft.year),
      badge: 'Drafted',
      text: `Selected Round ${draft.round}, Pick ${draft.pick} by ${TEAM_FULL[draft.draft_team] || draft.draft_team || ''}${college}.`,
    });
  } else if (derived.rookieYear) {
    timeline.push({
      label: String(derived.rookieYear),
      badge: 'Early career',
      text: `Entered the league and began carving out a role.`,
    });
  }

  if (derived.breakoutSeason) {
    timeline.push({
      label: String(derived.breakoutSeason.year),
      badge: 'Breakout',
      text: `Production climbed into ${pos}-starter territory (${derived.breakoutSeason.ppg.toFixed(1)} PPG across ${derived.breakoutSeason.games} games).`,
    });
  }

  if (derived.bestSeason && (!derived.breakoutSeason || derived.bestSeason.year !== derived.breakoutSeason.year)) {
    timeline.push({
      label: String(derived.bestSeason.year),
      badge: 'Peak',
      text: `Career-high fantasy production with ${derived.bestSeason.ppg.toFixed(1)} PPG across ${derived.bestSeason.games} games.`,
    });
  }

  for (const s of seasons) {
    if (s.games <= 8 && s !== derived.lastSeason && seasons.length >= 3) {
      const exists = timeline.some(t => t.label === String(s.year));
      if (!exists) {
        timeline.push({
          label: String(s.year),
          badge: 'Injury',
          text: `Limited to ${s.games} games, impacting overall fantasy value.`,
        });
      }
    }
  }

  if (derived.trend !== null && seasons.length >= 2) {
    const last = seasons[seasons.length - 1];
    let badge, text;
    if (derived.trend >= 2.0) {
      badge = 'Uptrend';
      text = `Recent production has been trending upward, with ${last.ppg.toFixed(1)} PPG in ${last.year}.`;
    } else if (derived.trend <= -2.0) {
      badge = 'Downtrend';
      text = `Recent production has dipped, posting ${last.ppg.toFixed(1)} PPG in ${last.year}.`;
    } else {
      badge = 'Stable';
      text = `Production has remained steady, averaging ${last.ppg.toFixed(1)} PPG in ${last.year}.`;
    }
    const exists = timeline.some(t => t.label === String(last.year));
    if (!exists) {
      timeline.push({ label: String(last.year), badge, text });
    }
  }

  const seen = new Set();
  const deduped = timeline.filter(t => {
    const key = t.label + t.badge;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, 8);
}

function buildCareerContextTiles({ pos, seasons, derived }) {
  const tiles = [];
  const recent = derived.lastSeason;
  if (!recent) return tiles;

  if (pos === 'QB') {
    const rushYPG = recent.games > 0 ? recent.rushing.yards / recent.games : 0;
    tiles.push({
      title: 'Floor driver',
      text: rushYPG >= 25 ? 'Rushing usage' : 'Passing volume/efficiency',
    });
    tiles.push({
      title: 'Ceiling driver',
      text: 'Multi-TD games + rushing TDs',
    });
  } else if (pos === 'RB') {
    const tgtPerGame = recent.games > 0 ? recent.receiving.tgts / recent.games : 0;
    tiles.push({
      title: 'Floor driver',
      text: tgtPerGame >= 3 ? 'Receiving work' : 'Carry volume',
    });
    tiles.push({
      title: 'Ceiling driver',
      text: 'Goal-line equity + big plays',
    });
  } else if (pos === 'WR') {
    const tgtPerGame = recent.games > 0 ? recent.receiving.tgts / recent.games : 0;
    tiles.push({
      title: 'Floor driver',
      text: tgtPerGame >= 7 ? 'Target volume' : 'High-leverage targets',
    });
    tiles.push({
      title: 'Ceiling driver',
      text: 'Deep targets + TDs',
    });
  } else if (pos === 'TE') {
    const tgtPerGame = recent.games > 0 ? recent.receiving.tgts / recent.games : 0;
    tiles.push({
      title: 'Floor driver',
      text: tgtPerGame >= 5 ? 'Targets' : 'Red-zone usage',
    });
    tiles.push({
      title: 'Ceiling driver',
      text: 'Red-zone TDs',
    });
  }

  if (recent.weeklyStdDev < 5) {
    tiles.push({ title: 'Stability', text: 'Stable role in offense' });
  } else if (recent.weeklyStdDev < 9) {
    tiles.push({ title: 'Stability', text: 'Moderate role in offense' });
  } else {
    tiles.push({ title: 'Stability', text: 'Volatile role in offense' });
  }

  let riskText = 'Scheme/usage swings';
  if (derived.avgGamesLast3 !== null && derived.avgGamesLast3 <= 11) {
    riskText = 'Availability';
  } else if (derived.trend !== null && derived.trend <= -3) {
    riskText = 'Role decline risk';
  } else if (pos === 'TE' && recent.receiving.tgts < 60 && recent.receiving.tds >= 4) {
    riskText = 'TD dependency';
  } else if (pos === 'WR' && recent.receiving.tgts < 70 && recent.receiving.tds >= 5) {
    riskText = 'TD dependency';
  }
  tiles.push({ title: 'Risk note', text: riskText });

  return tiles;
}

function buildNarrative({ name, pos, team, draft, seasons, derived, style, tiles }) {
  const teamFull = TEAM_FULL[team] || team;
  const paragraphs = [];

  let p1 = '';
  if (draft && draft.year && draft.round && draft.pick) {
    const college = draft.college || 'college';
    p1 = `${name} entered the NFL as a ${ordinal(draft.round)}-round pick (${draft.pick} overall) in ${draft.year} out of ${college}.`;
  } else {
    p1 = `${name} entered the NFL and began establishing a role at ${pos} for the ${teamFull}.`;
  }
  if (derived.rookieYear && seasons.length > 0) {
    const secondYear = derived.rookieYear + 1;
    if (seasons.some(s => s.year <= secondYear && s.games >= 4)) {
      p1 += ` By ${secondYear}, he was seeing meaningful snaps, setting the foundation for his fantasy profile.`;
    }
  }
  paragraphs.push(p1);

  if (seasons.length >= 2) {
    let p2 = '';
    if (derived.breakoutSeason) {
      p2 = `The turning point came in ${derived.breakoutSeason.year}, when his production climbed into ${pos}-starter territory (${derived.breakoutSeason.ppg.toFixed(1)} PPG).`;
    }
    if (derived.bestSeason && (!derived.breakoutSeason || derived.bestSeason.year !== derived.breakoutSeason.year)) {
      const peak = ` His peak arrived in ${derived.bestSeason.year}, delivering his best combination of volume and fantasy output (${derived.bestSeason.ppg.toFixed(1)} PPG across ${derived.bestSeason.games} games).`;
      p2 += peak;
    }
    if (p2) paragraphs.push(p2);
  }

  const floorTile = tiles.find(t => t.title === 'Floor driver');
  const ceilingTile = tiles.find(t => t.title === 'Ceiling driver');
  if (floorTile && ceilingTile) {
    paragraphs.push(
      `For fantasy managers, his floor is driven by ${floorTile.text.toLowerCase()}, while his ceiling spikes when ${ceilingTile.text.toLowerCase()} hit in the same week.`
    );
  }

  const riskTile = tiles.find(t => t.title === 'Risk note');
  if (riskTile && riskTile.text !== 'Scheme/usage swings') {
    paragraphs.push(
      `The main variable going forward is ${riskTile.text.toLowerCase()}, which can create week-to-week variance even when the overall role remains intact.`
    );
  }

  return paragraphs;
}

function defaultSources() {
  return [
    { label: 'Sleeper', url: 'https://sleeper.com' },
    { label: 'NFL', url: 'https://www.nfl.com/players/' },
    { label: 'Pro-Football-Reference', url: 'https://www.pro-football-reference.com' },
  ];
}

async function main() {
  console.log('Building bios (deterministic, fact-based)...');

  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  const indexed = JSON.parse(fs.readFileSync(INDEXED_FILE, 'utf8'));
  const allSlugs = indexed.slugs || [];

  let draftMap = {};
  if (fs.existsSync(DRAFT_FILE)) {
    draftMap = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf8'));
  }

  const seasons = getAvailableSeasons();
  console.log(`Processing ${allSlugs.length} indexed players across seasons: ${seasons.join(', ')}`);

  const playersBySlug = {};
  for (const p of Object.values(players)) {
    playersBySlug[p.slug] = p;
  }

  const bios = {};
  let count = 0;

  for (const slug of allSlugs) {
    const player = playersBySlug[slug];
    if (!player) continue;
    const pos = player.position;
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;

    const team = normalizeTeam(player.team);
    const name = player.name;
    const draft = draftMap[slug] || null;

    const seasonStats = [];
    for (const s of seasons) {
      const ss = buildSeasonStats(player.id, pos, s);
      if (ss) seasonStats.push(ss);
    }

    if (seasonStats.length === 0) {
      bios[slug] = {
        snapshot_bullets: [`${name} is a ${pos} for the ${TEAM_FULL[team] || team}.`],
        style: null,
        timeline: [],
        career_context_tiles: [],
        narrative_paragraphs: [`${name} is a ${pos} currently with the ${TEAM_FULL[team] || team}. Limited game data is available for this player.`],
        last_updated: new Date().toISOString().slice(0, 10),
        sources: defaultSources(),
      };
      count++;
      continue;
    }

    const derived = computeDerived(pos, seasonStats, draft);
    const snapshot_bullets = buildSnapshotBullets({ name, pos, team, draft, seasons: seasonStats, derived });
    const style = buildStyle({ pos, seasons: seasonStats, derived });
    const timeline = buildTimeline({ pos, draft, seasons: seasonStats, derived });
    const career_context_tiles = buildCareerContextTiles({ pos, seasons: seasonStats, derived });
    const narrative_paragraphs = buildNarrative({ name, pos, team, draft, seasons: seasonStats, derived, style, tiles: career_context_tiles });

    bios[slug] = {
      snapshot_bullets,
      style,
      timeline,
      career_context_tiles,
      narrative_paragraphs,
      last_updated: new Date().toISOString().slice(0, 10),
      sources: defaultSources(),
    };

    count++;
    if (count % 100 === 0) process.stdout.write(`  ${count}/${allSlugs.length}\n`);
  }

  console.log(`\nGenerated bios for ${count} players`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(bios, null, 2));
  console.log(`Saved to ${OUTPUT_FILE}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
