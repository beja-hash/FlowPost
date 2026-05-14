import { spawn } from "node:child_process";

import {
  getPlatformConfig,
  type PlatformSlug,
} from "@/infrastructure/platforms/platform-registry";
import { SessionManager } from "@/infrastructure/platforms/session-manager";
import type {
  PlatformEditorLaunchResult,
  PlatformEditorService,
} from "@/services/platforms/types";

type LaunchLogContext = {
  userId: string;
  platform: PlatformSlug;
  profilePath: string;
  editorUrl: string;
};

function logPlatformEditor(
  step: string,
  context: Partial<LaunchLogContext> & Record<string, unknown> = {},
) {
  console.log("[platform-editor]", {
    step,
    ...context,
  });
}

function logPlatformEditorError(
  step: string,
  error: unknown,
  context: Partial<LaunchLogContext> & Record<string, unknown> = {},
) {
  console.error("[platform-editor:error]", {
    step,
    ...context,
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
  });
}

export function createUrlEditorService(
  platform: PlatformSlug,
): PlatformEditorService {
  return {
    async launchEditor(userId: string): Promise<PlatformEditorLaunchResult> {
      const config = getPlatformConfig(platform);

      if (!config) {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      const profilePath = SessionManager.profilePath(userId, config.id);
      const logContext = {
        userId,
        platform: config.id,
        profilePath,
        editorUrl: config.editorUrl,
      };

      logPlatformEditor("session_restore_started", logContext);

      try {
        const { chromium } = await import("playwright");
        const executablePath = chromium.executablePath();

        logPlatformEditor("browser_launch_started", logContext);
        const browserProcess = spawn(
          executablePath,
          [
            `--user-data-dir=${profilePath}`,
            "--start-maximized",
            config.editorUrl,
          ],
          {
            detached: true,
            stdio: "ignore",
          },
        );
        browserProcess.unref();
        logPlatformEditor("browser_launched", {
          ...logContext,
          executablePath,
          controlledByPlaywright: false,
        });
        logPlatformEditor("editor_opened", {
          ...logContext,
          currentUrl: config.editorUrl,
        });

        return {
          platform: config.id,
          editorUrl: config.editorUrl,
        };
      } catch (error) {
        logPlatformEditorError("editor_launch_failed", error, logContext);
        throw error;
      }
    },
  };
}
