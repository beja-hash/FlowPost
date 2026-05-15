import NextAuth from "next-auth";

import { authOptions } from "@/infrastructure/auth/auth-options";
import { debugLog } from "@/lib/debug-log";

const handler = NextAuth(authOptions);

export async function GET(...args: Parameters<typeof handler>) {
  debugLog("[auth:route] GET start");
  const response = await handler(...args);
  debugLog("[auth:route] GET complete", { status: response.status });
  return response;
}

export async function POST(...args: Parameters<typeof handler>) {
  debugLog("[auth:route] POST start");
  const response = await handler(...args);
  debugLog("[auth:route] POST complete", { status: response.status });
  return response;
}
