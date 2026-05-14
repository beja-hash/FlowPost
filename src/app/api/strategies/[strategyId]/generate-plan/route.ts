import { NextRequest, NextResponse } from "next/server";

import {
  generateStrategyPlan,
  StrategyServiceError,
} from "@/features/strategies/server/strategy-service";
import { strategyIdSchema } from "@/features/strategies/server/strategy-schemas";
import { requireSession } from "@/infrastructure/auth/session";

type RouteContext = {
  params: Promise<{ strategyId: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { strategyId: rawStrategyId } = await context.params;
    const strategyId = strategyIdSchema.parse(rawStrategyId);
    const result = await generateStrategyPlan(session.user.id, strategyId);
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
          code: "STRATEGY_PLAN_FAILED",
          message: "Не удалось сгенерировать план стратегии.",
        },
      },
      { status: 500 },
    );
  }
}
