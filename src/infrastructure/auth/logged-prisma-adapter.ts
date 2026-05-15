import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { PrismaAdapter } from "@next-auth/prisma-adapter";

import { prisma } from "@/infrastructure/db/prisma";
import { debugLog } from "@/lib/debug-log";

const AUTH_ADAPTER_TIMEOUT_MS = 10_000;

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      "then" in value,
  );
}

async function withAdapterLog<T>(method: string, action: () => T | Promise<T>) {
    debugLog(`[auth:adapter] ${method} start`);
  const startedAt = Date.now();

  try {
    const result = action();

    if (!isPromiseLike(result)) {
      debugLog(`[auth:adapter] ${method} done`, {
        elapsedMs: Date.now() - startedAt,
      });
      return result;
    }

    const resolved = await Promise.race([
      result,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `[auth:adapter] ${method} timed out after ${AUTH_ADAPTER_TIMEOUT_MS}ms`,
            ),
          );
        }, AUTH_ADAPTER_TIMEOUT_MS);
      }),
    ]);
    debugLog(`[auth:adapter] ${method} done`, {
      elapsedMs: Date.now() - startedAt,
    });
    return resolved;
  } catch (error) {
    console.error(`[auth:adapter] ${method} failed`, error);
    throw error;
  }
}

export function createLoggedPrismaAdapter(): Adapter {
  const adapter = PrismaAdapter(prisma);
  const safeAdapter: Adapter = {
    ...adapter,
    async getUser(id) {
      return prisma.user.findUnique({
        where: { id },
      });
    },
    async getUserByEmail(email) {
      return prisma.user.findUnique({
        where: { email },
      });
    },
    async getUserByAccount(provider_providerAccountId) {
      const account = await prisma.account.findUnique({
        where: { provider_providerAccountId },
        select: { userId: true },
      });

      if (!account) {
        return null;
      }

      return prisma.user.findUnique({
        where: { id: account.userId },
      });
    },
    async linkAccount(data: AdapterAccount) {
      return prisma.account.upsert({
        where: {
          provider_providerAccountId: {
            provider: data.provider,
            providerAccountId: data.providerAccountId,
          },
        },
        create: data,
        update: {
          userId: data.userId,
          type: data.type,
          refresh_token: data.refresh_token,
          access_token: data.access_token,
          expires_at: data.expires_at,
          token_type: data.token_type,
          scope: data.scope,
          id_token: data.id_token,
          session_state: data.session_state,
        },
      });
    },
  };

  return Object.fromEntries(
    Object.entries(safeAdapter).map(([method, handler]) => [
      method,
      (...args: unknown[]) =>
        withAdapterLog(method, () =>
          (handler as (...handlerArgs: unknown[]) => unknown)(...args),
        ),
    ]),
  ) as Adapter;
}
