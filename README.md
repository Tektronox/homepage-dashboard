# schelbert.dev

Personal dashboard deployed at [schelbert.dev](https://schelbert.dev).  
Displays public projects with live health status, resource links, and monitors internal self-hosted services — all driven from a single config file.

---

## Architecture

```
schelbert-page/
├── config/
│   └── sites.json        # Single source of truth — all sites live here
├── public/               # Static frontend (no build step)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js             # Express backend + health check engine
├── package.json
└── Dockerfile
```

**Backend (`server.js`):**  
Node.js + Express. On startup it reads `config/sites.json`, collects all entries with `"monitor": true`, and runs HTTP health checks against them every 60 seconds using the native `fetch` API with a 5s timeout. Results are cached in memory and served at `GET /api/data`. The same endpoint also returns the full config so the frontend never needs a separate config file.

**Frontend (`public/`):**  
Vanilla HTML/CSS/JS — no framework, no build step. On load it calls `/api/data`, renders three sections (Public Sites, Resources, Internal Services), then refreshes status every 30 seconds. Status dots pulse green when online, dim red when offline.

**Health check logic:**  
HTTP 2xx, 3xx, 401, and 403 responses are all treated as "online" — redirects and auth-gated services are up even if they reject unauthenticated requests.

---

## Dev Environment

```bash
npm install
npm run dev       # starts server with --watch (auto-restarts on file changes)
```

Server listens on `http://localhost:3000`.  
`/api/data` returns the full config + live status cache for debugging.

---

## Deployment (Coolify)

1. Push to the connected Git repo.
2. Coolify builds the image via the `Dockerfile` (Node 20 Alpine).
3. Set exposed port to **3000** in Coolify's service config.
4. _(Optional)_ For Docker-internal services (e.g. `n8n-python-services`): attach this container to the same Docker network in Coolify's network settings so those hostnames resolve.

No environment variables are required. `PORT` can be overridden if needed (default: `3000`).

---

## Adding / Changing Sites

Edit **`config/sites.json`** only — no code changes needed.

```jsonc
{
  "public": [
    // Shown as cards with link + live status dot
    { "name": "My App", "url": "https://myapp.example.com", "description": "Short blurb", "monitor": true }
  ],
  "links": [
    // Plain link rows — no monitoring
    { "name": "Some Resource", "url": "https://...", "description": "What it is" }
  ],
  "internal": [
    // Status-only — no link shown in the UI
    { "name": "Internal API", "url": "http://service-hostname:8080/health", "monitor": true }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Display name |
| `url` | yes | Full URL including scheme |
| `description` | no | Shown as subtitle on cards |
| `monitor` | no | Set `true` to enable health checks |
| `note` | no | Internal annotation, not shown in UI |

Restart the server (or redeploy) after editing the config — it is read once at startup.

