import NextAuth from "next-auth";

import { authOptions } from "@/infrastructure/auth/auth-options";

const handler = NextAuth(authOptions);

export async function GET(...args: Parameters<typeof handler>) {
  console.log("[auth:route] GET start");
  const response = await handler(...args);
  console.log("[auth:route] GET complete", { status: response.status });
  return response;
}

export async function POST(...args: Parameters<typeof handler>) {
  console.log("[auth:route] POST start");
  const response = await handler(...args);
  console.log("[auth:route] POST complete", { status: response.status });
  return response;
}
