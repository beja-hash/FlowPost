import { NextRequest, NextResponse } from "next/server";

import {
  authenticateAgent,
  publicAgentDevice,
} from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const device = await authenticateAgent(request.headers.get("authorization"));

    return NextResponse.json({
      ok: true,
      device: publicAgentDevice(device),
    });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
