const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const APP_VERSION = "0.1.0";
const DEFAULT_API_URL = "https://flowpost-3yxb.onrender.com";
const settingsPath = path.join(app.getPath("userData"), "settings.json");
let mainWindow;
let settings = {};
let pollingTimer;
let loginWindow;

function browserDataRoot() {
  return app.getPath("userData");
}

function browserPartition(platform) {
  const safePlatform = String(platform || "default").replace(/[^a-z0-9_-]/gi, "");
  return `persist:flowpost-${safePlatform || "default"}`;
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

async function installFinishButton(window) {
  await window.webContents
    .executeJavaScript(
      `
      (() => {
        if (document.getElementById("__flowpost_agent_finish")) return;
        const button = document.createElement("button");
        button.id = "__flowpost_agent_finish";
        button.type = "button";
        button.textContent = "Готово: сохранить подключение";
        Object.assign(button.style, {
          position: "fixed",
          right: "20px",
          bottom: "20px",
          zIndex: "2147483647",
          border: "0",
          borderRadius: "999px",
          padding: "12px 18px",
          background: "#111827",
          color: "#fff",
          font: "600 14px system-ui, sans-serif",
          boxShadow: "0 18px 50px rgba(0,0,0,.32)",
          cursor: "pointer",
        });
        button.addEventListener("click", () => {
          window.flowPostAgentBrowser?.finish?.();
        });
        document.documentElement.appendChild(button);
      })();
      `,
      true,
    )
    .catch(() => undefined);
}

async function runConnectPlatformJob(job) {
  const platform = job.platform || job.payload?.platform;
  const connectUrl = job.payload?.connectUrl;

  if (!platform || !connectUrl) {
    throw new Error("Задание подключения повреждено.");
  }

  await updateJobStatus(job.id, "running");
  sendState({ status: "browser_opening" });

  if (loginWindow) {
    loginWindow.close();
    loginWindow = null;
  }

  loginWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: `FlowPost: ${platform}`,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: browserPartition(platform),
      preload: path.join(__dirname, "browser-preload.js"),
    },
  });

  loginWindow.webContents.on("did-finish-load", () => {
    if (loginWindow) void installFinishButton(loginWindow);
  });

  const finished = new Promise((resolve) => {
    const finish = () => resolve("completed");
    ipcMain.once("agent:browser-finish", finish);
    loginWindow?.once("closed", () => {
      ipcMain.off("agent:browser-finish", finish);
      resolve("closed");
    });
  });

  await loginWindow.loadURL(connectUrl);
  await installFinishButton(loginWindow);
  await updateJobStatus(job.id, "waiting_user_login");
  await logJob(job.id, "Браузер открыт локально. Ожидаем вход пользователя.");
  sendState({ status: "browser_opened" });

  const outcome = await finished;
  if (outcome !== "completed") {
    throw new Error("Браузер закрыт до подтверждения подключения.");
  }

  await updateJobStatus(job.id, "completed", {
    result: { platform, cookiesStoredLocally: true },
  });
  await logJob(job.id, "Подключение завершено. Cookies остались локально.");
  loginWindow.close();
  loginWindow = null;
  sendState({ status: "connected" });
}

async function handleJob(job) {
  if (job.type === "connect_platform") {
    await runConnectPlatformJob(job);
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
    await handleJob(job);
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
    platform: os.platform(),
    appVersion: APP_VERSION,
  };
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
  if (loginWindow) {
    loginWindow.close();
    loginWindow = null;
  }
  const partitions = ["dzen", "vc", "default"].map(browserPartition);
  await Promise.all(
    partitions.map((partition) =>
      session.fromPartition(partition).clearStorageData(),
    ),
  );
  sendState({ status: "profiles_deleted" });
  return true;
});

ipcMain.handle("agent:open-profiles", async () => {
  await fs.mkdir(browserDataRoot(), { recursive: true });
  await shell.openPath(browserDataRoot());
});

app.whenReady().then(async () => {
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
