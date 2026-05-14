import { NextRequest, NextResponse } from "next/server";

import {
  retryFailedPublishTask,
  StrategyServiceError,
} from "@/features/strategies/server/strategy-service";
import { requireSession } from "@/infrastructure/auth/session";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { taskId } = await context.params;
    const result = await retryFailedPublishTask(session.user.id, taskId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StrategyServiceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "AGENT_TASK_RETRY_FAILED",
          message: "Не удалось повторить публикацию.",
        },
      },
      { status: 500 },
    );
  }
}
