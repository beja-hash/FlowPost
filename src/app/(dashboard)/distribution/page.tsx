import { listBrandOptions } from "@/features/brands/server/brand-service";
import { DistributionManager } from "@/features/distribution/components/distribution-manager";
import {
  listDistributionAssetsByUser,
  listPlatformOptions,
} from "@/features/distribution/server/distribution-service";
import { requireSession } from "@/infrastructure/auth/session";

export default async function DistributionPage() {
  const session = await requireSession();

  const [assets, brands, platforms] = await Promise.all([
    listDistributionAssetsByUser(session.user.id),
    listBrandOptions(session.user.id),
    listPlatformOptions(),
  ]);

  return (
    <DistributionManager
      initialAssets={assets}
      brandOptions={brands}
      platformOptions={platforms}
    />
  );
}
