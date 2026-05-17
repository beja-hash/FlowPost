import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAgentSession } from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSessionSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
});

export async function POST(request: NextRequest) {
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

    const payload = createSessionSchema.parse(
      await request.json().catch(() => ({})),
    );
    const agentSession = await createAgentSession(
      session.user.id,
      payload.name,
    );

    return NextResponse.json(agentSession);
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
