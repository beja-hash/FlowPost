import { PlatformAccountStatus } from "@prisma/client";

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
import { SessionManager } from "@/infrastructure/platforms/session-manager";
import { debugLog } from "@/lib/debug-log";

type ConnectLogContext = {
  userId: string;
  platform: PlatformConnection["platform"];
  sessionPath?: string;
  profilePath?: string;
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
  const logContext = {
    userId,
    platform: config.id,
  };

  logConnectStep("connect:start", {
    ...logContext,
    loginUrl: config.connectUrl,
  });
  await ensureDefaultPlatforms();
  logConnectStep("default-platforms:ensured", logContext);

  const { createConnectPlatformJob } = await import(
    "@/features/agent/server/agent-service"
  );
  await createConnectPlatformJob({ userId, platform: config.slug });
  logConnectStep("desktop-agent-job:created", logContext);

  return {
    id: await getDistributionPlatformId(config.slug),
    name: config.name,
    platform: config.slug,
    status: "not_connected" satisfies PlatformConnectionStatus,
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

  throw new PlatformServiceError(
    409,
    "DESKTOP_AGENT_REQUIRED",
    "Установите FlowPost Agent, чтобы открыть браузер на вашем компьютере.",
  );
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
