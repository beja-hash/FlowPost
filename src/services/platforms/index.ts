import type { PlatformSlug } from "@/infrastructure/platforms/platform-registry";
import type { PlatformEditorService } from "@/services/platforms/types";

export async function getPlatformEditorService(
  platform: PlatformSlug,
): Promise<PlatformEditorService> {
  if (platform === "dzen") {
    return (await import("@/services/platforms/dzen")).dzenPlatformService;
  }

  return (await import("@/services/platforms/vc")).vcPlatformService;
}
