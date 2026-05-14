import { BrandsManager } from "@/features/brands/components/brands-manager";
import { listBrandsByUser } from "@/features/brands/server/brand-service";
import { requireSession } from "@/infrastructure/auth/session";

export default async function BrandsPage() {
  const session = await requireSession();
  const { brands } = await listBrandsByUser(session.user.id);

  return <BrandsManager initialBrands={brands} />;
}
