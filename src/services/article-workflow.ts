import {
  AssetStatus,
  PlatformAccountStatus,
  PublicationStatus,
  VariantStatus,
} from "@prisma/client";
import type { BrowserContext, BrowserType } from "playwright";

import type { ArticleContentBrief } from "@/features/distribution/types";
import { generateArticle } from "@/services/article-generator";
import { formatArticleForPlatform } from "@/services/article-formatting";
import { prisma } from "@/infrastructure/db/prisma";
import {
  getPlatformConfig,
  type PlatformSlug,
} from "@/infrastructure/platforms/platform-registry";
import { SessionManager } from "@/infrastructure/platforms/session-manager";
import { debugLog } from "@/lib/debug-log";
import { ArticleWorkflowError } from "@/services/article-workflow-error";

function isDzenNavigationDebugEnabled() {
  return process.env.DEBUG_DZEN_NAVIGATION_ONLY === "true";
}

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

async function importChromium() {
  let chromium: BrowserType;

  try {
    chromium = (await import("playwright")).chromium;
  } catch (error) {
    logArticleError("playwright:import-failed", error);
    throw new ArticleWorkflowError(
      500,
      "PLAYWRIGHT_NOT_INSTALLED",
      "Playwright is not installed. Run `npm install playwright` and `npx playwright install chromium`.",
    );
  }

  return chromium;
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

export async function publishArticleForUser(userId: string, articleId: string) {
  const { article, variant, publication } = await getArticleForUser(
    userId,
    articleId,
  );
  const platform = variant.platform;
  const platformConfig = getPlatformConfig(platform.slug);

  if (!platformConfig) {
    throw new ArticleWorkflowError(
      400,
      "UNSUPPORTED_PLATFORM",
      "Unsupported publication platform.",
    );
  }

  const platformSlug = platformConfig.id;
  const context = {
    userId,
    articleId,
    platform: platformSlug,
    profilePath: SessionManager.profilePath(userId, platformSlug),
  };

  logArticleStep("publish:start", context);
  logArticleStep("publish_started", context);

  const account = await prisma.platformAccount.findUnique({
    where: {
      userId_platform: {
        userId,
        platform: platform.slug,
      },
    },
  });

  if (account?.status !== PlatformAccountStatus.CONNECTED) {
    throw new ArticleWorkflowError(
      409,
      "PLATFORM_NOT_CONNECTED",
      "Platform is not connected.",
    );
  }

  if (!(await SessionManager.load(userId, platformSlug))) {
    throw new ArticleWorkflowError(
      404,
      "SESSION_NOT_FOUND",
      "Saved platform session was not found.",
    );
  }

  try {
    let publishedUrl: string | null = null;
    const preparedContent = formatArticleForPlatform(
      article.canonicalBody,
      platformSlug,
    );

    logArticleStep("publish:content-prepared", {
      ...context,
      originalLength: article.canonicalBody.length,
      preparedLength: preparedContent.length,
    });

    if (platformSlug === "dzen") {
      const { DzenPublisher } = await import("@/platforms/dzen/publisher");
      const publisher = new DzenPublisher();

      try {
        await publisher.open({ userId });
        await publisher.launch();
        await publisher.navigateToEditor();

        if (isDzenNavigationDebugEnabled()) {
          const editorUrl = publisher.getCurrentEditorUrl();

          logArticleStep("publish:dzen-debug-navigation:done", {
            ...context,
            editorUrl,
          });

          return {
            articleId: article.id,
            publishedUrl: editorUrl,
            debug: true,
          };
        }

        await publisher.fillTitle(article.title);
        await publisher.fillContent(preparedContent);
        await publisher.publish();
        publishedUrl = publisher.getPublishedUrl();
      } finally {
        await publisher.close();
      }
    } else if (platformSlug === "vc") {
      const { VcPublisher } = await import("@/platforms/vc/publisher");
      const publisher = new VcPublisher();

      try {
        await publisher.open({ userId });
        await publisher.launch();
        await publisher.navigateToEditor();
        await publisher.fillTitle(article.title);
        await publisher.fillContent(preparedContent);
        await publisher.publish();
        publishedUrl = publisher.getPublishedUrl();
      } finally {
        await publisher.close();
      }
    } else {
      publishedUrl = await publishWithPlaywright({
        userId,
        platform: platformSlug,
        title: article.title,
        content: preparedContent,
        cta: article.ctaText,
        link: article.ctaUrl,
      });
    }

    if (!publishedUrl) {
      throw new ArticleWorkflowError(
        500,
        "PUBLISHED_URL_MISSING",
        "Published URL was not captured.",
      );
    }

    await prisma.$transaction([
      prisma.articleAsset.update({
        where: { id: article.id },
        data: { status: AssetStatus.PUBLISHED },
      }),
      prisma.articleVariant.update({
        where: { id: variant.id },
        data: { status: VariantStatus.PUBLISHED },
      }),
      prisma.publication.update({
        where: { id: publication.id },
        data: {
          status: PublicationStatus.PUBLISHED,
          publishedAt: new Date(),
          externalUrl: publishedUrl,
          lastError: null,
        },
      }),
    ]);

    logArticleStep("published_url_saved", { ...context, publishedUrl });
    logArticleStep("publish:done", { ...context, publishedUrl });
    return { articleId: article.id, publishedUrl };
  } catch (error) {
    logArticleError("publish:failed", error, context);
    await markArticleFailed(
      article.id,
      error instanceof Error ? error.message : "Publish failed.",
    );
    throw error;
  }
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

type PublishPayload = {
  userId: string;
  platform: PlatformSlug;
  title: string;
  content: string;
  cta: string | null;
  link: string | null;
};

async function publishWithPlaywright(payload: PublishPayload) {
  const chromium = await importChromium();
  const platformConfig = getPlatformConfig(payload.platform);

  if (!platformConfig) {
    throw new ArticleWorkflowError(
      400,
      "UNSUPPORTED_PLATFORM",
      "Unsupported publication platform.",
    );
  }

  let context: BrowserContext | null = null;

  try {
    logArticleStep("publish:launch-persistent-context:start", {
      userId: payload.userId,
      platform: payload.platform,
    });
    context = await chromium.launchPersistentContext(
      SessionManager.profilePath(payload.userId, payload.platform),
      {
        headless: true,
        viewport: { width: 1440, height: 1100 },
      },
    );
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(platformConfig.editorUrl, {
      waitUntil: "domcontentloaded",
    });

    const body = [payload.content, payload.cta, payload.link]
      .filter(Boolean)
      .join("\n\n");

    await page
      .locator(
        'input[name="title"], textarea[name="title"], [contenteditable="true"]',
      )
      .first()
      .fill(payload.title, { timeout: 10000 });
    await page
      .locator('textarea, [contenteditable="true"]')
      .last()
      .fill(body, { timeout: 10000 });
    await page
      .getByRole("button", { name: /publish|опубликовать|разместить/i })
      .click({ timeout: 15000 });

    await page
      .waitForLoadState("domcontentloaded", { timeout: 30000 })
      .catch(() => undefined);

    return page.url();
  } finally {
    await context?.close();
  }
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

    await publishArticleForUser(userId, publication.assetId).catch(
      (error: unknown) => {
        logArticleError("scheduler:publish-failed", error, {
          articleId: publication.assetId,
        });
      },
    );
  }

  return { processed: due.length };
}
