import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  getCatchUpTasksForAgent,
  StrategyServiceError,
} from "@/features/strategies/server/strategy-service";
import { requireSession } from "@/infrastructure/auth/session";

const heartbeatSchema = z.object({
  deviceId: z.string().trim().min(1).max(120).optional(),
});

function toErrorResponse(error: unknown) {
  if (error instanceof StrategyServiceError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_AGENT_HEARTBEAT",
          message: error.issues[0]?.message ?? "Некорректный heartbeat агента.",
        },
      },
      { status: 400 },
    );
  }

  console.error("[api/agent/heartbeat:error]", error);
  return NextResponse.json(
    {
      error: {
        code: "AGENT_HEARTBEAT_FAILED",
        message: "Не удалось обработать heartbeat агента.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const payload = heartbeatSchema.parse(await request.json().catch(() => ({})));
    const result = await getCatchUpTasksForAgent(
      session.user.id,
      payload.deviceId ?? "local-browser",
    );

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
