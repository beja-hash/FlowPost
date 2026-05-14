import { ZodError } from "zod";
import { NextRequest, NextResponse } from "next/server";

import {
  deleteStrategy,
  getStrategy,
  StrategyServiceError,
  updateStrategy,
} from "@/features/strategies/server/strategy-service";
import {
  strategyIdSchema,
  updateStrategySchema,
} from "@/features/strategies/server/strategy-schemas";
import { requireSession } from "@/infrastructure/auth/session";

type RouteContext = {
  params: Promise<{ strategyId: string }>;
};

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
          code: "INVALID_STRATEGY_REQUEST",
          message: error.issues[0]?.message ?? "Некорректный запрос стратегии.",
        },
      },
      { status: 400 },
    );
  }

  console.error("[api/strategies/id:error]", error);
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

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { strategyId: rawStrategyId } = await context.params;
    const strategyId = strategyIdSchema.parse(rawStrategyId);
    const strategy = await getStrategy(session.user.id, strategyId);
    return NextResponse.json({ strategy });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { strategyId: rawStrategyId } = await context.params;
    const strategyId = strategyIdSchema.parse(rawStrategyId);
    const payload = updateStrategySchema.parse(await request.json());
    const strategy = await updateStrategy(session.user.id, strategyId, payload);
    return NextResponse.json({ strategy });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { strategyId: rawStrategyId } = await context.params;
    const strategyId = strategyIdSchema.parse(rawStrategyId);
    const result = await deleteStrategy(session.user.id, strategyId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
