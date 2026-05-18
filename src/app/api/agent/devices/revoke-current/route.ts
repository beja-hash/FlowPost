import { NextRequest, NextResponse } from "next/server";

import { revokeAuthenticatedAgent } from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const device = await revokeAuthenticatedAgent(
      request.headers.get("authorization"),
    );

    return NextResponse.json({ ok: true, device });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
