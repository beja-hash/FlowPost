import { StrategyArticleTaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/infrastructure/db/prisma";
import { requireSession } from "@/infrastructure/auth/session";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const session = await requireSession();
  const { taskId } = await context.params;
  const task = await prisma.strategyArticleTask.findFirst({
    where: {
      id: taskId,
      strategy: {
        userId: session.user.id,
      },
    },
    select: { id: true },
  });

  if (!task) {
    return NextResponse.json(
      { error: { code: "TASK_NOT_FOUND", message: "Задача не найдена." } },
      { status: 404 },
    );
  }

  const updated = await prisma.strategyArticleTask.update({
    where: { id: task.id },
    data: {
      status: StrategyArticleTaskStatus.SKIPPED,
      error: "Пропущено вручную.",
    },
  });

  return NextResponse.json({ taskId: updated.id, status: updated.status });
}
