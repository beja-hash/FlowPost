import { NextRequest, NextResponse } from "next/server";

import {
  runCatchUpPublishingForTask,
  StrategyServiceError,
} from "@/features/strategies/server/strategy-service";
import { requireSession } from "@/infrastructure/auth/session";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { taskId } = await context.params;
    const payload = (await _request.json().catch(() => ({}))) as {
      force?: boolean;
      agentWakeStartedAt?: string;
    };
    const result = await runCatchUpPublishingForTask(session.user.id, taskId, {
      ignoreCatchUpWindow: payload.force === true,
      agentWakeStartedAt: payload.agentWakeStartedAt,
    });
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
          code: "AGENT_TASK_PUBLISH_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Не удалось опубликовать задачу.",
        },
      },
      { status: 500 },
    );
  }
}
