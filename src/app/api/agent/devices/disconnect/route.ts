import { NextResponse } from "next/server";

import { disconnectAgentDevicesForUser } from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
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

    const result = await disconnectAgentDevicesForUser(session.user.id);

    return NextResponse.json(result);
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
