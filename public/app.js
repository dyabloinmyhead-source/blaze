const $ = id => document.getElementById(id);

async function api(url, options) {
  const r = await fetch(url, options);
  const data = await r.json();
  if (!r.ok || data.ok === false) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function renderModules(modules) {
  $("modules").innerHTML = modules.map(m => `
    <div class="module">
      <div>
        <strong>${m.name}</strong><br>
        <span>${m.description}</span>
      </div>
      <span class="badge">${m.status}</span>
    </div>
  `).join("");
}

async function loadStatus() {
  try {
    const data = await api("/api/status");
    $("statusBadge").textContent = data.configured ? "configured" : "fresh install";
    $("instanceName").value = data.settings.instanceName || "Blaze Core";
    $("owner").value = data.settings.owner || "";
    $("settingsOut").textContent = JSON.stringify(data, null, 2);
    renderModules(data.modules || []);
  } catch (e) {
    $("statusBadge").textContent = "error";
    $("settingsOut").textContent = e.message;
  }
}

$("saveBtn").onclick = async () => {
  try {
    const data = await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instanceName: $("instanceName").value,
        owner: $("owner").value
      })
    });
    $("settingsOut").textContent = JSON.stringify(data, null, 2);
    await loadStatus();
  } catch (e) {
    $("settingsOut").textContent = e.message;
  }
};

loadStatus();
