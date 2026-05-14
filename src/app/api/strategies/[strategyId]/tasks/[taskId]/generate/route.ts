import { NextRequest, NextResponse } from "next/server";

import {
  generateStrategyArticleTask,
  StrategyServiceError,
} from "@/features/strategies/server/strategy-service";
import { strategyIdSchema } from "@/features/strategies/server/strategy-schemas";
import { requireSession } from "@/infrastructure/auth/session";

type RouteContext = {
  params: Promise<{ strategyId: string; taskId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { strategyId: rawStrategyId, taskId } = await context.params;
    const strategyId = strategyIdSchema.parse(rawStrategyId);
    const result = await generateStrategyArticleTask(session.user.id, strategyId, taskId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StrategyServiceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("[api/strategies/task/generate:error]", error);
    return NextResponse.json(
      {
        error: {
          code: "STRATEGY_TASK_GENERATE_FAILED",
          message: "Не удалось сгенерировать статью по задаче.",
        },
      },
      { status: 500 },
    );
  }
}
