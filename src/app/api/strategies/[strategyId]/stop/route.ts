import { ContentStrategyStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { setStrategyStatus } from "@/features/strategies/server/strategy-service";
import { strategyIdSchema } from "@/features/strategies/server/strategy-schemas";
import { requireSession } from "@/infrastructure/auth/session";

type RouteContext = {
  params: Promise<{ strategyId: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const session = await requireSession();
  const { strategyId: rawStrategyId } = await context.params;
  const strategyId = strategyIdSchema.parse(rawStrategyId);
  const strategy = await setStrategyStatus(
    session.user.id,
    strategyId,
    ContentStrategyStatus.STOPPED,
  );
  return NextResponse.json({ strategy });
}
