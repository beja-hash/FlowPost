import { NextRequest, NextResponse } from "next/server";

import {
  generateWeekArticles,
  StrategyServiceError,
} from "@/features/strategies/server/strategy-service";
import { strategyIdSchema } from "@/features/strategies/server/strategy-schemas";
import { requireSession } from "@/infrastructure/auth/session";

type RouteContext = {
  params: Promise<{ strategyId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { strategyId: rawStrategyId } = await context.params;
    const strategyId = strategyIdSchema.parse(rawStrategyId);
    const result = await generateWeekArticles(session.user.id, strategyId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StrategyServiceError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("[api/strategies/generate-week:error]", error);
    return NextResponse.json(
      {
        error: {
          code: "STRATEGY_GENERATE_WEEK_FAILED",
          message: "Не удалось сгенерировать неделю.",
        },
      },
      { status: 500 },
    );
  }
}
