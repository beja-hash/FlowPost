import { notFound } from "next/navigation";

import { ArticlePreviewPage } from "@/features/distribution/components/article-preview-page";
import { listDistributionAssetsByUser } from "@/features/distribution/server/distribution-service";
import { requireSession } from "@/infrastructure/auth/session";

type PreviewArticlePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PreviewArticlePage({
  params,
}: PreviewArticlePageProps) {
  const [{ id }, session] = await Promise.all([params, requireSession()]);
  const assets = await listDistributionAssetsByUser(session.user.id);
  const asset = assets.find((item) => item.id === id);

  if (!asset) {
    notFound();
  }

  return <ArticlePreviewPage asset={asset} />;
}
