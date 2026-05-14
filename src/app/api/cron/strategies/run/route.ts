import { NextRequest, NextResponse } from "next/server";

import { runStrategyJobs } from "@/features/strategies/server/strategy-service";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function authorizeCron(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.CRON_SECRET && token === env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Cron secret is invalid." } },
      { status: 401 },
    );
  }

  try {
    const result = await runStrategyJobs();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/cron/strategies/run:error]", error);
    return NextResponse.json(
      {
        error: {
          code: "STRATEGY_CRON_FAILED",
          message: "Не удалось запустить задачи автопилота.",
        },
      },
      { status: 500 },
    );
  }
}
