import { PlatformAccountStatus } from "@prisma/client";

import type {
  PlatformConnection,
  PlatformConnectionStatus,
} from "@/features/platforms/types";
import { prisma } from "@/infrastructure/db/prisma";
import { ensureDefaultPlatforms } from "@/infrastructure/platforms/default-platforms";
import { platforms } from "@/infrastructure/platforms/platform-registry";
import { SessionManager } from "@/infrastructure/platforms/session-manager";

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

export async function listPlatformConnections(
  userId: string,
): Promise<PlatformConnection[]> {
  await ensureDefaultPlatforms();

  const [accounts, activePlatforms] = await Promise.all([
    prisma.platformAccount.findMany({
      where: { userId },
      select: {
        status: true,
        platform: true,
      },
    }),
    prisma.distributionPlatform.findMany({
      where: { isActive: true },
      select: {
        id: true,
        slug: true,
      },
    }),
  ]);

  return Promise.all(
    platforms.map(async (config) => {
      const distributionPlatform = activePlatforms.find(
        (platform) => platform.slug === config.slug,
      );
      const accountStatuses = accounts
        .filter((account) => account.platform === config.slug)
        .map((account) => account.status);
      const hasStorageState = Boolean(await SessionManager.load(userId, config.id));

      return {
        id: distributionPlatform?.id ?? config.slug,
        name: config.name,
        platform: config.slug,
        status: mapAccountStatus(hasStorageState, accountStatuses),
      };
    }),
  );
}
