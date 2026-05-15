import { PlatformAccountStatus } from "@prisma/client";
import type { BrowserContext, BrowserType } from "playwright";

import type {
  PlatformConnection,
  PlatformConnectionStatus,
} from "@/features/platforms/types";
import { prisma } from "@/infrastructure/db/prisma";
import { ensureDefaultPlatforms } from "@/infrastructure/platforms/default-platforms";
import {
  getPlatformConfig as getRegisteredPlatformConfig,
  platforms,
  type PlatformSlug,
} from "@/infrastructure/platforms/platform-registry";
import {
  type PlatformStorageState,
  SessionManager,
} from "@/infrastructure/platforms/session-manager";
import { getPlatformEditorService } from "@/services/platforms";
import { debugLog } from "@/lib/debug-log";

type ConnectLogContext = {
  userId: string;
  platform: PlatformConnection["platform"];
  sessionPath: string;
  profilePath: string;
};

export class PlatformServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlatformServiceError";
  }
}

function logConnectStep(
  step: string,
  context: Partial<ConnectLogContext> & Record<string, unknown> = {},
) {
  debugLog("[platform-connect]", {
    step,
    ...context,
  });
}

function logConnectError(
  step: string,
  error: unknown,
  context: Partial<ConnectLogContext> & Record<string, unknown> = {},
) {
  console.error("[platform-connect:error]", {
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

function getPlatformConfig(platform: string) {
  const config = getRegisteredPlatformConfig(platform);

  if (!config) {
    throw new PlatformServiceError(
      400,
      "INVALID_PLATFORM",
      "Эта площадка не поддерживается.",
    );
  }

  return config;
}

function mapAccountStatus(
  hasStorageState: boolean,
  statuses: PlatformAccountStatus[],
): PlatformConnectionStatus {
  if (hasStorageState || statuses.includes(PlatformAccountStatus.CONNECTED)) {
    return "connected";
  }

  if (statuses.includes(PlatformAccountStatus.EXPIRED)) {
    return "expired";
  }

  return "not_connected";
}

async function getDistributionPlatformId(slug: PlatformSlug) {
  const platform = await prisma.distributionPlatform.findFirst({
    where: {
      slug,
      isActive: true,
    },
    select: {
      id: true,
    },
  });

  return platform?.id ?? slug;
}

export async function listPlatformConnections(
  userId: string,
): Promise<PlatformConnection[]> {
  await ensureDefaultPlatforms();

  const accounts = await prisma.platformAccount.findMany({
    where: {
      userId,
    },
    select: {
      status: true,
      platform: true,
    },
  });
  const activePlatforms = await prisma.distributionPlatform.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      slug: true,
    },
  });

  return Promise.all(
    platforms.map(async (config) => {
      const distributionPlatform = activePlatforms.find(
        (platform) => platform.slug === config.slug,
      );
      const accountStatuses = accounts
        .filter((account) => account.platform === config.slug)
        .map((account) => account.status);
      const hasStorageState = Boolean(
        await SessionManager.load(userId, config.id),
      );

      return {
        id: distributionPlatform?.id ?? config.slug,
        name: config.name,
        platform: config.slug,
        status: mapAccountStatus(hasStorageState, accountStatuses),
      };
    }),
  );
}

export async function connectPlatform(userId: string, platform: string) {
  const config = getPlatformConfig(platform);
  const sessionPath = SessionManager.path(userId, config.id);
  const profilePath = SessionManager.profilePath(userId, config.id);
  const logContext = {
    userId,
    platform: config.id,
    sessionPath,
    profilePath,
  };

  logConnectStep("connect:start", {
    ...logContext,
    loginUrl: config.connectUrl,
  });
  await ensureDefaultPlatforms();
  logConnectStep("default-platforms:ensured", logContext);

  await SessionManager.ensureDirectory(userId, config.id);
  logConnectStep("session-directory:ensured", logContext);

  const storageState = await runManualLogin(config.connectUrl, logContext);
  logConnectStep("storage-state:received", logContext);

  await SessionManager.save(userId, config.id, storageState);
  logConnectStep("storage-state:saved", logContext);

  await prisma.platformAccount.upsert({
    where: {
      userId_platform: {
        userId,
        platform: config.slug,
      },
    },
    create: {
      userId,
      platform: config.slug,
      status: PlatformAccountStatus.CONNECTED,
      sessionPath: SessionManager.relativePath(userId, config.id),
    },
    update: {
      status: PlatformAccountStatus.CONNECTED,
      sessionPath: SessionManager.relativePath(userId, config.id),
    },
  });
  logConnectStep("platform-account:connected", logContext);

  return {
    id: await getDistributionPlatformId(config.slug),
    name: config.name,
    platform: config.slug,
    status: "connected" satisfies PlatformConnectionStatus,
  };
}

export async function launchPlatformWithSession(userId: string, platform: string) {
  const config = getPlatformConfig(platform);
  const sessionPath = SessionManager.path(userId, config.id);
  const profilePath = SessionManager.profilePath(userId, config.id);
  const logContext = {
    userId,
    platform: config.id,
    sessionPath,
    profilePath,
  };

  logConnectStep("manual-launch:start", {
    ...logContext,
    editorUrl: config.editorUrl,
  });

  const storageState = await SessionManager.load(userId, config.id);

  if (!storageState) {
    logConnectStep("manual-launch:session-missing", logContext);
    throw new PlatformServiceError(
      404,
      "SESSION_NOT_FOUND",
      "Сохранённая сессия площадки не найдена.",
    );
  }

  logConnectStep("manual-launch:session-loaded", logContext);
  const editorService = await getPlatformEditorService(config.id);
  const launchResult = await editorService.launchEditor(userId);
  logConnectStep("manual-launch:browser-opened", {
    ...logContext,
    editorUrl: launchResult.editorUrl,
  });

  return {
    id: await getDistributionPlatformId(config.slug),
    name: config.name,
    platform: config.slug,
    status: "connected" satisfies PlatformConnectionStatus,
  };
}

export async function disconnectPlatform(userId: string, platform: string) {
  const config = getPlatformConfig(platform);
  const logContext = {
    userId,
    platform: config.id,
    sessionPath: SessionManager.path(userId, config.id),
    profilePath: SessionManager.profilePath(userId, config.id),
  };

  logConnectStep("disconnect:start", logContext);

  await SessionManager.remove(userId, config.id);

  await prisma.platformAccount.upsert({
    where: {
      userId_platform: {
        userId,
        platform: config.slug,
      },
    },
    create: {
      userId,
      platform: config.slug,
      status: PlatformAccountStatus.NOT_CONNECTED,
      sessionPath: null,
    },
    update: {
      status: PlatformAccountStatus.NOT_CONNECTED,
      sessionPath: null,
    },
  });

  logConnectStep("disconnect:done", logContext);

  return {
    id: await getDistributionPlatformId(config.slug),
    name: config.name,
    platform: config.slug,
    status: "not_connected" satisfies PlatformConnectionStatus,
  };
}

async function importChromium(logContext?: Partial<ConnectLogContext>) {
  let chromium: BrowserType;

  try {
    logConnectStep("playwright:import", logContext);
    chromium = (await import("playwright")).chromium;
    logConnectStep("playwright:imported", {
      ...logContext,
      executablePath: chromium.executablePath(),
    });
  } catch (error) {
    logConnectError("playwright:import-failed", error, logContext);
    throw new PlatformServiceError(
      500,
      "PLAYWRIGHT_NOT_INSTALLED",
      "Не установлен модуль браузерной автоматизации.",
    );
  }

  return chromium;
}

async function runManualLogin(
  loginUrl: string,
  logContext: ConnectLogContext,
): Promise<PlatformStorageState> {
  const chromium = await importChromium(logContext);

  let context: BrowserContext;

  try {
    logConnectStep("playwright:launch-persistent-context:start", logContext);
    context = await chromium.launchPersistentContext(logContext.profilePath, {
      headless: false,
      args: ["--start-maximized"],
      viewport: null,
    });
    logConnectStep("playwright:launch-persistent-context:ready", logContext);
  } catch (error) {
    logConnectError(
      "playwright:launch-persistent-context:failed",
      error,
      logContext,
    );
    throw new PlatformServiceError(
      500,
      "PLAYWRIGHT_LAUNCH_FAILED",
      error instanceof Error
        ? `Не удалось запустить браузер: ${error.message}`
        : "Не удалось запустить браузер.",
    );
  }

  let finishedLogin!: () => void;
  let browserClosed = false;
  const loginFinished = new Promise<void>((resolve) => {
    finishedLogin = resolve;
  });

  context.on("close", () => {
    browserClosed = true;
    finishedLogin();
  });

  await context.exposeBinding("__finishPlatformConnection", () => {
    logConnectStep("manual-login:finish-clicked", logContext);
    finishedLogin();
  });

  await context.addInitScript(() => {
    const installFinishButton = () => {
      if (document.getElementById("__platform_connection_finish")) {
        return;
      }

      const button = document.createElement("button");
      button.id = "__platform_connection_finish";
      button.type = "button";
      button.textContent = "Сохранить сессию";
      button.style.position = "fixed";
      button.style.right = "20px";
      button.style.bottom = "20px";
      button.style.zIndex = "2147483647";
      button.style.border = "0";
      button.style.borderRadius = "999px";
      button.style.padding = "12px 18px";
      button.style.background = "#111827";
      button.style.color = "#ffffff";
      button.style.font = "500 14px system-ui, sans-serif";
      button.style.boxShadow = "0 18px 50px rgba(0, 0, 0, 0.28)";
      button.style.cursor = "pointer";
      button.addEventListener("click", () => {
        void (
          window as unknown as {
            __finishPlatformConnection?: () => Promise<void>;
          }
        ).__finishPlatformConnection?.();
      });

      document.documentElement.appendChild(button);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", installFinishButton);
      return;
    }

    installFinishButton();
  });

  const existingPages = context.pages();
  const page = existingPages[0] ?? (await context.newPage());

  logConnectStep("manual-login:open-platform:start", {
    ...logContext,
    loginUrl,
  });
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  logConnectStep("manual-login:open-platform:done", logContext);
  logConnectStep("manual-login:waiting-user", logContext);
  await loginFinished;

  if (browserClosed) {
    throw new PlatformServiceError(
      400,
      "CONNECTION_CANCELED",
      "Подключение отменено до сохранения сессии.",
    );
  }

  logConnectStep("storage-state:capture:start", logContext);
  const storageState = await context.storageState();
  await context.close();
  logConnectStep("playwright:persistent-context:closed", logContext);

  return storageState;
}
