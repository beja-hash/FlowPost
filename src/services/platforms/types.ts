import type { PlatformSlug } from "@/infrastructure/platforms/platform-registry";

export type PlatformEditorLaunchResult = {
  platform: PlatformSlug;
  editorUrl: string;
};

export type PlatformEditorService = {
  launchEditor(userId: string): Promise<PlatformEditorLaunchResult>;
};
