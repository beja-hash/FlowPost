import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { generateArticleForUser } from "@/services/article-generation-workflow";
import { ArticleWorkflowError } from "@/services/article-workflow-error";
import { getDistributionAssetByIdForUser } from "@/features/distribution/server/distribution-service";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const generateSchema = z.object({
  articleId: z.string().cuid(),
});

function toErrorResponse(error: unknown) {
  console.error("[api/articles/generate:error]", {
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
  });

  if (error instanceof ArticleWorkflowError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ARTICLE_GENERATE_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректный запрос.",
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "ARTICLE_GENERATION_FAILED",
        message:
          error instanceof Error ? error.message : "Не удалось сгенерировать статью.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    console.log("[article-generate] request received");
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Требуется авторизация." } },
        { status: 401 },
      );
    }

    const payload = generateSchema.parse(await request.json());
    console.log("[article-generate] article found/created", {
      userId: session.user.id,
      articleId: payload.articleId,
    });
    const article = await generateArticleForUser(session.user.id, payload.articleId);
    const asset = await getDistributionAssetByIdForUser(
      session.user.id,
      article.id,
    );
    const responseBody = {
      ok: true,
      articleId: asset.id,
      publicationId: asset.publicationId,
      variantId: asset.variantId,
      title: asset.title,
      content: asset.canonicalBody,
      status: "ready",
      article: {
        id: asset.id,
        title: asset.title,
        content: asset.canonicalBody,
        status: asset.status,
        updatedAt: asset.updatedAt,
      },
      asset,
      publication: {
        status: asset.publicationStatus,
        scheduledAt: asset.scheduledAt,
        publishedAt: asset.publishedAt,
        externalUrl: asset.externalUrl,
      },
      variant: {
        status: asset.variantStatus,
        platformId: asset.platformId,
        platformSlug: asset.platformSlug,
      },
    };

    console.log("[article-generate] response sent", {
      articleId: asset.id,
      contentLength: asset.canonicalBody.length,
    });
    return NextResponse.json(responseBody);
  } catch (error) {
    return toErrorResponse(error);
  }
}
