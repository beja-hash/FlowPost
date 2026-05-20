import {
  AssetStatus,
  PublicationStatus,
  VariantStatus,
  type ArticleAsset,
} from "@prisma/client";

import type { ArticleContentBrief } from "@/features/distribution/types";
import { prisma } from "@/infrastructure/db/prisma";
import { debugLog } from "@/lib/debug-log";
import { generateArticle } from "@/services/article-generator";
import { ArticleWorkflowError } from "@/services/article-workflow-error";

const activeGenerations = new Map<string, Promise<ArticleAsset>>();

function logArticleStep(step: string, context: Record<string, unknown> = {}) {
  debugLog("[article-generation-workflow]", { step, ...context });
}

function logArticleError(
  step: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  console.error("[article-generation-workflow:error]", {
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
    throw new ArticleWorkflowError(404, "ARTICLE_NOT_FOUND", "Article not found.");
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

export async function generateArticleForUser(userId: string, articleId: string) {
  logArticleStep("generate:start", { userId, articleId });
  console.log("[article-generate] request received", { userId, articleId });

  const existingGeneration = activeGenerations.get(articleId);
  if (existingGeneration) {
    console.log("[article-generate] generation already running", {
      userId,
      articleId,
    });
    return existingGeneration;
  }

  const generation = generateArticleForUserOnce(userId, articleId).finally(() => {
    activeGenerations.delete(articleId);
  });
  activeGenerations.set(articleId, generation);
  return generation;
}

async function generateArticleForUserOnce(userId: string, articleId: string) {
  const { article, variant } = await getArticleForUser(userId, articleId);
  console.log("[article-generate] article found/created", {
    userId,
    articleId,
    variantId: variant.id,
    publicationId: article.publications[0]?.id ?? null,
  });
  let saved = false;

  try {
    console.log("[article-generate] llm started", { userId, articleId });
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
    console.log("[article-generate] llm completed", {
      userId,
      articleId,
      contentLength: generated.content.length,
    });

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
    saved = true;

    console.log("[article-generate] saved", {
      userId,
      articleId: updated.id,
      variantId: variant.id,
      publicationId: article.publications[0]?.id ?? null,
      contentLength: generated.content.length,
    });
    logArticleStep("generate:done", { userId, articleId });
    return updated;
  } catch (error) {
    logArticleError("generate:failed", error, { userId, articleId });
    if (!saved) {
      await markArticleFailed(article.id, "Generation failed.");
    }
    throw error;
  }
}

export async function scheduleArticleForUser(
  userId: string,
  articleId: string,
  publishAt: string,
) {
  const { article, variant, publication } = await getArticleForUser(userId, articleId);
  const scheduledAt = new Date(publishAt);

  if (Number.isNaN(scheduledAt.getTime())) {
    throw new ArticleWorkflowError(400, "INVALID_PUBLISH_AT", "Invalid publishAt.");
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
