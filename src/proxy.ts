import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PROTECTED_PATHS = [
  "/dashboard",
  "/brands",
  "/distribution",
  "/analytics",
  "/settings",
  "/projects",
  "/content",
];

const AUTH_PATHS = ["/sign-in"];

function matchesPath(pathname: string, paths: string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  console.log("[auth:proxy] request", { pathname, search });
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  console.log("[auth:proxy] token check", {
    pathname,
    hasToken: Boolean(token),
    tokenSub: token?.sub,
  });

  if (matchesPath(pathname, AUTH_PATHS) && token) {
    console.log("[auth:proxy] redirect authenticated user to /dashboard");
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (matchesPath(pathname, PROTECTED_PATHS) && !token) {
    const callbackUrl = `${pathname}${search}`;
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", callbackUrl);

    console.log("[auth:proxy] redirect unauthenticated user to /sign-in", {
      callbackUrl,
    });
    return NextResponse.redirect(signInUrl);
  }

  console.log("[auth:proxy] continue", { pathname });
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/brands/:path*",
    "/distribution/:path*",
    "/projects/:path*",
    "/content/:path*",
    "/analytics/:path*",
    "/settings/:path*",
    "/sign-in",
  ],
};
