import { notFound } from "next/navigation";

import { ArticleEditorPage } from "@/features/distribution/components/article-editor-page";
import { listBrandOptions } from "@/features/brands/server/brand-service";
import {
  listDistributionAssetsByUser,
  listPlatformOptions,
} from "@/features/distribution/server/distribution-service";
import { requireSession } from "@/infrastructure/auth/session";

type EditArticlePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditArticlePage({ params }: EditArticlePageProps) {
  const [{ id }, session] = await Promise.all([params, requireSession()]);
  const [assets, brands, platforms] = await Promise.all([
    listDistributionAssetsByUser(session.user.id),
    listBrandOptions(session.user.id),
    listPlatformOptions(),
  ]);
  const asset = assets.find((item) => item.id === id);

  if (!asset) {
    notFound();
  }

  return (
    <ArticleEditorPage
      mode="edit"
      asset={asset}
      brands={brands}
      platforms={platforms}
    />
  );
}
