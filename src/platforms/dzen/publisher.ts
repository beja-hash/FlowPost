import { cp, mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BrowserContext, Locator, Page } from "playwright";

import type { BasePublisher, PublisherOpenOptions } from "@/platforms/base-publisher";
import { SessionManager } from "@/infrastructure/platforms/session-manager";
import { debugLog } from "@/lib/debug-log";

type DzenPublisherLogContext = {
  userId: string;
  platform: "dzen";
  sessionPath: string;
  profilePath: string;
  launchProfilePath?: string;
  usingTemporaryProfile?: boolean;
};

const DZEN_HOME_URL = "https://dzen.ru/";
const EDITOR_URL_PATTERN = /\/edit(?:$|[/?#])|\/edit\//;

const globalForDzenPublisher = globalThis as typeof globalThis & {
  dzenPublisherContexts?: Map<string, BrowserContext>;
};

export class DzenPublisherError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DzenPublisherError";
  }
}

function logDzenStep(
  step: string,
  context: Partial<DzenPublisherLogContext> & Record<string, unknown> = {},
) {
  debugLog("[dzen-publisher]", {
    step,
    ...context,
  });
}

function logDzenError(
  step: string,
  error: unknown,
  context: Partial<DzenPublisherLogContext> & Record<string, unknown> = {},
) {
  console.error("[dzen-publisher:error]", {
    step,
    ...context,
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
  });
}

async function importChromium(logContext: DzenPublisherLogContext) {
  try {
    logDzenStep("playwright:import", logContext);
    const { chromium } = await import("playwright");
    logDzenStep("playwright:imported", {
      ...logContext,
      executablePath: chromium.executablePath(),
    });

    return chromium;
  } catch (error) {
    logDzenError("playwright:import-failed", error, logContext);
    throw new DzenPublisherError(
      500,
      "PLAYWRIGHT_NOT_INSTALLED",
      "Playwright is not installed. Run `npm install playwright` and `npx playwright install chromium`.",
    );
  }
}

function isAuthUrl(url: string) {
  return (
    url.includes("passport.yandex") ||
    url.includes("oauth.yandex") ||
    url.includes("/auth") ||
    url.includes("login")
  );
}

function isProfileLockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /ProcessSingleton|profile.*in use|user data directory.*in use|Singleton/i.test(
    message,
  );
}

async function cleanupProfileLocks(profilePath: string) {
  await Promise.all(
    ["SingletonLock", "SingletonCookie", "SingletonSocket"].map((fileName) =>
      unlink(path.join(profilePath, fileName)).catch(() => undefined),
    ),
  );
}

async function createTemporaryProfileCopy(profilePath: string) {
  const temporaryProfilePath = await mkdtemp(
    path.join(/* turbopackIgnore: true */ os.tmpdir(), "posting-dzen-profile-"),
  );

  await cp(profilePath, temporaryProfilePath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  await cleanupProfileLocks(temporaryProfilePath);

  return temporaryProfilePath;
}

async function humanDelay(min = 300, max = 1200) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function waitForVisible(locator: Locator, label: string) {
  try {
    await locator.first().waitFor({
      state: "visible",
      timeout: 15_000,
    });

    return locator.first();
  } catch (error) {
    throw new DzenPublisherError(
      504,
      "DZEN_SELECTOR_NOT_FOUND",
      error instanceof Error
        ? `Unable to find visible Dzen element "${label}": ${error.message}`
        : `Unable to find visible Dzen element "${label}".`,
    );
  }
}

async function safeWait(locator: Locator, label: string) {
  return waitForVisible(locator, label);
}

async function safeScroll(locator: Locator, label: string) {
  const element = await safeWait(locator, label);

  await element.scrollIntoViewIfNeeded({ timeout: 10_000 });

  return element;
}

async function withInteractionRetry<T>(
  label: string,
  action: (attempt: number) => Promise<T>,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      await humanDelay(350, 900);
    }
  }

  throw new DzenPublisherError(
    504,
    "DZEN_INTERACTION_FAILED",
    lastError instanceof Error
      ? `Dzen interaction "${label}" failed after retries: ${lastError.message}`
      : `Dzen interaction "${label}" failed after retries.`,
  );
}

async function safeClick(
  locator: Locator,
  label: string,
  context?: DzenPublisherLogContext | null,
) {
  await withInteractionRetry(label, async (attempt) => {
    logDzenStep("click_started", {
      ...(context ?? {}),
      label,
      attempt,
    });

    const element = await safeScroll(locator, label);

    await element.waitFor({ state: "visible", timeout: 10_000 });
    await element.hover({ timeout: 10_000 });
    await humanDelay(200, 500);
    await element.click({ timeout: 10_000 });
    await humanDelay(300, 700);

    logDzenStep("click_finished", {
      ...(context ?? {}),
      label,
      attempt,
    });
  });
}

async function moveMouseLikeHuman(page: Page, locator: Locator) {
  const box = await locator.boundingBox();

  if (!box) {
    await locator.hover({ timeout: 10_000 });
    return;
  }

  const targetX = box.x + box.width / 2 + Math.floor(Math.random() * 8) - 4;
  const targetY = box.y + box.height / 2 + Math.floor(Math.random() * 8) - 4;
  const startX = Math.max(12, targetX - 80 - Math.floor(Math.random() * 80));
  const startY = Math.max(12, targetY - 40 - Math.floor(Math.random() * 60));

  await page.mouse.move(startX, startY, { steps: 8 });
  await humanDelay(180, 420);
  await page.mouse.move(targetX, targetY, { steps: 18 + Math.floor(Math.random() * 10) });
}

async function handleCaptchaIfNeeded(
  page: Page,
  context?: DzenPublisherLogContext | null,
) {
  const detectionTimeout = Math.floor(Math.random() * 2000) + 3000;
  const captchaText = page
    .getByText(/подтвердите,\s*что вы не робот|подтвердите что вы не робот|я не робот/i)
    .first();

  try {
    await captchaText.waitFor({ state: "visible", timeout: detectionTimeout });
  } catch {
    logDzenStep("Captcha not present", context ?? {});
    return false;
  }

  logDzenStep("Captcha detected", context ?? {});

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const checkbox = await findFirstVisible(
        [
          {
            label: "captcha checkbox by label",
            locator: page.getByLabel(/я не робот/i),
          },
          {
            label: "captcha checkbox role",
            locator: page.getByRole("checkbox", { name: /я не робот/i }),
          },
          {
            label: "captcha checkbox input",
            locator: page.locator('input[type="checkbox"]'),
          },
          {
            label: "captcha text fallback",
            locator: page.getByText(/я не робот/i),
          },
        ],
        "captcha checkbox",
      );

      logDzenStep("Solving captcha checkbox", {
        ...(context ?? {}),
        attempt,
      });
      await humanDelay(1200, 2600);
      await checkbox.locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
      await moveMouseLikeHuman(page, checkbox.locator);
      await checkbox.locator.hover({ timeout: 10_000 });
      await humanDelay(350, 900);
      await checkbox.locator.click({ timeout: 10_000 });
      await humanDelay(1200, 2200);

      await captchaText.waitFor({ state: "hidden", timeout: 15_000 });
      logDzenStep("Captcha solved", {
        ...(context ?? {}),
        attempt,
      });
      return true;
    } catch (error) {
      logDzenError("captcha:solve-attempt-failed", error, {
        ...(context ?? {}),
        attempt,
      });
      await humanDelay(900, 1800);
    }
  }

  logDzenStep("Captcha verification failed", context ?? {});
  return false;
}

async function safeFocus(
  locator: Locator,
  label: string,
  context?: DzenPublisherLogContext | null,
) {
  return withInteractionRetry(label, async (attempt) => {
    const element = await safeScroll(locator, label);

    await element.click({ timeout: 10_000 });
    await humanDelay(150, 350);
    await element.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.focus();
      }
    });

    logDzenStep("field_focused", {
      ...(context ?? {}),
      label,
      attempt,
    });

    return element;
  });
}

function splitTextIntoChunks(text: string) {
  const chunks: string[] = [];
  let index = 0;

  while (index < text.length) {
    const size = Math.floor(Math.random() * 16) + 5;
    chunks.push(text.slice(index, index + size));
    index += size;
  }

  return chunks;
}

async function safeType(
  page: Page,
  locator: Locator,
  label: string,
  text: string,
  context?: DzenPublisherLogContext | null,
) {
  await withInteractionRetry(label, async (attempt) => {
    const element = await safeFocus(locator, label, context);

    logDzenStep("typing_started", {
      ...(context ?? {}),
      label,
      attempt,
      length: text.length,
    });

    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await humanDelay(120, 280);
    await page.keyboard.press("Backspace");
    await humanDelay(150, 350);

    for (const chunk of splitTextIntoChunks(text)) {
      await page.keyboard.insertText(chunk);
      await humanDelay(50, 150);
    }

    await humanDelay(250, 600);
    await element.evaluate((node) => {
      node.dispatchEvent(new InputEvent("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });

    logDzenStep("typing_finished", {
      ...(context ?? {}),
      label,
      attempt,
      length: text.length,
    });
  });
}

async function safeInsertText(
  page: Page,
  locator: Locator,
  label: string,
  text: string,
  context?: DzenPublisherLogContext | null,
) {
  await withInteractionRetry(label, async (attempt) => {
    const element = await safeFocus(locator, label, context);

    logDzenStep("body_insert_started", {
      ...(context ?? {}),
      label,
      attempt,
      length: text.length,
    });

    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await humanDelay(120, 280);
    await page.keyboard.press("Backspace");
    await humanDelay(150, 350);
    await page.keyboard.insertText(text);
    await humanDelay(350, 800);
    await element.evaluate((node) => {
      node.dispatchEvent(new InputEvent("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });

    logDzenStep("body_inserted", {
      ...(context ?? {}),
      label,
      attempt,
      length: text.length,
    });
  });
}

async function readLocatorText(locator: Locator) {
  const value = await locator.evaluate((node) => {
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement
    ) {
      return node.value;
    }

    return node.textContent ?? "";
  });

  return value.normalize("NFC");
}

function validateInsertedContent(expected: string, actual: string) {
  const normalize = (value: string) =>
    value.normalize("NFC").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const normalizedExpected = normalize(expected);
  const normalizedActual = normalize(actual);

  if (normalizedActual.includes("\uFFFD") || normalizedActual.includes("��")) {
    throw new DzenPublisherError(
      500,
      "DZEN_BODY_INSERT_BROKEN_UTF8",
      "Inserted Dzen body contains broken UTF-8 replacement characters.",
    );
  }

  if (!normalizedActual || normalizedActual.length < Math.min(80, normalizedExpected.length)) {
    throw new DzenPublisherError(
      500,
      "DZEN_BODY_INSERT_FAILED",
      "Dzen body was not inserted successfully.",
    );
  }
}

async function waitForNetworkIdle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
}

async function findFirstVisible(
  locators: Array<{ label: string; locator: Locator }>,
  fallbackLabel: string,
) {
  for (const candidate of locators) {
    try {
      await candidate.locator.first().waitFor({
        state: "visible",
        timeout: 3000,
      });

      return {
        label: candidate.label,
        locator: candidate.locator.first(),
      };
    } catch {
      // Try the next selector. Dzen UI changes often, so adapters need fallbacks.
    }
  }

  throw new DzenPublisherError(
    504,
    "DZEN_SELECTOR_NOT_FOUND",
    `Unable to find visible Dzen element "${fallbackLabel}".`,
  );
}

export class DzenPublisher implements BasePublisher {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private editorUrl: string | null = null;
  private publishedUrl: string | null = null;
  private logContext: DzenPublisherLogContext | null = null;
  private userId: string | null = null;

  async open({ userId }: PublisherOpenOptions) {
    const logContext = {
      userId,
      platform: "dzen" as const,
      sessionPath: SessionManager.path(userId, "dzen"),
      profilePath: SessionManager.profilePath(userId, "dzen"),
    };
    this.userId = userId;
    this.logContext = logContext;

    logDzenStep("session_loading", logContext);
    const storageState = await SessionManager.load(userId, "dzen");

    if (!storageState) {
      logDzenStep("session:missing", logContext);
      throw new DzenPublisherError(
        404,
        "SESSION_NOT_FOUND",
        "Saved Dzen session was not found. Connect Dzen first.",
      );
    }

    logDzenStep("session_loaded", {
      ...logContext,
      cookies: storageState.cookies.length,
      origins: storageState.origins.length,
    });
  }

  async launch() {
    if (!this.userId || !this.logContext) {
      throw new DzenPublisherError(
        500,
        "SESSION_NOT_OPENED",
        "Dzen session is not opened.",
      );
    }
    const logContext = this.logContext;
    const userId = this.userId;

    if (process.env.FLOWPOST_ENABLE_SERVER_BROWSER !== "1") {
      throw new DzenPublisherError(
        409,
        "DESKTOP_AGENT_REQUIRED",
        "Подключите FlowPost Agent, чтобы открыть браузер на вашем компьютере.",
      );
    }

    const chromium = await importChromium(logContext);
    globalForDzenPublisher.dzenPublisherContexts ??= new Map();

    const existingContext =
      globalForDzenPublisher.dzenPublisherContexts.get(userId);

    if (existingContext) {
      logDzenStep("browser:close-existing-context:start", logContext);
      await existingContext.close().catch((error: unknown) => {
        logDzenError("browser:close-existing-context:failed", error, logContext);
      });
      globalForDzenPublisher.dzenPublisherContexts.delete(userId);
      logDzenStep("browser:close-existing-context:done", logContext);
    }

    logDzenStep("browser:temporary-profile-create:start", logContext);
    const launchProfilePath = await createTemporaryProfileCopy(logContext.profilePath);
    const usingTemporaryProfile = true;
    logDzenStep("browser:temporary-profile-created", {
      ...logContext,
      launchProfilePath,
      usingTemporaryProfile,
    });

    try {
      logDzenStep("browser:launch-persistent-context:start", {
        ...logContext,
        launchProfilePath,
        usingTemporaryProfile,
      });
      this.context = await chromium.launchPersistentContext(launchProfilePath, {
        headless: false,
        args: ["--start-maximized"],
        viewport: null,
      });
      logDzenStep("browser_launched", {
        ...logContext,
        launchProfilePath,
        usingTemporaryProfile,
      });
    } catch (error) {
      logDzenError("browser:launch-persistent-context:failed", error, {
        ...logContext,
        launchProfilePath,
        usingTemporaryProfile,
      });

      if (!isProfileLockError(error)) {
        throw new DzenPublisherError(
          500,
          "PLAYWRIGHT_LAUNCH_FAILED",
          error instanceof Error
            ? `Unable to launch Dzen browser session: ${error.message}`
            : "Unable to launch Dzen browser session.",
        );
      }

      throw new DzenPublisherError(
        500,
        "PLAYWRIGHT_PROFILE_LOCKED",
        error instanceof Error
          ? `Temporary Dzen browser profile is locked: ${error.message}`
          : "Temporary Dzen browser profile is locked.",
      );
    }

    this.context.on("close", () => {
      globalForDzenPublisher.dzenPublisherContexts?.delete(userId);
      logDzenStep("browser:persistent-context:closed", {
        ...logContext,
        launchProfilePath,
        usingTemporaryProfile,
      });

      if (usingTemporaryProfile) {
        void rm(launchProfilePath, { recursive: true, force: true }).catch(
          (error: unknown) => {
            logDzenError("browser:temporary-profile-cleanup:failed", error, {
              ...logContext,
              launchProfilePath,
              usingTemporaryProfile,
            });
          },
        );
      }
    });
    globalForDzenPublisher.dzenPublisherContexts.set(userId, this.context);

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
  }

  async navigateToEditor() {
    if (!this.page || !this.logContext) {
      throw new DzenPublisherError(
        500,
        "BROWSER_NOT_OPEN",
        "Dzen browser session is not open.",
      );
    }

    try {
      logDzenStep("navigation:start", {
        ...this.logContext,
        entryUrl: DZEN_HOME_URL,
      });
      await this.page.goto(DZEN_HOME_URL, {
        waitUntil: "load",
      });
      await waitForNetworkIdle(this.page);
      await humanDelay(800, 1600);
      logDzenStep("homepage_loaded", {
        ...this.logContext,
        currentUrl: this.page.url(),
      });

      if (isAuthUrl(this.page.url())) {
        logDzenStep("navigation:auth-failed", {
          ...this.logContext,
          currentUrl: this.page.url(),
        });
        throw new DzenPublisherError(
          401,
          "AUTH_FAILED",
          "Dzen did not authorize the saved session. Reconnect Dzen.",
        );
      }

      const profileButton = await findFirstVisible(
        [
          {
            label: "profile button by role",
            locator: this.page.getByRole("button", {
              name: /профиль|аккаунт|profile|account|user|avatar/i,
            }),
          },
          {
            label: "profile by aria label",
            locator: this.page.locator(
              '[aria-label*="проф" i], [aria-label*="аккаунт" i], [aria-label*="profile" i], [aria-label*="account" i]',
            ),
          },
          {
            label: "profile data-testid",
            locator: this.page.locator(
              '[data-testid*="profile" i], [data-testid*="avatar" i], [data-testid*="user" i]',
            ),
          },
          {
            label: "header avatar image button",
            locator: this.page
              .locator("header button, header a")
              .filter({
                has: this.page.locator(
                  'img[alt*="avatar" i], img[alt*="profile" i], img[alt*="проф" i]',
                ),
              }),
          },
        ],
        "profile button",
      );

      await safeClick(profileButton.locator, profileButton.label, this.logContext);
      logDzenStep("profile_clicked", this.logContext);

      const createPublication = await findFirstVisible(
        [
          {
            label: "create publication button",
            locator: this.page.getByRole("button", {
              name: /создать публикацию/i,
            }),
          },
          {
            label: "create publication menu item",
            locator: this.page.getByRole("menuitem", {
              name: /создать публикацию/i,
            }),
          },
          {
            label: "create publication text",
            locator: this.page.getByText(/создать публикацию/i),
          },
        ],
        "Создать публикацию",
      );

      await safeClick(
        createPublication.locator,
        createPublication.label,
        this.logContext,
      );
      logDzenStep("create_publication_clicked", this.logContext);

      const writeArticle = await findFirstVisible(
        [
          {
            label: "write article button",
            locator: this.page.getByRole("button", {
              name: /написать статью/i,
            }),
          },
          {
            label: "write article menu item",
            locator: this.page.getByRole("menuitem", {
              name: /написать статью/i,
            }),
          },
          {
            label: "write article text",
            locator: this.page.getByText(/написать статью/i),
          },
        ],
        "Написать статью",
      );

      await safeClick(writeArticle.locator, writeArticle.label, this.logContext);
      logDzenStep("write_article_clicked", this.logContext);

      logDzenStep("navigation:waiting-editor-open", this.logContext);
      await this.page.waitForURL(EDITOR_URL_PATTERN, {
        timeout: 60_000,
        waitUntil: "domcontentloaded",
      });
      await waitForNetworkIdle(this.page);

      this.editorUrl = this.page.url();
      logDzenStep("editor_opened", {
        ...this.logContext,
        editorUrl: this.editorUrl,
      });
    } catch (error) {
      if (error instanceof DzenPublisherError) {
        throw error;
      }

      logDzenError("navigation:failed", error, {
        ...this.logContext,
        currentUrl: this.page.url(),
      });

      if (isAuthUrl(this.page.url())) {
        throw new DzenPublisherError(
          401,
          "AUTH_FAILED",
          "Dzen did not authorize the saved session. Reconnect Dzen.",
        );
      }

      throw new DzenPublisherError(
        504,
        "EDITOR_NAVIGATION_FAILED",
        error instanceof Error
          ? `Unable to open Dzen editor: ${error.message}`
          : "Unable to open Dzen editor.",
      );
    }
  }

  async fillTitle(title: string) {
    if (!this.page || !this.logContext) {
      throw new DzenPublisherError(
        500,
        "BROWSER_NOT_OPEN",
        "Dzen browser session is not open.",
      );
    }

    const titleField = await findFirstVisible(
      [
        {
          label: "title placeholder",
          locator: this.page.getByPlaceholder(/заголов/i),
        },
        {
          label: "title textbox",
          locator: this.page.getByRole("textbox", { name: /заголов/i }),
        },
        {
          label: "title aria label",
          locator: this.page.locator(
            '[aria-label*="заголов" i], [data-placeholder*="заголов" i], [placeholder*="заголов" i]',
          ),
        },
        {
          label: "first contenteditable title",
          locator: this.page.locator('[contenteditable="true"]').first(),
        },
      ],
      "article title field",
    );

    await safeType(this.page, titleField.locator, titleField.label, title, this.logContext);
    logDzenStep("title_typed", {
      ...this.logContext,
      titleLength: title.length,
    });
    logDzenStep("title_filled", {
      ...this.logContext,
      titleLength: title.length,
    });
  }

  async fillContent(content: string) {
    if (!this.page || !this.logContext) {
      throw new DzenPublisherError(
        500,
        "BROWSER_NOT_OPEN",
        "Dzen browser session is not open.",
      );
    }

    const contentField = await findFirstVisible(
      [
        {
          label: "body placeholder",
          locator: this.page.getByPlaceholder(/текст|напишите|начните/i),
        },
        {
          label: "body textbox",
          locator: this.page.getByRole("textbox", {
            name: /текст|статья|публикац/i,
          }),
        },
        {
          label: "body aria label",
          locator: this.page.locator(
            '[aria-label*="текст" i], [aria-label*="статья" i], [data-placeholder*="текст" i], [data-placeholder*="напишите" i], [data-placeholder*="начните" i]',
          ),
        },
        {
          label: "last contenteditable body",
          locator: this.page.locator('[contenteditable="true"]').last(),
        },
      ],
      "article content field",
    );

    await safeInsertText(
      this.page,
      contentField.locator,
      contentField.label,
      content,
      this.logContext,
    );
    validateInsertedContent(content, await readLocatorText(contentField.locator));
    logDzenStep("content_validated", {
      ...this.logContext,
      contentLength: content.length,
    });
    logDzenStep("content_filled", {
      ...this.logContext,
      contentLength: content.length,
    });
  }

  async publish() {
    if (!this.page || !this.logContext) {
      throw new DzenPublisherError(
        500,
        "BROWSER_NOT_OPEN",
        "Dzen browser session is not open.",
      );
    }

    const firstPublishButton = await findFirstVisible(
      [
        {
          label: "first publish button",
          locator: this.page.getByRole("button", { name: /^опубликовать$/i }),
        },
        {
          label: "publish text button",
          locator: this.page
            .locator("button")
            .filter({ hasText: /^опубликовать$/i }),
        },
        {
          label: "publish text",
          locator: this.page.getByText(/^опубликовать$/i),
        },
      ],
      "first publish button",
    );

    logDzenStep("publish_started", this.logContext);
    await safeClick(
      firstPublishButton.locator,
      firstPublishButton.label,
      this.logContext,
    );
    logDzenStep("first_publish_clicked", this.logContext);
    await handleCaptchaIfNeeded(this.page, this.logContext);

    const publishModal = await findFirstVisible(
      [
        {
          label: "publish dialog",
          locator: this.page.getByRole("dialog"),
        },
        {
          label: "publish modal",
          locator: this.page.locator('[role="dialog"], [aria-modal="true"]'),
        },
        {
          label: "publish modal by text",
          locator: this.page.locator("div").filter({
            has: this.page.getByRole("button", { name: /^опубликовать$/i }),
          }),
        },
      ],
      "publish modal",
    );
    await safeWait(publishModal.locator, publishModal.label);
    logDzenStep("publish_modal_opened", this.logContext);
    await handleCaptchaIfNeeded(this.page, this.logContext);

    const secondPublishButton = await findFirstVisible(
      [
        {
          label: "modal publish button",
          locator: publishModal.locator.getByRole("button", {
            name: /^опубликовать$/i,
          }),
        },
        {
          label: "modal publish text button",
          locator: publishModal.locator
            .locator("button")
            .filter({ hasText: /^опубликовать$/i }),
        },
        {
          label: "fallback second publish button",
          locator: this.page.getByRole("button", { name: /^опубликовать$/i }).last(),
        },
      ],
      "second publish button",
    );

    const editorUrl = this.page.url();
    await safeClick(
      secondPublishButton.locator,
      secondPublishButton.label,
      this.logContext,
    );
    logDzenStep("second_publish_clicked", this.logContext);

    try {
      await Promise.race([
        this.page.waitForURL(
          (url) => {
            const nextUrl = url.toString();
            return nextUrl !== editorUrl && !EDITOR_URL_PATTERN.test(nextUrl);
          },
          { timeout: 120_000, waitUntil: "domcontentloaded" },
        ),
        this.page
          .getByText(/опубликовано|публикация опубликована|готово/i)
          .first()
          .waitFor({ state: "visible", timeout: 120_000 }),
        publishModal.locator
          .waitFor({ state: "hidden", timeout: 120_000 }),
      ]);
    } catch (error) {
      logDzenError("publish_success_wait:failed", error, {
        ...this.logContext,
        currentUrl: this.page.url(),
      });
      throw new DzenPublisherError(
        504,
        "DZEN_PUBLISH_CONFIRMATION_FAILED",
        error instanceof Error
          ? `Unable to confirm Dzen publication: ${error.message}`
          : "Unable to confirm Dzen publication.",
      );
    }

    await this.page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
    await waitForNetworkIdle(this.page);
    this.publishedUrl = this.page.url();
    logDzenStep("Article published successfully", {
      ...this.logContext,
      publishedUrl: this.publishedUrl,
    });
    logDzenStep("publish_success", {
      ...this.logContext,
      publishedUrl: this.publishedUrl,
    });
    logDzenStep("publish_finished", {
      ...this.logContext,
      publishedUrl: this.publishedUrl,
    });
  }

  async close() {
    const context = this.context;
    const page = this.page;
    const browser = context?.browser();
    const shouldCloseGracefully = Boolean(this.publishedUrl);

    logDzenStep("Closing browser session", this.logContext ?? {});

    if (shouldCloseGracefully && page) {
      await humanDelay(2000, 4000);
      await page.mouse.move(80, 80, { steps: 12 }).catch(() => undefined);
      await humanDelay(250, 600);
    }

    await page?.close({ runBeforeUnload: false }).catch((error: unknown) => {
      logDzenError("browser:page-close:failed", error, this.logContext ?? {});
    });
    await context?.close().catch((error: unknown) => {
      logDzenError("browser:context-close:failed", error, this.logContext ?? {});
    });
    await browser?.close().catch((error: unknown) => {
      logDzenError("browser:instance-close:failed", error, this.logContext ?? {});
    });

    this.page = null;
    this.context = null;

    logDzenStep("Browser session closed", this.logContext ?? {});
  }

  getCurrentEditorUrl() {
    return this.editorUrl;
  }

  getPublishedUrl() {
    return this.publishedUrl;
  }
}
