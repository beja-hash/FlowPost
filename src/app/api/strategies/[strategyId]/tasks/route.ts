import { NextRequest, NextResponse } from "next/server";

import { strategyIdSchema } from "@/features/strategies/server/strategy-schemas";
import { requireSession } from "@/infrastructure/auth/session";
import { prisma } from "@/infrastructure/db/prisma";

type RouteContext = {
  params: Promise<{ strategyId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await requireSession();
  const { strategyId: rawStrategyId } = await context.params;
  const strategyId = strategyIdSchema.parse(rawStrategyId);
  const platform = request.nextUrl.searchParams.get("platform");

  const tasks = await prisma.strategyArticleTask.findMany({
    where: {
      strategyId,
      ...(platform && platform !== "all" ? { platform } : {}),
      strategy: {
        workspace: {
          members: {
            some: { userId: session.user.id },
          },
        },
      },
    },
    include: {
      article: { select: { id: true, title: true, status: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 300,
  });

  return NextResponse.json({
    tasks: tasks.map((task) => ({
      id: task.id,
      platform: task.platform,
      scheduledAt: task.scheduledAt.toISOString(),
      status: task.status,
      topic: task.topic,
      title: task.title ?? task.article?.title ?? null,
      contentFormat: task.contentFormat,
      tone: task.tone,
      mainThesis: task.mainThesis,
      articleId: task.articleId,
      error: task.error,
      attempts: task.attempts,
    })),
  });
}
