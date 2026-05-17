import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getAgentJobForUser,
  parseAgentJobStatus,
  updateAgentJobStatus,
} from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusSchema = z.object({
  status: z.string().min(1),
  result: z.unknown().optional(),
  error: z.string().nullable().optional(),
});

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Требуется авторизация.",
          },
        },
        {
          status: 401,
        },
      );
    }

    const { jobId } = await context.params;
    const job = await getAgentJobForUser(session.user.id, jobId);

    return NextResponse.json({ job });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const payload = statusSchema.parse(await request.json());
    const job = await updateAgentJobStatus({
      authorization: request.headers.get("authorization"),
      jobId,
      status: parseAgentJobStatus(payload.status),
      result: payload.result,
      error: payload.error,
    });

    return NextResponse.json({ job });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
