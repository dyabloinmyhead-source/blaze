import express from "express";
import fs from "fs/promises";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || "./data";
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

async function ensureData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureData();
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

const modules = [
  {
    id: "dashboard",
    name: "Dashboard",
    description: "Home screen and system overview",
    status: "enabled"
  },
  {
    id: "agents",
    name: "AI Agents",
    description: "Future workspace for personal agents",
    status: "planned"
  },
  {
    id: "integrations",
    name: "Integrations",
    description: "Mail, GitHub, Telegram and external APIs",
    status: "planned"
  },
  {
    id: "monitoring",
    name: "Monitoring",
    description: "Server checks, jobs and logs",
    status: "planned"
  }
];

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    name: "blaze",
    version: "0.1.0",
    time: new Date().toISOString()
  });
});

app.get("/api/status", async (req, res) => {
  const settings = await readJson(SETTINGS_FILE, {});
  res.json({
    ok: true,
    app: "Blaze",
    version: "0.1.0",
    dataDir: DATA_DIR,
    configured: Boolean(settings.instanceName),
    settings,
    modules
  });
});

app.post("/api/settings", async (req, res) => {
  const body = req.body || {};
  const current = await readJson(SETTINGS_FILE, {});
  const next = {
    ...current,
    instanceName: body.instanceName || current.instanceName || "Blaze Core",
    owner: body.owner || current.owner || "",
    updatedAt: new Date().toISOString()
  };
  await writeJson(SETTINGS_FILE, next);
  res.json({ ok: true, settings: next });
});

app.get("/api/modules", (req, res) => {
  res.json({ ok: true, modules });
});

app.listen(PORT, () => {
  console.log(`Blaze running on http://0.0.0.0:${PORT}`);
});
