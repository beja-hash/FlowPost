const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  bodyTail,
  inspectPublishingBody,
  sanitizeBodyForPublishing,
} = require("./publish-body-sanitizer");

const SUPPORTED_PLATFORMS = new Set(["dzen", "vc"]);
const DZEN_HOME_URL = "https://dzen.ru/";
const VC_HOME_URL = "https://vc.ru/";
const VC_NEW_URL = "https://vc.ru/new";
const DEBUG_ERROR_BROWSER_HOLD_MS = 45_000;

class UserCancelledBrowserError extends Error {
  constructor(message = "Браузер был закрыт пользователем.") {
    super(message);
    this.name = "UserCancelledBrowserError";
  }
}

class AutomationError extends Error {
  constructor(code, message, technicalMessage) {
    super(message);
    this.name = "AutomationError";
    this.code = code;
    this.technicalMessage = technicalMessage || message;
  }
}

class SessionExpiredError extends AutomationError {
  constructor(message = "Сессия площадки истекла. Нажмите «Переподключить», чтобы войти заново.") {
    super("SESSION_EXPIRED", message);
    this.name = "SessionExpiredError";
  }
}

function normalizePlatform(platform) {
  const normalized = String(platform || "default")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.ru$/, "")
    .replace(/[^a-z0-9_-]/g, "");

  if (normalized === "vcru") return "vc";
  return normalized || "default";
}

function normalizeJobType(type) {
  return String(type || "").trim().toLowerCase();
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

  function shouldRunHeadless(job) {
    const jobType = normalizeJobType(job.type);
    const envValue = process.env.AGENT_SHOW_BROWSER_ON_PUBLISH;
    const showBrowserOnPublish =
      envValue === undefined ? true : String(envValue).toLowerCase() === "true";

    if (jobType === "publish_article" || jobType === "scheduled_publish") {
      return !showBrowserOnPublish;
    }

    return false;
  }

  function isDebugVisiblePublish(job, headless) {
    const jobType = normalizeJobType(job.type);
    return (
      !headless &&
      (jobType === "publish_article" || jobType === "scheduled_publish")
    );
  }

  function platformLabel(platform) {
    return normalizePlatform(platform) === "dzen" ? "dzen" : "vc";
  }

  async function logStep(platform, step, extra = {}) {
    const label = platformLabel(platform);
    console.log(`[agent:${label}] ${step}`, extra);
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
      headless,
    });
    console.log("[agent] browser launch mode", {
      platform: normalizedPlatform,
      headless,
    });

    launchPromise = chromium
      .launchPersistentContext(userDataDir, {
        headless,
        args: headless
          ? ["--disable-background-timer-throttling"]
          : ["--start-minimized", "--disable-background-timer-throttling"],
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
      return openPage(platform, url, options);
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
    const jobType = normalizeJobType(job.type);
    const platform = normalizePlatform(job.platform || job.payload?.platform);
    const connectUrl = job.payload?.connectUrl;
    const openUrl = job.payload?.editorUrl || connectUrl;

    if (!SUPPORTED_PLATFORMS.has(platform) || !openUrl) {
      throw new Error("Задание подключения повреждено.");
    }

    await updateJobStatus(job.id, "running");
    setBrowserState("running_job", { status: "browser_opening" });

    if (jobType === "open_platform") {
      await launchDetachedBrowser(platform, openUrl);
      await updateJobStatus(job.id, "completed", {
        result: {
          platform,
          browserOpened: true,
        },
      });
      await logJob(job.id, "Браузер открыт локально.");
      return;
    }

    if (!connectUrl) {
      throw new Error("Задание подключения повреждено.");
    }

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

  function validatePublishPayload(job) {
    const payload = job.payload || {};
    const required = [
      "articleId",
      "publicationId",
      "variantId",
      "brandId",
      "workspaceId",
      "userId",
      "platform",
      "title",
    ];
    const missing = required.filter((key) => !payload[key]);
    const editorUrl = payload.platformEditorUrl || payload.editorUrl;
    const content = payload.content || payload.body;

    if (!content) missing.push("content");

    if (missing.length > 0) {
      throw new AutomationError(
        "PAYLOAD_INCOMPLETE",
        "Недостаточно данных для публикации. Сохраните статью и попробуйте снова.",
        `PUBLISH_ARTICLE payload is missing: ${missing.join(", ")}`,
      );
    }

    return {
      ...payload,
      editorUrl,
      content,
    };
  }

  async function runPublishArticleJob(job, updateJobStatus) {
    const payload = validatePublishPayload(job);
    const platform = normalizePlatform(job.platform || job.payload?.platform);
    const title = payload.title;
    const rawBody = String(payload.body || payload.content || "");

    const headless = shouldRunHeadless(job);
    const visibleDebugMode = isDebugVisiblePublish(job, headless);
    await updateJobStatus(job.id, "running");
    setBrowserState("running_job", { status: "publishing" });
    console.log("[agent] publish mode", {
      headless,
      trigger: payload.trigger || "manual",
      reason: headless ? "explicit headless publish" : "visible publish test mode",
    });
    console.log("[agent] publish started", {
      id: job.id,
      platform,
      payloadKeys:
        job.payload && typeof job.payload === "object"
          ? Object.keys(job.payload)
          : [],
    });
    await logJob(job.id, "Публикация запущена в локальном браузере Agent.");

    let page = null;

    try {
      logAgentPublishBody("raw payload.body", rawBody, payload, platform);
      logAgentPublishBody("before sanitize", rawBody, payload, platform);
      const body = sanitizeBodyForPublishing(rawBody, {
        ctaText: normalizeCtaText(payload),
        ctaUrl: payload.ctaUrl,
        brandName: payload.brandName,
      });
      logAgentPublishBody("after sanitize", body, payload, platform);
      validateSanitizedPublishBody(body, payload);
      assertNoUnsafeLinkText(body, platform, payload);

      if (platform === "dzen") {
        const opened = await openPage(platform, DZEN_HOME_URL, { headless });
        page = opened.page;
        await publishToDzen(page, { ...payload, title, body, content: body });
      } else if (platform === "vc") {
        const opened = await openPage(platform, VC_HOME_URL, { headless });
        page = opened.page;
        await publishToVc(page, { ...payload, title, body, content: body });
      } else {
        throw new AutomationError(
          "UNSUPPORTED_PLATFORM",
          "Эта площадка пока не поддерживается Agent.",
          `Unsupported publish platform: ${platform}`,
        );
      }

      if (await looksLikeLoginPage(page)) {
        throw new SessionExpiredError();
      }

      await updateJobStatus(job.id, "completed", {
        result: {
          platform,
          articleId: payload.articleId,
          publishedUrl: page.url(),
        },
      });
      await logJob(job.id, "Публикация выполнена локально через Playwright.");
      console.log("[agent] publish completed", {
        id: job.id,
        platform,
        publishedUrl: page.url(),
      });
      setBrowserState("idle", { status: "publish_completed" });
    } catch (error) {
      const errorMeta = await capturePublishError({
        page,
        job,
        platform,
        error,
      });

      if (error instanceof SessionExpiredError) {
        console.log("[agent] session expired", {
          id: job.id,
          platform,
          url: page?.url?.() ?? null,
          ...errorMeta,
        });
        await updateJobStatus(job.id, "failed", {
          error: error.message,
          result: {
            ok: false,
            code: error.code,
            platform,
            articleId: payload.articleId,
            ...errorMeta,
          },
        });
        await logJob(job.id, error.message, "warning");
        setBrowserState("idle", { status: "session_expired" });
        throw error;
      }

      const message =
        error instanceof Error ? error.message : "Ошибка автоматизации публикации.";
      const code = error instanceof AutomationError
        ? error.code
        : "AUTOMATION_EXCEPTION";
      const technicalMessage =
        error instanceof AutomationError
          ? error.technicalMessage
          : message;
      console.log("[agent] publish failed", {
        id: job.id,
        platform,
        error: technicalMessage,
        code,
        ...errorMeta,
      });
      await updateJobStatus(job.id, "failed", {
        error: message,
        result: {
          ok: false,
          code,
          platform,
          articleId: payload.articleId,
          technicalError: technicalMessage,
          ...errorMeta,
        },
      }).catch(() => undefined);
      await logJob(job.id, technicalMessage, "error");
      if (visibleDebugMode && page && !page.isClosed()) {
        await page.waitForTimeout(DEBUG_ERROR_BROWSER_HOLD_MS).catch(() => undefined);
      }
      throw error;
    } finally {
      await closeActiveContext();
      setBrowserState("idle", { status: "job_idle" });
    }
  }

  async function looksLikeLoginPage(page) {
    const url = page.url().toLowerCase();

    if (
      url.includes("login") ||
      url.includes("auth") ||
      url.includes("passport") ||
      url.includes("oauth") ||
      url.includes("signin")
    ) {
      return true;
    }

    const loginElements = page
      .locator(
        [
          'input[type="password"]',
          'button:has-text("Войти")',
          'a:has-text("Войти")',
          'button:has-text("Log in")',
          'button:has-text("Sign in")',
        ].join(", "),
      )
      .first();

    return loginElements.isVisible({ timeout: 1500 }).catch(() => false);
  }

  async function capturePublishError({ page, job, platform, error }) {
    const step =
      error instanceof AutomationError && error.step
        ? error.step
        : error instanceof SessionExpiredError
          ? "check session"
          : "publish";
    const code =
      error instanceof AutomationError
        ? error.code
        : error instanceof SessionExpiredError
          ? error.code
          : "AUTOMATION_EXCEPTION";
    const meta = {
      platform,
      step,
      currentUrl: null,
      pageTitle: null,
      visibleEditablesCount: null,
      errorCode: code,
      screenshotPath: null,
    };

    if (!page || page.isClosed()) {
      console.log("[agent] publish error diagnostics", meta);
      return meta;
    }

    try {
      meta.currentUrl = page.url();
      meta.pageTitle = await page.title().catch(() => null);
      meta.visibleEditablesCount = (await getVisibleEditables(page)).length;
      const screenshotsDir = path.join(app.getPath("userData"), "logs", "screenshots");
      await fs.mkdir(screenshotsDir, { recursive: true });
      const safePlatform = normalizePlatform(platform);
      const fileName = `${Date.now()}-${safePlatform}-${job.id}-${code}.png`.replace(
        /[^a-z0-9_.-]/gi,
        "_",
      );
      meta.screenshotPath = path.join(screenshotsDir, fileName);
      await page.screenshot({ path: meta.screenshotPath, fullPage: true }).catch(
        () => undefined,
      );
    } catch (diagnosticsError) {
      console.log("[agent] publish error diagnostics failed", {
        error:
          diagnosticsError instanceof Error
            ? diagnosticsError.message
            : String(diagnosticsError),
      });
    }

    console.log("[agent] publish error diagnostics", meta);
    return meta;
  }

  function automationError(code, message, technicalMessage, step) {
    const error = new AutomationError(code, message, technicalMessage);
    error.step = step;
    return error;
  }

  async function waitForNetworkSettled(page, timeout = 15_000) {
    await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
  }

  async function humanDelay(min = 300, max = 1200) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async function waitVisibleEnabled(locator, timeout = 20_000) {
    const element = locator.first();
    const deadline = Date.now() + timeout;

    await element.waitFor({ state: "visible", timeout });
    await element.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => undefined);
    await element.waitFor({ state: "attached", timeout: 10_000 }).catch(
      () => undefined,
    );
    await element.waitFor({ state: "visible", timeout: 10_000 });

    while (Date.now() < deadline) {
      const enabled = await element
        .evaluate((node) => {
          const htmlElement = node;
          const disabled =
            htmlElement.hasAttribute("disabled") ||
            htmlElement.getAttribute("aria-disabled") === "true";

          return !disabled;
        })
        .catch(() => false);

      if (enabled) {
        return element;
      }

      await humanDelay(350, 800);
    }

    throw new Error("Element is disabled.");
  }

  async function waitFirstVisible(locator, timeout = 3500) {
    const deadline = Date.now() + timeout;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        const items = await locator.all();

        for (const item of items) {
          if (await item.isVisible({ timeout: 500 }).catch(() => false)) {
            return item;
          }
        }
      } catch (error) {
        lastError = error;
      }

      await humanDelay(200, 450);
    }

    if (lastError) throw lastError;
    throw new Error("Visible element not found.");
  }

  async function moveMouseToElement(page, locator) {
    const element = locator.first();
    const box = await element.boundingBox();

    if (!box) {
      await element.hover({ timeout: 10_000 }).catch(() => undefined);
      return;
    }

    const targetX = box.x + box.width / 2 + Math.floor(Math.random() * 10) - 5;
    const targetY = box.y + box.height / 2 + Math.floor(Math.random() * 10) - 5;
    const startX = Math.max(12, targetX - 80 - Math.floor(Math.random() * 120));
    const startY = Math.max(12, targetY - 40 - Math.floor(Math.random() * 80));

    await page.mouse.move(startX, startY, { steps: 8 });
    await humanDelay(160, 420);
    await page.mouse.move(targetX, targetY, {
      steps: 18 + Math.floor(Math.random() * 12),
    });
  }

  async function humanClick(page, locator) {
    const element = await waitVisibleEnabled(locator);
    await humanDelay(240, 680);
    await moveMouseToElement(page, element);
    await humanDelay(180, 420);
    const box = await element.boundingBox();

    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
        delay: Math.floor(Math.random() * 80) + 40,
      });
    } else {
      await element.click({ timeout: 10_000 });
    }

    await humanDelay(450, 950);
  }

  async function focusEditable(page, locator) {
    const element = await waitVisibleEnabled(locator);
    await moveMouseToElement(page, element);
    await humanDelay(180, 420);
    await element.click({ timeout: 10_000 });
    await humanDelay(150, 350);
    await element.evaluate((node) => {
      if (node instanceof HTMLElement) node.focus();
    });
    return element;
  }

  async function humanType(page, locator, text) {
    const element = await focusEditable(page, locator);
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
    await humanDelay(120, 280);
    await page.keyboard.press("Backspace").catch(() => undefined);
    await humanDelay(150, 350);

    for (const char of text) {
      await page.keyboard.type(char, {
        delay: Math.floor(Math.random() * 81) + 40,
      });
    }

    await humanDelay(450, 900);
    await element.evaluate((node) => {
      node.dispatchEvent(new InputEvent("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function pasteText(page, text, locator = null) {
    const element = locator ? await focusEditable(page, locator) : null;
    if (element) {
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
      await humanDelay(120, 280);
      await page.keyboard.press("Backspace").catch(() => undefined);
      await humanDelay(150, 350);
    }

    await page.keyboard.insertText(text);
    await humanDelay(800, 1400);
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.dispatchEvent(new InputEvent("input", { bubbles: true }));
        active.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }).catch(() => undefined);
  }

  const bareUrlPattern = /https?:\/\/[^\s)]+/gi;
  const standaloneUrlPattern = /^https?:\/\/\S+$/i;
  const junkCtaTextPattern =
    /^(покупка услуг|покупка|услуги|купить|заказать|перейти|перейти по ссылке|переходите по ссылке|ссылка ниже|ссылка|cta|call to action|url)$/i;
  const genericBrandNamePattern = /^(ai content distribution platform|content distribution platform)$/i;

  function normalizeCtaText(payload) {
    const raw = String(payload.ctaText || "").replace(/\s+/g, " ").trim();
    if (raw && !junkCtaTextPattern.test(raw)) {
      return raw;
    }

    const brandName = String(payload.brandName || "").replace(/\s+/g, " ").trim();
    if (
      brandName &&
      !junkCtaTextPattern.test(brandName) &&
      !genericBrandNamePattern.test(brandName.toLowerCase())
    ) {
      return brandName;
    }

    return "FlowPostAI";
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeTextForCompare(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function logPublishContent(event, extra = {}) {
    console.log("[Publish Content]", {
      event,
      ...extra,
    });
  }

  function logPublishGuard(platform, event, extra = {}) {
    console.log("[Publish Guard]", {
      platform,
      event,
      ...extra,
    });
  }

  function logAgentPublishBody(stage, body, payload, platform) {
    const diagnostics = inspectPublishingBody(body, {
      ctaText: normalizeCtaText(payload),
      ctaUrl: payload.ctaUrl,
      brandName: payload.brandName,
    });

    console.log(`[Agent Publish] ${stage} tail:`, bodyTail(body));
    console.log("[Agent Publish] contains plain url:", diagnostics.containsPlainUrl);
    console.log("[Agent Publish] contains markdown:", diagnostics.containsMarkdownLink);
    console.log("[Agent Publish] contains trailing cta:", diagnostics.containsTrailingCta);
    console.log("[Agent Publish] platform:", platform);
  }

  function containsForbiddenPublishText(text, ctaUrl = "") {
    const source = String(text || "");
    const normalizedUrl = normalizeUrlForCompare(ctaUrl);
    const plainUrlFound =
      bareUrlPattern.test(source) ||
      Boolean(
        normalizedUrl &&
          normalizeUrlForCompare(source).includes(normalizedUrl),
      );
    bareUrlPattern.lastIndex = 0;

    const markdownFound = /\[[^\]]+\]\(https?:\/\/[^)\s]+\)/i.test(source);
    const forbiddenPhraseFound =
      /(^|[\s.,;:!?()"'«»])(?:покупка услуг|купить|заказать)(?=$|[\s.,;:!?()"'«»])/i.test(
        source,
      );

    return {
      plainUrlFound,
      markdownFound,
      forbiddenPhraseFound,
      found: plainUrlFound || markdownFound || forbiddenPhraseFound,
    };
  }

  function validateSanitizedPublishBody(body, payload) {
    const ctaText = normalizeCtaText(payload);
    const ctaUrl = String(payload.ctaUrl || "").trim();
    const ctaTextFound =
      ctaText && body.toLowerCase().includes(ctaText.toLowerCase());

    logPublishContent("sanitized body length", { length: body.length });
    logCtaLink("publish", "ctaText", { ctaText });
    logCtaLink("publish", "ctaUrl", { ctaUrl: ctaUrl || null });
    logCtaLink("publish", "ctaText found in body", {
      found: Boolean(ctaTextFound),
    });

    if (!ctaTextFound) {
      throw automationError(
        "CTA_TEXT_NOT_FOUND_IN_BODY",
        `CTA text ${ctaText} не найден в статье. Нельзя добавить ссылку без изменения текста.`,
        `CTA text "${ctaText}" was not found in sanitized publish body.`,
        "sanitize publish content",
      );
    }
  }

  function publishGuardState(text, payload = {}) {
    const ctaText = normalizeCtaText(payload);
    const ctaUrl = String(payload.ctaUrl || "").trim();
    const source = String(text || "");
    const ctaOnlyPattern = new RegExp(
      `(^|\\n)\\s*${escapeRegExp(ctaText)}\\s*($|\\n)`,
      "i",
    );
    const forbidden = containsForbiddenPublishText(source, ctaUrl);
    const standaloneUrlFound = /(^|\n)\s*https?:\/\/\S+\s*($|\n)/i.test(source);
    const standaloneCtaTextFound = ctaOnlyPattern.test(source);

    return {
      ...forbidden,
      plainUrlFound: forbidden.plainUrlFound || standaloneUrlFound,
      standaloneCtaTextFound,
      found:
        forbidden.found ||
        standaloneUrlFound ||
        standaloneCtaTextFound,
    };
  }

  function assertNoUnsafeLinkText(text, platform, payload = {}) {
    const guard = publishGuardState(text, payload);

    if (guard.found) {
      const code = platform === "dzen" ? "DZEN_UNSAFE_LINK_TEXT" : "VC_UNSAFE_LINK_TEXT";
      throw automationError(
        code,
        "В тексте публикации найдена голая ссылка, markdown-ссылка или мусорный CTA. Публикация остановлена.",
        `Unsafe link text detected for ${platform}: ${JSON.stringify(guard)}.`,
        "validate article links",
      );
    }

    return guard;
  }

  function normalizeUrlForCompare(value) {
    return String(value || "")
      .trim()
      .replace(/\/+$/, "")
      .toLowerCase();
  }

  function logCtaLink(platform, event, extra = {}) {
    console.log("[CTA Link]", {
      platform,
      event,
      ...extra,
    });
  }

  async function markCtaEditor(editorLocator) {
    await editorLocator
      .evaluate((root) => {
        root.setAttribute("data-flowpost-cta-editor", "true");
      })
      .catch(() => undefined);
  }

  async function selectTextInEditable(page, locator, text, platform) {
    const result = await locator.evaluate((root, targetText) => {
      const needle = String(targetText || "").trim();
      if (!needle) {
        return { success: false, reason: "empty_target" };
      }

      const lowerNeedle = needle.toLowerCase();
      const rootText =
        "value" in root && typeof root.value === "string"
          ? root.value
          : root.innerText || root.textContent || "";

      if (!rootText.toLowerCase().includes(lowerNeedle)) {
        return {
          success: false,
          reason: "text_not_found_in_editor",
          editorTextSample: rootText.slice(0, 300),
        };
      }

      root.focus?.({ preventScroll: true });

      if (
        (root instanceof HTMLTextAreaElement ||
          root instanceof HTMLInputElement) &&
        typeof root.setSelectionRange === "function"
      ) {
        const index = root.value.toLowerCase().indexOf(lowerNeedle);
        root.setSelectionRange(index, index + needle.length);
        root.dispatchEvent(new Event("select", { bubbles: true }));
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
        return {
          success: true,
          mode: "input_selection",
          selectedText: root.value.slice(index, index + needle.length),
        };
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();

      while (node) {
        const value = node.nodeValue || "";
        const index = value.toLowerCase().indexOf(lowerNeedle);
        if (index >= 0) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + needle.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          const element =
            node.parentElement ||
            (node.parentNode instanceof Element ? node.parentNode : root);
          element.scrollIntoView?.({ block: "center", inline: "center" });
          const rect = range.getBoundingClientRect();
          const eventOptions = {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          };
          root.dispatchEvent(new Event("focus", { bubbles: true }));
          document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
          element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
          element.dispatchEvent(new MouseEvent("pointerup", eventOptions));
          return {
            success: selection?.toString().trim().toLowerCase() === lowerNeedle,
            mode: "dom_range",
            selectedText: selection?.toString() || "",
            rect: {
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            },
          };
        }
        node = walker.nextNode();
      }

      return { success: false, reason: "text_node_not_found" };
    }, text).catch((error) => ({
      success: false,
      reason: error instanceof Error ? error.message : String(error),
    }));

    logCtaLink(platform, "selection success", {
      ctaText: text,
      success: Boolean(result.success),
      mode: result.mode ?? null,
      selectedText: result.selectedText ?? null,
      reason: result.reason ?? null,
    });

    if (result.success) {
      await page.waitForTimeout(700);
    }
    return Boolean(result.success);
  }

  async function clickFloatingToolbarLinkButton(page, platform) {
    const deadline = Date.now() + 5000;
    let lastResult = null;

    while (Date.now() < deadline) {
      const result = await page
        .evaluate((currentPlatform) => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            style.opacity !== "0"
          );
        };

          const selection = window.getSelection();
          const rangeRect =
            selection && selection.rangeCount > 0
              ? selection.getRangeAt(0).getBoundingClientRect()
              : null;

          const skipButtonText =
            /опубликовать|публиковать|создать|написать|войти|готово|сохранить|отмена|publish|create|login|save|cancel/i;

          const buttons = Array.from(
            document.querySelectorAll("button, [role='button'], a[role='button']"),
          )
            .filter((button) => visible(button))
            .map((button) => {
              const rect = button.getBoundingClientRect();
              const svgText = Array.from(button.querySelectorAll("svg, path, use"))
                .map((node) =>
                  [
                    node.getAttribute("aria-label"),
                    node.getAttribute("data-testid"),
                    node.getAttribute("data-icon"),
                    node.getAttribute("href"),
                    node.getAttribute("xlink:href"),
                    node.getAttribute("class"),
                    node.getAttribute("d"),
                  ]
                    .filter(Boolean)
                    .join(" "),
                )
                .join(" ");
              const label = [
                button.getAttribute("aria-label"),
                button.getAttribute("title"),
                button.getAttribute("data-testid"),
                button.getAttribute("data-qa"),
                button.getAttribute("class"),
                button.textContent,
                svgText,
              ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
              const nearSelection = rangeRect
                ? rect.bottom < rangeRect.top + 220 &&
                  rect.top > rangeRect.top - 260 &&
                  rect.left < rangeRect.right + 620 &&
                  rect.right > rangeRect.left - 620
                : false;
              const compactToolbarButton =
                rect.width >= 18 &&
                rect.width <= 72 &&
                rect.height >= 18 &&
                rect.height <= 72;

              return {
                button,
                rect,
                label,
                nearSelection,
                compactToolbarButton,
                text: button.textContent || "",
              };
            })
            .filter(({ label, text }) => !skipButtonText.test(`${label} ${text}`));

          const linkPattern =
            currentPlatform === "dzen"
              ? /(^|\s|_|-)(link|chain|url|href)(\s|_|-|$)|ссыл/i
              : /(^|\s|_|-)(link|chain|url|href)(\s|_|-|$)|ссыл/i;
          const linkButton =
            buttons.find(
              ({ label, nearSelection }) =>
                nearSelection && linkPattern.test(label),
            ) ?? buttons.find(({ label }) => linkPattern.test(label));

          if (linkButton) {
            linkButton.button.click();
            return {
              clicked: true,
              reason: "link_button",
              label: linkButton.label.slice(0, 160),
              nearSelection: linkButton.nearSelection,
              buttonCount: buttons.length,
            };
          }

          return {
            clicked: false,
            reason: rangeRect ? "link_button_not_found" : "selection_not_visible",
            buttonCount: buttons.length,
            selectionText: selection?.toString() || "",
          };
        }, platform)
        .catch((error) => ({
          clicked: false,
          reason: error instanceof Error ? error.message : String(error),
        }));

      lastResult = result;

      if (result.clicked) {
        logCtaLink(platform, "toolbar button found", {
          found: true,
          reason: result.reason,
          label: result.label ?? null,
          nearSelection: result.nearSelection ?? null,
        });
        await humanDelay(300, 700);
        return true;
      }

      await page.waitForTimeout(350);
    }

    logCtaLink(platform, "toolbar button found", {
      found: false,
      reason: lastResult?.reason ?? "timeout",
      buttonCount: lastResult?.buttonCount ?? null,
      selectionText: lastResult?.selectionText ?? null,
    });

    return false;
  }

  async function clickDzenFloatingToolbarLinkButton(page) {
    return clickFloatingToolbarLinkButton(page, "dzen");
  }

  async function clickVcFloatingToolbarLinkButton(page) {
    return clickFloatingToolbarLinkButton(page, "vc");
  }

  async function openEditorLinkTool(page, platform) {
    if (platform === "dzen") {
      const clickedToolbar = await clickDzenFloatingToolbarLinkButton(page);
      if (clickedToolbar) {
        return "toolbar";
      }
    }

    if (platform === "vc") {
      const clickedToolbar = await clickVcFloatingToolbarLinkButton(page);
      if (clickedToolbar) {
        return "toolbar";
      }
    }

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+K`);
    await humanDelay(400, 900);
    return "shortcut";
  }

  async function findSafeLinkInput(page, platform, text) {
    const candidates = [
      { locator: page.locator('input[type="url"]:visible'), timeout: 1200 },
      {
        locator: page.locator(
          'input[placeholder*="https" i]:visible, input[placeholder*="url" i]:visible, input[placeholder*="ссыл" i]:visible',
        ),
        timeout: 1200,
      },
      {
        locator: page.locator(
          'input[aria-label*="ссыл" i]:visible, input[aria-label*="url" i]:visible, input[aria-label*="link" i]:visible',
        ),
        timeout: 1200,
      },
      {
        locator: page.locator(
          'textarea[placeholder*="https" i]:visible, textarea[placeholder*="url" i]:visible, textarea[placeholder*="ссыл" i]:visible',
        ),
        timeout: 1200,
      },
      {
        locator: page.locator(
          '[role="dialog"] input:visible, [aria-modal="true"] input:visible, [role="tooltip"] input:visible, [data-floating-ui-root] input:visible',
        ),
        timeout: 1200,
      },
    ];

    const linkField = await findFirstVisible(
      candidates,
      platform === "dzen" ? "DZEN_LINK_FIELD_NOT_FOUND" : "VC_LINK_FIELD_NOT_FOUND",
      `Не удалось открыть поле ссылки для ${text}.`,
      "add editor link",
    );
    const linkFieldLooksSafe = await linkField
      .evaluate((field) => {
        const tag = field.tagName.toLowerCase();
        const insideEditor = Boolean(field.closest("[data-flowpost-cta-editor='true']"));
        const rect = field.getBoundingClientRect();
        const label = [
          field.getAttribute("aria-label"),
          field.getAttribute("placeholder"),
          field.getAttribute("type"),
          field.getAttribute("name"),
          field.getAttribute("id"),
        ]
          .filter(Boolean)
          .join(" ");
        return {
          safe:
            (tag === "input" || tag === "textarea") &&
            !insideEditor &&
            rect.width > 0 &&
            rect.height > 0,
          tag,
          insideEditor,
          label,
        };
      })
      .catch((error) => ({
        safe: false,
        reason: error instanceof Error ? error.message : String(error),
      }));
    if (!linkFieldLooksSafe.safe) {
      logCtaLink(platform, "link input found", {
        found: false,
        details: linkFieldLooksSafe,
      });
      logCtaLink(platform, "input found", {
        found: false,
        details: linkFieldLooksSafe,
      });
      throw automationError(
        platform === "dzen" ? "DZEN_LINK_FIELD_NOT_FOUND" : "VC_LINK_FIELD_NOT_FOUND",
        `Не удалось открыть безопасное поле ссылки для ${text}. Публикация остановлена.`,
        `Link field for ${platform} was not an input/textarea; refusing to paste URL into editor.`,
        "add editor link",
      );
    }

    logCtaLink(platform, "link input found", {
      found: true,
      details: linkFieldLooksSafe,
    });
    logCtaLink(platform, "input found", {
      found: true,
      details: linkFieldLooksSafe,
    });

    return linkField;
  }

  async function fillSafeLinkInput(page, linkField, url, platform) {
    await linkField.fill(url).catch(async () => {
      const field = await waitVisibleEnabled(linkField);
      await field.click({ timeout: 5000 });
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
      await page.keyboard.insertText(url);
    });
    logCtaLink(platform, "url inserted", { ctaUrl: url });
  }

  async function editorHasCtaLink(editorLocator, text, url) {
    return editorLocator.evaluate(
      (root, args) => {
        const expectedText = args.text.toLowerCase();
        const expectedUrl = args.url.toLowerCase();
        const anchors = Array.from(root.querySelectorAll("a"));
        return anchors.some((anchor) => {
          const label = (anchor.textContent || "").trim().toLowerCase();
          const href = String(anchor.getAttribute("href") || anchor.href || "")
            .trim()
            .replace(/\/+$/, "")
            .toLowerCase();
          return label.includes(expectedText) && href.includes(expectedUrl);
        });
      },
      { text, url: normalizeUrlForCompare(url) },
    ).catch(() => false);
  }

  async function addLinkToEditorText(page, editorLocator, payload, platform) {
    const text = normalizeCtaText(payload);
    const url = String(payload.ctaUrl || "").trim();
    const editorText = await editorLocator.innerText({ timeout: 5000 }).catch(() => "");

    logCtaLink(platform, "platform", { platform });
    logCtaLink(platform, "ctaText", { ctaText: text });
    logCtaLink(platform, "ctaUrl", { ctaUrl: url || null });
    logCtaLink(platform, "body contains ctaText", {
      contains: editorText.toLowerCase().includes(text.toLowerCase()),
    });
    logCtaLink(platform, "ctaText found in body", {
      found: editorText.toLowerCase().includes(text.toLowerCase()),
    });

    if (!url) {
      return false;
    }

    await markCtaEditor(editorLocator);

    const selected = await selectTextInEditable(page, editorLocator, text, platform).catch(() => false);
    if (!selected) {
      throw automationError(
        platform === "dzen" ? "DZEN_CTA_TEXT_NOT_FOUND" : "VC_CTA_TEXT_NOT_FOUND",
        `Не удалось найти CTA-текст ${text} в статье для добавления ссылки.`,
        `CTA text "${text}" was not found in ${platform} editor.`,
        "add editor link",
      );
    }

    const tool = await openEditorLinkTool(page, platform);
    logCtaLink(platform, "toolbar open method", { method: tool });
    const linkField = await findSafeLinkInput(page, platform, text);
    await fillSafeLinkInput(page, linkField, url, platform);
    await page.keyboard.press("Enter");
    await humanDelay(700, 1300);

    const linked = await editorHasCtaLink(editorLocator, text, url);
    logCtaLink(platform, "link verification", {
      verified: linked,
      ctaText: text,
      ctaUrl: url,
    });

    if (!linked) {
      throw automationError(
        platform === "dzen" ? "DZEN_LINK_NOT_APPLIED" : "VC_LINK_NOT_APPLIED",
        `Не удалось добавить кликабельную CTA-ссылку ${text} в редактор ${platform === "dzen" ? "Dzen" : "VC.ru"}. Публикация остановлена.`,
        `Clickable link was not found in ${platform} editor after link insertion.`,
        "add editor link",
      );
    }

    return true;
  }

  async function validateEditorBeforePublish(page, editorLocator, payload, platform) {
    const text = await editorLocator.innerText({ timeout: 5000 }).catch(() => "");
    let guard = null;
    try {
      guard = assertNoUnsafeLinkText(text, platform, payload);
    } catch (error) {
      const failedGuard = publishGuardState(text, payload);
      logPublishGuard(platform, "plain URL found", {
        found: Boolean(failedGuard.plainUrlFound),
      });
      logPublishGuard(platform, "final publish allowed", {
        allowed: false,
        guard: failedGuard,
      });
      throw error;
    }

    const url = String(payload.ctaUrl || "").trim();
    const ctaText = normalizeCtaText(payload);
    if (!url) {
      logPublishGuard(platform, "plain URL found", {
        found: Boolean(guard?.plainUrlFound),
      });
      logPublishGuard(platform, "final publish allowed", {
        allowed: true,
        reason: "cta_url_missing",
      });
      return;
    }

    const linked = await editorLocator.evaluate(
      (root, args) => Array.from(root.querySelectorAll("a")).some((anchor) => {
        const label = (anchor.textContent || "").trim().toLowerCase();
        const href = String(anchor.getAttribute("href") || anchor.href || "")
          .trim()
          .replace(/\/+$/, "");
        return label.includes(args.text.toLowerCase()) && href.toLowerCase().includes(args.url);
      }),
      { text: ctaText, url: normalizeUrlForCompare(url) },
    ).catch(() => false);

    const expectedBody = normalizeTextForCompare(payload.body || payload.content || "");
    const editorBody = normalizeTextForCompare(text);
    const textMatchesBody = editorBody === expectedBody;

    logCtaLink(platform, "link verification", {
      verified: linked,
      ctaText,
      ctaUrl: url,
      phase: "before_publish",
    });
    logPublishGuard(platform, "plain URL found", {
      found: Boolean(guard?.plainUrlFound),
    });
    logPublishGuard(platform, "final publish allowed", {
      allowed: Boolean(linked && textMatchesBody && !guard?.found),
      linkVerified: linked,
      textMatchesBody,
      guard,
    });

    if (!linked || !textMatchesBody || guard?.found) {
      throw automationError(
        platform === "dzen" ? "DZEN_LINK_NOT_APPLIED" : "VC_LINK_NOT_APPLIED",
        "Публикация остановлена: CTA-ссылка не была корректно добавлена без изменения текста.",
        `Publish guard failed before ${platform} publish: linked=${linked}, textMatchesBody=${textMatchesBody}, guard=${JSON.stringify(guard)}.`,
        "validate article links",
      );
    }
  }

  async function findFirstVisible(candidates, errorCode, message, step) {
    for (const candidate of candidates) {
      try {
        return await waitFirstVisible(candidate.locator, candidate.timeout ?? 3500);
      } catch {
        // Try the next platform selector.
      }
    }

    throw automationError(errorCode, message, `Unable to find ${step}.`, step);
  }

  async function getBodyText(page) {
    return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  }

  const captchaTextPattern =
    /captcha|капч|я не робот|not a robot|robot check|подтвердите.*робот/i;
  const robotCheckboxPattern = /я не робот|not a robot|i'?m not a robot/i;

  async function locatorText(locator) {
    return locator.innerText({ timeout: 1000 }).catch(() => "");
  }

  async function captchaLooksPresent(page, scope = page) {
    const text =
      scope === page ? await getBodyText(page) : await locatorText(scope);

    return captchaTextPattern.test(text);
  }

  async function waitForCaptchaToClear(page, platform, scope = page) {
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      if (!(await captchaLooksPresent(page, scope))) {
        await logStep(platform, "captcha cleared");
        return true;
      }

      await page.waitForTimeout(500);
    }

    return false;
  }

  async function robotCheckboxCandidates(scope) {
    return [
      scope.getByRole("checkbox", { name: robotCheckboxPattern }),
      scope.locator('label:has-text("Я не робот") input[type="checkbox"]'),
      scope.locator('label:has-text("I am not a robot") input[type="checkbox"]'),
      scope.locator('label:has-text("not a robot") input[type="checkbox"]'),
      scope.locator('[role="checkbox"]').filter({ hasText: robotCheckboxPattern }),
      scope.locator('input[type="checkbox"]'),
    ];
  }

  async function clickRobotCheckbox(page, platform, scope = page) {
    await logStep(platform, "captcha detected");

    const candidates = await robotCheckboxCandidates(scope);
    for (const locator of candidates) {
      const items = await locator.all().catch(() => []);
      for (const item of items) {
        if (!(await item.isVisible({ timeout: 500 }).catch(() => false))) continue;
        if (await item.isChecked().catch(() => false)) continue;

        const text = await checkboxContextText(item);
        if (text && !robotCheckboxPattern.test(text)) continue;

        await logStep(platform, "click captcha checkbox", { text });
        await humanClick(page, item).catch(async () => {
          await item.click({ timeout: 10_000, force: true });
        });

        if (await waitForCaptchaToClear(page, platform, scope)) {
          return true;
        }
      }
    }

    const textLabel = scope.getByText(robotCheckboxPattern).first();
    if (await textLabel.isVisible({ timeout: 1000 }).catch(() => false)) {
      await logStep(platform, "click captcha label");
      await humanClick(page, textLabel).catch(async () => {
        await textLabel.click({ timeout: 10_000, force: true });
      });

      if (await waitForCaptchaToClear(page, platform, scope)) {
        return true;
      }
    }

    return false;
  }

  async function handleCaptchaIfPresent(page, platform, step, scope = page) {
    if (!(await captchaLooksPresent(page, scope))) {
      return false;
    }

    if (await clickRobotCheckbox(page, platform, scope)) {
      await humanDelay(500, 1200);
      return true;
    }

    const code = platform === "dzen" ? "DZEN_CAPTCHA_REQUIRED" : "VC_CAPTCHA_REQUIRED";
    throw automationError(
      code,
      "Площадка запросила ручное подтверждение. Agent не смог автоматически пройти проверку «Я не робот».",
      `${platform} captcha or robot check detected but checkbox was not cleared.`,
      step,
    );
  }

  async function detectCaptcha(page, platform, step) {
    return handleCaptchaIfPresent(page, platform, step);
  }

  async function checkboxContextText(checkbox) {
    return checkbox.evaluate((node) => {
      const element = node;
      const label =
        element.closest?.("label") ||
        (element.id
          ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
          : null);
      const labelledBy = element.getAttribute?.("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || "")
            .join(" ")
        : "";
      const ariaLabel = element.getAttribute?.("aria-label") || "";
      const nearby = element.parentElement?.textContent || "";

      return [ariaLabel, labelledText, label?.textContent || "", nearby]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }).catch(() => "");
  }

  function isForbiddenCheckboxText(text) {
    return /опубликовать позже|позже|дата|время|запланировать|партн[её]рский материал/i.test(text);
  }

  function isRequiredAgreementCheckboxText(text) {
    return /соглас|услов|правил|agreement|terms/i.test(text);
  }

  async function handleRegularCheckboxes(page, platform, scope = page) {
    await logStep(platform, "handle checkbox if present");
    await handleCaptchaIfPresent(page, platform, "handle checkbox if present", scope);

    const checkboxes = [
      scope.getByRole("checkbox", { name: /соглас|услов|правил|agreement|terms/i }),
      scope.locator('label:has-text("соглас") input[type="checkbox"]'),
      scope.locator('input[type="checkbox"]'),
    ];

    for (const checkbox of checkboxes) {
      const items = await checkbox.all().catch(() => []);
      for (const item of items) {
        if (!(await item.isVisible({ timeout: 500 }).catch(() => false))) continue;
        if (await item.isChecked().catch(() => false)) continue;
        const text = await checkboxContextText(item);
        if (isForbiddenCheckboxText(text)) {
          await logStep(platform, "skip forbidden checkbox", { text });
          continue;
        }
        if (!isRequiredAgreementCheckboxText(text)) {
          await logStep(platform, "skip non-required checkbox", { text });
          continue;
        }
        await humanClick(page, item).catch(() => undefined);
        return true;
      }
    }

    return false;
  }

  async function waitForAutosave(page, platform) {
    await logStep(platform, "wait autosave");
    const code = platform === "dzen" ? "DZEN_AUTOSAVE_TIMEOUT" : "VC_AUTOSAVE_TIMEOUT";
    const savingPattern = /сохранени|сохраня|saving/i;
    const savedPattern = /сохранено|saved|черновик сохран/i;

    try {
      await page.waitForFunction(
        ({ savingSource, savedSource }) => {
          const text = document.body?.innerText ?? "";
          const saving = new RegExp(savingSource, "i").test(text);
          const saved = new RegExp(savedSource, "i").test(text);
          return saved || !saving;
        },
        {
          savingSource: savingPattern.source,
          savedSource: savedPattern.source,
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      throw automationError(
        code,
        "Agent не дождался автосохранения на площадке.",
        error instanceof Error ? error.message : "Autosave timeout.",
        "wait autosave",
      );
    }
  }

  async function ensureDzenPublishFieldsFilled(page, payload) {
    const expectedTitle = String(payload.title || "").trim();
    const expectedBody = String(payload.body || payload.content || "").trim();
    const titleSample = expectedTitle.slice(0, 24);
    const bodySample = expectedBody.slice(0, 40);

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const text = await getBodyText(page);
      const hasTitle = !titleSample || text.includes(titleSample);
      const hasBody = !bodySample || text.includes(bodySample);

      if (hasTitle && hasBody) {
        return true;
      }

      await page.waitForTimeout(500);
    }

    return false;
  }

  async function editorLooksOpen(page, minimumFields = 1) {
    const editables = await getVisibleEditables(page);
    return editables.length >= minimumFields;
  }

  async function tryOpenEditorUrl(page, platform, editorUrl, minimumFields) {
    if (!editorUrl) return false;

    await logStep(platform, "open editor url if provided", { editorUrl });
    await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForNetworkSettled(page);
    await humanDelay(700, 1300);

    if (await looksLikeLoginPage(page)) {
      throw new SessionExpiredError();
    }

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await editorLooksOpen(page, minimumFields)) return true;
      await page.waitForTimeout(400);
    }

    return false;
  }

  async function publishToDzen(page, payload) {
    await logStep("dzen", "open dzen");
    await page.goto(DZEN_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForNetworkSettled(page);
    await humanDelay(800, 1600);

    await logStep("dzen", "check session");
    if (await looksLikeLoginPage(page)) {
      throw automationError(
        "DZEN_SESSION_EXPIRED",
        "Сессия площадки истекла. Нажмите «Переподключить», чтобы войти заново.",
        "Dzen session expired.",
        "check session",
      );
    }

    const openedByUrl = await tryOpenEditorUrl(page, "dzen", payload.editorUrl, 2);

    if (!openedByUrl) {
      await logStep("dzen", "open profile/studio");
      await logStep("dzen", "click profile menu");
      const profileButton = await findFirstVisible(
        [
          {
            locator: page.getByRole("button", {
              name: /профиль|аккаунт|profile|account|user|avatar/i,
            }),
          },
          {
            locator: page.locator(
              '[aria-label*="проф" i], [aria-label*="аккаунт" i], [aria-label*="profile" i], [aria-label*="account" i]',
            ),
          },
          {
            locator: page.locator(
              '[data-testid*="profile" i], [data-testid*="avatar" i], [data-testid*="user" i]',
            ),
          },
          {
            locator: page
              .locator("header button, header a")
              .filter({
                has: page.locator(
                  'img[alt*="avatar" i], img[alt*="profile" i], img[alt*="проф" i]',
                ),
              }),
          },
        ],
        "DZEN_SESSION_EXPIRED",
        "Сессия площадки истекла. Нажмите «Переподключить», чтобы войти заново.",
        "click profile menu",
      );
      await humanClick(page, profileButton);

      await logStep("dzen", "click create publication");
      const createPublication = await findFirstVisible(
        [
          { locator: page.getByRole("button", { name: /создать публикацию/i }) },
          { locator: page.getByRole("menuitem", { name: /создать публикацию/i }) },
          { locator: page.getByText(/создать публикацию/i) },
        ],
        "DZEN_CREATE_BUTTON_NOT_FOUND",
        "Agent открыл Дзен, но не нашел кнопку создания публикации.",
        "click create publication",
      );
      await humanClick(page, createPublication);

      await logStep("dzen", "click write article");
      const writeArticle = await findFirstVisible(
        [
          { locator: page.getByRole("button", { name: /написать статью/i }) },
          { locator: page.getByRole("menuitem", { name: /написать статью/i }) },
          { locator: page.getByText(/написать статью/i) },
        ],
        "DZEN_WRITE_ARTICLE_NOT_FOUND",
        "Agent открыл Дзен, но не нашел пункт «Написать статью».",
        "click write article",
      );
      await humanClick(page, writeArticle);
    }

    const editables = await waitForVisibleEditables(page, 2, "dzen");
    await logStep("dzen", "editor opened", { url: page.url() });
    await logStep("dzen", "visible editables count", { count: editables.length });

    const titleField = editables[0]?.locator;
    const bodyField = editables[1]?.locator;
    if (!titleField || !bodyField || editables[0].meta.key === editables[1].meta.key) {
      throw editorNotFoundError("dzen", `visibleEditables=${editables.length}`);
    }

    await logStep("dzen", "fill title");
    await humanType(page, titleField, payload.title);
    await logStep("dzen", "title filled");

    await logStep("dzen", "paste body");
    logAgentPublishBody("before pasteText", payload.body, payload, "dzen");
    await pasteText(page, payload.body, bodyField);
    await logStep("dzen", "body pasted");
    await logStep("dzen", "add cta link");
    await addLinkToEditorText(page, bodyField, payload, "dzen");
    await validateEditorBeforePublish(page, bodyField, payload, "dzen");
    await logStep("dzen", "cta link validated");
    await waitForAutosave(page, "dzen");
    await detectCaptcha(page, "dzen", "wait autosave");

    await logStep("dzen", "click publish");
    const publishButton = await findFirstVisible(
      [
        { locator: page.getByRole("button", { name: /^опубликовать$/i }) },
        { locator: page.locator("button").filter({ hasText: /^опубликовать$/i }) },
        { locator: page.getByText(/^опубликовать$/i) },
      ],
      "DZEN_PUBLISH_BUTTON_NOT_FOUND",
      "Текст вставлен, но не найдена кнопка публикации. Проверьте страницу в открытом браузере.",
      "click publish",
    );
    const previousUrl = page.url();
    await humanClick(page, publishButton);
    await detectCaptcha(page, "dzen", "click publish");

    await logStep("dzen", "handle publish modal");
    const modal = page.locator('[role="dialog"], [aria-modal="true"]').first();
    if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
      await handleRegularCheckboxes(page, "dzen", modal);
      const modalPublish = await findFirstVisible(
        [
          { locator: modal.getByRole("button", { name: /^опубликовать$/i }) },
          { locator: modal.locator("button").filter({ hasText: /^опубликовать$/i }) },
        ],
        "DZEN_CONFIRM_MODAL_NOT_FOUND",
        "Agent не смог подтвердить модалку публикации Дзена.",
        "handle publish modal",
      );
      await modalPublish.waitFor({ state: "visible", timeout: 15_000 });
      await modalPublish.waitFor({ state: "attached", timeout: 15_000 });
      const enabledDeadline = Date.now() + 15_000;
      while (Date.now() < enabledDeadline) {
        if (await modalPublish.isEnabled().catch(() => false)) break;
        await page.waitForTimeout(500);
        await waitForAutosave(page, "dzen").catch(() => undefined);
        await ensureDzenPublishFieldsFilled(page, payload);
        await detectCaptcha(page, "dzen", "handle publish modal");
      }
      if (!(await modalPublish.isEnabled().catch(() => false))) {
        throw automationError(
          "DZEN_CONFIRM_MODAL_NOT_FOUND",
          "Agent не смог подтвердить модалку публикации Дзена.",
          "Final Dzen publish button stayed disabled.",
          "handle publish modal",
        );
      }
      await humanClick(page, modalPublish);
      if (await handleCaptchaIfPresent(page, "dzen", "after final publish click")) {
        if (
          (await modalPublish.isVisible({ timeout: 15_000 }).catch(() => false)) &&
          (await modalPublish.isEnabled().catch(() => false))
        ) {
          await humanClick(page, modalPublish);
        }
      }
    }

    await waitForPublishCompletion(page, "dzen", previousUrl);
    await logStep("dzen", "completed", { publishedUrl: page.url() });
  }

  async function publishToVc(page, payload) {
    await logStep("vc", "open vc");
    const editorUrl = payload.editorUrl || VC_NEW_URL;
    await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForNetworkSettled(page);
    await humanDelay(800, 1500);

    await logStep("vc", "check session");
    if (await looksLikeLoginPage(page)) {
      throw automationError(
        "VC_SESSION_EXPIRED",
        "Сессия площадки истекла. Нажмите «Переподключить», чтобы войти заново.",
        "VC.ru session expired.",
        "check session",
      );
    }

    if (!(await editorLooksOpen(page, 1))) {
      await logStep("vc", "click write");
      const writeButton = await findFirstVisible(
        [
          { locator: page.getByRole("button", { name: /^написать$/i }) },
          { locator: page.locator("button").filter({ hasText: /^написать$/i }) },
          { locator: page.getByRole("link", { name: /^написать$/i }) },
          { locator: page.getByText(/^написать$/i) },
        ],
        "VC_WRITE_BUTTON_NOT_FOUND",
        "Agent открыл VC.ru, но не нашел кнопку «Написать».",
        "click write",
      );
      await humanClick(page, writeButton);
    }

    const editables = await waitForVisibleEditables(page, 1, "vc");
    await logStep("vc", "editor opened", {
      url: page.url(),
      visibleEditables: editables.length,
    });
    const titleField = editables[0]?.locator;
    if (!titleField) {
      throw editorNotFoundError("vc", `visibleEditables=${editables.length}`);
    }

    await logStep("vc", "fill title");
    await humanType(page, titleField, payload.title);
    await logStep("vc", "title filled");

    await logStep("vc", "press enter");
    await page.keyboard.press("Enter");
    await humanDelay(500, 1000);

    await logStep("vc", "paste body");
    logAgentPublishBody("before pasteText", payload.body, payload, "vc");
    await pasteText(page, payload.body);
    await logStep("vc", "body pasted");
    await logStep("vc", "add cta link");
    const vcBodyField = (await page
      .locator('[contenteditable="true"]:focus, [role="textbox"]:focus, textarea:focus')
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false))
      ? page.locator('[contenteditable="true"]:focus, [role="textbox"]:focus, textarea:focus').first()
      : titleField;
    await addLinkToEditorText(page, vcBodyField, payload, "vc");
    await validateEditorBeforePublish(page, vcBodyField, payload, "vc");
    await logStep("vc", "cta link validated");
    await waitForAutosave(page, "vc");
    await detectCaptcha(page, "vc", "wait autosave");

    await logStep("vc", "prepare native dialog handler");
    const dialogPromise = prepareVcNativeDialogHandler(page);

    await logStep("vc", "click publish");
    const previousUrl = page.url();
    const publishButton = await findFirstVisible(
      [
        { locator: page.getByRole("button", { name: /^опубликовать$/i }) },
        { locator: page.locator("button").filter({ hasText: /^опубликовать$/i }) },
        { locator: page.getByText(/^опубликовать$/i) },
      ],
      "VC_PUBLISH_BUTTON_NOT_FOUND",
      "Текст вставлен, но не найдена кнопка публикации. Проверьте страницу в открытом браузере.",
      "click publish",
    );
    await humanClick(page, publishButton);

    const dialogResult = await dialogPromise;
    if (dialogResult.error) {
      throw automationError(
        "VC_NATIVE_DIALOG_NOT_HANDLED",
        "VC.ru запросил подтверждение публикации, но Agent не смог его обработать. Попробуйте повторить публикацию.",
        dialogResult.error,
        "prepare native dialog handler",
      );
    }

    await logStep("vc", "handle confirm modal");
    await handleVcConfirmModal(page);
    await waitForPublishCompletion(page, "vc", previousUrl);
    await logStep("vc", "completed", { publishedUrl: page.url() });
  }

  function prepareVcNativeDialogHandler(page) {
    let settled = false;
    let timeout = null;
    let handler = null;

    return new Promise((resolve) => {
      handler = async (dialog) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          await logStep("vc", "native dialog", {
            type: dialog.type(),
            message: dialog.message(),
          });

          if (dialog.type() === "confirm" || dialog.type() === "alert") {
            await humanDelay(300, 800);
            await dialog.accept();
            await logStep("vc", "native dialog accepted");
          } else {
            await dialog.accept();
          }

          resolve({ handled: true });
        } catch (error) {
          resolve({
            handled: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      page.once("dialog", handler);
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        page.off("dialog", handler);
        resolve({ handled: false });
      }, 15_000);
    });
  }

  async function handleVcConfirmModal(page) {
    const modal = page.locator('[role="dialog"], [aria-modal="true"]').first();
    if (!(await modal.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }

    const confirm = await findFirstVisible(
      [
        { locator: modal.getByRole("button", { name: /ok|опубликовать|подтвердить|готово/i }) },
        { locator: modal.locator("button").filter({ hasText: /ok|опубликовать|подтвердить|готово/i }) },
      ],
      "VC_CONFIRM_MODAL_NOT_FOUND",
      "Agent не смог подтвердить окно публикации VC.ru.",
      "handle confirm modal",
    );
    await humanClick(page, confirm);
    return true;
  }

  async function waitForPublishCompletion(page, platform, previousUrl) {
    const successText = /пост опубликован|публикация опубликована|опубликовано|published|готово/i;

    try {
      await Promise.race([
        page.waitForURL(
          (url) => {
            const nextUrl = url.toString();
            return nextUrl !== previousUrl && !/\/new\b|\bmodal=editor\b/.test(nextUrl);
          },
          { timeout: 120_000, waitUntil: "domcontentloaded" },
        ),
        page.getByText(successText).first().waitFor({
          state: "visible",
          timeout: 120_000,
        }),
      ]);
      await waitForNetworkSettled(page, 30_000);
    } catch (error) {
      const code =
        platform === "dzen"
          ? "DZEN_CONFIRM_MODAL_NOT_FOUND"
          : "VC_CONFIRM_MODAL_NOT_FOUND";
      throw automationError(
        code,
        "Agent не смог подтвердить, что публикация была выполнена.",
        error instanceof Error ? error.message : "Publish confirmation timeout.",
        platform === "dzen" ? "handle publish modal" : "handle confirm modal",
      );
    }
  }

  async function getVisibleEditables(page) {
    const selectors = [
      "textarea",
      "input",
      '[contenteditable="true"]',
      '[role="textbox"]',
    ];
    const result = [];
    const seen = new Set();
    let fieldIndex = 0;

    for (const selector of selectors) {
      const elements = await page.locator(selector).all();

      for (const locator of elements) {
        try {
          if (!(await locator.isVisible({ timeout: 1000 }))) continue;

          const meta = await locator.evaluate((el) => {
            const htmlEl = el;
            const tagName = htmlEl.tagName.toLowerCase();
            const type = (htmlEl.getAttribute("type") || "").toLowerCase();
            const placeholder = htmlEl.getAttribute("placeholder") || "";
            const ariaLabel = htmlEl.getAttribute("aria-label") || "";
            const role = htmlEl.getAttribute("role") || "";
            const disabled = htmlEl.hasAttribute("disabled");
            const readonly = htmlEl.hasAttribute("readonly");
            const contentEditable = htmlEl.isContentEditable;
            const testId = htmlEl.getAttribute("data-testid") || "";
            const id = htmlEl.getAttribute("id") || "";
            const name = htmlEl.getAttribute("name") || "";
            const className = String(htmlEl.getAttribute("class") || "");
            const text = htmlEl.textContent || "";
            const value = "value" in htmlEl ? String(htmlEl.value || "") : "";
            const rect = htmlEl.getBoundingClientRect();
            let key = htmlEl.getAttribute("data-flowpost-agent-field-id");

            if (!key) {
              key = `flowpost-field-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`;
              htmlEl.setAttribute("data-flowpost-agent-field-id", key);
            }

            return {
              key,
              tagName,
              type,
              placeholder,
              ariaLabel,
              role,
              disabled,
              readonly,
              contentEditable,
              testId,
              id,
              name,
              className,
              text,
              value,
              width: rect.width,
              height: rect.height,
            };
          });

          if (seen.has(meta.key)) continue;
          seen.add(meta.key);
          if (meta.type === "hidden") continue;
          if (meta.disabled || meta.readonly) continue;
          if (meta.width <= 0 || meta.height <= 0) continue;

          const editable =
            meta.contentEditable ||
            meta.tagName === "textarea" ||
            meta.tagName === "input" ||
            meta.role === "textbox";

          if (!editable) continue;

          result.push({ locator, meta, index: fieldIndex });
          fieldIndex += 1;
        } catch {
          // DOM can change while the editor hydrates; skip unstable elements.
        }
      }
    }

    return result;
  }

  async function waitForVisibleEditables(page, minimumCount = 2, platform = "default") {
    const deadline = Date.now() + 30_000;
    let editables = [];

    while (Date.now() < deadline) {
      editables = await getVisibleEditables(page);
      if (editables.length >= minimumCount) return editables;
      await page.waitForTimeout(500);
    }

    if (minimumCount > 0 && editables.length < minimumCount) {
      throw editorNotFoundError(
        platform,
        `Editor fields not found. visibleEditables=${editables.length}`,
      );
    }

    return editables;
  }

  function editorNotFoundError(platform, technicalMessage) {
    const normalized = normalizePlatform(platform);
    const code =
      normalized === "dzen"
        ? "DZEN_EDITOR_NOT_FOUND"
        : normalized === "vc"
          ? "VC_EDITOR_NOT_FOUND"
          : "EDITOR_FIELDS_NOT_FOUND";

    return new AutomationError(
      code,
      "Не удалось найти редактор площадки. Откройте площадку через «Переподключить» и проверьте вход.",
      technicalMessage,
    );
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
    hasVisibleBrowser: () =>
      Boolean(activeContext && !activeContextClosed && activeHeadless === false),
    isUserCancelledError: (error) => error instanceof UserCancelledBrowserError,
    launchDetachedBrowser,
    runConnectPlatformJob,
    runPublishArticleJob,
  };
}

module.exports = { createAutomationRunner };
