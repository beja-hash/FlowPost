import {
  getPlatformConfig,
  type PlatformSlug,
} from "@/infrastructure/platforms/platform-registry";
import { debugLog } from "@/lib/debug-log";
import type {
  PlatformEditorLaunchResult,
  PlatformEditorService,
} from "@/services/platforms/types";

type LaunchLogContext = {
  userId: string;
  platform: PlatformSlug;
  editorUrl: string;
};

function logPlatformEditor(
  step: string,
  context: Partial<LaunchLogContext> & Record<string, unknown> = {},
) {
  debugLog("[platform-editor]", {
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

      const logContext = {
        userId,
        platform: config.id,
        editorUrl: config.editorUrl,
      };

      logPlatformEditor("desktop-agent-required", logContext);
      const error = new Error(
        "Подключите FlowPost Agent, чтобы открыть браузер на вашем компьютере.",
      );
      logPlatformEditorError("server-browser-launch-disabled", error, logContext);
      throw error;
    },
  };
}
