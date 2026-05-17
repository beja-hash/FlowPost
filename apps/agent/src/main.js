const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { createAutomationRunner } = require("./automation-runner");

const APP_VERSION = "0.1.0";
const DEFAULT_API_URL = "https://flowpost-3yxb.onrender.com";
const settingsPath = path.join(app.getPath("userData"), "settings.json");
let mainWindow;
let settings = {};
let pollingTimer;
let runner;

function browserDataRoot() {
  return runner?.profileRoot || path.join(app.getPath("appData"), "FlowPost", "browser-profiles");
}

async function readSettings() {
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  } catch {
    settings = { apiUrl: DEFAULT_API_URL };
  }
}

async function writeSettings(next) {
  settings = { ...settings, ...next };
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  sendState();
}

function send(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
}

function sendState(extra = {}) {
  send("agent:state", {
    apiUrl: settings.apiUrl || DEFAULT_API_URL,
    connected: Boolean(settings.agentToken),
    account: settings.account ?? null,
    profileRoot: browserDataRoot(),
    browserCachePath: runner?.browserCachePath,
    platform: os.platform(),
    appVersion: APP_VERSION,
    ...extra,
  });
}

async function api(pathname, options = {}) {
  const apiUrl = (settings.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(settings.agentToken
        ? { Authorization: `Bearer ${settings.agentToken}` }
        : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body?.error?.message || `FlowPost API error ${response.status}`,
    );
  }

  return body;
}

async function updateJobStatus(jobId, status, extra = {}) {
  await api(`/api/agent/jobs/${jobId}/status`, {
    method: "POST",
    body: JSON.stringify({ status, ...extra }),
  });
}

async function logJob(jobId, message, level = "info") {
  send("agent:log", { message, level });
  try {
    await api(`/api/agent/jobs/${jobId}/logs`, {
      method: "POST",
      body: JSON.stringify({ message, level }),
    });
  } catch {
    // Keep local UX clean even if log upload fails.
  }
}

async function runConnectPlatformJob(job) {
  await runner.runConnectPlatformJob(job, updateJobStatus);
}

async function runPublishArticleJob(job) {
  await runner.runPublishArticleJob(job, updateJobStatus);
}

async function handleJob(job) {
  if (job.type === "connect_platform") {
    await runConnectPlatformJob(job);
    return;
  }

  if (job.type === "publish_article") {
    await runPublishArticleJob(job);
    return;
  }

  await updateJobStatus(job.id, "failed", {
    error: "Этот тип задачи пока не поддерживается в Agent.",
  });
}

async function pollJobs() {
  if (!settings.agentToken) return;

  try {
    sendState({ status: "waiting_job" });
    const { job } = await api("/api/agent/jobs/next");
    if (!job) return;
    sendState({ status: "job_received" });
    try {
      await handleJob(job);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Неизвестная ошибка Agent.";
      await updateJobStatus(job.id, "failed", { error: message }).catch(
        () => undefined,
      );
      await logJob(job.id, message, "error");
      throw error;
    }
  } catch (error) {
    sendState({
      status: "error",
      error:
        error instanceof Error ? error.message : "Неизвестная ошибка Agent.",
    });
  }
}

function startPolling() {
  clearInterval(pollingTimer);
  pollingTimer = setInterval(() => void pollJobs(), 3000);
  void pollJobs();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    title: "FlowPost Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

ipcMain.handle("agent:get-state", async () => {
  await readSettings();
  return {
    apiUrl: settings.apiUrl || DEFAULT_API_URL,
    connected: Boolean(settings.agentToken),
    account: settings.account ?? null,
    profileRoot: browserDataRoot(),
    browserCachePath: runner?.browserCachePath,
    platform: os.platform(),
    appVersion: APP_VERSION,
  };
});

ipcMain.handle("agent:prepare-browser", async () => {
  await runner.ensureChromium();
  return true;
});

ipcMain.handle("agent:pair", async (_event, payload) => {
  await writeSettings({ apiUrl: payload.apiUrl || DEFAULT_API_URL });
  const result = await api("/api/agent/pairing/confirm", {
    method: "POST",
    body: JSON.stringify({
      code: payload.code,
      name: os.hostname() || "FlowPost Agent",
      platform: os.platform(),
      appVersion: APP_VERSION,
    }),
  });
  await writeSettings({
    agentToken: result.token,
    account: result.device?.name || "FlowPost",
  });
  startPolling();
  return result;
});

ipcMain.handle("agent:disconnect", async () => {
  await writeSettings({ agentToken: null, account: null });
  clearInterval(pollingTimer);
  return true;
});

ipcMain.handle("agent:delete-profiles", async () => {
  await runner.deleteProfiles();
  sendState({ status: "profiles_deleted" });
  return true;
});

ipcMain.handle("agent:open-profiles", async () => {
  await fs.mkdir(browserDataRoot(), { recursive: true });
  await shell.openPath(browserDataRoot());
});

app.whenReady().then(async () => {
  runner = createAutomationRunner({ app, sendState, logJob });
  await readSettings();
  createWindow();
  mainWindow.webContents.once("did-finish-load", () => {
    sendState();
    if (settings.agentToken) startPolling();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
