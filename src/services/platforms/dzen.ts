import type {
  PlatformEditorLaunchResult,
  PlatformEditorService,
} from "@/services/platforms/types";

export const dzenPlatformService: PlatformEditorService = {
  async launchEditor(userId: string): Promise<PlatformEditorLaunchResult> {
    console.warn("[platform-editor] server-browser-launch-disabled", {
      userId,
      platform: "dzen",
    });
    throw new Error(
      "Подключите FlowPost Agent, чтобы открыть браузер на вашем компьютере.",
    );
  },
};
