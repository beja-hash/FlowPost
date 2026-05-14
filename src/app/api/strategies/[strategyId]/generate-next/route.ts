import { NextRequest, NextResponse } from "next/server";

import {
  generateNextStrategyArticles,
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
    const result = await generateNextStrategyArticles(session.user.id, strategyId, 24);
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
          code: "STRATEGY_GENERATE_NEXT_FAILED",
          message: "Не удалось сгенерировать ближайшие статьи.",
        },
      },
      { status: 500 },
    );
  }
}
