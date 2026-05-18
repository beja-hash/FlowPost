import type { BrowserContext, Locator, Page } from "playwright";

import { SessionManager } from "@/infrastructure/platforms/session-manager";
import type {
  BasePublisher,
  PublisherOpenOptions,
} from "@/platforms/base-publisher";
import {
  humanDelay,
  logVcError,
  logVcStep,
  moveMouseLikeHuman,
  safeClick,
  safeFocus,
  waitForVisible,
  withVcRetry,
} from "@/platforms/vc/interactions";
import { sanitizeVcBody, sanitizeVcTitle } from "@/platforms/vc/text";
import {
  VcPublisherError,
  type VcPublisherLogContext,
} from "@/platforms/vc/types";

const VC_NEW_URL = "https://vc.ru/new";
const VC_URL_PATTERN = /https:\/\/vc\.ru\//i;

const globalForVcPublisher = globalThis as typeof globalThis & {
  vcPublisherContexts?: Map<string, BrowserContext>;
};

async function importChromium(logContext: VcPublisherLogContext) {
  try {
    logVcStep("playwright:import", logContext);
    const { chromium } = await import("playwright");
    logVcStep("playwright:imported", {
      ...logContext,
      executablePath: chromium.executablePath(),
    });

    return chromium;
  } catch (error) {
    logVcError("playwright:import-failed", error, logContext);
    throw new VcPublisherError(
      500,
      "PLAYWRIGHT_NOT_INSTALLED",
      "Playwright is not installed. Run `npm install playwright` and `npx playwright install chromium`.",
    );
  }
}

async function waitForNetworkIdle(page: Page) {
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => undefined);
}

async function findFirstVisible(
  candidates: Array<{ label: string; locator: Locator }>,
  fallbackLabel: string,
) {
  for (const candidate of candidates) {
    try {
      const locator = await waitForVisible(candidate.locator, candidate.label);
      return {
        label: candidate.label,
        locator,
      };
    } catch {
      // Try the next selector. VC.ru UI changes often, so this adapter needs fallbacks.
    }
  }

  throw new VcPublisherError(
    504,
    "VC_SELECTOR_NOT_FOUND",
    `Unable to find visible VC element "${fallbackLabel}".`,
  );
}

async function readEditableText(locator: Locator) {
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

async function clearActiveEditor(page: Page) {
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await humanDelay(120, 280);
  await page.keyboard.press("Backspace");
  await humanDelay(250, 520);
}

async function typeTitleLikeHuman(
  page: Page,
  locator: Locator,
  title: string,
  context: VcPublisherLogContext,
) {
  await withVcRetry("title field", async (attempt) => {
    const element = await safeFocus(locator, "title field", context);

    logVcStep("typing title", {
      ...context,
      attempt,
      length: title.length,
    });
    await clearActiveEditor(page);

    for (const char of title) {
      await page.keyboard.type(char, {
        delay: Math.floor(Math.random() * 70) + 35,
      });
    }

    await humanDelay(450, 900);
    await element.evaluate((node) => {
      node.dispatchEvent(new InputEvent("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });

    logVcStep("title typed", {
      ...context,
      attempt,
      length: title.length,
    });
  });
}

async function insertBodyAtCursor(
  page: Page,
  body: string,
  context: VcPublisherLogContext,
) {
  await withVcRetry("article body", async (attempt) => {
    logVcStep("inserting article body", {
      ...context,
      attempt,
      length: body.length,
    });

    await page.keyboard.press("Enter");
    await humanDelay(500, 1000);
    await page.keyboard.insertText(body);
    await humanDelay(800, 1400);

    const activeText = await page.evaluate(() => {
      const active = document.activeElement;

      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        return active.value;
      }

      return active?.textContent ?? "";
    });

    if (
      !activeText.normalize("NFC").includes(body.slice(0, 80).normalize("NFC"))
    ) {
      await page.evaluate((text) => {
        const active = document.activeElement;

        if (!active || !(active instanceof HTMLElement)) {
          throw new Error("No focused editor element.");
        }

        active.focus();
        document.execCommand("insertText", false, text);
        active.dispatchEvent(new InputEvent("input", { bubbles: true }));
        active.dispatchEvent(new Event("change", { bubbles: true }));
      }, body);
      await humanDelay(800, 1400);
    }

    logVcStep("article body inserted", {
      ...context,
      attempt,
      length: body.length,
    });
  });
}

async function acceptPublishConfirm(
  page: Page,
  context: VcPublisherLogContext,
) {
  logVcStep("waiting native confirm modal", context);

  const dialog = await page.waitForEvent("dialog", { timeout: 12_000 });
  const message = dialog.message();

  logVcStep("native confirm modal detected", {
    ...context,
    message,
  });

  if (!/опубликовать|publish|post/i.test(message)) {
    throw new VcPublisherError(
      409,
      "VC_UNEXPECTED_DIALOG",
      `Unexpected VC dialog: ${message}`,
    );
  }

  await humanDelay(900, 1800);
  await dialog.accept();
  logVcStep("native confirm accepted", context);
}

export class VcPublisher implements BasePublisher {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private editorUrl: string | null = null;
  private publishedUrl: string | null = null;
  private logContext: VcPublisherLogContext | null = null;
  private userId: string | null = null;

  async open({ userId }: PublisherOpenOptions) {
    const logContext = {
      userId,
      platform: "vc" as const,
      sessionPath: SessionManager.path(userId, "vc"),
      profilePath: SessionManager.profilePath(userId, "vc"),
    };
    this.userId = userId;
    this.logContext = logContext;

    logVcStep("session loading", logContext);
    const storageState = await SessionManager.load(userId, "vc");

    if (!storageState) {
      logVcStep("session missing", logContext);
      throw new VcPublisherError(
        404,
        "SESSION_NOT_FOUND",
        "Saved VC.ru session was not found. Connect VC.ru first.",
      );
    }

    logVcStep("session loaded", {
      ...logContext,
      cookies: storageState.cookies.length,
      origins: storageState.origins.length,
    });
  }

  async launch() {
    if (!this.userId || !this.logContext) {
      throw new VcPublisherError(
        500,
        "SESSION_NOT_OPENED",
        "VC.ru session is not opened.",
      );
    }

    if (process.env.FLOWPOST_ENABLE_SERVER_BROWSER !== "1") {
      throw new VcPublisherError(
        409,
        "DESKTOP_AGENT_REQUIRED",
        "Подключите FlowPost Agent, чтобы открыть браузер на вашем компьютере.",
      );
    }

    const chromium = await importChromium(this.logContext);
    globalForVcPublisher.vcPublisherContexts ??= new Map();

    const existingContext = globalForVcPublisher.vcPublisherContexts.get(
      this.userId,
    );

    if (existingContext) {
      logVcStep("browser close existing context start", this.logContext);
      await existingContext.close().catch((error: unknown) => {
        logVcError(
          "browser close existing context failed",
          error,
          this.logContext ?? {},
        );
      });
      globalForVcPublisher.vcPublisherContexts.delete(this.userId);
      logVcStep("browser close existing context done", this.logContext);
    }

    logVcStep("browser launch started", this.logContext);
    this.context = await chromium.launchPersistentContext(
      this.logContext.profilePath,
      {
        headless: false,
        args: ["--start-maximized"],
        viewport: null,
      },
    );
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    globalForVcPublisher.vcPublisherContexts.set(this.userId, this.context);

    this.context.on("close", () => {
      if (this.userId) {
        globalForVcPublisher.vcPublisherContexts?.delete(this.userId);
      }
      logVcStep("browser context closed", this.logContext ?? {});
    });

    logVcStep("browser launched", this.logContext);
  }

  async navigateToEditor() {
    if (!this.page || !this.logContext) {
      throw new VcPublisherError(
        500,
        "BROWSER_NOT_OPEN",
        "VC.ru browser session is not open.",
      );
    }

    logVcStep("opening vc.ru", {
      ...this.logContext,
      url: VC_NEW_URL,
    });
    await this.page.goto(VC_NEW_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await waitForNetworkIdle(this.page);
    await humanDelay(800, 1500);

    const writeButton = await findFirstVisible(
      [
        {
          label: "write button by role",
          locator: this.page.getByRole("button", { name: /^написать$/i }),
        },
        {
          label: "write text button",
          locator: this.page
            .locator("button")
            .filter({ hasText: /^написать$/i }),
        },
        {
          label: "write link by role",
          locator: this.page.getByRole("link", { name: /^написать$/i }),
        },
        {
          label: "write text",
          locator: this.page.getByText(/^написать$/i),
        },
      ],
      "write button",
    );

    logVcStep("opening editor", this.logContext);
    await safeClick(writeButton.locator, writeButton.label, this.logContext);

    await findFirstVisible(
      [
        {
          label: "editor modal",
          locator: this.page.getByRole("dialog"),
        },
        {
          label: "editor modal by aria",
          locator: this.page.locator('[role="dialog"], [aria-modal="true"]'),
        },
        {
          label: "editor contenteditable",
          locator: this.page.locator('[contenteditable="true"]'),
        },
      ],
      "editor modal",
    );
    await humanDelay(700, 1300);
    this.editorUrl = this.page.url();

    logVcStep("editor opened", {
      ...this.logContext,
      editorUrl: this.editorUrl,
    });
  }

  async fillTitle(title: string) {
    if (!this.page || !this.logContext) {
      throw new VcPublisherError(
        500,
        "BROWSER_NOT_OPEN",
        "VC.ru browser session is not open.",
      );
    }

    const cleanTitle = sanitizeVcTitle(title);
    const titleField = await findFirstVisible(
      [
        {
          label: "title by placeholder",
          locator: this.page.getByPlaceholder(/заголовок|название/i),
        },
        {
          label: "title contenteditable placeholder",
          locator: this.page.locator(
            '[contenteditable="true"][data-placeholder*="Заголовок" i], [contenteditable="true"][aria-label*="Заголовок" i]',
          ),
        },
        {
          label: "first contenteditable",
          locator: this.page.locator('[contenteditable="true"]').first(),
        },
        {
          label: "title input",
          locator: this.page
            .locator('input[name*="title" i], textarea[name*="title" i]')
            .first(),
        },
      ],
      "title field",
    );

    await typeTitleLikeHuman(
      this.page,
      titleField.locator,
      cleanTitle,
      this.logContext,
    );
    const insertedTitle = await readEditableText(titleField.locator);

    if (!insertedTitle.includes(cleanTitle.slice(0, 20))) {
      throw new VcPublisherError(
        500,
        "VC_TITLE_INSERT_FAILED",
        "VC.ru title was not inserted successfully.",
      );
    }
  }

  async fillContent(content: string) {
    if (!this.page || !this.logContext) {
      throw new VcPublisherError(
        500,
        "BROWSER_NOT_OPEN",
        "VC.ru browser session is not open.",
      );
    }

    const cleanBody = sanitizeVcBody(content);

    if (!cleanBody) {
      throw new VcPublisherError(
        400,
        "VC_EMPTY_BODY",
        "VC.ru article body is empty after sanitization.",
      );
    }

    await insertBodyAtCursor(this.page, cleanBody, this.logContext);
    const pageText = (
      await this.page.locator("body").innerText({ timeout: 10_000 })
    ).normalize("NFC");

    if (!pageText.includes(cleanBody.slice(0, 80).normalize("NFC"))) {
      throw new VcPublisherError(
        500,
        "VC_BODY_INSERT_FAILED",
        "VC.ru body was not inserted successfully.",
      );
    }
  }

  async publish() {
    if (!this.page || !this.logContext) {
      throw new VcPublisherError(
        500,
        "BROWSER_NOT_OPEN",
        "VC.ru browser session is not open.",
      );
    }

    const publishButton = await findFirstVisible(
      [
        {
          label: "publish button by role",
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
      "publish button",
    );

    logVcStep("publishing article", this.logContext);
    await moveMouseLikeHuman(this.page, publishButton.locator);
    const previousUrl = this.page.url();
    const confirmPromise = acceptPublishConfirm(this.page, this.logContext);
    try {
      await safeClick(
        publishButton.locator,
        publishButton.label,
        this.logContext,
      );
    } catch (error) {
      await confirmPromise.catch(() => undefined);
      throw error;
    }
    logVcStep("confirming publish", this.logContext);
    await confirmPromise;

    try {
      await Promise.race([
        this.page.waitForURL(
          (url) => {
            const nextUrl = url.toString();
            return (
              VC_URL_PATTERN.test(nextUrl) &&
              nextUrl !== previousUrl &&
              !nextUrl.includes("/new")
            );
          },
          { timeout: 120_000, waitUntil: "domcontentloaded" },
        ),
        this.page
          .getByText(/пост опубликован|публикация опубликована|опубликовано/i)
          .first()
          .waitFor({ state: "visible", timeout: 120_000 }),
      ]);
    } catch (error) {
      logVcError("publish success wait failed", error, {
        ...this.logContext,
        currentUrl: this.page.url(),
      });
      throw new VcPublisherError(
        504,
        "VC_PUBLISH_CONFIRMATION_FAILED",
        error instanceof Error
          ? `Unable to confirm VC.ru publication: ${error.message}`
          : "Unable to confirm VC.ru publication.",
      );
    }

    await this.page
      .waitForLoadState("domcontentloaded", { timeout: 30_000 })
      .catch(() => undefined);
    await waitForNetworkIdle(this.page);
    this.publishedUrl = this.page.url();

    logVcStep("article published successfully", {
      ...this.logContext,
      publishedUrl: this.publishedUrl,
    });
  }

  async close() {
    const context = this.context;
    const page = this.page;
    const browser = context?.browser();
    const shouldCloseGracefully = Boolean(this.publishedUrl);

    logVcStep("closing browser", this.logContext ?? {});

    if (shouldCloseGracefully && page) {
      await humanDelay(2000, 4000);
      await page.mouse.move(90, 90, { steps: 14 }).catch(() => undefined);
      await humanDelay(300, 700);
    }

    await page?.close({ runBeforeUnload: false }).catch((error: unknown) => {
      logVcError("browser page close failed", error, this.logContext ?? {});
    });
    await context?.close().catch((error: unknown) => {
      logVcError("browser context close failed", error, this.logContext ?? {});
    });
    await browser?.close().catch((error: unknown) => {
      logVcError("browser instance close failed", error, this.logContext ?? {});
    });

    this.page = null;
    this.context = null;

    logVcStep("browser closed", this.logContext ?? {});
  }

  getCurrentEditorUrl() {
    return this.editorUrl;
  }

  getPublishedUrl() {
    return this.publishedUrl;
  }
}
