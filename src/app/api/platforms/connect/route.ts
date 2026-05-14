import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  connectPlatform,
  PlatformServiceError,
} from "@/features/platforms/server/platform-service";
import { auth } from "@/infrastructure/auth/session";
import { platformSlugs } from "@/infrastructure/platforms/platform-registry";

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

  if (error instanceof PlatformServiceError) {
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
        message: "Не удалось подключить площадку.",
      },
    },
    {
      status: 500,
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    console.log("[api/platforms/connect]", {
      step: "request:start",
      runtime,
    });

    const session = await auth();

    if (!session?.user?.id) {
      console.warn("[api/platforms/connect]", {
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

    console.log("[api/platforms/connect]", {
      step: "payload:parsed",
      userId: session.user.id,
      platform: payload.platform,
    });

    const platform = await connectPlatform(session.user.id, payload.platform);

    console.log("[api/platforms/connect]", {
      step: "request:success",
      userId: session.user.id,
      platform: payload.platform,
    });

    return NextResponse.json({ platform });
  } catch (error) {
    return toErrorResponse(error);
  }
}
