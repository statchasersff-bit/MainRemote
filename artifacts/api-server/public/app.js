const newsList = document.getElementById('newsList');
const pager = document.getElementById('pager');

const PAGE_SIZE = 3;
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

function teamLogoUrl(item) {
  if (!playerTeams) return null;
  const id = playerIdFromImage(item.image);
  const team = id && playerTeams[id];
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

  const logo = teamLogoUrl(item);
  const cardClass = logo ? 'sc-card has-team-logo' : 'sc-card';
  const styleAttr = logo ? ` style="--sc-team-logo:url('${escapeHtml(logo)}')"` : '';

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
  return Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
}

function renderPager() {
  if (allItems.length <= PAGE_SIZE) {
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
  const start = currentPage * PAGE_SIZE;
  const pageItems = allItems.slice(start, start + PAGE_SIZE);
  newsList.innerHTML = pageItems.map(renderCard).join('');
  wireImageFallbacks();
  renderPager();
}

pager.addEventListener('click', (e) => {
  const btn = e.target.closest('.sc-pager-btn');
  if (!btn || btn.disabled) return;
  currentPage += btn.dataset.dir === 'next' ? 1 : -1;
  currentPage = Math.max(0, Math.min(currentPage, totalPages() - 1));
  renderPage();
  newsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const height = Math.ceil(
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  );
  window.parent.postMessage({ type: 'statchasers:height', height }, '*');
}

if (embedded && 'ResizeObserver' in window) {
  // Fires on every layout change: render, image load, pager, font swap, resize.
  new ResizeObserver(postHeight).observe(document.documentElement);
}
window.addEventListener('load', postHeight);

// Apply team-logo watermarks as soon as the Sleeper map is ready.
loadPlayerTeams().then(() => {
  if (allItems.length) renderPage();
});
loadNews().then(startAutoRefresh);
