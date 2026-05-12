import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const CHECK_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

// Load config
const config = JSON.parse(readFileSync(join(__dirname, 'config/sites.json'), 'utf8'));

// Collect all monitored entries: { name, url, section }
const monitored = [
  ...config.public.filter(s => s.monitor).map(s => ({ ...s, section: 'public' })),
  ...config.internal.filter(s => s.monitor).map(s => ({ ...s, section: 'internal' })),
  ...(config.services || []).filter(s => s.monitor).map(s => ({ ...s, section: 'services' })),
];

// In-memory cache: name -> { online, latencyMs, lastChecked }
const statusCache = new Map();

async function checkSite(site) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(site.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'schelbert-healthcheck/1.0' },
    });
    clearTimeout(timer);
    return {
      online: res.ok || (res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403,
      latencyMs: Date.now() - start,
    };
  } catch {
    clearTimeout(timer);
    return { online: false, latencyMs: null };
  }
}

async function runChecks() {
  await Promise.allSettled(
    monitored.map(async site => {
      const result = await checkSite(site);
      statusCache.set(site.name, {
        online: result.online,
        latencyMs: result.latencyMs,
        lastChecked: new Date().toISOString(),
      });
    })
  );
}

// Run immediately, then on interval
runChecks();
setInterval(runChecks, CHECK_INTERVAL_MS);

// In-memory favicon cache: origin -> { contentType, buffer } | null
const faviconCache = new Map();

async function resolveFavicon(siteUrl) {
  let origin;
  try { origin = new URL(siteUrl).origin; } catch { return null; }
  if (faviconCache.has(origin)) return faviconCache.get(origin);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    // 1. Fetch HTML and look for <link rel="icon">
    const htmlRes = await fetch(siteUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'schelbert-favicon/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    const html = await htmlRes.text();
    // Match <link ... rel="...icon..." ...> with href
    const match = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
               || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i);
    const iconPath = match ? match[1] : '/favicon.ico';
    const iconUrl = iconPath.startsWith('http') ? iconPath : new URL(iconPath, origin).href;

    // 2. Fetch the icon itself
    const iconRes = await fetch(iconUrl, {
      signal: new AbortController().signal,
      headers: { 'User-Agent': 'schelbert-favicon/1.0' },
    });
    if (!iconRes.ok) { faviconCache.set(origin, null); return null; }
    const buffer = Buffer.from(await iconRes.arrayBuffer());
    const contentType = iconRes.headers.get('content-type') || 'image/x-icon';
    const entry = { buffer, contentType };
    faviconCache.set(origin, entry);
    return entry;
  } catch {
    clearTimeout(timer);
    faviconCache.set(origin, null);
    return null;
  }
}

// Static frontend
app.use(express.static(join(__dirname, 'public')));

// Favicon proxy
app.get('/api/favicon', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).end();
  const entry = await resolveFavicon(url);
  if (!entry) return res.status(404).end();
  res.set('Content-Type', entry.contentType);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(entry.buffer);
});

// API: return full config + status
app.get('/api/data', (_req, res) => {
  const status = Object.fromEntries(statusCache);
  res.json({ config, status });
});

app.listen(PORT, () => {
  console.log(`schelbert.dev running on http://localhost:${PORT}`);
});
