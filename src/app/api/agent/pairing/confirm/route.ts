import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { confirmPairingCode } from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmPairingSchema = z.object({
  code: z.string().trim().min(4).max(32),
  name: z.string().trim().min(1).max(160).optional(),
  platform: z.string().trim().min(1).max(80).optional(),
  appVersion: z.string().trim().min(1).max(40).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = confirmPairingSchema.parse(await request.json());
    const result = await confirmPairingCode(payload);

    return NextResponse.json(result);
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
