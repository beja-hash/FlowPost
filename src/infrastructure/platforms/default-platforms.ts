import { prisma } from "@/infrastructure/db/prisma";
import type { PlatformConfig } from "@/infrastructure/platforms/platform-registry";
import { platforms } from "@/infrastructure/platforms/platform-registry";

function assertPlatformConfig(platform: PlatformConfig) {
  if (!platform.slug) {
    throw new Error(`Platform slug is required for ${platform.name}.`);
  }
}

export async function ensureDefaultPlatforms() {
  console.log("[platforms:defaults] start", { count: platforms.length });
  await Promise.all(
    platforms.map((platform) => {
      assertPlatformConfig(platform);

      console.log("[platforms:defaults] before upsert", {
        slug: platform.slug,
      });
      return prisma.distributionPlatform.upsert({
        where: { slug: platform.slug },
        create: {
          type: platform.type,
          slug: platform.slug,
          name: platform.name,
          description: platform.description,
          styleGuide: platform.styleGuide,
          constraints: platform.metadata,
        },
        update: {
          type: platform.type,
          name: platform.name,
          description: platform.description,
          styleGuide: platform.styleGuide,
          constraints: platform.metadata,
          isActive: true,
        },
      }).then((result) => {
        console.log("[platforms:defaults] after upsert", {
          slug: platform.slug,
          id: result.id,
        });
        return result;
      });
    }),
  );
  console.log("[platforms:defaults] done");
}
