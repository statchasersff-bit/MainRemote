const newsGrid = document.getElementById('newsGrid');
const emptyState = document.getElementById('emptyState');
const statusBar = document.getElementById('statusBar');
const newsCount = document.getElementById('newsCount');
const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');

let searchTimer = null;

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderCard(item) {
  const card = document.createElement('div');
  card.className = 'news-card';

  const avatar = document.createElement('div');
  avatar.className = 'news-card-avatar';

  if (item.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.playerName || '';
    img.onerror = () => {
      img.replaceWith(buildDot());
    };
    avatar.appendChild(img);
  } else {
    avatar.appendChild(buildDot());
  }

  const body = document.createElement('div');
  body.className = 'news-card-body';

  if (item.playerName) {
    const player = document.createElement('div');
    player.className = 'news-card-player';
    player.textContent = item.playerName;
    body.appendChild(player);
  }

  const title = document.createElement('div');
  title.className = 'news-card-title';
  title.textContent = item.title;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'news-card-meta';

  if (item.pubDate) {
    const date = document.createElement('span');
    date.className = 'news-card-date';
    date.textContent = formatDate(item.pubDate);
    meta.appendChild(date);
  }

  const source = document.createElement('span');
  source.className = 'news-card-source';
  source.textContent = item.source || 'Dynasty Command';
  meta.appendChild(source);

  body.appendChild(meta);

  if (item.link) {
    const link = document.createElement('a');
    link.className = 'news-card-link';
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.innerHTML = 'Read article <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 10L10 2M10 2H4M10 2V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    body.appendChild(link);
  }

  card.appendChild(avatar);
  card.appendChild(body);
  return card;
}

function buildDot() {
  const dot = document.createElement('div');
  dot.className = 'avatar-dot';
  return dot;
}

function showStatus(message, type = 'info') {
  statusBar.textContent = message;
  statusBar.className = `status-bar ${type}`;
  statusBar.classList.remove('hidden');
  setTimeout(() => statusBar.classList.add('hidden'), 5000);
}

async function loadNews(query = '') {
  const params = new URLSearchParams({ limit: '100' });
  if (query) params.set('search', query);

  try {
    const res = await fetch(`/api/news?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    newsGrid.innerHTML = '';
    emptyState.classList.add('hidden');

    if (!data.items || data.items.length === 0) {
      newsCount.textContent = '';
      emptyState.classList.remove('hidden');
      return;
    }

    newsCount.textContent = `${data.items.length} ${data.items.length === 1 ? 'headline' : 'headlines'}${query ? ` matching "${query}"` : ''}`;

    const fragment = document.createDocumentFragment();
    for (const item of data.items) {
      fragment.appendChild(renderCard(item));
    }
    newsGrid.appendChild(fragment);
  } catch (err) {
    newsGrid.innerHTML = '';
    showStatus('Failed to load news. Please try again.', 'error');
  }
}

async function runRefresh() {
  refreshBtn.disabled = true;
  const btnIcon = refreshBtn.querySelector('.btn-icon');
  btnIcon.classList.add('spinning');
  showStatus('Fetching latest news from Dynasty Command…', 'info');

  try {
    const res = await fetch('/api/ingest', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const msg = `Done — ${data.total} items processed (${data.inserted} new, ${data.updated} updated)`;
    showStatus(msg, 'success');
    await loadNews(searchInput.value.trim());
  } catch (err) {
    showStatus('Refresh failed. Check your connection and try again.', 'error');
  } finally {
    refreshBtn.disabled = false;
    btnIcon.classList.remove('spinning');
  }
}

// Search with debounce
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadNews(searchInput.value.trim());
  }, 300);
});

refreshBtn.addEventListener('click', runRefresh);

// Initial load
loadNews();
