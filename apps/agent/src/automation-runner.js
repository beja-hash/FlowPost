const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const SUPPORTED_PLATFORMS = new Set(["dzen", "vc"]);

class UserCancelledBrowserError extends Error {
  constructor(message = "Браузер был закрыт пользователем.") {
    super(message);
    this.name = "UserCancelledBrowserError";
  }
}

function normalizePlatform(platform) {
  const normalized = String(platform || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

  return normalized || "default";
}

function createAutomationRunner({ app, sendState, logJob }) {
  const flowPostDataPath = path.join(app.getPath("appData"), "FlowPost");
  const browserCachePath = path.join(flowPostDataPath, "ms-playwright");
  const profileRoot = path.join(flowPostDataPath, "browser-profiles");
  let activeContext = null;
  let activePage = null;
  let activePlatform = null;
  let activeHeadless = null;
  let activeContextClosed = true;
  let isLaunching = false;
  let launchPromise = null;
  let browserState = "idle";
  let chromiumReady = false;

  process.env.PLAYWRIGHT_BROWSERS_PATH = browserCachePath;

  function logRunner(action, extra = {}) {
    console.log("[flowpost-agent:runner]", {
      action,
      activePlatform,
      activeHeadless,
      activeContext: Boolean(activeContext),
      activePage: Boolean(activePage),
      activeContextClosed,
      isLaunching,
      browserState,
      ...extra,
    });
  }

  function setBrowserState(nextState, extra = {}) {
    browserState = nextState;
    sendState({ browserState, ...extra });
    logRunner(`state:${nextState}`, extra);
  }

  function profilePath(platform) {
    return path.join(profileRoot, normalizePlatform(platform));
  }

  function setPlaywrightEnv(extra = {}) {
    return {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browserCachePath,
      ...extra,
    };
  }

  async function getChromium() {
    const { chromium } = require("playwright");
    return chromium;
  }

  async function hasChromium() {
    try {
      const chromium = await getChromium();
      await fs.access(chromium.executablePath());
      return true;
    } catch {
      return false;
    }
  }

  async function installChromium() {
    const playwrightCli = path.join(
      path.dirname(require.resolve("playwright/package.json")),
      "cli.js",
    );

    await fs.mkdir(browserCachePath, { recursive: true });
    sendState({
      status: "preparing_browser",
      browserInstallStatus: "running",
    });

    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [playwrightCli, "install", "chromium"], {
        env: setPlaywrightEnv({ ELECTRON_RUN_AS_NODE: "1" }),
        stdio: "ignore",
      });

      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error("Не удалось подготовить браузер для публикации."));
      });
    });

    sendState({
      status: "browser_ready",
      browserInstallStatus: "ready",
    });
  }

  async function ensureChromium() {
    if (chromiumReady) {
      sendState({ browserInstallStatus: "ready" });
      return;
    }

    if (await hasChromium()) {
      chromiumReady = true;
      sendState({ browserInstallStatus: "ready" });
      return;
    }

    try {
      await installChromium();
      chromiumReady = true;
    } catch (error) {
      sendState({
        status: "browser_install_failed",
        browserInstallStatus: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Не удалось подготовить браузер для публикации.",
      });
      throw error;
    }
  }

  async function prewarm(platforms = ["dzen"]) {
    const uniquePlatforms = [...new Set(platforms.map(normalizePlatform))];

    setBrowserState("preparing", { status: "preparing_browser" });
    logRunner("prewarm:start", { platforms: uniquePlatforms });
    await ensureChromium();
    await Promise.all(
      uniquePlatforms.map((platform) =>
        fs.mkdir(profilePath(platform), { recursive: true }),
      ),
    );
    setBrowserState("idle", { status: "browser_ready" });
    logRunner("prewarm:ready", { platforms: uniquePlatforms });
  }

  function clearActiveContext(context) {
    if (context && activeContext && context !== activeContext) return;

    logRunner("context:clear");
    activeContext = null;
    activePage = null;
    activePlatform = null;
    activeHeadless = null;
    activeContextClosed = true;
    setBrowserState("closed");
  }

  async function closeActiveContext() {
    const context = activeContext;
    clearActiveContext(context);

    if (context) {
      await context.close().catch((error) => {
        logRunner("context:close:ignored-error", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  function contextLooksUsable(platform, headless) {
    return (
      activeContext &&
      !activeContextClosed &&
      activePlatform === platform &&
      activeHeadless === headless
    );
  }

  async function getOrCreatePage(context) {
    if (activePage && !activePage.isClosed()) {
      return activePage;
    }

    const existingPage = context.pages().find((page) => !page.isClosed());
    activePage = existingPage ?? (await context.newPage());
    activePage.once("close", () => {
      if (activePage?.isClosed()) {
        logRunner("page:closed");
        activePage = null;
      }
    });

    return activePage;
  }

  async function getOrLaunchContext(platform, options = {}) {
    const normalizedPlatform = normalizePlatform(platform);
    const headless = Boolean(options.headless);

    if (contextLooksUsable(normalizedPlatform, headless)) {
      logRunner("context:reuse", { platform: normalizedPlatform });
      setBrowserState("opened", { status: "browser_already_opened" });
      return activeContext;
    }

    if (isLaunching && launchPromise) {
      if (activePlatform && activePlatform !== normalizedPlatform) {
        throw new Error("Браузер уже запускается для другой площадки.");
      }

      logRunner("context:await-existing-launch", {
        platform: normalizedPlatform,
      });
      setBrowserState("busy", { status: "browser_already_launching" });
      return launchPromise;
    }

    if (
      activeContext &&
      activePlatform === normalizedPlatform &&
      activeHeadless === headless
    ) {
      logRunner("context:reuse-visible", { platform: normalizedPlatform });
      return activeContext;
    }

    await closeActiveContext();
    await ensureChromium();
    const chromium = await getChromium();
    const userDataDir = profilePath(normalizedPlatform);

    await fs.mkdir(userDataDir, { recursive: true });

    isLaunching = true;
    activePlatform = normalizedPlatform;
    activeHeadless = headless;
    activeContextClosed = true;
    setBrowserState("launching", { status: "launching_browser" });
    logRunner("context:launch:start", {
      platform: normalizedPlatform,
      userDataDir,
    });

    launchPromise = chromium
      .launchPersistentContext(userDataDir, {
        headless,
        args: headless ? [] : ["--start-maximized"],
        viewport: headless ? { width: 1440, height: 1000 } : null,
      })
      .then((context) => {
        activeContext = context;
        activeContextClosed = false;
        setBrowserState("opened", { status: "browser_opened" });
        context.once("close", () => {
          logRunner("context:closed", { platform: normalizedPlatform });
          clearActiveContext(context);
          sendState({ status: "browser_closed" });
        });
        logRunner("context:launch:ready", { platform: normalizedPlatform });
        return context;
      })
      .finally(() => {
        isLaunching = false;
        launchPromise = null;
      });

    return launchPromise;
  }

  async function launchContext(platform, options = {}) {
    const context = await getOrLaunchContext(platform, options);
    await getOrCreatePage(context);
    return context;
  }

  async function openPage(platform, url, options = {}) {
    const context = await getOrLaunchContext(platform, options);
    const page = await getOrCreatePage(context);

    if (page.isClosed()) {
      activePage = null;
      return openPage(platform, url);
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { context, page };
  }

  async function launchDetachedBrowser(platform, url) {
    const { context, page } = await openPage(platform, url, { headless: false });
    sendState({ status: "browser_opened" });
    return { context, page };
  }

  async function runConnectPlatformJob(job, updateJobStatus) {
    const platform = normalizePlatform(job.platform || job.payload?.platform);
    const connectUrl = job.payload?.connectUrl;

    if (!SUPPORTED_PLATFORMS.has(platform) || !connectUrl) {
      throw new Error("Задание подключения повреждено.");
    }

    await updateJobStatus(job.id, "running");
    setBrowserState("running_job", { status: "browser_opening" });

    const context = await launchContext(platform, { headless: false });
    let finishedLogin;
    let browserClosed = false;
    const loginFinished = new Promise((resolve) => {
      finishedLogin = resolve;
    });

    context.once("close", () => {
      browserClosed = true;
      finishedLogin();
    });

    await context
      .exposeBinding("__flowPostFinishPlatformConnection", () => {
        finishedLogin();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);

        if (!message.includes("__flowPostFinishPlatformConnection")) {
          throw error;
        }

        logRunner("binding:finish-already-registered");
      });

    await context.addInitScript(() => {
      const installFinishButton = () => {
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
          void window.__flowPostFinishPlatformConnection?.();
        });
        document.documentElement.appendChild(button);
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", installFinishButton);
        return;
      }

      installFinishButton();
    });

    const page = await getOrCreatePage(context);
    await page.goto(connectUrl, { waitUntil: "domcontentloaded" });
    await updateJobStatus(job.id, "waiting_user_login");
    await logJob(job.id, "Браузер открыт локально. Ожидаем вход пользователя.");
    setBrowserState("opened", { status: "browser_opened" });

    await loginFinished;

    if (browserClosed) {
      await updateJobStatus(job.id, "cancelled", {
        error: "Браузер был закрыт до подтверждения подключения.",
      }).catch(() => undefined);
      await logJob(
        job.id,
        "Браузер закрыт пользователем до подтверждения подключения.",
        "warning",
      );
      throw new UserCancelledBrowserError(
        "Браузер был закрыт. Нажмите “Открыть браузер” еще раз.",
      );
    }

    await updateJobStatus(job.id, "completed", {
      result: {
        platform,
        cookiesStoredLocally: true,
      },
    });
    await logJob(job.id, "Подключение завершено. Cookies остались локально.");
    await closeActiveContext();
    sendState({ status: "connected" });
  }

  async function runPublishArticleJob(job, updateJobStatus) {
    const platform = normalizePlatform(job.platform || job.payload?.platform);
    const editorUrl = job.payload?.editorUrl;
    const title = job.payload?.title;
    const body = [job.payload?.body, job.payload?.ctaText, job.payload?.ctaUrl]
      .filter(Boolean)
      .join("\n\n");

    if (!SUPPORTED_PLATFORMS.has(platform) || !editorUrl || !title || !body) {
      throw new Error("Задание публикации повреждено.");
    }

    await updateJobStatus(job.id, "running");
    setBrowserState("running_job", { status: "publishing" });

    const { page } = await openPage(platform, editorUrl, { headless: true });

    try {
      await fillArticle(page, platform, title, body);

      await updateJobStatus(job.id, "completed", {
        result: {
          platform,
          articleId: job.payload?.articleId,
          publishedUrl: page.url(),
        },
      });
      await logJob(job.id, "Публикация выполнена локально через Playwright.");
      setBrowserState("idle", { status: "publish_completed" });
    } finally {
      await closeActiveContext();
    }
  }

  async function fillArticle(page, platform, title, body) {
    if (platform === "vc") {
      await page
        .locator('textarea[placeholder*="Заголовок"], [contenteditable="true"]')
        .first()
        .fill(title, { timeout: 20_000 });
      await page
        .locator('[contenteditable="true"], textarea')
        .last()
        .fill(body, { timeout: 20_000 });
      return;
    }

    if (platform === "dzen") {
      await page
        .locator('textarea, input, [contenteditable="true"]')
        .first()
        .fill(title, { timeout: 20_000 });
      await page
        .locator('textarea, [contenteditable="true"]')
        .last()
        .fill(body, { timeout: 20_000 });
      return;
    }

    await page
      .locator('input[name="title"], textarea[name="title"], [contenteditable="true"]')
      .first()
      .fill(title, { timeout: 20_000 });
    await page.locator('textarea, [contenteditable="true"]').last().fill(body, {
      timeout: 20_000,
    });
  }

  async function deleteProfiles() {
    await closeActiveContext();
    await fs.rm(profileRoot, { recursive: true, force: true });
  }

  async function dispose() {
    await closeActiveContext();
  }

  return {
    browserCachePath,
    ensureChromium,
    prewarm,
    deleteProfiles,
    dispose,
    profilePath,
    profileRoot,
    isUserCancelledError: (error) => error instanceof UserCancelledBrowserError,
    launchDetachedBrowser,
    runConnectPlatformJob,
    runPublishArticleJob,
  };
}

module.exports = { createAutomationRunner };
