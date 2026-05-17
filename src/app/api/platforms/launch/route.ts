import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

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

    debugLog("[api/platforms/launch]", {
      step: "desktop-agent-required",
      userId: session.user.id,
      platform: payload.platform,
    });

    return NextResponse.json(
      {
        error: {
          code: "DESKTOP_AGENT_REQUIRED",
          message:
            "Для запуска браузера подключите FlowPost Agent на компьютере пользователя.",
        },
      },
      {
        status: 409,
      },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
