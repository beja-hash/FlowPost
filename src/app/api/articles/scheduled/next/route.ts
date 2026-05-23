import { PublicationStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { auth } from "@/infrastructure/auth/session";
import { prisma } from "@/infrastructure/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHEDULED_TRIGGER_LEAD_MS = 30 * 1000;
const SCHEDULED_RETRY_WINDOW_MS = 2 * 60 * 1000;

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Требуется авторизация." } },
      { status: 401 },
    );
  }

  const now = new Date();
  const triggerWindowEnd = new Date(now.getTime() + SCHEDULED_TRIGGER_LEAD_MS);
  const retryWindowStart = new Date(now.getTime() - SCHEDULED_RETRY_WINDOW_MS);

  const publications = await prisma.publication.findMany({
    where: {
      status: PublicationStatus.SCHEDULED,
      scheduledAt: {
        gte: retryWindowStart,
        lte: triggerWindowEnd,
      },
      workspace: {
        members: {
          some: { userId: session.user.id },
        },
      },
    },
    select: {
      id: true,
      assetId: true,
      scheduledAt: true,
      status: true,
      asset: {
        select: {
          title: true,
        },
      },
      platform: {
        select: {
          slug: true,
        },
      },
    },
    orderBy: {
      scheduledAt: "asc",
    },
    take: 5,
  });

  const items = publications.flatMap((publication) =>
    publication.scheduledAt
      ? [
          {
            publicationId: publication.id,
            articleId: publication.assetId,
            title: publication.asset.title,
            platform: publication.platform.slug,
            scheduledAt: publication.scheduledAt.toISOString(),
            secondsUntilPublish: Math.round(
              (publication.scheduledAt.getTime() - now.getTime()) / 1000,
            ),
            status: publication.status,
          },
        ]
      : [],
  );

  console.log("[Scheduled Next] found due publications", {
    userId: session.user.id,
    now: now.toISOString(),
    count: items.length,
    publicationIds: items.map((item) => item.publicationId),
  });

  return NextResponse.json({ items });
}
