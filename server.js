import express from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const app = express();
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || "./data";
const STEAM_DB_DIR = path.join(DATA_DIR, "steamdb");
const OBJECTS_DIR = path.join(STEAM_DB_DIR, "objects");
const COMMITS_DIR = path.join(STEAM_DB_DIR, "commits");
const INDEX_FILE = path.join(STEAM_DB_DIR, "index.json");
const STEAM_APPLIST_URL = process.env.STEAM_APPLIST_URL || "https://api.steampowered.com/ISteamApps/GetAppList/v2/";
const STEAM_STORE_DETAILS_URL = process.env.STEAM_STORE_DETAILS_URL || "https://store.steampowered.com/api/appdetails";
const SYNC_INTERVAL_MS = Number(process.env.STEAM_SYNC_INTERVAL_MS || 3600000);
const AUTO_SYNC = String(process.env.STEAM_AUTO_SYNC || "true").toLowerCase() !== "false";

let syncState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null
};

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

async function ensureDb() {
  await fs.mkdir(OBJECTS_DIR, { recursive: true });
  await fs.mkdir(COMMITS_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

async function writeJson(file, data) {
  await ensureDb();
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function sha(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function normalizeApps(rawApps) {
  return (rawApps || [])
    .map(x => ({ appid: Number(x.appid), name: String(x.name || "").trim() }))
    .filter(x => Number.isFinite(x.appid) && x.appid > 0 && x.name)
    .sort((a, b) => a.appid - b.appid);
}

async function fetchAppList() {
  const response = await fetch(STEAM_APPLIST_URL);
  if (!response.ok) throw new Error(`Steam app list HTTP ${response.status}`);
  const data = await response.json();
  return normalizeApps(data?.applist?.apps || []);
}

async function getIndex() {
  return await readJson(INDEX_FILE, {
    schema: 1,
    head: null,
    commits: [],
    totalApps: 0,
    updatedAt: null
  });
}

async function loadObject(hash) {
  if (!hash) return [];
  return await readJson(path.join(OBJECTS_DIR, `${hash}.json`), []);
}

function diffApps(prev, next) {
  const prevMap = new Map(prev.map(x => [x.appid, x]));
  const nextMap = new Map(next.map(x => [x.appid, x]));

  const added = [];
  const removed = [];
  const renamed = [];

  for (const item of next) {
    const old = prevMap.get(item.appid);
    if (!old) added.push(item);
    else if (old.name !== item.name) renamed.push({ appid: item.appid, oldName: old.name, newName: item.name });
  }

  for (const item of prev) {
    if (!nextMap.has(item.appid)) removed.push(item);
  }

  return { added, removed, renamed };
}

async function createCommit(source = "manual") {
  if (syncState.running) return { ok: false, skipped: true, reason: "sync already running" };

  syncState.running = true;
  syncState.lastStartedAt = new Date().toISOString();
  syncState.lastError = null;

  try {
    const index = await getIndex();
    const prevApps = await loadObject(index.head);
    const apps = await fetchAppList();
    const hash = sha(apps);
    const now = new Date().toISOString();

    if (hash === index.head) {
      syncState.lastFinishedAt = now;
      return { ok: true, changed: false, hash, totalApps: apps.length, message: "No changes" };
    }

    const diff = diffApps(prevApps, apps);
    const commit = {
      id: `${now.replace(/[:.]/g, "-")}_${hash.slice(0, 12)}`,
      parent: index.head,
      hash,
      createdAt: now,
      source,
      totalApps: apps.length,
      stats: {
        added: diff.added.length,
        removed: diff.removed.length,
        renamed: diff.renamed.length
      },
      sample: {
        added: diff.added.slice(0, 20),
        removed: diff.removed.slice(0, 20),
        renamed: diff.renamed.slice(0, 20)
      }
    };

    await writeJson(path.join(OBJECTS_DIR, `${hash}.json`), apps);
    await writeJson(path.join(COMMITS_DIR, `${commit.id}.json`), commit);

    const nextIndex = {
      schema: 1,
      head: hash,
      updatedAt: now,
      totalApps: apps.length,
      commits: [commit, ...(index.commits || [])].slice(0, 500)
    };

    await writeJson(INDEX_FILE, nextIndex);
    syncState.lastFinishedAt = now;

    return { ok: true, changed: true, commit, index: nextIndex };
  } catch (e) {
    syncState.lastError = e.message;
    throw e;
  } finally {
    syncState.running = false;
  }
}

function filterApps(apps, q, limit) {
  const query = String(q || "").toLowerCase().trim();
  const lim = Math.min(Number(limit || 100), 500);
  if (!query) return apps.slice(0, lim);
  return apps.filter(x => String(x.appid).includes(query) || x.name.toLowerCase().includes(query)).slice(0, lim);
}

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "blaze-steam-gitdb", time: new Date().toISOString() });
});

app.get("/api/steam/status", async (req, res) => {
  const index = await getIndex();
  res.json({ ok: true, syncState, index, intervalMs: SYNC_INTERVAL_MS, autoSync: AUTO_SYNC });
});

app.post("/api/steam/sync", async (req, res) => {
  try {
    const result = await createCommit("manual");
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/steam/apps", async (req, res) => {
  const index = await getIndex();
  const apps = await loadObject(index.head);
  res.json({ ok: true, head: index.head, totalApps: apps.length, apps: filterApps(apps, req.query.q, req.query.limit) });
});

app.get("/api/steam/commits", async (req, res) => {
  const index = await getIndex();
  res.json({ ok: true, head: index.head, commits: index.commits || [] });
});

app.get("/api/steam/commit/:id", async (req, res) => {
  const commit = await readJson(path.join(COMMITS_DIR, `${req.params.id}.json`), null);
  if (!commit) return res.status(404).json({ ok: false, error: "commit not found" });
  res.json({ ok: true, commit });
});

app.get("/api/steam/app/:appid", async (req, res) => {
  const appid = Number(req.params.appid);
  const url = new URL(STEAM_STORE_DETAILS_URL);
  url.searchParams.set("appids", String(appid));
  url.searchParams.set("cc", String(req.query.cc || "us"));
  url.searchParams.set("l", String(req.query.lang || "english"));

  const response = await fetch(url);
  if (!response.ok) return res.status(response.status).json({ ok: false, error: `Steam store HTTP ${response.status}` });

  const data = await response.json();
  res.json({ ok: true, appid, details: data[String(appid)] || null });
});

if (AUTO_SYNC) {
  setTimeout(() => createCommit("startup").catch(e => console.error("Steam startup sync failed:", e.message)), 3000);
  setInterval(() => createCommit("hourly").catch(e => console.error("Steam hourly sync failed:", e.message)), SYNC_INTERVAL_MS);
}

app.listen(PORT, () => {
  console.log(`Blaze Steam GitDB running on http://0.0.0.0:${PORT}`);
});
