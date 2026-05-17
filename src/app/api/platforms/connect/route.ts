import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  AgentServiceError,
  createConnectPlatformJob,
} from "@/features/agent/server/agent-service";
import { auth } from "@/infrastructure/auth/session";
import {
  getPlatformConfig,
  platformSlugs,
} from "@/infrastructure/platforms/platform-registry";
import { debugLog, debugWarn } from "@/lib/debug-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const connectPlatformSchema = z.object({
  platform: z.enum(platformSlugs),
});

function toErrorResponse(error: unknown) {
  console.error("[api/platforms/connect:error]", {
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
          code: "INVALID_PLATFORM_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректные данные площадки.",
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
        message:
          "Для подключения браузера запустите FlowPost Agent на компьютере пользователя.",
      },
    },
    {
      status: 500,
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    debugLog("[api/platforms/connect]", {
      step: "request:start",
      runtime,
    });

    const session = await auth();

    if (!session?.user?.id) {
      debugWarn("[api/platforms/connect]", {
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

    const payload = connectPlatformSchema.parse(await request.json());

    debugLog("[api/platforms/connect]", {
      step: "payload:parsed",
      userId: session.user.id,
      platform: payload.platform,
    });

    const platformConfig = getPlatformConfig(payload.platform);
    const agent = await createConnectPlatformJob({
      userId: session.user.id,
      platform: payload.platform,
      sessionName: `FlowPost Agent: ${platformConfig?.name ?? payload.platform}`,
    });
    const apiUrl = request.nextUrl.origin;
    const command = `FLOWPOST_API_URL=${apiUrl} FLOWPOST_AGENT_TOKEN=${agent.token} npm run agent`;

    debugLog("[api/platforms/connect]", {
      step: "request:success",
      userId: session.user.id,
      platform: payload.platform,
    });

    return NextResponse.json({
      mode: "local_agent",
      message:
        "Для подключения браузера запустите FlowPost Agent на компьютере пользователя.",
      platform: platformConfig
        ? {
            id: platformConfig.slug,
            name: platformConfig.name,
            platform: platformConfig.slug,
            status: "not_connected",
          }
        : null,
      agent: {
        session: agent.session,
        token: agent.token,
        command,
      },
      job: agent.job,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
