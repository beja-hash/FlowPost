import { prisma } from "@/infrastructure/db/prisma";
import type { PlatformConfig } from "@/infrastructure/platforms/platform-registry";
import { platforms } from "@/infrastructure/platforms/platform-registry";
import { debugLog } from "@/lib/debug-log";

const DEFAULT_PLATFORMS_CACHE_MS =
  process.env.NODE_ENV === "production" ? 60 * 60 * 1000 : 30 * 1000;

let ensuredAt = 0;
let ensurePromise: Promise<void> | null = null;

function assertPlatformConfig(platform: PlatformConfig) {
  if (!platform.slug) {
    throw new Error(`Platform slug is required for ${platform.name}.`);
  }
}

export async function ensureDefaultPlatforms() {
  const now = Date.now();

  if (ensurePromise) {
    return ensurePromise;
  }

  if (ensuredAt && now - ensuredAt < DEFAULT_PLATFORMS_CACHE_MS) {
    debugLog("[platforms:defaults] cache hit", {
      ageMs: now - ensuredAt,
    });
    return;
  }

  debugLog("[platforms:defaults] start", { count: platforms.length });
  ensurePromise = Promise.all(
    platforms.map((platform) => {
      assertPlatformConfig(platform);

      debugLog("[platforms:defaults] before upsert", {
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
        debugLog("[platforms:defaults] after upsert", {
          slug: platform.slug,
          id: result.id,
        });
        return result;
      });
    }),
  )
    .then(() => {
      ensuredAt = Date.now();
      debugLog("[platforms:defaults] done");
    })
    .finally(() => {
      ensurePromise = null;
    });

  return ensurePromise;
}
