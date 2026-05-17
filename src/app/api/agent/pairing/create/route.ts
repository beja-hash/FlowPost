import { NextResponse } from "next/server";

import { createPairingCodeForUser } from "@/features/agent/server/agent-service";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "UNAUTHORIZED",
          message: "Войдите в аккаунт, чтобы создать код подключения.",
        },
        {
          status: 401,
        },
      );
    }

    const pairing = await createPairingCodeForUser(session.user.id);

    return NextResponse.json({
      ok: true,
      code: pairing.code,
      expiresAt: pairing.expiresAt,
      pairing,
    });
  } catch (error) {
    console.error("[api/agent/pairing/create:error]", {
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    });

    if (isMissingAgentTableError(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "DATABASE_ERROR",
          message:
            "Сервис подключения Agent еще не подготовлен. Проверьте миграции базы данных.",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_ERROR",
        message:
          "Не удалось создать код подключения. Попробуйте еще раз или напишите в поддержку.",
      },
      {
        status: 500,
      },
    );
  }
}

function isMissingAgentTableError(error: unknown) {
  const maybeError = error as {
    code?: string;
    message?: string;
    meta?: {
      modelName?: string;
      table?: string;
    };
  };
  const message = maybeError.message ?? "";
  const table = maybeError.meta?.table ?? "";
  const modelName = maybeError.meta?.modelName ?? "";

  return (
    maybeError.code === "P2021" ||
    maybeError.code === "P2022" ||
    table.includes("Agent") ||
    modelName.includes("Agent") ||
    message.includes("AgentPairingCode") ||
    message.includes("does not exist")
  );
}
