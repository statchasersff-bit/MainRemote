const newsList = document.getElementById('newsList');
const pager = document.getElementById('pager');

// Cards are full-width horizontal rows stacked vertically (see styles.css), so
// each page is a fixed-length column of cards rather than a single row.
const PAGE_SIZE = 6;

function pageSize() {
  return PAGE_SIZE;
}

let allItems = [];
let currentPage = 0;

// Sleeper player-id -> team-abbrev map, used to pick the team-logo watermark.
const TEAMS_CACHE_KEY = 'sc_player_teams_v1';
const TEAMS_CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day
let playerTeams = null;

async function loadPlayerTeams() {
  try {
    const cached = JSON.parse(localStorage.getItem(TEAMS_CACHE_KEY) || 'null');
    if (cached && cached.teams && Date.now() - cached.ts < TEAMS_CACHE_TTL) {
      playerTeams = cached.teams;
      return;
    }
  } catch (_) { /* ignore bad cache */ }

  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    if (!res.ok) throw new Error(`Sleeper ${res.status}`);
    const data = await res.json();
    const teams = {};
    for (const id in data) {
      const team = data[id] && data[id].team;
      if (team) teams[id] = String(team).toLowerCase();
    }
    playerTeams = teams;
    try {
      localStorage.setItem(TEAMS_CACHE_KEY, JSON.stringify({ ts: Date.now(), teams }));
    } catch (_) { /* storage full / unavailable */ }
  } catch (_) {
    playerTeams = playerTeams || {};
  }
}

function playerIdFromImage(url) {
  const match = /\/players\/thumb\/(\d+)\./.exec(url || '');
  return match ? match[1] : null;
}

// Primary brand color per NFL team, keyed by Sleeper's lowercase abbreviation.
// Used to tint each card's headshot square instead of a single navy for all.
const TEAM_COLORS = {
  ari: '#97233F', atl: '#A71930', bal: '#241773', buf: '#00338D',
  car: '#0085CA', chi: '#0B162A', cin: '#FB4F14', cle: '#311D00',
  dal: '#041E42', den: '#FB4F14', det: '#0076B6', gb: '#203731',
  hou: '#03202F', ind: '#002C5F', jax: '#006778', kc: '#E31837',
  lac: '#0080C6', lar: '#003594', lv: '#101820', mia: '#008E97',
  min: '#4F2683', ne: '#002244', no: '#101820', nyg: '#0B2265',
  nyj: '#125740', phi: '#004C54', pit: '#101820', sea: '#002244',
  sf: '#AA0000', tb: '#D50A0A', ten: '#0C2340', was: '#5A1414',
};

// Secondary/accent color per team, used for the strip along the photo's edge.
const TEAM_ACCENTS = {
  ari: '#FFB612', atl: '#A5ACAF', bal: '#9E7C0C', buf: '#C60C30',
  car: '#BFC0BF', chi: '#C83803', cin: '#000000', cle: '#FF3C00',
  dal: '#869397', den: '#002244', det: '#B0B7BC', gb: '#FFB612',
  hou: '#A71930', ind: '#FFFFFF', jax: '#D7A22A', kc: '#FFB81C',
  lac: '#FFC20E', lar: '#FFD100', lv: '#A5ACAF', mia: '#FC4C02',
  min: '#FFC62F', ne: '#C60C30', no: '#D3BC8D', nyg: '#A71930',
  nyj: '#FFFFFF', phi: '#A5ACAF', pit: '#FFB612', sea: '#69BE28',
  sf: '#B3995D', tb: '#FF7900', ten: '#4B92DB', was: '#FFB612',
};

// The player's team abbreviation (lowercase), or null if unknown.
function teamAbbrev(item) {
  if (!playerTeams) return null;
  const id = playerIdFromImage(item.image);
  return (id && playerTeams[id]) || null;
}

function teamLogoUrl(team) {
  return team ? `https://sleepercdn.com/images/team_logos/nfl/${team}.png` : null;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;

  // Under 2 days old: show a relative "x ago" label.
  const diffMs = Date.now() - d.getTime();
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  if (diffMs >= 0 && diffMs < TWO_DAYS) {
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// First initial of the player name (or "SC") for the headshot fallback badge.
function initialFor(name) {
  const trimmed = (name || '').trim();
  return trimmed ? escapeHtml(trimmed[0].toUpperCase()) : 'SC';
}

function renderCard(item) {
  const link = item.link || '';
  const playerName = item.playerName ? escapeHtml(item.playerName) : '';
  const title = escapeHtml(item.title);
  const summary = item.summary ? escapeHtml(item.summary) : '';
  const date = escapeHtml(formatDate(item.pubDate));

  const mediaInner = item.image
    ? `<img class="sc-card-photo" src="${escapeHtml(item.image)}" alt="${playerName}" />`
    : `<div class="sc-card-photo-fallback">${initialFor(item.playerName)}</div>`;

  const tag = link ? 'a' : 'div';
  const linkAttrs = link
    ? ` href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer"`
    : '';

  const team = teamAbbrev(item);
  const logo = teamLogoUrl(team);
  const color = team ? TEAM_COLORS[team] : null;
  const accent = team ? TEAM_ACCENTS[team] : null;

  const cardClass = logo ? 'sc-card has-team-logo' : 'sc-card';
  const styleParts = [];
  if (logo) styleParts.push(`--sc-team-logo:url('${logo}')`);
  if (color) styleParts.push(`--sc-team-color:${color}`);
  if (accent) styleParts.push(`--sc-team-accent:${accent}`);
  const styleAttr = styleParts.length
    ? ` style="${escapeHtml(styleParts.join(';'))}"`
    : '';

  // The full headline (e.g. "Drake London: Nursing minor injury") is the heading.
  const titleBlock = `<h2 class="sc-card-name">${title}</h2>`;

  return `
    <${tag} class="${cardClass}"${linkAttrs}${styleAttr}>
      <div class="sc-card-media">
        ${mediaInner}
      </div>

      <div class="sc-card-body">
        <div class="sc-card-toprow">
          <span class="sc-card-label">Player News</span>
          ${date ? `<span class="sc-chip">${date}</span>` : ''}
        </div>

        ${titleBlock}

        ${summary ? `<p class="sc-card-summary">${summary}</p>` : ''}

        ${link ? '<div class="sc-card-cta">Read article <span aria-hidden="true">&rarr;</span></div>' : ''}
      </div>
    </${tag}>
  `;
}

// Swap a broken headshot for the initial-badge fallback.
function wireImageFallbacks() {
  newsList.querySelectorAll('.sc-card-photo').forEach((img) => {
    const swap = () => {
      const first = (img.getAttribute('alt') || '').trim()[0] || '';
      const initial = /[a-z0-9]/i.test(first) ? first.toUpperCase() : 'SC';
      img.outerHTML = `<div class="sc-card-photo-fallback">${initial}</div>`;
    };
    img.addEventListener('error', swap);
    if (img.complete && img.naturalWidth === 0) swap();
  });
}

function totalPages() {
  return Math.max(1, Math.ceil(allItems.length / pageSize()));
}

function renderPager() {
  if (allItems.length <= pageSize()) {
    pager.innerHTML = '';
    return;
  }
  const pages = totalPages();
  pager.innerHTML = `
    <button class="sc-pager-btn" data-dir="prev" ${currentPage === 0 ? 'disabled' : ''}>← Prev</button>
    <span class="sc-pager-status">${currentPage + 1} <span>of</span> ${pages}</span>
    <button class="sc-pager-btn" data-dir="next" ${currentPage >= pages - 1 ? 'disabled' : ''}>Next →</button>
  `;
}

function renderPage() {
  const size = pageSize();
  const start = currentPage * size;
  const pageItems = allItems.slice(start, start + size);
  newsList.innerHTML = pageItems.map(renderCard).join('');
  wireImageFallbacks();
  renderPager();
  // Report the freshly-rendered height so the embedding frame can never stay
  // stuck at a stale/oversized value from an earlier transient layout.
  postHeight();
}

pager.addEventListener('click', (e) => {
  const btn = e.target.closest('.sc-pager-btn');
  if (!btn || btn.disabled) return;
  currentPage += btn.dataset.dir === 'next' ? 1 : -1;
  currentPage = Math.max(0, Math.min(currentPage, totalPages() - 1));
  renderPage();
  newsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Re-paginate when the container width changes enough to fit a different number
// of cards per row (e.g. the embed is resized or the device is rotated). Anchor
// on the first card currently shown so the reader doesn't lose their place.
let lastPageSize = pageSize();
window.addEventListener('resize', () => {
  const size = pageSize();
  if (size === lastPageSize) return;
  const firstItem = currentPage * lastPageSize;
  lastPageSize = size;
  currentPage = Math.min(Math.floor(firstItem / size), totalPages() - 1);
  if (allItems.length) renderPage();
});

// preservePage keeps the reader on their current page during a background
// refresh; the initial load resets to the first page.
async function loadNews(preservePage = false) {
  try {
    const res = await fetch('/api/news?limit=250');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      if (!preservePage) {
        newsList.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:48px 0;">No news yet.</p>';
      }
      return;
    }

    allItems = data.items;
    currentPage = preservePage
      ? Math.min(currentPage, totalPages() - 1)
      : 0;
    renderPage();
  } catch (err) {
    // On a background refresh, keep showing the last good content.
    if (!preservePage) {
      newsList.innerHTML = '<p style="text-align:center;color:#dc2626;padding:48px 0;">Failed to load news.</p>';
    }
  }
}

// Self-refresh so an embedded widget picks up new items without a manual
// reload. Polls while visible; refreshes immediately on becoming visible.
const REFRESH_MS = 2 * 60 * 1000;
let refreshTimer = null;

function startAutoRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadNews(true);
  }, REFRESH_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadNews(true);
});

// When embedded in an iframe, report our content height to the parent page so
// it can size the frame to fit — no inner scrollbar, no fixed-height guessing.
const embedded = window.parent !== window;

function postHeight() {
  if (!embedded) return;
  // Measure the content wrapper directly. documentElement.scrollHeight is
  // clamped to the iframe's viewport height, so it can never shrink the frame
  // below its current size (it leaves whitespace). The .page element's own
  // height reflects the true content height regardless of the frame size.
  const page = document.querySelector('.page');
  const height = Math.ceil(
    page ? page.getBoundingClientRect().height : document.body.scrollHeight,
  );
  window.parent.postMessage({ type: 'statchasers:height', height }, '*');
}

if (embedded && 'ResizeObserver' in window) {
  // Observe the content wrapper (not documentElement, which is viewport-bound)
  // so we re-measure on every layout change: render, image load, pager, resize.
  const page = document.querySelector('.page');
  new ResizeObserver(postHeight).observe(page || document.body);
}
window.addEventListener('load', postHeight);

if (embedded) {
  // The parent's resize script (embed.js) can load late — performance plugins
  // such as WP Rocket / Perfmatters "delay JavaScript execution" until the user
  // interacts, so our load-time broadcast above is often missed. Two safeguards:
  // (1) answer an explicit height request whenever embed.js finally runs, and
  // (2) re-broadcast a few times after load so a late listener still catches up.
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'statchasers:request-height') postHeight();
  });
  [250, 1000, 2500, 5000].forEach((ms) => setTimeout(postHeight, ms));
}

// Apply team-logo watermarks as soon as the Sleeper map is ready.
loadPlayerTeams().then(() => {
  if (allItems.length) renderPage();
});
loadNews().then(startAutoRefresh);
