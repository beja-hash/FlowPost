import { NextResponse } from "next/server";

import {
  getAgentConnectionState,
  listAgentDevices,
} from "@/features/agent/server/agent-service";
import { toAgentErrorResponse } from "@/features/agent/server/error-response";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

    const [devices, agent] = await Promise.all([
      listAgentDevices(session.user.id),
      getAgentConnectionState(session.user.id),
    ]);

    return NextResponse.json({ devices, agent });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
