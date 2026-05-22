import { NextRequest, NextResponse } from "next/server";

import {
  publicAgentDevice,
  recordAgentHeartbeat,
} from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}));
    const device = await recordAgentHeartbeat({
      authorization: request.headers.get("authorization"),
      appVersion:
        typeof payload?.appVersion === "string" ? payload.appVersion : null,
      platform: typeof payload?.platform === "string" ? payload.platform : null,
      capabilities: payload?.capabilities,
    });

    return NextResponse.json({
      ok: true,
      device: publicAgentDevice(device),
    });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
