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

function getFailureMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message.trim() : "Article generation failed.";

  return message || "Article generation failed.";
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
  const totalTimer = `[ArticleGeneration:${articleId}] total`;
  const loadTimer = `[ArticleGeneration:${articleId}] load-data`;
  console.time(totalTimer);
  console.time(loadTimer);
  const { article, variant } = await getArticleForUser(userId, articleId);
  console.timeEnd(loadTimer);
  console.log("[article-generate] article found/created", {
    userId,
    articleId,
    variantId: variant.id,
    publicationId: article.publications[0]?.id ?? null,
  });
  let saved = false;

  try {
    const llmTimer = `[ArticleGeneration:${articleId}] llm-request`;
    console.time(llmTimer);
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
    console.timeEnd(llmTimer);
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

    const saveTimer = `[ArticleGeneration:${articleId}] save`;
    console.time(saveTimer);
    const updated = await prisma.articleAsset.update({
      where: { id: article.id },
      data: {
        title: generated.title,
        canonicalBody: generated.content,
        ctaText: generated.ctaText,
        ctaUrl: generated.ctaUrl,
        generationMeta: {
          provider: "polza",
          model: generated.usage.model,
          pipeline: ["single_llm_article", "cleanup", "product_block"],
          strategy: generated.strategy,
          qualityScore: generated.polished.qualityScore,
          polishChanged: generated.polished.changed,
          warnings: generated.warnings,
          detectedIssues: generated.polished.detectedIssues,
          platformFit: generated.polished.platformFit,
          qualityReport: generated.qualityReport,
          contentStorageFormat: "plain_text_with_cta_text",
          productBlockEnabled: true,
          linkHandling: {
            bodyContainsUrl: false,
            ctaText: generated.ctaText,
            ctaUrl: generated.ctaUrl,
          },
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
              callToAction: generated.ctaText,
              status: VariantStatus.READY,
            },
          },
        },
      },
    });
    saved = true;
    console.timeEnd(saveTimer);

    console.log("[article-generate] saved", {
      userId,
      articleId: updated.id,
      variantId: variant.id,
      publicationId: article.publications[0]?.id ?? null,
      contentLength: generated.content.length,
    });
    logArticleStep("generate:done", { userId, articleId });
    console.timeEnd(totalTimer);
    return updated;
  } catch (error) {
    console.timeEnd(totalTimer);
    logArticleError("generate:failed", error, { userId, articleId });
    if (!saved) {
      await markArticleFailed(article.id, getFailureMessage(error));
    }
    throw error;
  }
}

export async function scheduleArticleForUser(
  userId: string,
  articleId: string,
  publishAt: string,
  diagnostics: {
    selectedLocalTime?: string | null;
    browserTimezone?: string | null;
  } = {},
) {
  const { article, variant, publication } = await getArticleForUser(userId, articleId);
  const scheduledAt = new Date(publishAt);
  const serverNow = new Date();

  if (Number.isNaN(scheduledAt.getTime())) {
    throw new ArticleWorkflowError(400, "INVALID_PUBLISH_AT", "Invalid publishAt.");
  }

  if (scheduledAt.getTime() < serverNow.getTime()) {
    throw new ArticleWorkflowError(
      400,
      "PUBLISH_AT_IN_PAST",
      "Нельзя запланировать публикацию на прошедшее время.",
    );
  }

  if (scheduledAt.getTime() - serverNow.getTime() < 2 * 60 * 1000) {
    throw new ArticleWorkflowError(
      400,
      "PUBLISH_AT_TOO_SOON",
      "Слишком близкое время. Лучше выбрать минимум через 5 минут, чтобы агент успел обработать задачу.",
    );
  }

  console.log("[Scheduler] selected local time", {
    userId,
    articleId,
    publicationId: publication.id,
    selectedLocalTime: diagnostics.selectedLocalTime ?? publishAt,
    browserTimezone: diagnostics.browserTimezone ?? null,
  });
  console.log("[Scheduler] saved UTC time", {
    userId,
    articleId,
    publicationId: publication.id,
    savedUtcTime: scheduledAt.toISOString(),
  });
  console.log("[Scheduler] server now", {
    userId,
    articleId,
    publicationId: publication.id,
    serverNow: serverNow.toISOString(),
  });
  console.log("[Scheduler] due in seconds", {
    userId,
    articleId,
    publicationId: publication.id,
    dueInSeconds: Math.round((scheduledAt.getTime() - serverNow.getTime()) / 1000),
  });
  console.log("[Scheduler] status", {
    userId,
    articleId,
    publicationId: publication.id,
    status: PublicationStatus.SCHEDULED,
  });

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
