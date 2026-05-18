import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  AgentServiceError,
  createConnectPlatformJob,
} from "@/features/agent/server/agent-service";
import { auth } from "@/infrastructure/auth/session";
import { platformSlugs } from "@/infrastructure/platforms/platform-registry";
import { debugLog, debugWarn } from "@/lib/debug-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const launchPlatformSchema = z.object({
  platform: z.enum(platformSlugs),
});

function toErrorResponse(error: unknown) {
  console.error("[api/platforms/launch:error]", {
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
  });

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PLATFORM_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректные данные площадки.",
        },
      },
      {
        status: 400,
      },
    );
  }

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

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Не удалось запустить площадку.",
      },
    },
    {
      status: 500,
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    debugLog("[api/platforms/launch]", {
      step: "request:start",
      runtime,
    });

    const session = await auth();

    if (!session?.user?.id) {
      debugWarn("[api/platforms/launch]", {
        step: "auth:unauthorized",
      });

      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Требуется авторизация.",
          },
        },
        {
          status: 401,
        },
      );
    }

    const payload = launchPlatformSchema.parse(await request.json());

    debugLog("[api/platforms/launch]", {
      step: "payload:parsed",
      userId: session.user.id,
      platform: payload.platform,
    });

    const result = await createConnectPlatformJob({
      userId: session.user.id,
      platform: payload.platform,
    });

    debugLog("[api/platforms/launch]", {
      step: "agent-job:created",
      userId: session.user.id,
      platform: payload.platform,
      status: result.status,
      jobId: result.job?.id ?? null,
      agentDeviceId: result.agentDevice?.id ?? null,
    });

    return NextResponse.json({
      mode: "desktop_agent",
      ...result,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
