const newsList = document.getElementById('newsList');

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildDot() {
  const dot = document.createElement('div');
  dot.className = 'avatar-dot';
  return dot;
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
    img.onerror = () => img.replaceWith(buildDot());
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
    link.innerHTML = 'Read article <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H4M10 2V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    body.appendChild(link);
  }

  card.appendChild(avatar);
  card.appendChild(body);
  return card;
}

async function loadNews() {
  try {
    const res = await fetch('/api/news?limit=250');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    newsList.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      newsList.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:48px 0;">No news yet.</p>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of data.items) {
      fragment.appendChild(renderCard(item));
    }
    newsList.appendChild(fragment);
  } catch (err) {
    newsList.innerHTML = '<p style="text-align:center;color:#dc2626;padding:48px 0;">Failed to load news.</p>';
  }
}

loadNews();
