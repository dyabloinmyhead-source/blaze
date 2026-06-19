import express from 'express';
import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'blaze_steam';
const SEARCH_URL = 'https://store.' + 'steampowered.com/search/results/';
const DETAILS_URL = 'https://store.' + 'steampowered.com/api/appdetails';
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS || 2500);
const PAGES_PER_SYNC = Number(process.env.PAGES_PER_SYNC || 20);
const DETAIL_DELAY_MS = Number(process.env.DETAIL_DELAY_MS || 900);

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = x => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex');
const now = () => new Date();

let db;
let running = false;
let runtime = { lastSync: null, lastError: null };

function strip(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(s, n) {
  const re = new RegExp(n + '=\\"([^\\"]+)\\"');
  const m = String(s).match(re);
  return m ? m[1] : null;
}

function parseCard(html) {
  const id = (html.match(/data-ds-appid=\"(\d+)\"/) || [])[1] || (html.match(/app\/(\d+)/) || [])[1];
  if (!id) return null;
  const appid = Number(id);
  const name = strip((html.match(/<span class=\"title\">([\s\S]*?)<\/span>/) || [])[1] || '');
  if (!appid || !name) return null;
  const steamUrl = attr(html, 'href') || `https://store.steampowered.com/app/${appid}`;
  const capsule = (html.match(/<img[^>]+src=\"([^\"]+)/) || [])[1] || null;
  const release = strip((html.match(/class=\"col search_released responsive_secondrow\">([\s\S]*?)<\/div>/) || [])[1] || '') || null;
  const price = strip((html.match(/class=\"col search_price[^\"]*\">([\s\S]*?)<\/div>/) || [])[1] || '') || null;
  const reviews = strip((html.match(/class=\"search_review_summary[^\"]*\"[^>]*data-tooltip-html=\"([^\"]*)/) || [])[1] || '') || null;
  const platforms = [...html.matchAll(/platform_img ([a-zA-Z0-9_]+)/g)].map(x => x[1]);
  return { appid, name, steamUrl, capsule, release, price, reviews, platforms, source: 'store-search' };
}

function compactDetails(raw) {
  const r = raw?.success ? raw.data : raw?.data || raw;
  if (!r) return null;
  return {
    type: r.type || null,
    name: r.name || null,
    required_age: r.required_age || 0,
    is_free: !!r.is_free,
    controller_support: r.controller_support || null,
    detailed_description: r.detailed_description || null,
    about_the_game: r.about_the_game || null,
    short_description: r.short_description || null,
    supported_languages: r.supported_languages || null,
    header_image: r.header_image || null,
    capsule_image: r.capsule_image || null,
    website: r.website || null,
    pc_requirements: r.pc_requirements || null,
    mac_requirements: r.mac_requirements || null,
    linux_requirements: r.linux_requirements || null,
    legal_notice: r.legal_notice || null,
    developers: r.developers || [],
    publishers: r.publishers || [],
    price_overview: r.price_overview || null,
    packages: r.packages || [],
    package_groups: r.package_groups || [],
    platforms: r.platforms || {},
    metacritic: r.metacritic || null,
    categories: r.categories || [],
    genres: r.genres || [],
    screenshots: r.screenshots || [],
    movies: r.movies || [],
    recommendations: r.recommendations || null,
    achievements: r.achievements || null,
    release_date: r.release_date || null,
    support_info: r.support_info || null,
    background: r.background || null,
    content_descriptors: r.content_descriptors || null
  };
}

function detectChanges(oldGame, newGame) {
  const changes = [];
  if (!oldGame) {
    changes.push({ type: 'new_game', field: 'game', oldValue: null, newValue: newGame.name });
    return changes;
  }
  const fields = ['name', 'price', 'release', 'reviews'];
  for (const f of fields) if ((oldGame[f] || null) !== (newGame[f] || null)) changes.push({ type: 'field_changed', field: f, oldValue: oldGame[f] || null, newValue: newGame[f] || null });
  const oldEA = isEarlyAccess(oldGame);
  const newEA = isEarlyAccess(newGame);
  if (oldEA && !newEA) changes.push({ type: 'early_access_released', field: 'early_access', oldValue: true, newValue: false });
  return changes;
}

function isEarlyAccess(g) {
  const text = JSON.stringify(g || {}).toLowerCase();
  return text.includes('early access') || text.includes('ранний доступ');
}

async function fetchSearchPage(start) {
  const u = new URL(SEARCH_URL);
  u.searchParams.set('query', '');
  u.searchParams.set('start', String(start));
  u.searchParams.set('count', '100');
  u.searchParams.set('sort_by', '_ASC');
  u.searchParams.set('category1', '998');
  u.searchParams.set('infinite', '1');
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 Blaze', 'Accept': 'application/json,text/plain,*/*', 'Cookie': 'birthtime=0; mature_content=1' } });
  if (res.status === 429) throw new Error('Steam rate limit 429. Progress saved. Wait 2-5 minutes and Sync again');
  const txt = await res.text();
  if (!res.ok) throw new Error('Steam store search HTTP ' + res.status);
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error('Steam store search non JSON: ' + txt.slice(0, 120)); }
  const chunks = String(j.results_html || '').split(/<a /).slice(1).map(x => '<a ' + x);
  return { total: Number(j.total_count || 0), items: chunks.map(parseCard).filter(Boolean) };
}

async function fetchDetails(appid) {
  const u = new URL(DETAILS_URL);
  u.searchParams.set('appids', String(appid));
  u.searchParams.set('cc', 'ru');
  u.searchParams.set('l', 'russian');
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 Blaze', 'Accept': 'application/json' } });
  const txt = await res.text();
  if (!res.ok) throw new Error('Steam appdetails HTTP ' + res.status);
  const j = JSON.parse(txt);
  return j[String(appid)] || j;
}

async function ensureIndexes() {
  await db.collection('games').createIndex({ appid: 1 }, { unique: true });
  await db.collection('games').createIndex({ name: 'text' });
  await db.collection('game_snapshots').createIndex({ appid: 1, createdAt: -1 });
  await db.collection('game_changes').createIndex({ appid: 1, createdAt: -1 });
  await db.collection('game_changes').createIndex({ type: 1, posted: 1 });
  await db.collection('sync_jobs').createIndex({ createdAt: -1 });
}

async function syncBatch(reason = 'manual') {
  if (running) return { ok: false, running: true };
  running = true;
  const jobs = db.collection('sync_jobs');
  const job = { reason, status: 'running', createdAt: now(), updatedAt: now(), pagesDone: 0, added: 0, changed: 0, totalKnown: 0 };
  const { insertedId } = await jobs.insertOne(job);
  try {
    const meta = (await db.collection('sync_meta').findOne({ _id: 'crawl' })) || { start: 0, done: false };
    let start = meta.done ? 0 : (meta.start || 0);
    let totalKnown = 0, pagesDone = 0, added = 0, changed = 0;
    for (let i = 0; i < PAGES_PER_SYNC; i++, start += 100) {
      await sleep(PAGE_DELAY_MS);
      const page = await fetchSearchPage(start);
      totalKnown = page.total || totalKnown;
      if (!page.items.length) break;
      for (const item of page.items) {
        const old = await db.collection('games').findOne({ appid: item.appid });
        const enriched = { ...old, ...item, updatedAt: now(), lastSeenAt: now() };
        const oldHash = old?.hash || null;
        const newHash = hash({ ...enriched, _id: undefined, hash: undefined, updatedAt: undefined, lastSeenAt: undefined });
        enriched.hash = newHash;
        if (!old) added++; else if (oldHash !== newHash) changed++;
        await db.collection('games').updateOne({ appid: item.appid }, { $set: enriched, $setOnInsert: { createdAt: now() } }, { upsert: true });
        if (!old || oldHash !== newHash) {
          await db.collection('game_snapshots').insertOne({ appid: item.appid, hash: newHash, source: 'search', data: enriched, createdAt: now() });
          const changes = detectChanges(old, enriched);
          if (changes.length) await db.collection('game_changes').insertMany(changes.map(c => ({ ...c, appid: item.appid, name: item.name, genres: enriched.genres || [], categories: enriched.categories || [], createdAt: now(), posted: false })));
        }
      }
      pagesDone++;
      const done = start + 100 >= totalKnown;
      await db.collection('sync_meta').updateOne({ _id: 'crawl' }, { $set: { start: done ? 0 : start + 100, done, totalKnown, updatedAt: now() } }, { upsert: true });
      await jobs.updateOne({ _id: insertedId }, { $set: { updatedAt: now(), pagesDone, added, changed, totalKnown, nextStart: done ? 0 : start + 100 } });
      if (done) break;
    }
    const result = { ok: true, pagesDone, added, changed, totalKnown };
    await jobs.updateOne({ _id: insertedId }, { $set: { ...result, status: 'done', finishedAt: now(), updatedAt: now() } });
    runtime.lastSync = { at: now(), ...result };
    runtime.lastError = null;
    return result;
  } catch (e) {
    runtime.lastError = { at: now(), message: e.message };
    await jobs.updateOne({ _id: insertedId }, { $set: { status: 'error', error: e.message, finishedAt: now(), updatedAt: now() } });
    throw e;
  } finally { running = false; }
}

async function enrichGame(appid) {
  const old = await db.collection('games').findOne({ appid });
  if (!old) throw new Error('not found');
  if (old.detailsFetchedAt && Date.now() - new Date(old.detailsFetchedAt).getTime() < 86400000) return old;
  await sleep(DETAIL_DELAY_MS);
  const raw = await fetchDetails(appid);
  const details = compactDetails(raw);
  const enriched = { ...old, details, rawDetails: raw, genres: details?.genres || old.genres || [], categories: details?.categories || old.categories || [], detailsFetchedAt: now(), updatedAt: now() };
  const newHash = hash({ ...enriched, _id: undefined, hash: undefined, updatedAt: undefined, lastSeenAt: undefined });
  const changed = old.hash !== newHash;
  enriched.hash = newHash;
  await db.collection('games').updateOne({ appid }, { $set: enriched });
  if (changed) await db.collection('game_snapshots').insertOne({ appid, hash: newHash, source: 'appdetails', data: enriched, createdAt: now() });
  return enriched;
}

app.get('/health', (req, res) => res.json({ ok: true, app: 'blaze-steam-watcher' }));
app.get('/api/status', async (req, res) => {
  const games = await db.collection('games').countDocuments();
  const changes = await db.collection('game_changes').countDocuments();
  const lastJob = await db.collection('sync_jobs').find().sort({ createdAt: -1 }).limit(1).next();
  const meta = await db.collection('sync_meta').findOne({ _id: 'crawl' });
  res.json({ ok: true, running, games, changes, lastJob, crawl: meta, ...runtime, timing: { PAGES_PER_SYNC, PAGE_DELAY_MS, DETAIL_DELAY_MS } });
});
app.post('/api/sync', async (req, res) => { try { res.json(await syncBatch('manual')); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/games', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit || 100), 1000);
  const filter = q ? { $or: [{ name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { appid: Number(q) || -1 }] } : {};
  const games = await db.collection('games').find(filter, { projection: { rawDetails: 0 } }).sort({ appid: 1 }).limit(limit).toArray();
  res.json({ ok: true, total: await db.collection('games').countDocuments(filter), games });
});
app.get('/api/games/:appid', async (req, res) => {
  try { res.json({ ok: true, game: await enrichGame(Number(req.params.appid)) }); } catch (e) { res.status(404).json({ ok: false, error: e.message }); }
});
app.get('/api/games/:appid/history', async (req, res) => {
  const appid = Number(req.params.appid);
  const snapshots = await db.collection('game_snapshots').find({ appid }, { projection: { data: 0 } }).sort({ createdAt: -1 }).limit(50).toArray();
  const changes = await db.collection('game_changes').find({ appid }).sort({ createdAt: -1 }).limit(100).toArray();
  res.json({ ok: true, snapshots, changes });
});
app.get('/api/changes', async (req, res) => {
  const type = req.query.type ? { type: String(req.query.type) } : {};
  const changes = await db.collection('game_changes').find(type).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 100), 1000)).toArray();
  res.json({ ok: true, changes });
});
app.post('/api/watch-rules', async (req, res) => {
  const rule = { ...req.body, enabled: req.body.enabled !== false, createdAt: now(), updatedAt: now() };
  const r = await db.collection('watch_rules').insertOne(rule);
  res.json({ ok: true, id: r.insertedId });
});

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  await ensureIndexes();
  setInterval(() => syncBatch('hourly').catch(e => console.error(e.message)), 3600000);
  app.listen(PORT, () => console.log('Blaze Steam Watcher on ' + PORT));
}
main().catch(e => { console.error(e); process.exit(1); });
