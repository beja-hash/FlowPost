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

type SafeGenerateInput = {
  articleId?: unknown;
};

function getErrorMessage(error: unknown, fallback = "Не удалось сгенерировать статью.") {
  return error instanceof Error ? error.message : fallback;
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

function getErrorCause(error: unknown) {
  if (!(error instanceof Error) || !("cause" in error)) {
    return undefined;
  }

  const cause = error.cause;
  return cause instanceof Error
    ? { name: cause.name, message: cause.message, stack: cause.stack }
    : cause;
}

function toErrorResponse(error: unknown, input: SafeGenerateInput = {}) {
  const details = getErrorMessage(error);
  const code =
    error instanceof ArticleWorkflowError
      ? error.code
      : error instanceof ZodError
        ? "INVALID_ARTICLE_GENERATE_PAYLOAD"
        : "ARTICLE_GENERATION_FAILED";
  const status =
    error instanceof ArticleWorkflowError
      ? error.statusCode
      : error instanceof ZodError
        ? 400
        : 500;

  console.error("[ArticleGeneration API] failed", {
    message: details,
    stack: getErrorStack(error),
    cause: getErrorCause(error),
    input,
  });

  return NextResponse.json(
    {
      ok: false,
      error: "Article generation failed",
      details:
        error instanceof ZodError
          ? (error.issues[0]?.message ?? "Некорректный запрос.")
          : details,
      code,
    },
    { status },
  );
}

export async function POST(request: NextRequest) {
  let safeInput: SafeGenerateInput = {};

  try {
    console.log("[article-generate] request received");
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "Article generation failed",
          details: "Требуется авторизация.",
          code: "UNAUTHORIZED",
        },
        { status: 401 },
      );
    }

    const rawPayload = (await request.json()) as unknown;
    safeInput =
      rawPayload && typeof rawPayload === "object"
        ? { articleId: (rawPayload as SafeGenerateInput).articleId }
        : {};
    const payload = generateSchema.parse(rawPayload);
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
    return toErrorResponse(error, safeInput);
  }
}
