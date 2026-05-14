import { DzenPublisher } from "@/platforms/dzen/publisher";
import type {
  PlatformEditorLaunchResult,
  PlatformEditorService,
} from "@/services/platforms/types";

export const dzenPlatformService: PlatformEditorService = {
  async launchEditor(userId: string): Promise<PlatformEditorLaunchResult> {
    const publisher = new DzenPublisher();

    await publisher.open({ userId });
    await publisher.launch();
    await publisher.navigateToEditor();

    return {
      platform: "dzen",
      editorUrl: publisher.getCurrentEditorUrl() ?? "https://dzen.ru",
    };
  },
};
