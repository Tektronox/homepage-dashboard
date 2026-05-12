const REFRESH_MS = 30_000;

let statusData = {};

function dot(name) {
  const s = statusData[name];
  if (!s) return '<span class="dot"></span>';
  const cls = s.online ? 'online' : 'offline';
  return `<span class="dot ${cls}"></span>`;
}

function latency(name) {
  const s = statusData[name];
  if (!s) return '';
  if (!s.online) return 'offline';
  if (s.latencyMs == null) return '';
  return `${s.latencyMs}ms`;
}

function renderPublic(sites) {
  const grid = document.getElementById('grid-public');
  grid.innerHTML = sites.map(site => `
    <a class="card" href="${escHtml(site.url)}" target="_blank" rel="noopener noreferrer">
      <div class="card-top">
        <span class="card-name">${escHtml(site.name)}</span>
      </div>
      ${site.description ? `<div class="card-desc">${escHtml(site.description)}</div>` : ''}
      <div class="card-footer">
        ${dot(site.name)}
        <span class="card-latency" data-name="${escHtml(site.name)}">${latency(site.name)}</span>
      </div>
    </a>
  `).join('');
}

function renderLinks(links) {
  const list = document.getElementById('list-links');
  list.innerHTML = links.map(link => `
    <a class="link-item" href="${escHtml(link.url)}" target="_blank" rel="noopener noreferrer">
      <span class="link-name">${escHtml(link.name)}</span>
      ${link.description ? `<span class="link-desc">${escHtml(link.description)}</span>` : ''}
      <span class="link-arrow">↗</span>
    </a>
  `).join('');
}

function renderInternalCards(sites) {
  const grid = document.getElementById('grid-internal');
  grid.innerHTML = sites.map(site => `
    <a class="card" href="${escHtml(site.url)}" target="_blank" rel="noopener noreferrer">
      <div class="card-top">
        <span class="card-name">${escHtml(site.name)}</span>
      </div>
      ${site.description ? `<div class="card-desc">${escHtml(site.description)}</div>` : ''}
      <div class="card-footer">
        ${dot(site.name)}
        <span class="card-latency" data-name="${escHtml(site.name)}">${latency(site.name)}</span>
      </div>
    </a>
  `).join('');
}

function renderServices(services) {
  const list = document.getElementById('list-services');
  list.innerHTML = services.map(svc => `
    <div class="service-item">
      ${dot(svc.name)}
      <span class="service-name">${escHtml(svc.name)}</span>
      <span class="service-latency" data-name="${escHtml(svc.name)}">${latency(svc.name)}</span>
    </div>
  `).join('');
}

function updateStatusDots() {
  // Update dots and latency in public cards
  document.querySelectorAll('.card-footer').forEach(footer => {
    const latEl = footer.querySelector('[data-name]');
    if (!latEl) return;
    const name = latEl.dataset.name;
    const dotEl = footer.querySelector('.dot');
    const s = statusData[name];
    if (!s) return;
    dotEl.className = `dot ${s.online ? 'online' : 'offline'}`;
    latEl.textContent = latency(name);
  });

  // Update internal cards
  document.querySelectorAll('#grid-internal .card-footer').forEach(footer => {
    const latEl = footer.querySelector('[data-name]');
    if (!latEl) return;
    const name = latEl.dataset.name;
    const dotEl = footer.querySelector('.dot');
    const s = statusData[name];
    if (!s) return;
    dotEl.className = `dot ${s.online ? 'online' : 'offline'}`;
    latEl.textContent = latency(name);
  });

  // Update service rows
  document.querySelectorAll('.service-item').forEach(row => {
    const latEl = row.querySelector('[data-name]');
    if (!latEl) return;
    const name = latEl.dataset.name;
    const dotEl = row.querySelector('.dot');
    const s = statusData[name];
    if (!s) return;
    dotEl.className = `dot ${s.online ? 'online' : 'offline'}`;
    latEl.textContent = latency(name);
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
