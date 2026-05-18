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
let heartbeatTimer;
let prewarmPromise = null;
let isPolling = false;
let activeJobId = null;
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

function logLifecycle(action, extra = {}) {
  console.log("[flowpost-agent:lifecycle]", {
    action,
    hasMainWindow: Boolean(mainWindow),
    mainWindowDestroyed: mainWindow?.isDestroyed?.() ?? null,
    webContentsDestroyed: mainWindow?.webContents?.isDestroyed?.() ?? null,
    ...extra,
  });
}

function safeSend(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logLifecycle("safe-send:skip-window-destroyed", { channel });
    return;
  }

  if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
    logLifecycle("safe-send:skip-webcontents-destroyed", { channel });
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function userSafeErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : "";

  console.error("[flowpost-agent:error]", {
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });

  if (/object has been destroyed/i.test(message)) {
    return "Не удалось открыть браузер. Закройте старое окно браузера и попробуйте снова.";
  }

  if (/browser.*closed|context.*closed|page.*closed|target.*closed/i.test(message)) {
    return "Браузер был закрыт. Нажмите “Открыть браузер” еще раз.";
  }

  return message || fallback;
}

function send(channel, payload) {
  safeSend(channel, payload);
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

async function sendHeartbeat() {
  if (!settings.agentToken) return;

  try {
    await api("/api/agent/devices/heartbeat", {
      method: "POST",
      body: JSON.stringify({ appVersion: APP_VERSION }),
    });
    logLifecycle("heartbeat:sent");
  } catch (error) {
    logLifecycle("heartbeat:failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => void sendHeartbeat(), 12_000);
  void sendHeartbeat();
}

function stopAgentLoops() {
  clearInterval(pollingTimer);
  clearInterval(heartbeatTimer);
}

function prewarmBrowser() {
  if (!runner?.prewarm || prewarmPromise) {
    return prewarmPromise;
  }

  prewarmPromise = runner
    .prewarm(["dzen", "vc"])
    .catch((error) => {
      sendState({
        status: "browser_install_failed",
        error: userSafeErrorMessage(
          error,
          "Не удалось подготовить браузер для публикации.",
        ),
      });
    })
    .finally(() => {
      prewarmPromise = null;
    });

  return prewarmPromise;
}

async function runConnectPlatformJob(job) {
  logLifecycle("job:connect-platform:start", { jobId: job.id });
  await runner.runConnectPlatformJob(job, updateJobStatus);
}

async function runPublishArticleJob(job) {
  logLifecycle("job:publish-article:start", { jobId: job.id });
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
  if (isPolling || activeJobId) {
    logLifecycle("poll:skip-busy", { isPolling, activeJobId });
    return;
  }

  try {
    isPolling = true;
    sendState({ status: "waiting_job" });
    const { job } = await api("/api/agent/jobs/next");
    if (!job) return;
    activeJobId = job.id;
    sendState({ status: "job_received" });
    try {
      await handleJob(job);
    } catch (error) {
      const message = userSafeErrorMessage(error, "Неизвестная ошибка Agent.");
      const status = runner?.isUserCancelledError?.(error)
        ? "cancelled"
        : "failed";
      await updateJobStatus(job.id, status, { error: message }).catch(
        () => undefined,
      );
      await logJob(job.id, message, "error");
      throw error;
    }
  } catch (error) {
    sendState({
      status: "error",
      error: userSafeErrorMessage(error, "Неизвестная ошибка Agent."),
    });
  } finally {
    isPolling = false;
    activeJobId = null;
  }
}

function startPolling() {
  clearInterval(pollingTimer);
  pollingTimer = setInterval(() => void pollJobs(), 3000);
  startHeartbeat();
  void prewarmBrowser();
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
  mainWindow.on("closed", () => {
    logLifecycle("main-window:closed");
    mainWindow = null;
    stopAgentLoops();
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
  try {
    await runner.prewarm(["dzen", "vc"]);
    return true;
  } catch (error) {
    throw new Error(
      userSafeErrorMessage(error, "Не удалось подготовить браузер."),
    );
  }
});

ipcMain.handle("agent:pair", async (_event, payload) => {
  try {
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
  } catch (error) {
    throw new Error(
      userSafeErrorMessage(error, "Не удалось подключить Agent."),
    );
  }
});

ipcMain.handle("agent:disconnect", async () => {
  await writeSettings({ agentToken: null, account: null });
  stopAgentLoops();
  return true;
});

ipcMain.handle("agent:delete-profiles", async () => {
  try {
    await runner.deleteProfiles();
    sendState({ status: "profiles_deleted" });
    return true;
  } catch (error) {
    throw new Error(
      userSafeErrorMessage(error, "Не удалось удалить локальные профили."),
    );
  }
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

app.on("before-quit", () => {
  stopAgentLoops();
  void runner?.dispose?.();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
