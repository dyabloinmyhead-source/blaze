const $ = id => document.getElementById(id);

async function api(url, options) {
  const r = await fetch(url, options);
  const data = await r.json();
  if (!r.ok || data.ok === false) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function showDebug(x) {
  $("debug").textContent = typeof x === "string" ? x : JSON.stringify(x, null, 2);
}

function commitRow(c) {
  return `<div class="row">
    <b>${c.id}</b><br>
    <span class="muted">${c.createdAt} / ${c.source}</span><br>
    <span class="pill">apps ${c.totalApps}</span>
    <span class="pill">+${c.stats?.added || 0}</span>
    <span class="pill">-${c.stats?.removed || 0}</span>
    <span class="pill">renamed ${c.stats?.renamed || 0}</span>
  </div>`;
}

function appRow(a) {
  return `<div class="row">
    <b>${a.name}</b><br>
    <span class="muted">appid: ${a.appid}</span>
    <button onclick="details(${a.appid})">details</button>
  </div>`;
}

async function loadStatus() {
  try {
    const data = await api("/api/steam/status");
    const idx = data.index || {};
    $("statusBadge").textContent = data.syncState.running ? "syncing" : "ready";
    $("summary").innerHTML =
      `Head: <b>${idx.head ? idx.head.slice(0, 12) : "empty"}</b><br>` +
      `Apps: <b>${idx.totalApps || 0}</b><br>` +
      `Updated: <b>${idx.updatedAt || "never"}</b><br>` +
      `Interval: <b>${Math.round(data.intervalMs / 60000)} min</b>`;
    showDebug(data);
    await loadCommits();
    await searchApps();
  } catch (e) {
    $("statusBadge").textContent = "error";
    showDebug(e.message);
  }
}

async function syncNow() {
  $("statusBadge").textContent = "syncing";
  showDebug("Steam sync started...");
  try {
    const data = await api("/api/steam/sync", { method: "POST" });
    showDebug(data);
    await loadStatus();
  } catch (e) {
    $("statusBadge").textContent = "error";
    showDebug(e.message);
  }
}

async function loadCommits() {
  const data = await api("/api/steam/commits");
  $("commits").innerHTML = (data.commits || []).map(commitRow).join("") || "<div class=row>No commits yet.</div>";
}

async function searchApps() {
  const q = $("search").value.trim();
  const data = await api(`/api/steam/apps?q=${encodeURIComponent(q)}&limit=80`);
  $("apps").innerHTML = (data.apps || []).map(appRow).join("") || "<div class=row>No apps.</div>";
}

async function details(appid) {
  showDebug("Loading details for " + appid + "...");
  try {
    const data = await api(`/api/steam/app/${appid}`);
    showDebug(data.details);
  } catch (e) {
    showDebug(e.message);
  }
}

$("syncBtn").onclick = syncNow;
$("statusBtn").onclick = loadStatus;
$("searchBtn").onclick = searchApps;
$("search").onkeydown = e => { if (e.key === "Enter") searchApps(); };

loadStatus();
