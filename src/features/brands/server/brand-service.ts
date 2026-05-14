import {
  AssetStatus,
  BrandStatus,
  Prisma,
  PublicationStatus,
  WorkspacePlan,
} from "@prisma/client";

import type {
  BrandListItem,
  BrandOption,
  CreateBrandPayload,
  UpdateBrandPayload,
} from "@/features/brands/types";
import {
  getWorkspaceShell,
  requireWorkspaceForUser,
} from "@/features/workspaces/server/workspace-service";
import { prisma } from "@/infrastructure/db/prisma";
import { ensureDefaultPlatforms } from "@/infrastructure/platforms/default-platforms";
import { slugify } from "@/lib/slugify";
import { getDomainFromUrl, normalizeHttpUrl } from "@/lib/url";

import type { CreateBrandInput, UpdateBrandInput } from "./brand-schemas";

type BrandListRecord = Prisma.BrandGetPayload<{
  include: {
    _count: {
      select: {
        articleAssets: true;
        publications: true;
      };
    };
  };
}>;

export class BrandServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BrandServiceError";
  }
}

function normalizeOptionalValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapBrand(brand: BrandListRecord): BrandListItem {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    siteUrl: brand.siteUrl,
    domain: getDomainFromUrl(brand.siteUrl),
    description: brand.description,
    industry: brand.industry,
    geography: brand.geography,
    targetAudience: brand.targetAudience,
    primaryCta: brand.primaryCta,
    status: brand.status,
    assetCount: brand._count.articleAssets,
    publicationCount: brand._count.publications,
    createdAt: brand.createdAt.toISOString(),
    updatedAt: brand.updatedAt.toISOString(),
    lastActivityAt: brand.lastActivityAt?.toISOString() ?? null,
  };
}

async function safeLoad<T>(label: string, fallback: T, loader: () => Promise<T>) {
  try {
    console.log(`[brands:safe] before ${label}`);
    const result = await loader();
    console.log(`[brands:safe] after ${label}`);
    return result;
  } catch (error) {
    console.error(`[brands:safe] ${label} error`, error);
    return fallback;
  }
}

async function generateUniqueBrandSlug(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  baseSlug: string,
) {
  const safeBaseSlug = baseSlug || "brand";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? safeBaseSlug : `${safeBaseSlug}-${attempt + 1}`;
    const existing = await tx.brand.findFirst({
      where: {
        workspaceId,
        slug: candidate,
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new BrandServiceError(
    500,
    "BRAND_SLUG_GENERATION_FAILED",
    "Не удалось создать уникальный адрес бренда.",
  );
}

async function ensureWorkspaceBrandAccess(userId: string, brandId: string) {
  const brand = await prisma.brand.findFirst({
    where: {
      id: brandId,
      workspace: {
        members: {
          some: { userId },
        },
      },
    },
    include: {
      workspace: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!brand || brand.status === BrandStatus.ARCHIVED) {
    throw new BrandServiceError(404, "BRAND_NOT_FOUND", "Бренд не найден.");
  }

  return brand;
}

async function ensureUniqueSiteUrl(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  normalizedSiteUrl: string,
  excludeBrandId?: string,
) {
  const existing = await tx.brand.findFirst({
    where: {
      workspaceId,
      siteUrl: normalizedSiteUrl,
      ...(excludeBrandId ? { id: { not: excludeBrandId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new BrandServiceError(
      409,
      "BRAND_SITE_URL_CONFLICT",
      "Бренд с таким адресом сайта уже существует в рабочем пространстве.",
    );
  }
}

export async function listBrandsByUser(userId: string) {
  const workspace = await getWorkspaceShell(userId);

  if (!workspace) {
    return {
      workspace: null,
      brands: [],
      planLabel: "Рост",
    };
  }

  const brands = await safeLoad("brand.findMany", [], () =>
    prisma.brand.findMany({
      where: {
        workspaceId: workspace.id,
        status: {
          not: BrandStatus.ARCHIVED,
        },
      },
      include: {
        _count: {
          select: {
            articleAssets: true,
            publications: true,
          },
        },
      },
      orderBy: [
        {
          lastActivityAt: "desc",
        },
        {
          updatedAt: "desc",
        },
      ],
    }),
  );

  return {
    workspace,
    brands: brands.flatMap((brand) => {
      if (!brand.name?.trim() || !brand.slug?.trim() || !brand.siteUrl?.trim()) {
        console.error("[brands:safe] skip broken brand", { brandId: brand.id });
        return [];
      }

      return [mapBrand(brand)];
    }),
    planLabel:
      workspace.plan === WorkspacePlan.STARTER
        ? "Старт"
        : workspace.plan === WorkspacePlan.PRO
          ? "Про"
          : "Рост",
  };
}

export async function listBrandOptions(userId: string): Promise<BrandOption[]> {
  const workspace = await getWorkspaceShell(userId);

  if (!workspace) {
    return [];
  }

  const brands = await safeLoad("brand.findMany(options)", [], () =>
    prisma.brand.findMany({
      where: {
        workspaceId: workspace.id,
        status: BrandStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
        siteUrl: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  );

  return brands.flatMap((brand) => {
    if (!brand.name?.trim() || !brand.siteUrl?.trim()) {
      console.error("[brands:safe] skip broken brand option", {
        brandId: brand.id,
      });
      return [];
    }

    return [
      {
        id: brand.id,
        name: brand.name,
        domain: getDomainFromUrl(brand.siteUrl),
      },
    ];
  });
}

export async function createBrand(userId: string, payload: CreateBrandPayload) {
  const workspace = await requireWorkspaceForUser(userId);
  await ensureDefaultPlatforms();
  const normalizedSiteUrl = normalizeHttpUrl(payload.siteUrl);

  return prisma.$transaction(async (tx) => {
    await ensureUniqueSiteUrl(tx, workspace.id, normalizedSiteUrl);

    const slug = await generateUniqueBrandSlug(
      tx,
      workspace.id,
      slugify(payload.name) || slugify(getDomainFromUrl(normalizedSiteUrl)) || "brand",
    );

    const brand = await tx.brand.create({
      data: {
        workspaceId: workspace.id,
        name: payload.name.trim(),
        slug,
        siteUrl: normalizedSiteUrl,
        description: normalizeOptionalValue(payload.description),
        industry: normalizeOptionalValue(payload.industry),
        geography: normalizeOptionalValue(payload.geography),
        targetAudience: normalizeOptionalValue(payload.targetAudience),
        primaryCta: normalizeOptionalValue(payload.primaryCta),
        lastActivityAt: new Date(),
      },
      include: {
        _count: {
          select: {
            articleAssets: true,
            publications: true,
          },
        },
      },
    });

    const hydratedBrand = await tx.brand.findUniqueOrThrow({
      where: { id: brand.id },
      include: {
        _count: {
          select: {
            articleAssets: true,
            publications: true,
          },
        },
      },
    });

    return mapBrand(hydratedBrand);
  });
}

export async function updateBrand(
  userId: string,
  brandId: string,
  payload: UpdateBrandPayload,
) {
  const existing = await ensureWorkspaceBrandAccess(userId, brandId);

  return prisma.$transaction(async (tx) => {
    let nextSiteUrl = existing.siteUrl;

    if (payload.siteUrl?.trim()) {
      nextSiteUrl = normalizeHttpUrl(payload.siteUrl);
      await ensureUniqueSiteUrl(tx, existing.workspaceId, nextSiteUrl, existing.id);
    }

    const nextName = payload.name?.trim() || existing.name;
    const nextSlug =
      nextName !== existing.name
        ? await generateUniqueBrandSlug(
            tx,
            existing.workspaceId,
            slugify(nextName) || existing.slug || "brand",
          )
        : existing.slug;

    const brand = await tx.brand.update({
      where: { id: existing.id },
      data: {
        name: nextName,
        slug: nextSlug,
        siteUrl: nextSiteUrl,
        description:
          payload.description !== undefined
            ? normalizeOptionalValue(payload.description)
            : existing.description,
        industry:
          payload.industry !== undefined
            ? normalizeOptionalValue(payload.industry)
            : existing.industry,
        geography:
          payload.geography !== undefined
            ? normalizeOptionalValue(payload.geography)
            : existing.geography,
        targetAudience:
          payload.targetAudience !== undefined
            ? normalizeOptionalValue(payload.targetAudience)
            : existing.targetAudience,
        primaryCta:
          payload.primaryCta !== undefined
            ? normalizeOptionalValue(payload.primaryCta)
            : existing.primaryCta,
        lastActivityAt: new Date(),
      },
      include: {
        _count: {
          select: {
            articleAssets: true,
            publications: true,
          },
        },
      },
    });

    return mapBrand(brand);
  });
}

export async function archiveBrand(userId: string, brandId: string) {
  const existing = await ensureWorkspaceBrandAccess(userId, brandId);

  await prisma.$transaction(async (tx) => {
    const archivedAt = new Date();

    await tx.brand.update({
      where: { id: existing.id },
      data: {
        status: BrandStatus.ARCHIVED,
        archivedAt,
        lastActivityAt: archivedAt,
      },
    });

    await tx.articleAsset.updateMany({
      where: {
        brandId: existing.id,
      },
      data: {
        status: AssetStatus.ARCHIVED,
        archivedAt,
      },
    });

    await tx.publication.updateMany({
      where: {
        brandId: existing.id,
        status: {
          not: PublicationStatus.PUBLISHED,
        },
      },
      data: {
        status: PublicationStatus.CANCELED,
      },
    });
  });
}

export function parseCreateBrandPayload(payload: CreateBrandInput): CreateBrandPayload {
  return payload;
}

export function parseUpdateBrandPayload(payload: UpdateBrandInput): UpdateBrandPayload {
  return payload;
}
