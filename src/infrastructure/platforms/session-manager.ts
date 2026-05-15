import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PlatformConnection } from "@/features/platforms/types";
import { platformSlugs } from "@/infrastructure/platforms/platform-registry";

export type PlatformStorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{
      name: string;
      value: string;
    }>;
  }>;
};

const sessionsRoot = path.join(/* turbopackIgnore: true */ process.cwd(), "sessions");
const allowedPlatforms = new Set<PlatformConnection["platform"]>(platformSlugs);

function assertSafeUserId(userId: string) {
  if (!userId || userId.includes("/") || userId.includes("\\") || userId === "." || userId === "..") {
    throw new Error("Invalid user id.");
  }
}

function assertKnownPlatform(
  platform: PlatformConnection["platform"],
) {
  if (!allowedPlatforms.has(platform)) {
    throw new Error("Invalid platform.");
  }
}

function getSessionPath(userId: string, platform: PlatformConnection["platform"]) {
  assertSafeUserId(userId);
  assertKnownPlatform(platform);

  const sessionPath = path.join(sessionsRoot, userId, `${platform}.json`);
  const resolvedPath = path.resolve(sessionPath);
  const resolvedRoot = path.resolve(sessionsRoot);

  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Invalid session path.");
  }

  return sessionPath;
}

function getProfilePath(userId: string, platform: PlatformConnection["platform"]) {
  assertSafeUserId(userId);
  assertKnownPlatform(platform);

  const profilePath = path.join(sessionsRoot, userId, `${platform}-profile`);
  const resolvedPath = path.resolve(profilePath);
  const resolvedRoot = path.resolve(sessionsRoot);

  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Invalid profile path.");
  }

  return profilePath;
}

export const SessionManager = {
  path(userId: string, platform: PlatformConnection["platform"]) {
    return getSessionPath(userId, platform);
  },

  relativePath(userId: string, platform: PlatformConnection["platform"]) {
    assertSafeUserId(userId);
    assertKnownPlatform(platform);

    return `sessions/${userId}/${platform}.json`;
  },

  profilePath(userId: string, platform: PlatformConnection["platform"]) {
    return getProfilePath(userId, platform);
  },

  async ensureDirectory(userId: string, platform: PlatformConnection["platform"]) {
    const sessionPath = getSessionPath(userId, platform);

    await mkdir(path.dirname(sessionPath), { recursive: true });

    return path.dirname(sessionPath);
  },

  async save(
    userId: string,
    platform: PlatformConnection["platform"],
    storageState: PlatformStorageState,
  ) {
    const sessionPath = getSessionPath(userId, platform);

    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(sessionPath, JSON.stringify(storageState, null, 2), "utf8");

    return sessionPath;
  },

  async load(
    userId: string,
    platform: PlatformConnection["platform"],
  ): Promise<PlatformStorageState | null> {
    const sessionPath = getSessionPath(userId, platform);

    try {
      return JSON.parse(await readFile(sessionPath, "utf8")) as PlatformStorageState;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  },

  async remove(userId: string, platform: PlatformConnection["platform"]) {
    const sessionPath = getSessionPath(userId, platform);
    const profilePath = getProfilePath(userId, platform);

    try {
      await unlink(sessionPath);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        await rm(profilePath, { recursive: true, force: true });
        return;
      }

      throw error;
    }

    await rm(profilePath, { recursive: true, force: true });
  },
};
