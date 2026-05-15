import { PlatformsManager } from "@/features/platforms/components/platforms-manager";
import { listPlatformConnections } from "@/features/platforms/server/platform-query-service";
import { requireSession } from "@/infrastructure/auth/session";

export default async function PlatformsPage() {
  const session = await requireSession();
  const platforms = await listPlatformConnections(session.user.id);

  return <PlatformsManager initialPlatforms={platforms} />;
}
