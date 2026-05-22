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
let scheduledTimer;
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
let wakeOnDemandMode = false;
let quitAfterWakeTimer = null;
let backgroundStarted = false;
let pendingShowMainWindow = false;
const pendingProtocolUrls = [];

const gotSingleInstanceLock = app.requestSingleInstanceLock();

class FlowPostApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "FlowPostApiError";
    this.status = status;
    this.code = code;
  }
}

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

function getWindowLifecycleState() {
  try {
    if (!mainWindow) {
      return {
        hasMainWindow: false,
        mainWindowDestroyed: null,
        webContentsDestroyed: null,
      };
    }

    if (mainWindow.isDestroyed()) {
      return {
        hasMainWindow: true,
        mainWindowDestroyed: true,
        webContentsDestroyed: null,
      };
    }

    const webContents = mainWindow.webContents;
    return {
      hasMainWindow: true,
      mainWindowDestroyed: false,
      webContentsDestroyed: webContents?.isDestroyed?.() ?? null,
    };
  } catch (error) {
    return {
      hasMainWindow: Boolean(mainWindow),
      mainWindowDestroyed: null,
      webContentsDestroyed: null,
      lifecycleStateError: error?.message || String(error),
    };
  }
}

function logLifecycle(event, payload = {}) {
  const data = {
    event,
    payload: {
      ...payload,
      lifecycle: getWindowLifecycleState(),
    },
    at: new Date().toISOString(),
  };

  console.log("[flowpost-agent:lifecycle]", data);
  console.log("[agent:lifecycle]", data);
  safeSend("agent:lifecycle", data);
}

function safeSend(channel, payload) {
  try {
    if (!mainWindow) return;
    if (mainWindow.isDestroyed()) return;

    const webContents = mainWindow.webContents;
    if (!webContents) return;
    if (webContents.isDestroyed()) return;

    webContents.send(channel, payload);
  } catch (error) {
    console.warn("[agent:safeSend] skipped", error?.message || error);
  }
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

function extractProtocolUrl(argv) {
  return argv.find((arg) => arg.startsWith("flowpost-agent://")) ?? null;
}

function parseProtocolAction(url) {
  if (!url?.startsWith("flowpost-agent://")) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    logLifecycle("protocol:invalid", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  return {
    type: parsed.hostname || parsed.pathname.replace(/^\//, ""),
    code: parsed.searchParams.get("code"),
    platform: parsed.searchParams.get("platform"),
    url,
  };
}

function detectStartupMode(argv) {
  if (argv.some((arg) => arg.includes("flowpost-agent://wake"))) {
    return "wake";
  }

  if (argv.some((arg) => arg.includes("flowpost-agent://open-background"))) {
    return "background";
  }

  if (argv.includes("--hidden")) return "hidden";
  if (argv.includes("--background")) return "background";
  return "normal";
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
    throw new FlowPostApiError(
      body?.error?.message || `FlowPost API error ${response.status}`,
      {
        status: response.status,
        code: body?.error?.code,
      },
    );
  }

  return body;
}

function isRevokedTokenError(error) {
  const code = error?.code ? String(error.code).toUpperCase() : "";

  return (
    error?.status === 401 ||
    error?.status === 403 ||
    code === "DEVICE_REVOKED" ||
    code === "AGENT_REVOKED" ||
    code === "INVALID_TOKEN" ||
    code === "INVALID_AGENT_TOKEN"
  );
}

async function clearLocalAgentToken(reason = "Agent отключен от аккаунта. Создайте новый код подключения в FlowPost.") {
  if (!settings.agentToken) {
    sendState({ status: "agent_revoked", error: reason });
    return;
  }

  console.log("[agent] token revoked");
  clearInterval(pollingTimer);
  console.log("[agent] polling stopped");
  clearInterval(heartbeatTimer);
  console.log("[agent] heartbeat stopped");
  await writeSettings({ agentToken: null, account: null });
  console.log("[agent] local token cleared");
  activeJobId = null;
  isPolling = false;
  sendState({
    status: "agent_revoked",
    error: reason,
    activeJobId: null,
  });
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
    if (isRevokedTokenError(error)) {
      await clearLocalAgentToken(
        "Agent отключен от аккаунта. Создайте новый код подключения в FlowPost.",
      );
      return;
    }

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
  clearInterval(scheduledTimer);
  clearInterval(heartbeatTimer);
  clearTimeout(quitAfterWakeTimer);
}

function shouldQuitAfterWakeJob() {
  const raw = process.env.AGENT_QUIT_AFTER_WAKE_JOB;
  return raw === undefined ? true : String(raw).toLowerCase() === "true";
}

function scheduleQuitAfterWakeJob() {
  clearTimeout(quitAfterWakeTimer);

  if (!wakeOnDemandMode || !shouldQuitAfterWakeJob()) {
    return;
  }

  logLifecycle("job finished");

  if (activeJobId || runner?.hasVisibleBrowser?.()) {
    return;
  }

  logLifecycle("no pending jobs");
  logLifecycle("quit after wake scheduled");
  quitAfterWakeTimer = setTimeout(() => {
    if (activeJobId || runner?.hasVisibleBrowser?.()) {
      return;
    }

    logLifecycle("quitting after wake job");
    logLifecycle("app:quit-after-wake-job");
    isQuitting = true;
    stopAgentLoops();
    void runner?.dispose?.();
    app.quit();
  }, 15_000);
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
  console.log("[agent] job running", {
    id: job.id,
    type: job.type,
    platform: job.platform,
  });
  await runner.runConnectPlatformJob(job, updateJobStatus);
}

async function runPublishArticleJob(job) {
  logLifecycle("job:publish-article:start", { jobId: job.id });
  console.log("[agent] job running", {
    id: job.id,
    type: job.type,
    platform: job.platform,
  });
  await runner.runPublishArticleJob(job, updateJobStatus);
}

async function handleJob(job) {
  if (
    job.type === "connect_platform" ||
    job.type === "open_platform" ||
    job.type === "reconnect_platform"
  ) {
    await runConnectPlatformJob(job);
    return;
  }

  if (job.type === "publish_article" || job.type === "scheduled_publish") {
    await runPublishArticleJob(job);
    return;
  }

  await updateJobStatus(job.id, "failed", {
    error: "Этот тип задачи пока не поддерживается в Agent.",
  });
  console.log("[agent] unknown job type", {
    id: job.id,
    type: job.type,
    platform: job.platform,
  });
}

async function pollJobs() {
  if (!settings.agentToken) return;
  if (isPolling || activeJobId) {
    logLifecycle("poll:skip-busy", { isPolling, activeJobId });
    return;
  }

  let handledJob = false;

  try {
    isPolling = true;
    sendState({ status: "waiting_job" });
    const { job } = await api("/api/agent/jobs/next");
    if (!job) return;
    handledJob = true;
    activeJobId = job.id;
    console.log("[agent] job received", {
      id: job.id,
      type: job.type,
      platform: job.platform,
      payloadKeys:
        job.payload && typeof job.payload === "object"
          ? Object.keys(job.payload)
          : [],
    });
    sendState({ status: "job_received" });
    try {
      await handleJob(job);
      console.log("[agent] job completed", {
        id: job.id,
        type: job.type,
        platform: job.platform,
      });
    } catch (error) {
      const message = userSafeErrorMessage(error, "Неизвестная ошибка Agent.");
      const status = runner?.isUserCancelledError?.(error)
        ? "cancelled"
        : "failed";
      await updateJobStatus(job.id, status, { error: message }).catch(
        () => undefined,
      );
      await logJob(job.id, message, "error");
      console.log("[agent] job failed", {
        id: job.id,
        type: job.type,
        platform: job.platform,
        error: message,
      });
      throw error;
    }
  } catch (error) {
    if (isRevokedTokenError(error)) {
      await clearLocalAgentToken(
        "Agent отключен от аккаунта. Создайте новый код подключения в FlowPost.",
      );
      return;
    }

    sendState({
      status: "error",
      error: userSafeErrorMessage(error, "Неизвестная ошибка Agent."),
    });
  } finally {
    isPolling = false;
    activeJobId = null;
    if (handledJob) {
      sendState({ status: "idle", activeJobId: null });
      scheduleQuitAfterWakeJob();
    }
  }
}

async function pollScheduledPublications() {
  if (!settings.agentToken) return;

  const agentNow = new Date();
  console.log("[Scheduler] agent now", agentNow.toISOString());

  try {
    const result = await api("/api/agent/scheduled-publications/claim", {
      method: "POST",
      body: JSON.stringify({
        agentNow: agentNow.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      }),
    });

    console.log("[Scheduler] claim result", {
      agentNow: agentNow.toISOString(),
      queuedCount: result.queuedCount ?? 0,
      checkedAt: result.checkedAt ?? null,
    });

    if ((result.queuedCount ?? 0) > 0) {
      void pollJobs();
    }
  } catch (error) {
    if (isRevokedTokenError(error)) {
      await clearLocalAgentToken(
        "Agent отключен от аккаунта. Создайте новый код подключения в FlowPost.",
      );
      return;
    }

    console.log("[Scheduler] claim failed", {
      agentNow: agentNow.toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function startPolling() {
  clearInterval(pollingTimer);
  clearInterval(scheduledTimer);
  pollingTimer = setInterval(() => void pollJobs(), 3000);
  scheduledTimer = setInterval(() => void pollScheduledPublications(), 30_000);
  startHeartbeat();
  void prewarmBrowser();
  void pollScheduledPublications();
  void pollJobs();
  console.log("[agent] polling started");
  logLifecycle("polling:started");
}

async function startBackgroundAgent() {
  if (!app.isReady()) {
    logLifecycle("background:start-deferred-before-ready");
    return;
  }

  if (!runner) {
    runner = createAutomationRunner({ app, sendState, logJob });
  }

  await readSettings();
  createTray();

  if (settings.agentToken) {
    startPolling();
  } else {
    sendState({ status: "not_paired" });
  }

  if (!backgroundStarted) {
    backgroundStarted = true;
    logLifecycle("background_agent_started");
  } else {
    logLifecycle("background_agent_already_started");
  }
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
  if (!app.isReady()) {
    pendingShowMainWindow = true;
    logLifecycle("show-window:deferred-before-ready");
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ show: true });
    return;
  }

  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createWindow({ show = true } = {}) {
  if (!app.isReady()) {
    pendingShowMainWindow = pendingShowMainWindow || show;
    logLifecycle("create-window:blocked-before-ready", { show });
    return;
  }

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
  mainWindow.webContents.once("did-finish-load", () => {
    sendState();
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
  try {
    await api("/api/agent/devices/revoke-current", {
      method: "POST",
      body: JSON.stringify({ reason: "user_disconnect" }),
    });
  } catch (error) {
    logLifecycle("disconnect:revoke-failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    if (isRevokedTokenError(error)) {
      await clearLocalAgentToken(
        "Agent отключен от аккаунта. Создайте новый код подключения в FlowPost.",
      );
      return;
    }
  }

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

function queueProtocolUrl(url) {
  if (!url?.startsWith("flowpost-agent://")) return null;

  if (!app.isReady()) {
    pendingProtocolUrls.push(url);
    logLifecycle("protocol:queued-before-ready", { url });
    return parseProtocolAction(url)?.type ?? null;
  }

  void handleProtocolUrlAfterReady(url);
  return parseProtocolAction(url)?.type ?? null;
}

function handleProtocolUrl(url) {
  return queueProtocolUrl(url);
}

async function handleProtocolUrlAfterReady(url) {
  if (!app.isReady()) {
    queueProtocolUrl(url);
    return null;
  }

  const action = parseProtocolAction(url);
  if (!action) return null;

  logLifecycle("protocol:received", { url, action: action.type });

  if (action.type === "wake" || action.type === "open-background") {
    wakeOnDemandMode = true;
    logLifecycle("wake mode enabled", { action: action.type });
    await startBackgroundAgent();
  } else if (action.type === "open") {
    await startBackgroundAgent();
    showMainWindow();
  } else if (action.type === "pair") {
    if (action.code) {
      pendingPairingCode = action.code;
    }

    await startBackgroundAgent();
    showMainWindow();
  } else {
    await startBackgroundAgent();
  }

  sendState({
    status: "protocol_opened",
    protocolAction: action.type,
    pairingCode: pendingPairingCode,
    protocolPlatform: action.platform,
  });

  return action.type;
}

async function flushPendingProtocolUrls() {
  while (pendingProtocolUrls.length > 0) {
    const url = pendingProtocolUrls.shift();
    await handleProtocolUrlAfterReady(url);
  }
}

function shouldStartHidden(argv) {
  return ["wake", "background", "hidden"].includes(detectStartupMode(argv));
}

function initializeWakeModeFromArgv(argv) {
  const startupMode = detectStartupMode(argv);

  if (startupMode === "background" || startupMode === "hidden") {
    wakeOnDemandMode = true;
    logLifecycle("wake mode enabled", { source: "argv", startupMode });
    return;
  }

  const protocolArg = extractProtocolUrl(argv);
  if (!protocolArg) return;

  const action = parseProtocolAction(protocolArg);
  if (action?.type === "wake" || action?.type === "open-background") {
    wakeOnDemandMode = true;
    logLifecycle("wake mode enabled", { action: action.type });
  }
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
  const protocolUrl = extractProtocolUrl(argv);

  if (protocolUrl) {
    queueProtocolUrl(protocolUrl);
    return;
  }

  if (app.isReady()) {
    showMainWindow();
  } else {
    pendingShowMainWindow = true;
  }
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
  initializeWakeModeFromArgv(process.argv);
  await startBackgroundAgent();

  const startupMode = detectStartupMode(process.argv);
  const startupProtocolUrl = extractProtocolUrl(process.argv);

  if (startupProtocolUrl && !pendingProtocolUrls.includes(startupProtocolUrl)) {
    pendingProtocolUrls.push(startupProtocolUrl);
  }

  if (
    pendingShowMainWindow ||
    (startupMode === "normal" &&
      !startupProtocolUrl &&
      pendingProtocolUrls.length === 0)
  ) {
    showMainWindow();
  }

  await flushPendingProtocolUrls();
  logLifecycle("app:started", {
    background: shouldStartHidden(process.argv),
    startupMode,
  });
});

app.on("before-quit", (event) => {
  if (!isQuitting) {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    logLifecycle("quit-prevented-agent-hidden");
    return;
  }

  stopAgentLoops();
  void runner?.dispose?.();
});

app.on("window-all-closed", () => {
  // Keep the Agent alive in tray/menu bar so heartbeat and job polling continue.
});
