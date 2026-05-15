import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/infrastructure/auth/auth-options";
import { debugLog } from "@/lib/debug-log";

export async function auth() {
  debugLog("[auth:session-helper] getServerSession start");
  const session = await getServerSession(authOptions);
  debugLog("[auth:session-helper] getServerSession complete", {
    hasUser: Boolean(session?.user?.id),
    userId: session?.user?.id,
  });
  return session;
}

export async function requireSession() {
  debugLog("[auth:requireSession] start");
  const session = await auth();

  if (!session?.user?.id) {
    debugLog("[auth:requireSession] redirect /sign-in");
    redirect("/sign-in");
  }

  debugLog("[auth:requireSession] accepted", { userId: session.user.id });
  return session;
}
