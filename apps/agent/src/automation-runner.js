const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const SUPPORTED_PLATFORMS = new Set(["dzen", "vc"]);

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
    if (await hasChromium()) {
      sendState({ browserInstallStatus: "ready" });
      return;
    }

    try {
      await installChromium();
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

  async function launchContext(platform) {
    await ensureChromium();
    const chromium = await getChromium();
    const userDataDir = profilePath(platform);

    await fs.mkdir(userDataDir, { recursive: true });

    return chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ["--start-maximized"],
      viewport: null,
    });
  }

  async function runConnectPlatformJob(job, updateJobStatus) {
    const platform = normalizePlatform(job.platform || job.payload?.platform);
    const connectUrl = job.payload?.connectUrl;

    if (!SUPPORTED_PLATFORMS.has(platform) || !connectUrl) {
      throw new Error("Задание подключения повреждено.");
    }

    await updateJobStatus(job.id, "running");
    sendState({ status: "browser_opening" });

    const context = await launchContext(platform);
    let finishedLogin;
    let browserClosed = false;
    const loginFinished = new Promise((resolve) => {
      finishedLogin = resolve;
    });

    context.on("close", () => {
      browserClosed = true;
      finishedLogin();
    });

    await context.exposeBinding("__flowPostFinishPlatformConnection", () => {
      finishedLogin();
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

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(connectUrl, { waitUntil: "domcontentloaded" });
    await updateJobStatus(job.id, "waiting_user_login");
    await logJob(job.id, "Браузер открыт локально. Ожидаем вход пользователя.");
    sendState({ status: "browser_opened" });

    await loginFinished;

    if (browserClosed) {
      throw new Error("Браузер закрыт до подтверждения подключения.");
    }

    await updateJobStatus(job.id, "completed", {
      result: {
        platform,
        cookiesStoredLocally: true,
      },
    });
    await logJob(job.id, "Подключение завершено. Cookies остались локально.");
    await context.close();
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
    sendState({ status: "publishing" });

    const context = await launchContext(platform);
    const page = context.pages()[0] ?? (await context.newPage());

    try {
      await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
      await fillArticle(page, platform, title, body);

      await updateJobStatus(job.id, "completed", {
        result: {
          platform,
          articleId: job.payload?.articleId,
          publishedUrl: page.url(),
        },
      });
      await logJob(job.id, "Публикация выполнена локально через Playwright.");
      sendState({ status: "publish_completed" });
    } finally {
      await context.close().catch(() => undefined);
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
    await fs.rm(profileRoot, { recursive: true, force: true });
  }

  return {
    browserCachePath,
    ensureChromium,
    deleteProfiles,
    profilePath,
    profileRoot,
    runConnectPlatformJob,
    runPublishArticleJob,
  };
}

module.exports = { createAutomationRunner };
