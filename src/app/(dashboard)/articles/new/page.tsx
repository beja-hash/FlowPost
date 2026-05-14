import { ArticleEditorPage } from "@/features/distribution/components/article-editor-page";
import { listBrandOptions } from "@/features/brands/server/brand-service";
import { listPlatformOptions } from "@/features/distribution/server/distribution-service";
import { requireSession } from "@/infrastructure/auth/session";

export default async function NewArticlePage() {
  const session = await requireSession();
  const [brands, platforms] = await Promise.all([
    listBrandOptions(session.user.id),
    listPlatformOptions(),
  ]);

  return (
    <ArticleEditorPage mode="create" brands={brands} platforms={platforms} />
  );
}
