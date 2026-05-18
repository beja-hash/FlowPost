const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
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
let tray;
let isQuitting = false;
let pendingPairingCode = null;
let lastHeartbeatAt = null;
let hiddenToTrayNoticeShown = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

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
    autoLaunch: getAutoLaunchEnabled(),
    backgroundRunning: true,
    lastHeartbeatAt,
    activeJobId,
    pairingCode: pendingPairingCode,
    ...extra,
  });
  updateTrayMenu();
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
    lastHeartbeatAt = new Date().toISOString();
    logLifecycle("heartbeat:sent");
    sendState({ status: "heartbeat_active" });
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
  logLifecycle("polling:started");
}

function createTrayIcon() {
  return nativeImage.createFromDataURL(
    "data:image/svg+xml;utf8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111827"/><path d="M8 10h16v4H13v3h9v4h-9v5H8V10z" fill="#fff"/></svg>',
      ),
  );
}

function updateTrayMenu() {
  if (!tray) return;

  const connected = Boolean(settings.agentToken);
  const statusLabel = connected ? "Статус: подключен" : "Статус: не подключен";

  tray.setToolTip("FlowPost Agent");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Открыть FlowPost Agent",
        click: () => showMainWindow(),
      },
      {
        label: statusLabel,
        enabled: false,
      },
      {
        label: "Открыть браузер",
        enabled: connected,
        click: () => {
          void runner
            ?.launchDetachedBrowser("dzen", "about:blank")
            .catch((error) => {
              sendState({
                status: "error",
                error: userSafeErrorMessage(
                  error,
                  "Не удалось открыть браузер.",
                ),
              });
            });
        },
      },
      { type: "separator" },
      {
        label: "Удалить локальные профили браузера",
        click: () => {
          void runner?.deleteProfiles().then(() => {
            sendState({ status: "profiles_deleted" });
          });
        },
      },
      {
        label: "Отключить Agent",
        enabled: connected,
        click: () => {
          void disconnectAgent();
        },
      },
      { type: "separator" },
      {
        label: "Выйти",
        click: () => quitAgent(),
      },
    ]),
  );
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.on("click", () => showMainWindow());
  updateTrayMenu();
  logLifecycle("tray:initialized");
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ show: true });
    return;
  }

  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createWindow({ show = true } = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show) showMainWindow();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    title: "FlowPost Agent",
    show,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;

    event.preventDefault();
    logLifecycle("app:hidden-to-tray");
    if (!hiddenToTrayNoticeShown) {
      hiddenToTrayNoticeShown = true;
      sendState({
        status: "background_running",
        backgroundNotice:
          "Agent продолжит работать в фоне. Чтобы полностью выйти, используйте меню в панели.",
      });
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      }, 1200);
      return;
    }

    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    logLifecycle("main-window:destroyed");
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

function getAutoLaunchEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoLaunch(enabled) {
  settings.autoLaunch = enabled;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: enabled,
    args: enabled ? ["--background"] : [],
  });
  logLifecycle("autostart:set", { enabled });
  updateTrayMenu();
}

async function disconnectAgent() {
  await writeSettings({ agentToken: null, account: null });
  stopAgentLoops();
  updateTrayMenu();
}

function quitAgent() {
  logLifecycle("app:quit-from-tray");
  isQuitting = true;
  stopAgentLoops();
  void runner?.dispose?.();
  app.quit();
}

function registerProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("flowpost-agent", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient("flowpost-agent");
  }
}

function handleProtocolUrl(url) {
  if (!url?.startsWith("flowpost-agent://")) return;

  logLifecycle("protocol:received", { url });
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    logLifecycle("protocol:invalid", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const action = parsed.hostname || parsed.pathname.replace(/^\//, "");
  const code = parsed.searchParams.get("code");

  if (action === "pair" && code) {
    pendingPairingCode = code;
  }

  showMainWindow();
  sendState({
    status: "protocol_opened",
    protocolAction: action,
    pairingCode: pendingPairingCode,
    protocolPlatform: parsed.searchParams.get("platform"),
  });
}

function handleProtocolArgv(argv) {
  const protocolArg = argv.find((arg) => arg.startsWith("flowpost-agent://"));
  if (protocolArg) handleProtocolUrl(protocolArg);
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
    autoLaunch: getAutoLaunchEnabled(),
    backgroundRunning: true,
    lastHeartbeatAt,
    activeJobId,
    pairingCode: pendingPairingCode,
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
    if (settings.autoLaunch !== false) {
      setAutoLaunch(true);
      await writeSettings({ autoLaunch: true });
    }
    pendingPairingCode = null;
    startPolling();
    logLifecycle("paired", { deviceId: result.device?.id ?? null });
    return result;
  } catch (error) {
    throw new Error(
      userSafeErrorMessage(error, "Не удалось подключить Agent."),
    );
  }
});

ipcMain.handle("agent:disconnect", async () => {
  await disconnectAgent();
  return true;
});

ipcMain.handle("agent:set-auto-launch", async (_event, enabled) => {
  setAutoLaunch(Boolean(enabled));
  await writeSettings({ autoLaunch: Boolean(enabled) });
  return getAutoLaunchEnabled();
});

ipcMain.handle("agent:get-auto-launch", async () => getAutoLaunchEnabled());

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

app.on("second-instance", (_event, argv) => {
  logLifecycle("single-instance:second-instance", { argv });
  handleProtocolArgv(argv);
  showMainWindow();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

app.whenReady().then(async () => {
  registerProtocol();
  runner = createAutomationRunner({ app, sendState, logJob });
  await readSettings();
  setAutoLaunch(settings.autoLaunch === true);
  createTray();
  createWindow({ show: !process.argv.includes("--background") });
  handleProtocolArgv(process.argv);
  mainWindow.webContents.once("did-finish-load", () => {
    sendState();
    if (settings.agentToken) startPolling();
  });
  logLifecycle("app:started", {
    background: process.argv.includes("--background"),
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopAgentLoops();
  void runner?.dispose?.();
});

app.on("window-all-closed", () => {
  // Keep the Agent alive in tray/menu bar so heartbeat and job polling continue.
});
