import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AgentServiceError } from "@/features/agent/server/agent-service";

export function toAgentErrorResponse(error: unknown) {
  console.error("[api/agent:error]", {
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
  });

  if (error instanceof AgentServiceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      {
        status: error.statusCode,
      },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_AGENT_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректные данные агента.",
        },
      },
      {
        status: 400,
      },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Не удалось обработать запрос агента.",
      },
    },
    {
      status: 500,
    },
  );
}
