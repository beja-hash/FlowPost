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
    .replace(/[^a-z0-9_-]/g, "");

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

    if (!editorUrl) missing.push("platformEditorUrl");
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
    const editorUrl = payload.editorUrl;
    const title = payload.title;
    const body = [
      payload.content,
      payload.ctaText,
      payload.ctaUrl,
    ]
      .filter(Boolean)
      .join("\n\n");

    const headless = shouldRunHeadless(job);
    await updateJobStatus(job.id, "running");
    setBrowserState("running_job", { status: "publishing" });
    console.log("[agent] publish mode", {
      headless,
      reason: headless ? "default headless publish" : "debug visible publish",
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

    const { page } = await openPage(platform, editorUrl, { headless });

    try {
      if (await looksLikeLoginPage(page)) {
        throw new SessionExpiredError();
      }

      await fillEditorFields(page, { title, content: body, platform });
      await clickPublish(page, platform);

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
      if (error instanceof SessionExpiredError) {
        console.log("[agent] session expired", {
          id: job.id,
          platform,
          url: page.url(),
        });
        await updateJobStatus(job.id, "failed", {
          error: error.message,
          result: {
            ok: false,
            code: error.code,
            platform,
            articleId: payload.articleId,
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
      });
      await updateJobStatus(job.id, "failed", {
        error: message,
        result: {
          ok: false,
          code,
          platform,
          articleId: payload.articleId,
          technicalError: technicalMessage,
        },
      }).catch(() => undefined);
      await logJob(job.id, technicalMessage, "error");
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

  async function clickPublish(page, platform) {
    const selectors =
      platform === "dzen"
        ? [
            'button:has-text("Опубликовать")',
            'button:has-text("Публикация")',
            'button:has-text("Далее")',
            'button:has-text("Готово")',
            '[role="button"]:has-text("Опубликовать")',
          ]
        : [
            'button:has-text("Опубликовать")',
            'button:has-text("Publish")',
            'button:has-text("Далее")',
            '[role="button"]:has-text("Опубликовать")',
            '[role="button"]:has-text("Publish")',
          ];

    const clicked = await clickFirstVisibleButton(page, selectors);

    if (!clicked) {
      throw new AutomationError(
        `${platform.toUpperCase()}_PUBLISH_BUTTON_NOT_FOUND`,
        "Не удалось найти кнопку публикации. Возможно, интерфейс площадки изменился.",
      );
    }

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(1200);
    await clickFirstVisibleButton(page, [
      'button:has-text("Опубликовать")',
      'button:has-text("Подтвердить")',
      'button:has-text("Publish")',
      '[role="button"]:has-text("Опубликовать")',
      '[role="button"]:has-text("Подтвердить")',
      '[role="button"]:has-text("Publish")',
    ]);
    await page.waitForTimeout(2500);
  }

  async function clickFirstVisibleButton(page, selectors) {
    for (const selector of selectors) {
      const buttons = await page.locator(selector).all();

      for (const button of buttons) {
        if (!(await button.isVisible({ timeout: 1000 }).catch(() => false))) {
          continue;
        }

        if (!(await button.isEnabled({ timeout: 1000 }).catch(() => true))) {
          continue;
        }

        await button.click({ timeout: 10_000 });
        return true;
      }
    }

    return false;
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

  function fieldText(meta) {
    return [
      meta.placeholder,
      meta.ariaLabel,
      meta.role,
      meta.testId,
      meta.id,
      meta.name,
      meta.className,
      meta.text,
      meta.value,
    ]
      .join(" ")
      .toLowerCase();
  }

  function scoreTitleField(field, platform) {
    const text = fieldText(field.meta);
    let score = 0;

    if (/title|headline|heading|заголов/.test(text)) score += 20;
    if (/name|назван/.test(text)) score += 4;
    if (field.meta.tagName === "input") score += 4;
    if (field.meta.tagName === "textarea") score += 2;
    if (field.meta.contentEditable) score += 1;
    if (/body|content|article|editor|текст|пост|материал/.test(text)) {
      score -= 8;
    }
    if (platform === "dzen" && /title|заголов/.test(text)) score += 5;
    if (platform === "vc" && /title|заголов/.test(text)) score += 5;

    return score;
  }

  function scoreBodyField(field, platform) {
    const text = fieldText(field.meta);
    let score = 0;

    if (/body|content|article|editor|text|story|текст|пост|материал|редактор/.test(text)) {
      score += 18;
    }
    if (field.meta.contentEditable) score += 6;
    if (field.meta.tagName === "textarea") score += 4;
    if (field.meta.role === "textbox") score += 3;
    if (field.meta.tagName === "input") score -= 6;
    if (/title|headline|heading|заголов/.test(text)) score -= 10;
    if (platform === "dzen" && /editor|body|content|текст/.test(text)) score += 4;
    if (platform === "vc" && /editor|body|content|текст/.test(text)) score += 4;

    return score;
  }

  async function waitForVisibleEditables(page) {
    const deadline = Date.now() + 30_000;
    let editables = [];

    while (Date.now() < deadline) {
      editables = await getVisibleEditables(page);
      if (editables.length >= 2) return editables;
      await page.waitForTimeout(500);
    }

    return editables;
  }

  function pickBestField(fields, scorer) {
    return [...fields]
      .map((field) => ({ field, score: scorer(field) }))
      .sort((left, right) => right.score - left.score || left.field.index - right.field.index)[0];
  }

  async function fillEditorFields(page, { title, content, platform }) {
    const editables = await waitForVisibleEditables(page);
    console.log("[agent] visible editable fields", {
      platform,
      count: editables.length,
      fields: editables.map((field) => ({
        index: field.index,
        tagName: field.meta.tagName,
        type: field.meta.type,
        placeholder: field.meta.placeholder,
        ariaLabel: field.meta.ariaLabel,
        role: field.meta.role,
        testId: field.meta.testId,
        id: field.meta.id,
        name: field.meta.name,
      })),
    });

    if (editables.length === 0) {
      throw editorNotFoundError(platform, "No visible editable fields found.");
    }

    const titleRank = pickBestField(editables, (field) =>
      scoreTitleField(field, platform),
    );
    const titleField =
      titleRank && titleRank.score > 0 ? titleRank.field : editables[0];
    const bodyCandidates = editables.filter(
      (field) => field.meta.key !== titleField.meta.key,
    );
    const bodyRank = pickBestField(bodyCandidates, (field) =>
      scoreBodyField(field, platform),
    );
    const bodyField =
      bodyRank && bodyRank.score > 0 ? bodyRank.field : bodyCandidates[0];

    if (!titleField || !bodyField) {
      throw editorNotFoundError(
        platform,
        `Editor fields not found. visibleEditables=${editables.length}`,
      );
    }

    await fillEditableField(page, titleField, title);
    if (platform === "vc") {
      await page.keyboard.press("Enter").catch(() => undefined);
    }
    await fillEditableField(page, bodyField, content);
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

  async function fillEditableField(page, field, value) {
    const { locator, meta } = field;

    if (meta.tagName === "input" || meta.tagName === "textarea") {
      await locator.fill(value, { timeout: 20_000 });
      return;
    }

    await locator.click({ timeout: 20_000 });
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+A`).catch(() => undefined);
    await page.keyboard.insertText(value);
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
