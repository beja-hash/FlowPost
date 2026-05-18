import {
  AssetStatus,
  PublicationStatus,
  VariantStatus,
} from "@prisma/client";

import type { ArticleContentBrief } from "@/features/distribution/types";
import { generateArticle } from "@/services/article-generator";
import { prisma } from "@/infrastructure/db/prisma";
import { debugLog } from "@/lib/debug-log";
import { ArticleWorkflowError } from "@/services/article-workflow-error";

function logArticleStep(step: string, context: Record<string, unknown> = {}) {
  debugLog("[article-workflow]", { step, ...context });
}

function logArticleError(
  step: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  console.error("[article-workflow:error]", {
    step,
    ...context,
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getContentBrief(meta: unknown): ArticleContentBrief | null {
  if (!isRecord(meta) || !isRecord(meta.contentBrief)) {
    return null;
  }

  return meta.contentBrief as ArticleContentBrief;
}

async function getArticleForUser(userId: string, articleId: string) {
  const article = await prisma.articleAsset.findFirst({
    where: {
      id: articleId,
      workspace: {
        members: {
          some: { userId },
        },
      },
      status: {
        not: AssetStatus.ARCHIVED,
      },
    },
    include: {
      brand: true,
      variants: {
        include: {
          platform: true,
        },
        take: 1,
      },
      publications: {
        take: 1,
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!article) {
    throw new ArticleWorkflowError(
      404,
      "ARTICLE_NOT_FOUND",
      "Article not found.",
    );
  }

  const variant = article.variants[0];
  const publication = article.publications[0];

  if (!variant || !publication) {
    throw new ArticleWorkflowError(
      500,
      "ARTICLE_RELATIONS_MISSING",
      "Article is missing platform variant or publication.",
    );
  }

  return { article, variant, publication };
}

export async function generateArticleForUser(
  userId: string,
  articleId: string,
) {
  logArticleStep("generate:start", { userId, articleId });
  const { article, variant } = await getArticleForUser(userId, articleId);

  try {
    const generated = await generateArticle(
      {
        brand: article.brand,
        article: {
          title: article.title,
          primaryKeyword: article.primaryKeyword,
          summary: article.summary,
          ctaText: article.ctaText,
          ctaUrl: article.ctaUrl,
          intent: article.intent,
          platform: variant.platform.slug,
          contentBrief: getContentBrief(article.generationMeta),
        },
      },
      {
        onStep: (step) =>
          logArticleStep(`generate:${step}`, {
            userId,
            articleId,
          }),
      },
    );

    logArticleStep("generate:save:start", { userId, articleId });
    logArticleStep("generate:usage", {
      userId,
      articleId,
      model: generated.usage.model,
      input_tokens: generated.usage.inputTokens,
      output_tokens: generated.usage.outputTokens,
      estimated_cost: generated.usage.estimatedCost,
    });

    const updated = await prisma.articleAsset.update({
      where: { id: article.id },
      data: {
        title: generated.title,
        canonicalBody: generated.content,
        generationMeta: {
          provider: "polza",
          model: generated.usage.model,
          pipeline: ["strategy", "draft", "polish"],
          strategy: generated.strategy,
          qualityScore: generated.polished.qualityScore,
          polishChanged: generated.polished.changed,
          warnings: generated.warnings,
          detectedIssues: generated.polished.detectedIssues,
          platformFit: generated.polished.platformFit,
          qualityReport: generated.qualityReport,
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          totalTokens: generated.usage.totalTokens,
          estimatedCost: generated.usage.estimatedCost,
          generatedAt: new Date().toISOString(),
        },
        status: AssetStatus.READY,
        variants: {
          update: {
            where: { id: variant.id },
            data: {
              headline: generated.title,
              body: generated.content,
              status: VariantStatus.READY,
            },
          },
        },
      },
    });

    logArticleStep("generate:save:done", { userId, articleId });
    logArticleStep("generate:done", { userId, articleId });
    return updated;
  } catch (error) {
    logArticleError("generate:failed", error, { userId, articleId });
    await markArticleFailed(article.id, "Generation failed.");
    throw error;
  }
}

export async function scheduleArticleForUser(
  userId: string,
  articleId: string,
  publishAt: string,
) {
  const { article, variant, publication } = await getArticleForUser(
    userId,
    articleId,
  );
  const scheduledAt = new Date(publishAt);

  if (Number.isNaN(scheduledAt.getTime())) {
    throw new ArticleWorkflowError(
      400,
      "INVALID_PUBLISH_AT",
      "Invalid publishAt.",
    );
  }

  await prisma.$transaction([
    prisma.articleAsset.update({
      where: { id: article.id },
      data: { status: AssetStatus.READY },
    }),
    prisma.articleVariant.update({
      where: { id: variant.id },
      data: { status: VariantStatus.APPROVED },
    }),
    prisma.publication.update({
      where: { id: publication.id },
      data: {
        status: PublicationStatus.SCHEDULED,
        scheduledAt,
      },
    }),
  ]);

  return { articleId: article.id, publishAt: scheduledAt.toISOString() };
}

export async function publishArticleForUser(
  userId: string,
  articleId: string,
  options: { allowOfflineQueue?: boolean } = {},
) {
  logArticleStep("publish:desktop-agent-job:start", { userId, articleId });
  const { createPublishArticleJob } = await import(
    "@/features/agent/server/agent-service"
  );
  return createPublishArticleJob({
    userId,
    articleId,
    allowOfflineQueue: options.allowOfflineQueue,
  });
}

async function markArticleFailed(articleId: string, errorMessage: string) {
  await prisma.articleAsset.update({
    where: { id: articleId },
    data: {
      variants: {
        updateMany: {
          where: {},
          data: { status: VariantStatus.FAILED },
        },
      },
      publications: {
        updateMany: {
          where: {},
          data: {
            status: PublicationStatus.FAILED,
            lastError: errorMessage,
          },
        },
      },
    },
  });
}

export async function publishDueScheduledArticles() {
  const due = await prisma.publication.findMany({
    where: {
      status: PublicationStatus.SCHEDULED,
      scheduledAt: {
        lte: new Date(),
      },
    },
    include: {
      asset: true,
    },
  });

  for (const publication of due) {
    const userId = publication.asset.authorId;

    if (!userId) {
      await markArticleFailed(
        publication.assetId,
        "Article author is missing.",
      );
      continue;
    }

    await publishArticleForUser(userId, publication.assetId, {
      allowOfflineQueue: true,
    }).catch(
      (error: unknown) => {
        logArticleError("scheduler:publish-failed", error, {
          articleId: publication.assetId,
        });
      },
    );
  }

  return { processed: due.length };
}
