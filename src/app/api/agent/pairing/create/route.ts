import { NextResponse } from "next/server";

import { createPairingCodeForUser } from "@/features/agent/server/agent-service";
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

    const pairing = await createPairingCodeForUser(session.user.id);

    return NextResponse.json({ pairing });
  } catch (error) {
    return toAgentErrorResponse(error);
  }
}
