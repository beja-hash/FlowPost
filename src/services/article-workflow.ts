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
  const now = new Date();
  const triggerWindowEnd = new Date(now.getTime() + 30 * 1000);
  const retryWindowStart = new Date(now.getTime() - 2 * 60 * 1000);

  const expired = await prisma.publication.updateMany({
    where: {
      status: {
        in: [PublicationStatus.SCHEDULED, PublicationStatus.WAITING_AGENT],
      },
      scheduledAt: {
        lt: retryWindowStart,
      },
    },
    data: {
      status: PublicationStatus.FAILED,
      lockedAt: null,
      processingAt: null,
      lastError:
        "Планер не смог запустить agent. Проверьте, что FlowPost Agent установлен и доступен.",
    },
  });

  const due = await prisma.publication.findMany({
    where: {
      status: {
        in: [PublicationStatus.SCHEDULED, PublicationStatus.WAITING_AGENT],
      },
      scheduledAt: {
        lte: triggerWindowEnd,
        gt: retryWindowStart,
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

    const secondsUntilPublish = publication.scheduledAt
      ? Math.round((publication.scheduledAt.getTime() - now.getTime()) / 1000)
      : null;
    const triggerAt = publication.scheduledAt
      ? new Date(publication.scheduledAt.getTime() - 30 * 1000)
      : null;

    console.log("[Scheduler]", {
      event: "cron:candidate",
      now: now.toISOString(),
      plannedPublishAt: publication.scheduledAt?.toISOString() ?? null,
      secondsUntilPublish,
      triggerAt: triggerAt?.toISOString() ?? null,
      publicationId: publication.id,
      articleId: publication.assetId,
    });

    const { runPublicationJob } = await import(
      "@/features/agent/server/agent-service"
    );

    const result = await runPublicationJob({
      userId,
      publicationId: publication.id,
      mode: "scheduled",
      expectedStatuses: [
        PublicationStatus.SCHEDULED,
        PublicationStatus.WAITING_AGENT,
      ],
      now,
    }).catch(async (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Не удалось запустить agent для автопубликации.";
      await prisma.publication.update({
        where: { id: publication.id },
        data: {
          status: PublicationStatus.FAILED,
          lockedAt: null,
          processingAt: null,
          lastError: message,
        },
      });
        logArticleError("scheduler:publish-failed", error, {
          articleId: publication.assetId,
          publicationId: publication.id,
        });
      return null;
    });

    console.log("[Scheduler]", {
      event: "cron:trigger-result",
      publicationId: publication.id,
      result: result?.status ?? "failed",
      jobId: result?.job?.id ?? null,
    });
  }

  return { processed: due.length, expired: expired.count };
}
