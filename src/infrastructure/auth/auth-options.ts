import type { NextAuthOptions } from "next-auth";
import { UserStatus } from "@prisma/client";
import GoogleProvider from "next-auth/providers/google";

import { createLoggedPrismaAdapter } from "@/infrastructure/auth/logged-prisma-adapter";
import { prisma } from "@/infrastructure/db/prisma";
import { debugLog, debugWarn } from "@/lib/debug-log";
import { env } from "@/lib/env";

const isProduction = env.NODE_ENV === "production";

export const authOptions: NextAuthOptions = {
  adapter: createLoggedPrismaAdapter(),
  debug: !isProduction,
  logger: {
    error(code, metadata) {
      console.error("[auth:logger:error]", code, metadata);
    },
    warn(code) {
      debugWarn("[auth:logger:warn]", { code });
    },
    debug(code, metadata) {
      debugLog("[auth:logger:debug]", { code, metadata });
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  pages: {
    signIn: "/sign-in",
  },
  useSecureCookies: isProduction,
  cookies: {
    sessionToken: {
      name: isProduction
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
    callbackUrl: {
      name: isProduction
        ? "__Secure-next-auth.callback-url"
        : "next-auth.callback-url",
      options: {
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
    csrfToken: {
      name: isProduction
        ? "__Host-next-auth.csrf-token"
        : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
  },
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  events: {
    async createUser({ user }) {
      debugLog("[auth:createUser] start", { userId: user.id, email: user.email });

      try {
        debugLog("[auth:createUser] before prisma.user.update");
        const dbUser = await prisma.user.update({
          where: { id: user.id },
          data: {
            status: UserStatus.ACTIVE,
          },
          select: {
            id: true,
            name: true,
            email: true,
            timezone: true,
          },
        });
        debugLog("[auth:createUser] after prisma.user.update", {
          userId: dbUser.id,
        });

        debugLog("[auth:createUser] workspace provisioning skipped during OAuth callback", {
          userId: dbUser.id,
        });
      } catch (error) {
        console.error("[auth:createUser] failed", error);
      }

      debugLog("[auth:createUser] done", { userId: user.id });
    },
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      debugLog("[auth:redirect] start", { url, baseUrl });

      const targetUrl = url.startsWith("/")
        ? new URL(url, baseUrl)
        : new URL(url);

      if (targetUrl.pathname === "/sign-in") {
        debugLog("[auth:redirect] prevent sign-in loop");
        return `${baseUrl}/dashboard`;
      }

      if (url.startsWith("/")) {
        const nextUrl = `${baseUrl}${url}`;
        debugLog("[auth:redirect] relative redirect", { nextUrl });
        return nextUrl;
      }

      if (url.startsWith(baseUrl)) {
        debugLog("[auth:redirect] same-origin redirect", { url });
        return url;
      }

      debugLog("[auth:redirect] fallback dashboard");
      return `${baseUrl}/dashboard`;
    },
    async signIn({ user, account, profile }) {
      debugLog("[auth:signIn] start", {
        userId: user.id,
        email: user.email,
        provider: account?.provider,
      });

      if (account?.provider === "google") {
        const googleProfile = profile as { email_verified?: boolean } | undefined;
        debugLog("[auth:signIn] google callback received", {
          emailVerified: googleProfile?.email_verified,
        });

        if (googleProfile?.email_verified === false) {
          debugLog("[auth:signIn] rejected: google email is not verified");
          return false;
        }
      }

      debugLog("[auth:signIn] minimal OAuth flow accepted");
      return true;
    },
    async jwt({ token, user }) {
      debugLog("[auth:jwt] start", {
        hasUser: Boolean(user),
        tokenSub: token.sub,
      });

      if (user) {
        token.id = user.id;
        token.status = user.status;
        debugLog("[auth:jwt] attached user data", {
          userId: user.id,
          status: user.status,
        });
      }

      if (!token.status) {
        token.status = UserStatus.ACTIVE;
      }

      debugLog("[auth:jwt] done", {
        tokenSub: token.sub,
        tokenId: token.id,
      });
      return token;
    },
    async session({ session, token }) {
      debugLog("[auth:session] start", {
        tokenSub: token.sub,
        tokenId: token.id,
      });

      if (session.user) {
        session.user.id =
          (typeof token.id === "string" ? token.id : token.sub) ?? "";
        session.user.status =
          typeof token.status === "string"
            ? (token.status as UserStatus)
            : UserStatus.ACTIVE;
      }

      debugLog("[auth:session] done", {
        sessionUserId: session.user?.id,
        sessionStatus: session.user?.status,
      });
      return session;
    },
  },
  secret: env.NEXTAUTH_SECRET,
};
