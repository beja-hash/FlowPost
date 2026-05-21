import {
  AssetStatus,
  BrandStatus,
  Prisma,
  PublicationStatus,
  VariantStatus,
} from "@prisma/client";

import type {
  ArticleContentBrief,
  CreateDistributionAssetPayload,
  DistributionAssetListItem,
  PlatformOption,
  UpdateDistributionAssetPayload,
} from "@/features/distribution/types";
import {
  getWorkspaceShell,
  requireWorkspaceForUser,
} from "@/features/workspaces/server/workspace-service";
import { prisma } from "@/infrastructure/db/prisma";
import { ensureDefaultPlatforms } from "@/infrastructure/platforms/default-platforms";
import { platformSlugs } from "@/infrastructure/platforms/platform-registry";
import { debugLog } from "@/lib/debug-log";
import { slugify } from "@/lib/slugify";
import { getDomainFromUrl, normalizeHttpUrl } from "@/lib/url";

type AssetRecord = Prisma.ArticleAssetGetPayload<{
  include: {
    brand: {
      select: {
        id: true;
        name: true;
        siteUrl: true;
      };
    };
    variants: {
      include: {
        platform: {
          select: {
            id: true;
            name: true;
            slug: true;
          };
        };
      };
      take: 1;
    };
    publications: {
      take: 1;
      orderBy: {
        createdAt: "desc";
      };
    };
  };
}>;

type SafeAssetRecord = Prisma.ArticleAssetGetPayload<{
  select: {
    id: true;
    workspaceId: true;
    brandId: true;
    title: true;
    slug: true;
    canonicalBody: true;
    summary: true;
    primaryKeyword: true;
    ctaText: true;
    ctaUrl: true;
    intent: true;
    generationMeta: true;
    status: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

type SafeBrandRecord = {
  id: string;
  name: string;
  siteUrl: string;
};

type SafeVariantRecord = Prisma.ArticleVariantGetPayload<{
  include: {
    platform: {
      select: {
        id: true;
        name: true;
        slug: true;
      };
    };
  };
}>;

type SafePublicationRecord = Prisma.PublicationGetPayload<{
  select: {
    id: true;
    assetId: true;
    status: true;
    scheduledAt: true;
    publishedAt: true;
    externalUrl: true;
    clickCount: true;
    leadCount: true;
    lastError: true;
    createdAt: true;
  };
}>;

export class DistributionServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DistributionServiceError";
  }
}

function normalizeOptionalValue(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeContentBrief(
  brief?: ArticleContentBrief | null,
): ArticleContentBrief | null {
  if (!brief) {
    return null;
  }

  return {
    contentFormat: brief.contentFormat || "",
    tone: brief.tone || "",
    targetAudience: normalizeOptionalValue(brief.targetAudience) ?? "",
    readerPain: normalizeOptionalValue(brief.readerPain) ?? "",
    mainThesis: normalizeOptionalValue(brief.mainThesis) ?? "",
  };
}

function readContentBrief(meta: unknown): ArticleContentBrief | null {
  if (!isRecord(meta) || !isRecord(meta.contentBrief)) {
    return null;
  }

  return normalizeContentBrief(meta.contentBrief as ArticleContentBrief);
}

function buildGenerationMeta(
  existingMeta: unknown,
  brief?: ArticleContentBrief | null,
): Prisma.InputJsonObject | undefined {
  if (brief === undefined) {
    return undefined;
  }

  return {
    ...(isRecord(existingMeta) ? existingMeta : {}),
    contentBrief: normalizeContentBrief(brief),
  } as Prisma.InputJsonObject;
}

function mapAsset(record: AssetRecord): DistributionAssetListItem {
  const variant = record.variants[0];
  const publication = record.publications[0];

  if (!variant) {
    throw new Error("Не найдена версия статьи для площадки.");
  }

  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    canonicalBody: record.canonicalBody,
    summary: record.summary,
    primaryKeyword: record.primaryKeyword,
    ctaText: record.ctaText,
    ctaUrl: record.ctaUrl,
    intent: record.intent,
    contentBrief: readContentBrief(record.generationMeta),
    status: record.status,
    brandId: record.brand.id,
    brandName: record.brand.name,
    brandDomain: getDomainFromUrl(record.brand.siteUrl),
    brandUrl: record.brand.siteUrl,
    platformId: variant.platform.id,
    platformName: variant.platform.name,
    platformSlug: variant.platform.slug,
    variantId: variant.id,
    variantStatus: variant.status,
    publicationId: publication?.id ?? null,
    publicationStatus: publication?.status ?? PublicationStatus.PLANNED,
    publicationLastError: publication?.lastError ?? null,
    scheduledAt: publication?.scheduledAt?.toISOString() ?? null,
    publishedAt: publication?.publishedAt?.toISOString() ?? null,
    externalUrl: publication?.externalUrl ?? null,
    clickCount: publication?.clickCount ?? 0,
    leadCount: publication?.leadCount ?? 0,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapSafeAsset(
  asset: SafeAssetRecord,
  brand: SafeBrandRecord,
  variant: SafeVariantRecord,
  publication?: SafePublicationRecord,
): DistributionAssetListItem {
  return {
    id: asset.id,
    title: asset.title,
    slug: asset.slug,
    canonicalBody: asset.canonicalBody,
    summary: asset.summary,
    primaryKeyword: asset.primaryKeyword,
    ctaText: asset.ctaText,
    ctaUrl: asset.ctaUrl,
    intent: asset.intent,
    contentBrief: readContentBrief(asset.generationMeta),
    status: asset.status,
    brandId: brand.id,
    brandName: brand.name,
    brandDomain: getDomainFromUrl(brand.siteUrl),
    brandUrl: brand.siteUrl,
    platformId: variant.platform.id,
    platformName: variant.platform.name,
    platformSlug: variant.platform.slug,
    variantId: variant.id,
    variantStatus: variant.status,
    publicationId: publication?.id ?? null,
    publicationStatus: publication?.status ?? PublicationStatus.PLANNED,
    publicationLastError: publication?.lastError ?? null,
    scheduledAt: publication?.scheduledAt?.toISOString() ?? null,
    publishedAt: publication?.publishedAt?.toISOString() ?? null,
    externalUrl: publication?.externalUrl ?? null,
    clickCount: publication?.clickCount ?? 0,
    leadCount: publication?.leadCount ?? 0,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

async function safeLoad<T>(label: string, fallback: T, loader: () => Promise<T>) {
  try {
    debugLog(`[distribution:safe] before ${label}`);
    const result = await loader();
    debugLog(`[distribution:safe] after ${label}`);
    return result;
  } catch (error) {
    console.error(`[distribution:safe] ${label} error`, error);
    return fallback;
  }
}

async function ensureBrandAccess(
  tx: Prisma.TransactionClient,
  userId: string,
  brandId: string,
) {
  const brand = await tx.brand.findFirst({
    where: {
      id: brandId,
      status: {
        not: BrandStatus.ARCHIVED,
      },
      workspace: {
        members: {
          some: { userId },
        },
      },
    },
    select: {
      id: true,
      workspaceId: true,
      siteUrl: true,
      name: true,
    },
  });

  if (!brand) {
    throw new DistributionServiceError(
      404,
      "BRAND_NOT_FOUND",
      "Бренд не найден.",
    );
  }

  return brand;
}

async function ensurePlatform(
  tx: Prisma.TransactionClient,
  platformId: string,
) {
  const platform = await tx.distributionPlatform.findFirst({
    where: {
      id: platformId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!platform) {
    throw new DistributionServiceError(
      404,
      "PLATFORM_NOT_FOUND",
      "Площадка не найдена.",
    );
  }

  return platform;
}

async function ensureAssetAccess(userId: string, assetId: string) {
  const asset = await prisma.articleAsset.findFirst({
    where: {
      id: assetId,
      workspace: {
        members: {
          some: { userId },
        },
      },
    },
    include: {
      variants: {
        include: {
          platform: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        take: 1,
      },
      publications: {
        take: 1,
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!asset || asset.status === AssetStatus.ARCHIVED) {
    throw new DistributionServiceError(
      404,
      "ASSET_NOT_FOUND",
      "Статья не найдена.",
    );
  }

  return asset;
}

async function generateUniqueAssetSlug(
  tx: Prisma.TransactionClient,
  brandId: string,
  baseSlug: string,
) {
  const safeBaseSlug = baseSlug || "distribution-asset";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate =
      attempt === 0 ? safeBaseSlug : `${safeBaseSlug}-${attempt + 1}`;
    const existing = await tx.articleAsset.findFirst({
      where: {
        brandId,
        slug: candidate,
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new DistributionServiceError(
    500,
    "ASSET_SLUG_GENERATION_FAILED",
    "Не удалось создать уникальный адрес статьи.",
  );
}

function deriveAssetStatus(hasSchedule: boolean, nextStatus?: AssetStatus) {
  if (nextStatus) {
    return nextStatus;
  }

  return hasSchedule ? AssetStatus.DISTRIBUTING : AssetStatus.READY;
}

function deriveVariantStatus(publicationStatus?: PublicationStatus | null) {
  if (!publicationStatus || publicationStatus === PublicationStatus.PLANNED) {
    return VariantStatus.READY;
  }

  if (publicationStatus === PublicationStatus.PUBLISHED) {
    return VariantStatus.PUBLISHED;
  }

  if (publicationStatus === PublicationStatus.FAILED) {
    return VariantStatus.FAILED;
  }

  return VariantStatus.APPROVED;
}

export async function listPlatformOptions(): Promise<PlatformOption[]> {
  try {
    await ensureDefaultPlatforms();
  } catch (error) {
    console.error("[distribution:safe] ensureDefaultPlatforms error", error);
  }

  const platforms = await safeLoad("distributionPlatform.findMany", [], () =>
    prisma.distributionPlatform.findMany({
      where: {
        isActive: true,
        slug: {
          in: [...platformSlugs],
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  );

  return platforms;
}

export async function listDistributionAssetsByUser(userId: string) {
  const workspace = await getWorkspaceShell(userId);

  if (!workspace) {
    return [];
  }

  const assets = await safeLoad("articleAsset.findMany", [], () =>
    prisma.articleAsset.findMany({
      where: {
        workspaceId: workspace.id,
        status: {
          not: AssetStatus.ARCHIVED,
        },
      },
      select: {
        id: true,
        workspaceId: true,
        brandId: true,
        title: true,
        slug: true,
        canonicalBody: true,
        summary: true,
        primaryKeyword: true,
        ctaText: true,
        ctaUrl: true,
        intent: true,
        generationMeta: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
  );

  if (assets.length === 0) {
    return [];
  }

  const brandIds = [...new Set(assets.map((asset) => asset.brandId))];
  const assetIds = assets.map((asset) => asset.id);

  const brands = await safeLoad("brand.findMany", [], () =>
    prisma.brand.findMany({
      where: {
        id: { in: brandIds },
        status: {
          not: BrandStatus.ARCHIVED,
        },
      },
      select: {
        id: true,
        name: true,
        siteUrl: true,
      },
    }),
  );

  const variants = await safeLoad("articleVariant.findMany", [], () =>
    prisma.articleVariant.findMany({
      where: {
        assetId: { in: assetIds },
      },
      include: {
        platform: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
  );

  const publications = await safeLoad("publication.findMany", [], () =>
    prisma.publication.findMany({
      where: {
        assetId: { in: assetIds },
      },
      select: {
        id: true,
        assetId: true,
        status: true,
        scheduledAt: true,
        publishedAt: true,
        externalUrl: true,
        clickCount: true,
        leadCount: true,
        lastError: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
  );

  const brandById = new Map(brands.map((brand) => [brand.id, brand]));
  const variantByAssetId = new Map<string, SafeVariantRecord>();
  variants.forEach((variant) => {
    if (!variantByAssetId.has(variant.assetId)) {
      variantByAssetId.set(variant.assetId, variant);
    }
  });

  const publicationByAssetId = new Map<string, SafePublicationRecord>();
  publications.forEach((publication) => {
    if (!publicationByAssetId.has(publication.assetId)) {
      publicationByAssetId.set(publication.assetId, publication);
    }
  });

  return assets.flatMap((asset) => {
    const brand = brandById.get(asset.brandId);
    const variant = variantByAssetId.get(asset.id);

    if (!brand || !variant || !variant.platform.slug?.trim()) {
      console.error("[distribution:safe] skip broken asset", {
        assetId: asset.id,
        hasBrand: Boolean(brand),
        hasVariant: Boolean(variant),
      });
      return [];
    }

    return [mapSafeAsset(asset, brand, variant, publicationByAssetId.get(asset.id))];
  });
}

export async function getDistributionAssetByIdForUser(
  userId: string,
  assetId: string,
) {
  const record = await prisma.articleAsset.findFirst({
    where: {
      id: assetId,
      workspace: {
        members: {
          some: { userId },
        },
      },
      status: {
        not: AssetStatus.ARCHIVED,
      },
    },
    include: {
      brand: {
        select: {
          id: true,
          name: true,
          siteUrl: true,
        },
      },
      variants: {
        include: {
          platform: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        take: 1,
      },
      publications: {
        take: 1,
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!record) {
    throw new DistributionServiceError(
      404,
      "ASSET_NOT_FOUND",
      "Статья не найдена.",
    );
  }

  return mapAsset(record);
}

export async function createDistributionAsset(
  userId: string,
  payload: CreateDistributionAssetPayload,
) {
  const workspace = await requireWorkspaceForUser(userId);

  return prisma.$transaction(async (tx) => {
    const brand = await ensureBrandAccess(tx, userId, payload.brandId);
    const platform = await ensurePlatform(tx, payload.platformId);
    const slug = await generateUniqueAssetSlug(
      tx,
      brand.id,
      slugify(payload.title) ||
        slugify(getDomainFromUrl(brand.siteUrl)) ||
        "asset",
    );

    const scheduledAt = payload.scheduledAt
      ? new Date(payload.scheduledAt)
      : null;
    const publicationStatus = scheduledAt
      ? PublicationStatus.SCHEDULED
      : PublicationStatus.PLANNED;
    const assetStatus = deriveAssetStatus(Boolean(scheduledAt));
    const variantStatus = deriveVariantStatus(publicationStatus);

    const asset = await tx.articleAsset.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        authorId: userId,
        title: payload.title.trim(),
        slug,
        canonicalBody: payload.canonicalBody.trim(),
        summary: normalizeOptionalValue(payload.summary),
        primaryKeyword: normalizeOptionalValue(payload.primaryKeyword),
        ctaText: normalizeOptionalValue(payload.ctaText),
        ctaUrl: payload.ctaUrl ? normalizeHttpUrl(payload.ctaUrl) : null,
        intent: payload.intent ?? null,
        generationMeta: buildGenerationMeta(null, payload.contentBrief),
        status: assetStatus,
        variants: {
          create: {
            platformId: platform.id,
            headline: payload.title.trim(),
            body: payload.canonicalBody.trim(),
            callToAction: normalizeOptionalValue(payload.ctaText),
            status: variantStatus,
          },
        },
      },
      include: {
        variants: {
          take: 1,
        },
      },
    });

    const variantId = asset.variants[0]?.id;

    if (!variantId) {
      throw new DistributionServiceError(
        500,
        "VARIANT_CREATE_FAILED",
        "Не удалось создать версию статьи для площадки.",
      );
    }

    await tx.publication.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand.id,
        assetId: asset.id,
        variantId,
        platformId: platform.id,
        status: publicationStatus,
        scheduledAt,
      },
    });

    await tx.brand.update({
      where: { id: brand.id },
      data: {
        lastActivityAt: new Date(),
      },
    });

    const record = await tx.articleAsset.findUniqueOrThrow({
      where: { id: asset.id },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
            siteUrl: true,
          },
        },
        variants: {
          include: {
            platform: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
          take: 1,
        },
        publications: {
          take: 1,
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    return mapAsset(record);
  });
}

export async function updateDistributionAsset(
  userId: string,
  assetId: string,
  payload: UpdateDistributionAssetPayload,
) {
  const existing = await ensureAssetAccess(userId, assetId);

  return prisma.$transaction(async (tx) => {
    const brandId = payload.brandId ?? existing.brandId;
    const brand = await ensureBrandAccess(tx, userId, brandId);

    const currentVariant = existing.variants[0];
    const currentPublication = existing.publications[0];

    if (!currentVariant || !currentPublication) {
      throw new DistributionServiceError(
        500,
        "ASSET_RELATIONS_MISSING",
        "У статьи отсутствует версия для площадки или запись публикации.",
      );
    }

    const platformId = payload.platformId ?? currentVariant.platformId;
    await ensurePlatform(tx, platformId);

    const nextTitle = payload.title?.trim() || existing.title;
    const nextBody = payload.canonicalBody?.trim() || existing.canonicalBody;
    const nextScheduledAt =
      payload.scheduledAt !== undefined
        ? payload.scheduledAt
          ? new Date(payload.scheduledAt)
          : null
        : currentPublication.scheduledAt;
    const nextPublicationStatus =
      payload.publicationStatus ??
      (nextScheduledAt
        ? PublicationStatus.SCHEDULED
        : PublicationStatus.PLANNED);
    const nextAssetStatus = deriveAssetStatus(
      Boolean(nextScheduledAt),
      payload.status,
    );
    const nextVariantStatus = deriveVariantStatus(nextPublicationStatus);

    const nextSlug =
      nextTitle !== existing.title
        ? await generateUniqueAssetSlug(
            tx,
            brand.id,
            slugify(nextTitle) || existing.slug || "asset",
          )
        : existing.slug;

    await tx.articleAsset.update({
      where: { id: existing.id },
      data: {
        brandId: brand.id,
        title: nextTitle,
        slug: nextSlug,
        canonicalBody: nextBody,
        summary:
          payload.summary !== undefined
            ? normalizeOptionalValue(payload.summary)
            : existing.summary,
        primaryKeyword:
          payload.primaryKeyword !== undefined
            ? normalizeOptionalValue(payload.primaryKeyword)
            : existing.primaryKeyword,
        ctaText:
          payload.ctaText !== undefined
            ? normalizeOptionalValue(payload.ctaText)
            : existing.ctaText,
        ctaUrl:
          payload.ctaUrl !== undefined
            ? payload.ctaUrl
              ? normalizeHttpUrl(payload.ctaUrl)
              : null
            : existing.ctaUrl,
        intent: payload.intent !== undefined ? payload.intent : existing.intent,
        ...(payload.contentBrief !== undefined
          ? {
              generationMeta:
                buildGenerationMeta(existing.generationMeta, payload.contentBrief) ??
                Prisma.JsonNull,
            }
          : {}),
        status: nextAssetStatus,
      },
    });

    await tx.articleVariant.update({
      where: {
        id: currentVariant.id,
      },
      data: {
        platformId,
        headline: nextTitle,
        body: nextBody,
        callToAction:
          payload.ctaText !== undefined
            ? normalizeOptionalValue(payload.ctaText)
            : currentVariant.callToAction,
        status: nextVariantStatus,
      },
    });

    await tx.publication.update({
      where: {
        id: currentPublication.id,
      },
      data: {
        brandId: brand.id,
        platformId,
        status: nextPublicationStatus,
        scheduledAt: nextScheduledAt,
        publishedAt:
          nextPublicationStatus === PublicationStatus.PUBLISHED
            ? (currentPublication.publishedAt ?? new Date())
            : null,
      },
    });

    await tx.brand.update({
      where: { id: brand.id },
      data: {
        lastActivityAt: new Date(),
      },
    });

    const record = await tx.articleAsset.findUniqueOrThrow({
      where: { id: existing.id },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
            siteUrl: true,
          },
        },
        variants: {
          include: {
            platform: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
          take: 1,
        },
        publications: {
          take: 1,
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    return mapAsset(record);
  });
}

export async function archiveDistributionAsset(
  userId: string,
  assetId: string,
) {
  const existing = await ensureAssetAccess(userId, assetId);

  await prisma.$transaction(async (tx) => {
    const archivedAt = new Date();

    await tx.articleAsset.update({
      where: {
        id: existing.id,
      },
      data: {
        status: AssetStatus.ARCHIVED,
        archivedAt,
      },
    });

    await tx.articleVariant.updateMany({
      where: {
        assetId: existing.id,
      },
      data: {
        status: VariantStatus.ARCHIVED,
      },
    });

    await tx.publication.updateMany({
      where: {
        assetId: existing.id,
        status: {
          not: PublicationStatus.PUBLISHED,
        },
      },
      data: {
        status: PublicationStatus.CANCELED,
      },
    });

    await tx.brand.update({
      where: {
        id: existing.brandId,
      },
      data: {
        lastActivityAt: archivedAt,
      },
    });
  });
}
