import { BrandStatus, DistributionPlatformType } from "@prisma/client";

import { prisma } from "@/infrastructure/db/prisma";
import { ensureDefaultPlatforms } from "@/infrastructure/platforms/default-platforms";

const repairedUsers = new Set<string>();

async function repairDistributionPlatforms() {
  console.log("[auth:repair] platforms start");

  try {
    await prisma.$executeRaw`
      UPDATE "DistributionPlatform"
      SET "type" = 'DZEN'::"DistributionPlatformType"
      WHERE "slug" = 'dzen' AND "type" IS NULL
    `;
    await prisma.$executeRaw`
      UPDATE "DistributionPlatform"
      SET "type" = 'VC'::"DistributionPlatformType"
      WHERE "slug" = 'vc' AND "type" IS NULL
    `;
    await prisma.$executeRaw`
      DELETE FROM "DistributionPlatform"
      WHERE NULLIF(TRIM("slug"), '') IS NULL OR "type" IS NULL
    `;
  } catch (error) {
    console.error("[auth:repair] raw platform cleanup failed", error);
  }

  try {
    console.log("[auth:repair] before ensureDefaultPlatforms");
    await ensureDefaultPlatforms();
    console.log("[auth:repair] after ensureDefaultPlatforms");
  } catch (error) {
    console.error("[auth:repair] ensureDefaultPlatforms failed", error);
  }

  try {
    const platforms = await prisma.distributionPlatform.findMany({
      select: {
        id: true,
        slug: true,
        type: true,
      },
    });

    const brokenPlatforms = platforms.filter((platform) => {
      if (!platform.slug?.trim()) {
        return true;
      }

      if (
        platform.slug === "dzen" &&
        platform.type !== DistributionPlatformType.DZEN
      ) {
        return true;
      }

      if (platform.slug === "vc" && platform.type !== DistributionPlatformType.VC) {
        return true;
      }

      return false;
    });

    if (brokenPlatforms.length > 0) {
      console.error("[auth:repair] incompatible platforms found", {
        platformIds: brokenPlatforms.map((platform) => platform.id),
      });
    }
  } catch (error) {
    console.error("[auth:repair] platform verification failed", error);
  }

  console.log("[auth:repair] platforms done");
}

export async function fixBrokenUserData(userId: string) {
  if (repairedUsers.has(userId)) {
    console.log("[auth:repair] skipped, already scheduled", { userId });
    return;
  }

  repairedUsers.add(userId);
  console.log("[auth:repair] start", { userId });

  try {
    console.log("[auth:repair] before prisma.user.findUnique");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
      },
    });
    console.log("[auth:repair] after prisma.user.findUnique", {
      found: Boolean(user),
      userId,
    });

    if (!user) {
      return;
    }
  } catch (error) {
    console.error("[auth:repair] user fetch failed", error);
    return;
  }

  await repairDistributionPlatforms();

  try {
    console.log("[auth:repair] before prisma.brand.findMany");
    const brands = await prisma.brand.findMany({
      where: {
        workspace: {
          members: {
            some: { userId },
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        siteUrl: true,
        workspaceId: true,
        status: true,
      },
    });
    console.log("[auth:repair] after prisma.brand.findMany", {
      count: brands.length,
    });

    const brokenBrandIds = brands
      .filter(
        (brand) =>
          !brand.name?.trim() ||
          !brand.slug?.trim() ||
          !brand.siteUrl?.trim() ||
          !brand.workspaceId,
      )
      .map((brand) => brand.id);

    if (brokenBrandIds.length > 0) {
      console.log("[auth:repair] before prisma.brand.updateMany", {
        count: brokenBrandIds.length,
      });
      await prisma.brand.updateMany({
        where: { id: { in: brokenBrandIds } },
        data: {
          status: BrandStatus.ARCHIVED,
          archivedAt: new Date(),
        },
      });
      console.log("[auth:repair] after prisma.brand.updateMany");
    }
  } catch (error) {
    console.error("[auth:repair] brands repair failed", error);
  }

  try {
    console.log("[auth:repair] before prisma.publication.findMany");
    const publications = await prisma.publication.findMany({
      where: {
        workspace: {
          members: {
            some: { userId },
          },
        },
      },
      select: {
        id: true,
        workspaceId: true,
        brandId: true,
        assetId: true,
        variantId: true,
        platformId: true,
      },
    });
    console.log("[auth:repair] after prisma.publication.findMany", {
      count: publications.length,
    });

    const brokenPublicationIds = publications
      .filter(
        (publication) =>
          !publication.workspaceId ||
          !publication.brandId ||
          !publication.assetId ||
          !publication.variantId ||
          !publication.platformId,
      )
      .map((publication) => publication.id);

    if (brokenPublicationIds.length > 0) {
      console.log("[auth:repair] before prisma.publication.deleteMany", {
        count: brokenPublicationIds.length,
      });
      await prisma.publication.deleteMany({
        where: { id: { in: brokenPublicationIds } },
      });
      console.log("[auth:repair] after prisma.publication.deleteMany");
    }
  } catch (error) {
    console.error("[auth:repair] publications repair failed", error);
  }

  console.log("[auth:repair] done", { userId });
}
