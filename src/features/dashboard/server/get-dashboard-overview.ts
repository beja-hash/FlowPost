import { AssetStatus, BrandStatus, PublicationStatus } from "@prisma/client";

import { prisma } from "@/infrastructure/db/prisma";
import { debugLog } from "@/lib/debug-log";

import type {
  DashboardActivityItem,
  DashboardOverview,
  DashboardPlatformAnalytics,
  DashboardTimelinePoint,
} from "../types";

const platformSlots = [
  { key: "dzen", name: "Dzen", slug: "dzen" },
  { key: "vc", name: "VC.ru", slug: "vc" },
  { key: "rbk", name: "RBK.ru", slug: "rbk" },
] as const;

function roundRate(part: number, whole: number) {
  if (whole === 0) {
    return 0;
  }

  return Math.round((part / whole) * 100);
}

function toIso(value?: Date | null) {
  return value?.toISOString() ?? null;
}

function buildTimeline(
  publications: Array<{
    status: PublicationStatus;
    createdAt: Date;
    publishedAt: Date | null;
    updatedAt: Date;
  }>,
): DashboardTimelinePoint[] {
  const today = new Date();
  const points = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(today.getDate() - (6 - index));

    return {
      key: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
      }).format(date),
      total: 0,
      successful: 0,
      failed: 0,
    };
  });

  const pointByKey = new Map(points.map((point) => [point.key, point]));

  publications.forEach((publication) => {
    const activityDate =
      publication.publishedAt ?? publication.updatedAt ?? publication.createdAt;
    const key = activityDate.toISOString().slice(0, 10);
    const point = pointByKey.get(key);

    if (!point) {
      return;
    }

    point.total += 1;
    if (publication.status === PublicationStatus.PUBLISHED) {
      point.successful += 1;
    }
    if (publication.status === PublicationStatus.FAILED) {
      point.failed += 1;
    }
  });

  return points.map((point) => ({
    label: point.label,
    total: point.total,
    successful: point.successful,
    failed: point.failed,
  }));
}

function buildPlatformAnalytics(
  publications: Array<{
    status: PublicationStatus;
    publishedAt: Date | null;
    updatedAt: Date;
    clickCount: number;
    platform: {
      slug: string;
    };
  }>,
): DashboardPlatformAnalytics[] {
  return platformSlots.map((slot) => {
    const matches = publications.filter(
      (publication) => publication.platform.slug === slot.slug,
    );
    const successfulPublications = matches.filter(
      (publication) => publication.status === PublicationStatus.PUBLISHED,
    ).length;
    const failedPublications = matches.filter(
      (publication) => publication.status === PublicationStatus.FAILED,
    ).length;
    const scheduledPublications = matches.filter(
      (publication) => publication.status === PublicationStatus.SCHEDULED,
    ).length;
    const lastPublication = matches
      .map((publication) => publication.publishedAt ?? publication.updatedAt)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const successRate = roundRate(successfulPublications, matches.length);

    return {
      key: slot.key,
      name: slot.name,
      totalPublications: matches.length,
      successfulPublications,
      failedPublications,
      scheduledPublications,
      successRate,
      lastPublicationAt: toIso(lastPublication),
      trackedClicks: matches.reduce(
        (total, publication) => total + publication.clickCount,
        0,
      ),
      indicator:
        matches.length === 0
          ? "quiet"
          : failedPublications > successfulPublications
            ? "watch"
            : "healthy",
    };
  });
}

function buildRecentActivity(
  publications: Array<{
    id: string;
    status: PublicationStatus;
    scheduledAt: Date | null;
    publishedAt: Date | null;
    updatedAt: Date;
    platform: {
      name: string;
    };
  }>,
  assets: Array<{
    id: string;
    title: string;
    createdAt: Date;
  }>,
): DashboardActivityItem[] {
  const publicationItems: DashboardActivityItem[] = [];

  publications.forEach((publication) => {
    if (publication.status === PublicationStatus.PUBLISHED) {
      publicationItems.push({
        id: `${publication.id}-published`,
        kind: "published",
        message: `Статья опубликована на ${publication.platform.name}`,
        occurredAt: (
          publication.publishedAt ?? publication.updatedAt
        ).toISOString(),
      });
    }

    if (publication.status === PublicationStatus.FAILED) {
      publicationItems.push({
        id: `${publication.id}-failed`,
        kind: "failed",
        message: `Публикация на ${publication.platform.name} завершилась ошибкой`,
        occurredAt: publication.updatedAt.toISOString(),
      });
    }

    if (publication.status === PublicationStatus.SCHEDULED) {
      publicationItems.push({
        id: `${publication.id}-scheduled`,
        kind: "scheduled",
        message: `Публикация на ${publication.platform.name} запланирована`,
        occurredAt: (
          publication.scheduledAt ?? publication.updatedAt
        ).toISOString(),
      });
    }
  });

  const assetItems: DashboardActivityItem[] = assets.map((asset) => ({
    id: `${asset.id}-generated`,
    kind: "generated",
    message: `Создана новая статья: ${asset.title}`,
    occurredAt: asset.createdAt.toISOString(),
  }));

  return [...publicationItems, ...assetItems]
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime(),
    )
    .slice(0, 6);
}

function emptyDashboardOverview(): DashboardOverview {
  return {
    totalBrands: 0,
    totalArticles: 0,
    totalPublications: 0,
    successfulPublications: 0,
    failedPublications: 0,
    scheduledPublications: 0,
    successRate: 0,
    trackedClicks: 0,
    nextDistributionAt: null,
    lastActivityAt: null,
    platformAnalytics: buildPlatformAnalytics([]),
    brandAnalytics: [],
    recentActivity: [],
    publicationsOverTime: buildTimeline([]),
  };
}

async function safeLoad<T>(label: string, fallback: T, loader: () => Promise<T>) {
  try {
    debugLog(`[dashboard:safe] before ${label}`);
    const result = await loader();
    debugLog(`[dashboard:safe] after ${label}`);
    return result;
  } catch (error) {
    console.error(`[dashboard:safe] ${label} error`, error);
    return fallback;
  }
}

export async function getDashboardOverview(
  userId: string,
): Promise<DashboardOverview> {
  const now = new Date();

  const user = await safeLoad("user.findUnique", null, () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    }),
  );

  if (!user) {
    return emptyDashboardOverview();
  }

  const membership = await safeLoad("workspaceMember.findFirst", null, () =>
    prisma.workspaceMember.findFirst({
      where: { userId },
      select: { workspaceId: true },
    }),
  );

  if (!membership) {
    return emptyDashboardOverview();
  }

  const workspaceId = membership.workspaceId;

  const totalBrands = await safeLoad("brand.count", 0, () =>
    prisma.brand.count({
      where: {
        workspaceId,
        status: { not: BrandStatus.ARCHIVED },
      },
    }),
  );
  const totalArticles = await safeLoad("articleAsset.count", 0, () =>
    prisma.articleAsset.count({
      where: {
        workspaceId,
        status: { not: AssetStatus.ARCHIVED },
      },
    }),
  );
  const publications = await safeLoad("publication.findMany", [], () =>
    prisma.publication.findMany({
      where: { workspaceId },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        publishedAt: true,
        clickCount: true,
        createdAt: true,
        updatedAt: true,
        brandId: true,
        platform: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
  );
  const nextPublication = await safeLoad("publication.findFirst", null, () =>
    prisma.publication.findFirst({
      where: {
        workspaceId,
        status: PublicationStatus.SCHEDULED,
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true },
    }),
  );
  const activeBrands = await safeLoad("brand.findMany", [], () =>
    prisma.brand.findMany({
      where: {
        workspaceId,
        status: { not: BrandStatus.ARCHIVED },
      },
      select: {
        id: true,
        name: true,
        lastActivityAt: true,
        updatedAt: true,
        articleAssets: {
          where: { status: { not: AssetStatus.ARCHIVED } },
          select: { id: true },
        },
        publications: {
          select: {
            status: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
      take: 6,
    }),
  );
  const latestAssets = await safeLoad("articleAsset.findMany", [], () =>
    prisma.articleAsset.findMany({
      where: {
        workspaceId,
        status: { not: AssetStatus.ARCHIVED },
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  );

  const successfulPublications = publications.filter(
    (publication) => publication.status === PublicationStatus.PUBLISHED,
  ).length;
  const failedPublications = publications.filter(
    (publication) => publication.status === PublicationStatus.FAILED,
  ).length;
  const scheduledPublications = publications.filter(
    (publication) => publication.status === PublicationStatus.SCHEDULED,
  ).length;
  const totalPublications = publications.length;
  const trackedClicks = publications.reduce(
    (total, publication) => total + publication.clickCount,
    0,
  );

  const brandAnalytics = activeBrands
    .map((brand) => {
      const successful = brand.publications.filter(
        (publication) => publication.status === PublicationStatus.PUBLISHED,
      ).length;
      const recentPublication = brand.publications
        .map((publication) => publication.updatedAt)
        .sort((left, right) => right.getTime() - left.getTime())[0];

      return {
        id: brand.id,
        name: brand.name,
        articleCount: brand.articleAssets.length,
        publicationCount: brand.publications.length,
        successRate: roundRate(successful, brand.publications.length),
        recentActivityAt: toIso(
          recentPublication ?? brand.lastActivityAt ?? brand.updatedAt,
        ),
      };
    })
    .sort((left, right) => {
      if (right.publicationCount !== left.publicationCount) {
        return right.publicationCount - left.publicationCount;
      }

      return right.articleCount - left.articleCount;
    })
    .slice(0, 5);

  const activityDates = [
    ...publications.map((publication) => publication.updatedAt),
    ...latestAssets.map((asset) => asset.updatedAt),
    ...activeBrands
      .map((brand) => brand.lastActivityAt ?? brand.updatedAt)
      .filter((value): value is Date => value instanceof Date),
  ];

  const lastActivityAt =
    activityDates.length > 0
      ? new Date(Math.max(...activityDates.map((date) => date.getTime())))
      : null;

  return {
    totalBrands,
    totalArticles,
    totalPublications,
    successfulPublications,
    failedPublications,
    scheduledPublications,
    successRate: roundRate(successfulPublications, totalPublications),
    trackedClicks,
    nextDistributionAt: toIso(nextPublication?.scheduledAt),
    lastActivityAt: toIso(lastActivityAt),
    platformAnalytics: buildPlatformAnalytics(publications),
    brandAnalytics,
    recentActivity: buildRecentActivity(publications.slice(0, 8), latestAssets),
    publicationsOverTime: buildTimeline(publications),
  };
}
