# Blaze Steam GitDB

Blaze branch for a local Steam application database.

The module uses the public Steam app list endpoint and stores every fetched catalog state as a content-addressed object. Each update creates a commit-like JSON entry with parent hash, current hash and diff stats.

## Run

```bash
git checkout feature-steam-gitdb
docker compose up --build
```

Open:

```text
http://localhost:8080
```

## API

```text
GET  /api/steam/status
POST /api/steam/sync
GET  /api/steam/apps?q=&limit=
GET  /api/steam/commits
GET  /api/steam/commit/:id
GET  /api/steam/app/:appid
```

## Data layout

```text
data/steamdb/index.json
data/steamdb/objects/<sha256>.json
data/steamdb/commits/<timestamp>_<sha>.json
```

## Update logic

- startup sync after 3 seconds
- hourly sync by default
- interval can be changed with `STEAM_SYNC_INTERVAL_MS`
- auto sync can be disabled with `STEAM_AUTO_SYNC=false`
