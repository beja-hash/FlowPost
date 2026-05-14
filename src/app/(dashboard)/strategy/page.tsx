import { StrategyAutopilotPage } from "@/features/strategies/components/strategy-autopilot-page";
import { listBrandOptions } from "@/features/brands/server/brand-service";
import { listPlatformOptions } from "@/features/distribution/server/distribution-service";
import { listStrategies } from "@/features/strategies/server/strategy-service";
import { requireSession } from "@/infrastructure/auth/session";

export default async function StrategyPage() {
  const session = await requireSession();
  const [brands, platforms, strategies] = await Promise.all([
    listBrandOptions(session.user.id),
    listPlatformOptions(),
    listStrategies(session.user.id),
  ]);

  return (
    <StrategyAutopilotPage
      brands={brands}
      platforms={platforms}
      strategies={strategies}
    />
  );
}
