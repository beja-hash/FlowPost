import { NextRequest, NextResponse } from "next/server";

import { claimDueScheduledPublicationsForAgent } from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const result = await claimDueScheduledPublicationsForAgent(
      request.headers.get("authorization"),
    );

    return NextResponse.json(result);
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
