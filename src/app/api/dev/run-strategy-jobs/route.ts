import { NextResponse } from "next/server";

import { runStrategyJobs } from "@/features/strategies/server/strategy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Endpoint недоступен." } },
      { status: 404 },
    );
  }

  const result = await runStrategyJobs();
  return NextResponse.json(result);
}
