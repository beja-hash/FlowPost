import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/infrastructure/auth/auth-options";

export async function auth() {
  console.log("[auth:session-helper] getServerSession start");
  const session = await getServerSession(authOptions);
  console.log("[auth:session-helper] getServerSession complete", {
    hasUser: Boolean(session?.user?.id),
    userId: session?.user?.id,
  });
  return session;
}

export async function requireSession() {
  console.log("[auth:requireSession] start");
  const session = await auth();

  if (!session?.user?.id) {
    console.log("[auth:requireSession] redirect /sign-in");
    redirect("/sign-in");
  }

  console.log("[auth:requireSession] accepted", { userId: session.user.id });
  return session;
}
