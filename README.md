# Blaze Steam Watcher

MongoDB-based Steam watcher for local game database, snapshots, changes and future Telegram news.

## Run

```bash
git checkout feature-mongodb-steam-watcher
docker compose up --build
```

Open http://localhost:8080

## Collections

- games — current game state
- game_snapshots — historical full JSON snapshots
- game_changes — detected events
- sync_jobs — sync progress
- watch_rules — Telegram filters
- telegram_posts — generated/sent posts
