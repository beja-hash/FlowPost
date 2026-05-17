import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { appendAgentJobLog } from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logSchema = z.object({
  message: z.string().trim().min(1).max(5000),
  level: z.string().trim().min(1).max(24).optional(),
});

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const payload = logSchema.parse(await request.json());
    const log = await appendAgentJobLog({
      authorization: request.headers.get("authorization"),
      jobId,
      message: payload.message,
      level: payload.level,
    });

    return NextResponse.json({ log });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
