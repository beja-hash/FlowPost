import type { PlatformSlug } from "@/infrastructure/platforms/platform-registry";
import { dzenPlatformService } from "@/services/platforms/dzen";
import type { PlatformEditorService } from "@/services/platforms/types";
import { vcPlatformService } from "@/services/platforms/vc";

const platformServices = {
  dzen: dzenPlatformService,
  vc: vcPlatformService,
} satisfies Record<PlatformSlug, PlatformEditorService>;

export function getPlatformEditorService(platform: PlatformSlug) {
  return platformServices[platform];
}
