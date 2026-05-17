import { NextRequest, NextResponse } from "next/server";

import { getNextAgentJob } from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const job = await getNextAgentJob(request.headers.get("authorization"));

    return NextResponse.json({ job });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
