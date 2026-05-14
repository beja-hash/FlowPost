import { ZodError } from "zod";
import { NextRequest, NextResponse } from "next/server";

import {
  createStrategy,
  listStrategies,
  StrategyServiceError,
} from "@/features/strategies/server/strategy-service";
import { createStrategySchema } from "@/features/strategies/server/strategy-schemas";
import { requireSession } from "@/infrastructure/auth/session";

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
          code: "INVALID_STRATEGY_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректные данные стратегии.",
        },
      },
      { status: 400 },
    );
  }

  console.error("[api/strategies:error]", error);
  return NextResponse.json(
    {
      error: {
        code: "STRATEGY_REQUEST_FAILED",
        message: "Не удалось обработать запрос стратегии.",
      },
    },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const session = await requireSession();
    const strategies = await listStrategies(session.user.id);
    return NextResponse.json({ strategies });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const payload = createStrategySchema.parse(await request.json());
    const strategy = await createStrategy(session.user.id, payload);
    return NextResponse.json({ strategy }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
