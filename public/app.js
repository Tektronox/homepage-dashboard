const REFRESH_MS = 30_000;

let statusData = {};

function dot(name) {
  const s = statusData[name];
  if (!s) return `<span class="dot" data-name="${escHtml(name)}"></span>`;
  const cls = s.online ? 'online' : 'offline';
  return `<span class="dot ${cls}" data-name="${escHtml(name)}"></span>`;
}

function faviconUrl(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=16`;
  } catch { return ''; }
}

function renderPublic(sites) {
  const grid = document.getElementById('grid-public');
  grid.innerHTML = sites.map(site => `
    <a class="card" href="${escHtml(site.url)}" target="_blank" rel="noopener noreferrer">
      <div class="card-top">
        ${dot(site.name)}
        <img class="favicon" src="${faviconUrl(site.url)}" alt="" width="14" height="14" />
        <span class="card-name">${escHtml(site.name)}</span>
      </div>
    </a>
  `).join('');
}

function renderLinks(links) {
  const list = document.getElementById('list-links');
  list.innerHTML = links.map(link => `
    <a class="link-item" href="${escHtml(link.url)}" target="_blank" rel="noopener noreferrer">
      <img class="favicon" src="${faviconUrl(link.url)}" alt="" width="14" height="14" />
      <span class="link-name">${escHtml(link.name)}</span>
      <span class="link-arrow">↗</span>
    </a>
  `).join('');
}

function renderInternalCards(sites) {
  const grid = document.getElementById('grid-internal');
  grid.innerHTML = sites.map(site => `
    <a class="card" href="${escHtml(site.url)}" target="_blank" rel="noopener noreferrer">
      <div class="card-top">
        ${dot(site.name)}
        <img class="favicon" src="${faviconUrl(site.url)}" alt="" width="14" height="14" />
        <span class="card-name">${escHtml(site.name)}</span>
      </div>
    </a>
  `).join('');
}

function renderServices(services) {
  const list = document.getElementById('list-services');
  list.innerHTML = services.map(svc => `
    <div class="service-item">
      ${dot(svc.name)}
      <img class="favicon" src="${faviconUrl(svc.url)}" alt="" width="14" height="14" />
      <span class="service-name">${escHtml(svc.name)}</span>
    </div>
  `).join('');
}

function updateStatusDots() {
  document.querySelectorAll('.dot[data-name]').forEach(dotEl => {
    const name = dotEl.dataset.name;
    const s = statusData[name];
    if (!s) return;
    const delay = dotEl.style.animationDelay;
    dotEl.className = `dot ${s.online ? 'online' : 'offline'}`;
    dotEl.style.animationDelay = delay;
  });
  updateSummary();
}

function updateSummary() {
  const entries = Object.values(statusData);
  if (entries.length === 0) return;
  const onlineCount = entries.filter(e => e.online).length;
  const total = entries.length;
  const summaryEl = document.getElementById('status-summary');
  summaryEl.textContent = `${onlineCount}/${total} services online`;

  const lastEl = document.getElementById('last-updated');
  const now = new Date();
  lastEl.textContent = `checked ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function applyWaveDelays() {
  const dots = document.querySelectorAll('.dot');
  const total = Math.max(dots.length - 1, 1);
  dots.forEach((dot, i) => {
    dot.style.animationDelay = `${(i / total) * 2.5}s`;
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('non-ok response');
    const { config, status } = await res.json();
    statusData = status || {};

    // Only render structure on first load
    if (!document.getElementById('grid-public').hasChildNodes()) {
      renderPublic(config.public);
      renderInternalCards(config.internal);
      renderLinks(config.links);
      renderServices(config.services);
      applyWaveDelays();
    }

    updateStatusDots();
  } catch (err) {
    console.error('Failed to fetch dashboard data:', err);
  }
}

// Initial load
fetchData();
// Periodic refresh of status only
setInterval(async () => {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) return;
    const { status } = await res.json();
    statusData = status || {};
    updateStatusDots();
  } catch { /* silent */ }
}, REFRESH_MS);
