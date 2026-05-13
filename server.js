import express from 'express';
import rateLimit from 'express-rate-limit';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const CHECK_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

// Load config — expand ${VAR} placeholders from environment
const rawConfig = readFileSync(join(__dirname, 'config/sites.json'), 'utf8')
  .replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
const config = JSON.parse(rawConfig);

// Build allowlist of permitted origins for favicon fetches (all sections of config)
const allowedFaviconOrigins = new Set();
for (const section of ['public', 'links', 'internal', 'services']) {
  for (const site of config[section] || []) {
    if (site.url) {
      try { allowedFaviconOrigins.add(new URL(site.url).origin); } catch {}
    }
  }
}

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
    const iconUrl = iconPath.startsWith('http') ? iconPath : new URL(iconPath, htmlRes.url).href;

    // 2. Fetch the icon itself
    const iconController = new AbortController();
    const iconTimer = setTimeout(() => iconController.abort(), 5_000);
    const iconRes = await fetch(iconUrl, {
      signal: iconController.signal,
      headers: { 'User-Agent': 'schelbert-favicon/1.0' },
    });
    clearTimeout(iconTimer);
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

// Security headers
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'");
  res.removeHeader('X-Powered-By');
  next();
});

// Static frontend
app.use(express.static(join(__dirname, 'public')));

// Favicon proxy
const faviconRateLimit = rateLimit({ windowMs: 60_000, max: 30 });
app.get('/api/favicon', faviconRateLimit, async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).end();
  let reqOrigin;
  try { reqOrigin = new URL(url).origin; } catch { return res.status(400).end(); }
  if (!allowedFaviconOrigins.has(reqOrigin)) return res.status(400).end();
  const entry = await resolveFavicon(url);
  if (!entry) return res.status(404).end();
  res.set('Content-Type', entry.contentType);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(entry.buffer);
});

// API: return config + status, stripping URLs from services to avoid internal topology leak
app.get('/api/data', (_req, res) => {
  const status = Object.fromEntries(statusCache);
  const safeConfig = {
    ...config,
    services: (config.services || []).map(({ url: _url, ...rest }) => rest),
  };
  res.json({ config: safeConfig, status });
});

app.listen(PORT, () => {
  console.log(`schelbert.dev running on http://localhost:${PORT}`);
});
