import {
  AssetStatus,
  ContentStrategyStatus,
  PlatformAccountStatus,
  Prisma,
  StrategyArticleTaskStatus,
  StrategyDistributionMode,
  StrategyPublishExecutionMode,
  StrategyPublishMode,
  TopicIntent,
} from "@prisma/client";
import { z } from "zod";

import type { ArticleContentBrief, ArticleTone, ContentFormat } from "@/features/distribution/types";
import { createDistributionAsset } from "@/features/distribution/server/distribution-service";
import {
  generateArticleForUser,
  scheduleArticleForUser,
} from "@/services/article-generation-workflow";
import { prisma } from "@/infrastructure/db/prisma";
import { getPlatformConfig } from "@/infrastructure/platforms/platform-registry";
import { SessionManager } from "@/infrastructure/platforms/session-manager";
import { requireWorkspaceForUser } from "@/features/workspaces/server/workspace-service";
import { generateText } from "@/lib/llm";
import { normalizeHttpUrl } from "@/lib/url";

import type { CreateStrategyInput, UpdateStrategyInput } from "./strategy-schemas";

export class StrategyServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StrategyServiceError";
  }
}

const contentFormats: ContentFormat[] = [
  "guide",
  "teardown",
  "mistakes",
  "comparison",
  "opinion",
  "checklist",
  "case_story",
  "myth_busting",
  "failure_story",
  "decision_guide",
];

const tones: ArticleTone[] = [
  "calm_expert",
  "direct",
  "practical",
  "analytical",
  "founder_style",
  "provocative_soft",
  "painful",
];

const briefSchema = z.object({
  topic: z.string().trim().min(4).max(240),
  keyword: z.string().trim().max(160).optional().default(""),
  targetAudience: z.string().trim().min(4).max(500),
  readerPain: z.string().trim().min(4).max(800),
  mainThesis: z.string().trim().min(4).max(800),
  factsExample: z.string().trim().min(4).max(10000),
  contentFormat: z.enum([
    "teardown",
    "case_story",
    "failure_story",
    "personal_experience",
    "comparison",
    "guide",
    "opinion",
    "myth_busting",
    "checklist",
    "mistakes",
    "trend_analysis",
    "decision_guide",
  ]),
  tone: z.enum([
    "calm_expert",
    "direct",
    "provocative_soft",
    "painful",
    "founder_style",
    "analytical",
    "practical",
  ]),
});

type StrategyPlatform = "vc" | "dzen";
type GeneratedStrategyBrief = z.infer<typeof briefSchema>;

export const STRATEGY_CATCH_UP_WINDOW_HOURS = Number(
  process.env.STRATEGY_CATCH_UP_WINDOW_HOURS ?? 72,
);
const MAX_PUBLISH_ATTEMPTS = 3;
const CLIENT_AGENT_MISSED_MESSAGE =
  "Компьютер клиента был недоступен. Публикация будет выполнена при следующем запуске.";
const CONNECTION_REQUIRED_MESSAGE =
  "Подключите браузер для VC.ru/Дзен, чтобы автопубликация могла работать.";

type StrategyWithBrand = Prisma.ContentStrategyGetPayload<{
  include: {
    brand: true;
  };
}>;

function devLog(step: string, context: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[content-strategy]", { step, ...context });
  }
}

function hoursSince(date: Date, now = new Date()) {
  return (now.getTime() - date.getTime()) / 3_600_000;
}

async function publishArticleWithBrowserSession(userId: string, articleId: string) {
  const { publishArticleForUser } = await import("@/services/article-workflow");
  return publishArticleForUser(userId, articleId);
}

function normalizeOptional(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeLink(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? normalizeHttpUrl(trimmed) : null;
}

function readStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readNumberArray(value: Prisma.JsonValue): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : [];
}

function readPlatformTimeSlots(value: Prisma.JsonValue | null | undefined) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    vc: Array.isArray(record.vc)
      ? record.vc.filter((item): item is string => typeof item === "string")
      : undefined,
    dzen: Array.isArray(record.dzen)
      ? record.dzen.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function platformDailyLimits(
  strategy: Pick<
    StrategyWithBrand,
    "platforms" | "articlesPerDay" | "vcPerDay" | "dzenPerDay" | "distributionMode"
  >,
) {
  const selected = readStringArray(strategy.platforms).filter(
    (platform): platform is StrategyPlatform => platform === "vc" || platform === "dzen",
  );
  const fallback = platformsForDay(strategy).reduce<Record<StrategyPlatform, number>>(
    (acc, platform) => {
      acc[platform] += 1;
      return acc;
    },
    { vc: 0, dzen: 0 },
  );

  return {
    vc: selected.includes("vc") ? Math.max(0, strategy.vcPerDay ?? fallback.vc) : 0,
    dzen: selected.includes("dzen") ? Math.max(0, strategy.dzenPerDay ?? fallback.dzen) : 0,
  };
}

function extractJsonPayload(text: string) {
  const normalized = text.trim();
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return normalized.slice(firstBrace, lastBrace + 1);
  }

  return normalized;
}

function parseBriefJson(text: string): GeneratedStrategyBrief {
  const payload = extractJsonPayload(text);
  const candidates = [
    payload,
    payload
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'"),
  ];

  for (const candidate of candidates) {
    try {
      return briefSchema.parse(JSON.parse(candidate));
    } catch {
      // Try the next recovery candidate.
    }
  }

  throw new StrategyServiceError(
    502,
    "STRATEGY_BRIEF_INVALID_JSON",
    "Модель вернула некорректный бриф для автопилота.",
  );
}

async function ensureStrategyAccess(userId: string, strategyId: string) {
  const strategy = await prisma.contentStrategy.findFirst({
    where: {
      id: strategyId,
      workspace: {
        members: {
          some: { userId },
        },
      },
    },
    include: { brand: true },
  });

  if (!strategy) {
    throw new StrategyServiceError(404, "STRATEGY_NOT_FOUND", "Стратегия не найдена.");
  }

  return strategy;
}

async function ensureBrandAccess(userId: string, brandId: string) {
  const brand = await prisma.brand.findFirst({
    where: {
      id: brandId,
      workspace: {
        members: {
          some: { userId },
        },
      },
    },
    select: { id: true, workspaceId: true },
  });

  if (!brand) {
    throw new StrategyServiceError(404, "BRAND_NOT_FOUND", "Бренд не найден.");
  }

  return brand;
}

function toData(input: CreateStrategyInput | UpdateStrategyInput) {
  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
    ...(input.platforms !== undefined
      ? { platforms: input.platforms as Prisma.InputJsonValue }
      : {}),
    ...(input.articlesPerDay !== undefined
      ? { articlesPerDay: input.articlesPerDay }
      : {}),
    ...(input.distributionMode !== undefined
      ? { distributionMode: input.distributionMode }
      : {}),
    ...(input.vcPerDay !== undefined ? { vcPerDay: input.vcPerDay } : {}),
    ...(input.dzenPerDay !== undefined ? { dzenPerDay: input.dzenPerDay } : {}),
    ...(input.timeSlots !== undefined
      ? { timeSlots: input.timeSlots as Prisma.InputJsonValue }
      : {}),
    ...(input.platformTimeSlots !== undefined
      ? {
          platformTimeSlots: input.platformTimeSlots
            ? (input.platformTimeSlots as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        }
      : {}),
    ...(input.daysOfWeek !== undefined
      ? { daysOfWeek: input.daysOfWeek as Prisma.InputJsonValue }
      : {}),
    ...(input.startDate !== undefined ? { startDate: new Date(input.startDate) } : {}),
    ...(input.endDate !== undefined ? { endDate: new Date(input.endDate) } : {}),
    ...(input.generationMode !== undefined
      ? { generationMode: input.generationMode }
      : {}),
    ...(input.publishMode !== undefined ? { publishMode: input.publishMode } : {}),
    ...(input.cta !== undefined ? { cta: normalizeOptional(input.cta) } : {}),
    ...(input.link !== undefined ? { link: normalizeLink(input.link) } : {}),
    ...(input.goal !== undefined ? { goal: normalizeOptional(input.goal) } : {}),
    ...(input.topicDirections !== undefined
      ? { topicDirections: normalizeOptional(input.topicDirections) }
      : {}),
    ...(input.forbiddenTopics !== undefined
      ? { forbiddenTopics: normalizeOptional(input.forbiddenTopics) }
      : {}),
  };
}

export async function listStrategies(userId: string) {
  const workspace = await requireWorkspaceForUser(userId);
  const strategies = await prisma.contentStrategy.findMany({
    where: { workspaceId: workspace.id },
    include: {
      brand: { select: { id: true, name: true } },
      tasks: {
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          platform: true,
          topic: true,
          title: true,
          contentFormat: true,
          tone: true,
          mainThesis: true,
          error: true,
          articleId: true,
          attempts: true,
          article: {
            select: { id: true, title: true, status: true },
          },
        },
        orderBy: { scheduledAt: "asc" },
        take: 300,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return strategies.map((strategy) => mapStrategy(strategy));
}

export async function getStrategy(userId: string, strategyId: string) {
  const strategy = await prisma.contentStrategy.findFirst({
    where: {
      id: strategyId,
      workspace: { members: { some: { userId } } },
    },
    include: {
      brand: { select: { id: true, name: true } },
      tasks: {
        include: {
          article: {
            select: { id: true, title: true, status: true },
          },
        },
        orderBy: { scheduledAt: "asc" },
        take: 200,
      },
    },
  });

  if (!strategy) {
    throw new StrategyServiceError(404, "STRATEGY_NOT_FOUND", "Стратегия не найдена.");
  }

  return mapStrategy(strategy);
}

export async function createStrategy(userId: string, input: CreateStrategyInput) {
  const workspace = await requireWorkspaceForUser(userId);
  const brand = await ensureBrandAccess(userId, input.brandId);

  if (brand.workspaceId !== workspace.id) {
    throw new StrategyServiceError(403, "BRAND_WORKSPACE_MISMATCH", "Бренд недоступен.");
  }

  const strategy = await prisma.contentStrategy.create({
    data: {
      workspaceId: workspace.id,
      userId,
      status: input.status ?? ContentStrategyStatus.DRAFT,
      brandId: input.brandId,
      name: input.name.trim(),
      platforms: input.platforms as Prisma.InputJsonValue,
      articlesPerDay: input.articlesPerDay,
      distributionMode: input.distributionMode,
      vcPerDay: input.vcPerDay ?? null,
      dzenPerDay: input.dzenPerDay ?? null,
      timeSlots: input.timeSlots as Prisma.InputJsonValue,
      platformTimeSlots: input.platformTimeSlots
        ? (input.platformTimeSlots as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      daysOfWeek: input.daysOfWeek as Prisma.InputJsonValue,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      generationMode: input.generationMode,
      publishMode: input.publishMode,
      cta: normalizeOptional(input.cta),
      link: normalizeLink(input.link),
      goal: normalizeOptional(input.goal),
      topicDirections: normalizeOptional(input.topicDirections),
      forbiddenTopics: normalizeOptional(input.forbiddenTopics),
    },
    include: {
      brand: { select: { id: true, name: true } },
      tasks: true,
    },
  });

  devLog("strategy:create", { strategyId: strategy.id, brandId: strategy.brandId });
  return mapStrategy(strategy);
}

export async function updateStrategy(
  userId: string,
  strategyId: string,
  input: UpdateStrategyInput,
) {
  await ensureStrategyAccess(userId, strategyId);
  if (input.brandId) {
    await ensureBrandAccess(userId, input.brandId);
  }

  const strategy = await prisma.contentStrategy.update({
    where: { id: strategyId },
    data: {
      ...toData(input),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    include: {
      brand: { select: { id: true, name: true } },
      tasks: true,
    },
  });

  return mapStrategy(strategy);
}

export async function deleteStrategy(userId: string, strategyId: string) {
  await ensureStrategyAccess(userId, strategyId);
  await prisma.contentStrategy.delete({ where: { id: strategyId } });
  return { success: true };
}

export async function setStrategyStatus(
  userId: string,
  strategyId: string,
  status: ContentStrategyStatus,
) {
  return updateStrategy(userId, strategyId, { status });
}

function weekdayKey(date: Date) {
  return date.getDay();
}

function dateAtSlot(date: Date, slot: string) {
  const [hours = "0", minutes = "0"] = slot.split(":");
  const next = new Date(date);
  next.setHours(Number(hours), Number(minutes), 0, 0);
  return next;
}

function platformsForDay(strategy: Pick<StrategyWithBrand, "platforms" | "articlesPerDay" | "distributionMode" | "vcPerDay" | "dzenPerDay">) {
  const selected = readStringArray(strategy.platforms).filter(
    (platform): platform is StrategyPlatform => platform === "vc" || platform === "dzen",
  );

  if (selected.length === 1) {
    return Array.from({ length: strategy.articlesPerDay }, () => selected[0]);
  }

  if (strategy.distributionMode === StrategyDistributionMode.CUSTOM) {
    return [
      ...Array.from({ length: strategy.vcPerDay ?? 0 }, () => "vc" as const),
      ...Array.from({ length: strategy.dzenPerDay ?? 0 }, () => "dzen" as const),
    ].slice(0, strategy.articlesPerDay);
  }

  const dzenCount =
    strategy.distributionMode === StrategyDistributionMode.MORE_DZEN
      ? Math.ceil((strategy.articlesPerDay * 2) / 3)
      : strategy.distributionMode === StrategyDistributionMode.MORE_VC
        ? Math.floor(strategy.articlesPerDay / 3)
        : Math.floor(strategy.articlesPerDay / 2);
  const vcCount = strategy.articlesPerDay - dzenCount;

  return [
    ...Array.from({ length: vcCount }, () => "vc" as const),
    ...Array.from({ length: dzenCount }, () => "dzen" as const),
  ];
}

export function distributePlatformTasksAcrossTimeSlots(
  strategy: Pick<
    StrategyWithBrand,
    | "platforms"
    | "articlesPerDay"
    | "distributionMode"
    | "vcPerDay"
    | "dzenPerDay"
    | "timeSlots"
    | "platformTimeSlots"
  >,
  date: Date,
) {
  const limits = platformDailyLimits(strategy);
  const commonSlots = readStringArray(strategy.timeSlots);
  const platformSlots = readPlatformTimeSlots(strategy.platformTimeSlots);
  const selected = (["dzen", "vc"] as StrategyPlatform[]).filter(
    (platform) => limits[platform] > 0,
  );
  const usedByPlatform = new Map<string, number>();

  return selected.flatMap((platform) => {
    const specificSlots = platformSlots[platform]?.length
      ? platformSlots[platform]
      : null;
    const count = limits[platform];

    return Array.from({ length: count }, (_, index) => {
      const slots = specificSlots ?? commonSlots;
      const slot = slots[index % slots.length] ?? "12:00";
      const scheduledAt = dateAtSlot(date, slot);
      const key = `${platform}:${scheduledAt.toISOString().slice(0, 16)}`;
      const collisions = usedByPlatform.get(key) ?? 0;
      usedByPlatform.set(key, collisions + 1);

      if (collisions > 0) {
        scheduledAt.setMinutes(scheduledAt.getMinutes() + collisions * 5);
      }

      return {
        strategyId: "",
        brandId: "",
        platform,
        scheduledAt,
      };
    });
  });
}

export async function createWeeklyStrategySchedule(
  userId: string,
  strategyId: string,
  options: { startDate?: Date; days?: number } = {},
) {
  const strategy = await ensureStrategyAccess(userId, strategyId);
  const daysOfWeek = readNumberArray(strategy.daysOfWeek);
  const start = new Date(options.startDate ?? new Date());
  start.setHours(0, 0, 0, 0);
  const days = options.days ?? 7;
  const end = new Date(start);
  end.setDate(start.getDate() + days - 1);
  end.setHours(23, 59, 59, 999);
  const tasks: Array<{
    strategyId: string;
    brandId: string;
    platform: string;
    scheduledAt: Date;
  }> = [];

  for (let index = 0; index < days; index += 1) {
    const cursor = new Date(start);
    cursor.setDate(start.getDate() + index);

    if (cursor < strategy.startDate || cursor > strategy.endDate) {
      continue;
    }

    if (!daysOfWeek.includes(weekdayKey(cursor))) {
      continue;
    }

    distributePlatformTasksAcrossTimeSlots(strategy, cursor).forEach((item) => {
      tasks.push({
        strategyId: strategy.id,
        brandId: strategy.brandId,
        platform: item.platform,
        scheduledAt: item.scheduledAt,
      });
    });
  }

  const existing = await prisma.strategyArticleTask.findMany({
    where: {
      strategyId,
      scheduledAt: { gte: start, lte: end },
    },
    select: { platform: true, scheduledAt: true },
  });
  const existingKeys = new Set(
    existing.map((task) => `${task.platform}:${task.scheduledAt.toISOString()}`),
  );

  let created = 0;
  for (const task of tasks) {
    const key = `${task.platform}:${task.scheduledAt.toISOString()}`;
    if (existingKeys.has(key)) {
      continue;
    }

    const result = await prisma.strategyArticleTask.upsert({
      where: {
        strategyId_platform_scheduledAt: {
          strategyId: task.strategyId,
          platform: task.platform,
          scheduledAt: task.scheduledAt,
        },
      },
      update: {},
      create: task,
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created += 1;
      existingKeys.add(key);
    }
  }

  devLog("plan:week", {
    strategyId,
    brandId: strategy.brandId,
    days,
    planned: tasks.length,
    created,
    skippedDuplicates: tasks.length - created,
  });
  return { planned: tasks.length, created, skippedDuplicates: tasks.length - created };
}

export async function generateStrategyPlan(userId: string, strategyId: string) {
  const strategy = await ensureStrategyAccess(userId, strategyId);
  const days = Math.max(
    1,
    Math.ceil((strategy.endDate.getTime() - strategy.startDate.getTime()) / 86_400_000),
  );

  return createWeeklyStrategySchedule(userId, strategyId, {
    startDate: strategy.startDate,
    days,
  });
}

export async function buildArticleUniquenessContext(
  strategyId: string,
  brandId: string,
  platform: string,
) {
  const recentTasks = await prisma.strategyArticleTask.findMany({
    where: {
      strategyId,
      brandId,
      platform,
      OR: [{ topic: { not: null } }, { title: { not: null } }, { brief: { not: Prisma.JsonNull } }],
    },
    select: {
      topic: true,
      title: true,
      contentFormat: true,
      tone: true,
      mainThesis: true,
      brief: true,
      article: { select: { title: true } },
    },
    orderBy: { scheduledAt: "desc" },
    take: 90,
  });

  const titles = new Set<string>();
  const topics = new Set<string>();
  const angles = new Set<string>();
  const formats = new Set<string>();
  const theses = new Set<string>();

  for (const task of recentTasks) {
    const brief = task.brief && typeof task.brief === "object" && !Array.isArray(task.brief)
      ? (task.brief as Record<string, unknown>)
      : {};
    const title = task.title ?? task.article?.title;
    const topic = task.topic ?? (typeof brief.topic === "string" ? brief.topic : null);
    const format = task.contentFormat ?? (typeof brief.contentFormat === "string" ? brief.contentFormat : null);
    const thesis = task.mainThesis ?? (typeof brief.mainThesis === "string" ? brief.mainThesis : null);
    const angle = typeof brief.angle === "string" ? brief.angle : null;

    if (title) titles.add(title);
    if (topic) topics.add(topic);
    if (angle) angles.add(angle);
    if (format) formats.add(format);
    if (thesis) theses.add(thesis);
  }

  const recentTitles = Array.from(titles).slice(0, 30);
  const recentTopics = Array.from(topics).slice(0, 30);

  return {
    recentTitles,
    recentTopics,
    recentAngles: Array.from(angles).slice(0, 30),
    recentFormats: Array.from(formats).slice(0, 20),
    recentTheses: Array.from(theses).slice(0, 30),
    forbiddenRepeats: [...recentTitles.slice(0, 12), ...recentTopics.slice(0, 12)],
  };
}

export function groupStrategyTasksByPlatformAndDay<
  T extends { platform: string; scheduledAt: Date | string },
>(tasks: T[]) {
  return tasks.reduce<Record<string, Record<string, T[]>>>((acc, task) => {
    const platform = task.platform;
    const scheduledAt =
      task.scheduledAt instanceof Date ? task.scheduledAt : new Date(task.scheduledAt);
    const day = scheduledAt.toISOString().slice(0, 10);

    acc[platform] ??= {};
    acc[platform][day] = [...(acc[platform][day] ?? []), task];
    return acc;
  }, {});
}

export async function generateStrategyArticleTask(
  userId: string,
  strategyId: string,
  taskId: string,
) {
  const strategy = await ensureStrategyAccess(userId, strategyId);
  const task = await prisma.strategyArticleTask.findFirst({
    where: { id: taskId, strategyId },
  });

  if (!task) {
    throw new StrategyServiceError(404, "TASK_NOT_FOUND", "Задача не найдена.");
  }

  if (task.articleId) {
    return { taskId: task.id, articleId: task.articleId, status: task.status, generated: false };
  }

  return generateSingleStrategyTask(userId, strategy, task);
}

async function generateTaskBrief(
  strategy: StrategyWithBrand,
  task: { id: string; platform: string; scheduledAt: Date },
): Promise<GeneratedStrategyBrief> {
  const uniqueness = await buildArticleUniquenessContext(
    strategy.id,
    strategy.brandId,
    task.platform,
  );

  const format =
    contentFormats[
      Math.abs(task.scheduledAt.getDate() + task.scheduledAt.getHours()) %
        contentFormats.length
    ];
  const tone =
    tones[
      Math.abs(task.scheduledAt.getDay() + task.scheduledAt.getHours()) %
        tones.length
    ];

  const result = await generateText([
    {
      role: "system",
      content:
        "Ты редактор контент-автопилота. Верни строго JSON без markdown. Пиши на русском. Не выдумывай реальные кейсы, клиентов, метрики и гарантии. Если нужны факты, используй 'условный пример', 'типичная ситуация', 'например'. Используй только VC.ru и Дзен.",
    },
    {
      role: "user",
      content: `Сгенерируй brief для одной статьи автопилота.

Бренд:
${JSON.stringify(
  {
    name: strategy.brand.name,
    siteUrl: strategy.brand.siteUrl,
    description: strategy.brand.description,
    industry: strategy.brand.industry,
    targetAudience: strategy.brand.targetAudience,
    primaryCta: strategy.brand.primaryCta,
  },
  null,
  2,
)}

Стратегия:
${JSON.stringify(
  {
    platform: task.platform,
    goal: strategy.goal,
    topicDirections: strategy.topicDirections,
    forbiddenTopics: strategy.forbiddenTopics,
    cta: strategy.cta,
    link: strategy.link,
    suggestedContentFormat: format,
    suggestedTone: tone,
    uniqueness,
  },
  null,
  2,
)}

Правила:
- тема не должна повторять уже созданные темы и заголовки;
- не повторяй recentTitles, recentTopics, recentAngles и recentTheses из uniqueness;
- если тема похожа на прошлую — измени угол подачи, формат, тезис или аудиторию;
- чередуй боль, формат и угол подачи;
- не ставь один и тот же contentFormat слишком часто подряд;
- brief должен подходить для normalizeArticleBrief → strategy → draft → polish → qualityCheck;
- не добавляй Medium, Habr, Spark, Rusbase, Cossa, RBK;
- contentFormat выбери из: ${contentFormats.join(", ")};
- tone выбери из: ${tones.join(", ")}.

Верни JSON:
{
  "topic": "...",
  "keyword": "...",
  "targetAudience": "...",
  "readerPain": "...",
  "mainThesis": "...",
  "factsExample": "...",
  "contentFormat": "${format}",
  "tone": "${tone}"
}`,
    },
  ]);

  return parseBriefJson(result.text);
}

async function ensurePlatformBySlug(platform: string) {
  const config = getPlatformConfig(platform as StrategyPlatform);
  if (!config) {
    throw new StrategyServiceError(400, "UNSUPPORTED_PLATFORM", "Площадка не поддерживается.");
  }

  const record = await prisma.distributionPlatform.findFirst({
    where: { slug: platform, isActive: true },
    select: { id: true },
  });

  if (!record) {
    throw new StrategyServiceError(404, "PLATFORM_NOT_FOUND", "Площадка не найдена.");
  }

  return record;
}

async function generateSingleStrategyTask(
  userId: string,
  strategy: StrategyWithBrand,
  task: Prisma.StrategyArticleTaskGetPayload<object>,
) {
  if (task.articleId) {
    return { taskId: task.id, articleId: task.articleId, status: task.status, generated: false };
  }

  devLog("task:generate:start", {
    strategyId: strategy.id,
    taskId: task.id,
    brandId: task.brandId,
    platform: task.platform,
    scheduledAt: task.scheduledAt,
  });

  const brief = task.brief ? briefSchema.parse(task.brief) : await generateTaskBrief(strategy, task);
  const platform = await ensurePlatformBySlug(task.platform);
  await prisma.strategyArticleTask.update({
    where: { id: task.id },
    data: {
      brief: brief as Prisma.InputJsonValue,
      topic: brief.topic,
      contentFormat: brief.contentFormat,
      tone: brief.tone,
      mainThesis: brief.mainThesis,
      status: StrategyArticleTaskStatus.BRIEF_GENERATED,
      error: null,
    },
  });

  const contentBrief: ArticleContentBrief = {
    contentFormat: brief.contentFormat,
    tone: brief.tone,
    targetAudience: brief.targetAudience,
    readerPain: brief.readerPain,
    mainThesis: brief.mainThesis,
  };

  const asset = await createDistributionAsset(userId, {
    title: brief.topic,
    canonicalBody: "Черновик будет сгенерирован автопилотом.",
    brandId: strategy.brandId,
    platformId: platform.id,
    summary: brief.factsExample,
    primaryKeyword: brief.keyword,
    ctaText: strategy.cta ?? strategy.brand.primaryCta ?? "",
    ctaUrl: strategy.link ?? strategy.brand.siteUrl,
    intent: TopicIntent.INFORMATIONAL,
    contentBrief,
    scheduledAt:
      strategy.publishMode === StrategyPublishMode.DRAFT_ONLY
        ? null
        : strategy.publishMode === StrategyPublishMode.AUTO_PUBLISH &&
            strategy.publishExecutionMode === StrategyPublishExecutionMode.CLIENT_AGENT
          ? null
          : task.scheduledAt.toISOString(),
  });

  const article = await generateArticleForUser(userId, asset.id);
  await prisma.strategyArticleTask.update({
    where: { id: task.id },
    data: {
      articleId: article.id,
      title: article.title,
      status:
        strategy.publishMode === StrategyPublishMode.DRAFT_ONLY
          ? StrategyArticleTaskStatus.ARTICLE_GENERATED
          : StrategyArticleTaskStatus.SCHEDULED,
      error: null,
    },
  });

  if (
    strategy.publishMode === StrategyPublishMode.GENERATE_AND_SCHEDULE ||
    strategy.publishExecutionMode === StrategyPublishExecutionMode.SERVER_MANAGED
  ) {
    await scheduleArticleForUser(userId, article.id, task.scheduledAt.toISOString());
  }

  devLog("task:generate:done", {
    strategyId: strategy.id,
    taskId: task.id,
    articleId: article.id,
    topic: brief.topic,
    contentFormat: brief.contentFormat,
    tone: brief.tone,
  });

  return {
    taskId: task.id,
    articleId: article.id,
    status:
      strategy.publishMode === StrategyPublishMode.DRAFT_ONLY
        ? StrategyArticleTaskStatus.ARTICLE_GENERATED
        : StrategyArticleTaskStatus.SCHEDULED,
    generated: true,
  };
}

export async function generateNextStrategyArticles(
  userId: string,
  strategyId: string,
  horizonHours = 24,
  limit = 24,
) {
  const strategy = await ensureStrategyAccess(userId, strategyId);

  if (
    strategy.status === ContentStrategyStatus.PAUSED ||
    strategy.status === ContentStrategyStatus.STOPPED
  ) {
    throw new StrategyServiceError(
      409,
      "STRATEGY_NOT_RUNNING",
      "Стратегия на паузе или остановлена.",
    );
  }

  const until = new Date(Date.now() + horizonHours * 60 * 60 * 1000);
  const tasks = await prisma.strategyArticleTask.findMany({
    where: {
      strategyId,
      scheduledAt: { lte: until },
      status: { in: [StrategyArticleTaskStatus.PLANNED, StrategyArticleTaskStatus.BRIEF_GENERATED] },
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
  });

  let generated = 0;

  for (const task of tasks) {
    if (task.articleId) {
      continue;
    }

    try {
      await generateSingleStrategyTask(userId, strategy, task);
      generated += 1;
    } catch (error) {
      await prisma.strategyArticleTask.update({
        where: { id: task.id },
        data: {
          status: StrategyArticleTaskStatus.FAILED,
          error: error instanceof Error ? error.message : "Не удалось сгенерировать статью.",
        },
      });
      devLog("task:generate:error", { strategyId, taskId: task.id, error });
    }
  }

  return { processed: tasks.length, generated };
}

export async function generateWeekArticles(userId: string, strategyId: string) {
  const plan = await createWeeklyStrategySchedule(userId, strategyId, {
    startDate: new Date(),
    days: 7,
  });
  const generation = await generateNextStrategyArticles(userId, strategyId, 24 * 7, 100);

  return {
    ...plan,
    ...generation,
    horizonDays: 7,
  };
}

export async function fillWeekBuffer(userId: string, strategyId: string) {
  const plan = await createWeeklyStrategySchedule(userId, strategyId, {
    startDate: new Date(),
    days: 7,
  });
  const generation = await generateNextStrategyArticles(userId, strategyId, 24 * 7, 100);

  return {
    ...plan,
    ...generation,
    horizonDays: 7,
  };
}

export async function generateNext24Hours(userId: string, strategyId: string) {
  const plan = await createWeeklyStrategySchedule(userId, strategyId, {
    startDate: new Date(),
    days: 1,
  });
  const generation = await generateNextStrategyArticles(userId, strategyId, 24, 50);

  return {
    ...plan,
    ...generation,
    horizonHours: 24,
  };
}

async function isPlatformReadyForClientAgent(userId: string, platform: string) {
  const platformConfig = getPlatformConfig(platform as StrategyPlatform);

  if (!platformConfig) {
    return false;
  }

  const account = await prisma.platformAccount.findUnique({
    where: {
      userId_platform: {
        userId,
        platform,
      },
    },
    select: { status: true },
  });

  if (account?.status !== PlatformAccountStatus.CONNECTED) {
    return false;
  }

  return SessionManager.load(userId, platformConfig.id);
}

export async function markDueTasksAsWaitingAgent(userId?: string) {
  const now = new Date();
  const due = await prisma.strategyArticleTask.findMany({
    where: {
      scheduledAt: { lte: now },
      status: StrategyArticleTaskStatus.SCHEDULED,
      articleId: { not: null },
      attempts: { lt: MAX_PUBLISH_ATTEMPTS },
      strategy: {
        ...(userId ? { userId } : {}),
        status: ContentStrategyStatus.ACTIVE,
        publishMode: StrategyPublishMode.AUTO_PUBLISH,
        publishExecutionMode: StrategyPublishExecutionMode.CLIENT_AGENT,
      },
    },
    include: { strategy: true },
    take: 200,
    orderBy: { scheduledAt: "asc" },
  });

  let catchupPending = 0;
  let missed = 0;

  for (const task of due) {
    const ageHours = hoursSince(task.scheduledAt, now);
    const nextStatus =
      ageHours > STRATEGY_CATCH_UP_WINDOW_HOURS
        ? StrategyArticleTaskStatus.MISSED
        : StrategyArticleTaskStatus.CATCHUP_PENDING;
    const message =
      nextStatus === StrategyArticleTaskStatus.MISSED
        ? "Пропущено, требуется ручное действие."
        : CLIENT_AGENT_MISSED_MESSAGE;

    await prisma.strategyArticleTask.update({
      where: { id: task.id },
      data: {
        status: nextStatus,
        error: message,
      },
    });

    if (nextStatus === StrategyArticleTaskStatus.MISSED) {
      missed += 1;
    } else {
      catchupPending += 1;
    }

    devLog("task:agent-wait", {
      taskId: task.id,
      articleId: task.articleId,
      platform: task.platform,
      scheduledAt: task.scheduledAt,
      now,
      agentOnline: false,
      oldStatus: task.status,
      newStatus: nextStatus,
      catchUpWindowHours: STRATEGY_CATCH_UP_WINDOW_HOURS,
      attempts: task.attempts,
    });
  }

  return { processed: due.length, catchupPending, missed };
}

export async function updateAgentHeartbeat(userId: string, deviceId = "local-browser") {
  const heartbeat = await prisma.agentHeartbeat.upsert({
    where: {
      userId_deviceId: {
        userId,
        deviceId,
      },
    },
    update: { lastSeenAt: new Date() },
    create: { userId, deviceId, lastSeenAt: new Date() },
  });

  devLog("agent:heartbeat", {
    userId,
    deviceId,
    lastSeenAt: heartbeat.lastSeenAt,
    agentOnline: true,
  });

  return heartbeat;
}

export async function getCatchUpTasksForAgent(
  userId: string,
  deviceId = "local-browser",
) {
  const heartbeat = await updateAgentHeartbeat(userId, deviceId);
  await markDueTasksAsWaitingAgent(userId);

  const now = new Date();
  const candidates = await prisma.strategyArticleTask.findMany({
    where: {
      scheduledAt: { lte: now },
      status: {
        in: [
          StrategyArticleTaskStatus.SCHEDULED,
          StrategyArticleTaskStatus.WAITING_AGENT,
          StrategyArticleTaskStatus.MISSED,
          StrategyArticleTaskStatus.CATCHUP_PENDING,
          StrategyArticleTaskStatus.WAITING_CONNECTION,
        ],
      },
      articleId: { not: null },
      attempts: { lt: MAX_PUBLISH_ATTEMPTS },
      strategy: {
        userId,
        status: ContentStrategyStatus.ACTIVE,
        publishMode: StrategyPublishMode.AUTO_PUBLISH,
        publishExecutionMode: StrategyPublishExecutionMode.CLIENT_AGENT,
      },
    },
    include: {
      article: { select: { id: true, title: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 30,
  });

  const tasks = [];

  for (const task of candidates) {
    const ageHours = hoursSince(task.scheduledAt, now);

    if (ageHours > STRATEGY_CATCH_UP_WINDOW_HOURS) {
      await prisma.strategyArticleTask.update({
        where: { id: task.id },
        data: {
          status: StrategyArticleTaskStatus.MISSED,
          error: "Пропущено, требуется ручное действие.",
        },
      });
      continue;
    }

    if (!(await isPlatformReadyForClientAgent(userId, task.platform))) {
      await prisma.strategyArticleTask.update({
        where: { id: task.id },
        data: {
          status: StrategyArticleTaskStatus.WAITING_CONNECTION,
          error: CONNECTION_REQUIRED_MESSAGE,
        },
      });
      continue;
    }

    const updated = await prisma.strategyArticleTask.update({
      where: { id: task.id },
      data: {
        status: StrategyArticleTaskStatus.CATCHUP_PENDING,
        error: CLIENT_AGENT_MISSED_MESSAGE,
      },
    });

    devLog("agent:task-ready", {
      taskId: task.id,
      articleId: task.articleId,
      platform: task.platform,
      scheduledAt: task.scheduledAt,
      now,
      agentOnline: true,
      oldStatus: task.status,
      newStatus: updated.status,
      catchUpWindowHours: STRATEGY_CATCH_UP_WINDOW_HOURS,
      attempts: task.attempts,
    });

    tasks.push({
      id: task.id,
      articleId: task.articleId,
      platform: task.platform,
      scheduledAt: task.scheduledAt.toISOString(),
      status: updated.status,
      topic: task.topic ?? task.article?.title ?? null,
      attempts: task.attempts,
    });
  }

  return {
    deviceId,
    lastSeenAt: heartbeat.lastSeenAt.toISOString(),
    catchUpWindowHours: STRATEGY_CATCH_UP_WINDOW_HOURS,
    pending: tasks.length,
    tasks,
  };
}

export async function runCatchUpPublishingForTask(
  userId: string,
  taskId: string,
  options: { ignoreCatchUpWindow?: boolean } = {},
) {
  const now = new Date();
  const task = await prisma.strategyArticleTask.findFirst({
    where: {
      id: taskId,
      strategy: {
        userId,
      },
    },
    include: {
      strategy: true,
    },
  });

  if (!task) {
    throw new StrategyServiceError(404, "TASK_NOT_FOUND", "Задача не найдена.");
  }

  if (task.status === StrategyArticleTaskStatus.PUBLISHED) {
    return { taskId, articleId: task.articleId, status: task.status };
  }

  if (task.status === StrategyArticleTaskStatus.PUBLISHING) {
    throw new StrategyServiceError(
      409,
      "TASK_ALREADY_PUBLISHING",
      "Публикация уже запущена.",
    );
  }

  if (!task.articleId) {
    throw new StrategyServiceError(
      409,
      "TASK_ARTICLE_MISSING",
      "Статья ещё не сгенерирована.",
    );
  }

  if (
    task.strategy.status !== ContentStrategyStatus.ACTIVE ||
    task.strategy.publishMode !== StrategyPublishMode.AUTO_PUBLISH ||
    task.strategy.publishExecutionMode !== StrategyPublishExecutionMode.CLIENT_AGENT
  ) {
    throw new StrategyServiceError(
      409,
      "TASK_NOT_PUBLISHABLE",
      "Стратегия не готова к автопубликации.",
    );
  }

  if (
    !options.ignoreCatchUpWindow &&
    hoursSince(task.scheduledAt, now) > STRATEGY_CATCH_UP_WINDOW_HOURS
  ) {
    await prisma.strategyArticleTask.update({
      where: { id: task.id },
      data: {
        status: StrategyArticleTaskStatus.MISSED,
        error: "Пропущено, требуется ручное действие.",
      },
    });
    throw new StrategyServiceError(
      409,
      "TASK_TOO_OLD",
      "Задача старше окна автодогонки и требует ручного действия.",
    );
  }

  if (!(await isPlatformReadyForClientAgent(userId, task.platform))) {
    await prisma.strategyArticleTask.update({
      where: { id: task.id },
      data: {
        status: StrategyArticleTaskStatus.WAITING_CONNECTION,
        error: CONNECTION_REQUIRED_MESSAGE,
      },
    });
    throw new StrategyServiceError(409, "PLATFORM_CONNECTION_REQUIRED", CONNECTION_REQUIRED_MESSAGE);
  }

  const publishableStatuses: StrategyArticleTaskStatus[] = [
    StrategyArticleTaskStatus.SCHEDULED,
    StrategyArticleTaskStatus.WAITING_AGENT,
    StrategyArticleTaskStatus.CATCHUP_PENDING,
    StrategyArticleTaskStatus.WAITING_CONNECTION,
    StrategyArticleTaskStatus.MISSED,
  ];
  const lock = await prisma.strategyArticleTask.updateMany({
    where: {
      id: task.id,
      status: { in: publishableStatuses },
      attempts: { lt: MAX_PUBLISH_ATTEMPTS },
    },
    data: {
      status: StrategyArticleTaskStatus.PUBLISHING,
      attempts: { increment: 1 },
      error: null,
    },
  });

  if (lock.count === 0) {
    throw new StrategyServiceError(
      409,
      "TASK_LOCK_FAILED",
      "Задача уже обрабатывается или исчерпала попытки.",
    );
  }

  const nextAttempts = task.attempts + 1;

  try {
    const result = await publishArticleWithBrowserSession(userId, task.articleId);
    await prisma.strategyArticleTask.update({
      where: { id: task.id },
      data: {
        status: StrategyArticleTaskStatus.PUBLISHED,
        error: null,
      },
    });

    devLog("agent:publish:done", {
      taskId: task.id,
      articleId: task.articleId,
      platform: task.platform,
      scheduledAt: task.scheduledAt,
      now,
      agentOnline: true,
      oldStatus: task.status,
      newStatus: StrategyArticleTaskStatus.PUBLISHED,
      attempts: nextAttempts,
      publishResult: result,
    });

    return { ...result, taskId: task.id, status: StrategyArticleTaskStatus.PUBLISHED };
  } catch (error) {
    const nextStatus =
      nextAttempts >= MAX_PUBLISH_ATTEMPTS
        ? StrategyArticleTaskStatus.FAILED
        : StrategyArticleTaskStatus.CATCHUP_PENDING;
    const errorMessage =
      error instanceof Error ? error.message : "Не удалось опубликовать статью.";

    await prisma.strategyArticleTask.update({
      where: { id: task.id },
      data: {
        status: nextStatus,
        error: errorMessage,
      },
    });

    devLog("agent:publish:error", {
      taskId: task.id,
      articleId: task.articleId,
      platform: task.platform,
      scheduledAt: task.scheduledAt,
      now,
      agentOnline: true,
      oldStatus: task.status,
      newStatus: nextStatus,
      attempts: nextAttempts,
      error: errorMessage,
    });

    throw error;
  }
}

export async function retryFailedPublishTask(userId: string, taskId: string) {
  const task = await prisma.strategyArticleTask.findFirst({
    where: {
      id: taskId,
      strategy: { userId },
    },
    select: { id: true, status: true },
  });

  if (!task) {
    throw new StrategyServiceError(404, "TASK_NOT_FOUND", "Задача не найдена.");
  }

  const updated = await prisma.strategyArticleTask.update({
    where: { id: task.id },
    data: {
      status: StrategyArticleTaskStatus.CATCHUP_PENDING,
      attempts: 0,
      error: null,
    },
  });

  return { taskId: updated.id, status: updated.status };
}

export async function runStrategyPublisher() {
  const due = await prisma.strategyArticleTask.findMany({
    where: {
      scheduledAt: { lte: new Date() },
      status: StrategyArticleTaskStatus.SCHEDULED,
      articleId: { not: null },
      strategy: {
        status: ContentStrategyStatus.ACTIVE,
        publishMode: StrategyPublishMode.AUTO_PUBLISH,
        publishExecutionMode: StrategyPublishExecutionMode.SERVER_MANAGED,
      },
    },
    include: {
      strategy: true,
    },
    take: 20,
    orderBy: { scheduledAt: "asc" },
  });

  let published = 0;

  for (const task of due) {
    if (!task.articleId) {
      continue;
    }

    try {
      await prisma.strategyArticleTask.update({
        where: { id: task.id },
        data: { status: StrategyArticleTaskStatus.PUBLISHING, error: null },
      });
      await publishArticleWithBrowserSession(task.strategy.userId, task.articleId);
      await prisma.strategyArticleTask.update({
        where: { id: task.id },
        data: { status: StrategyArticleTaskStatus.PUBLISHED, error: null },
      });
      published += 1;
    } catch (error) {
      await prisma.strategyArticleTask.update({
        where: { id: task.id },
        data: {
          status:
            task.attempts >= 2
              ? StrategyArticleTaskStatus.FAILED
              : StrategyArticleTaskStatus.SCHEDULED,
          attempts: { increment: 1 },
          error: error instanceof Error ? error.message : "Не удалось опубликовать статью.",
        },
      });
    }
  }

  return { processed: due.length, published };
}

export async function runStrategyJobs() {
  const activeStrategies = await prisma.contentStrategy.findMany({
    where: { status: ContentStrategyStatus.ACTIVE },
    select: { id: true, userId: true },
  });

  let generated = 0;
  for (const strategy of activeStrategies) {
    await createWeeklyStrategySchedule(strategy.userId, strategy.id, {
      startDate: new Date(),
      days: 7,
    }).catch((error: unknown) => {
      devLog("job:plan-week:error", { strategyId: strategy.id, error });
    });
    const result = await generateNextStrategyArticles(strategy.userId, strategy.id, 24).catch(
      (error: unknown) => {
        devLog("job:generate:error", { strategyId: strategy.id, error });
        return { generated: 0 };
      },
    );
    generated += result.generated;
  }

  const waitingAgent = await markDueTasksAsWaitingAgent();
  const publisher = await runStrategyPublisher();
  return { strategies: activeStrategies.length, generated, waitingAgent, ...publisher };
}

function mapStrategy(strategy: {
  id: string;
  brandId: string;
  name: string;
  status: ContentStrategyStatus;
  platforms: Prisma.JsonValue;
  articlesPerDay: number;
  distributionMode: StrategyDistributionMode;
  vcPerDay: number | null;
  dzenPerDay: number | null;
  timeSlots: Prisma.JsonValue;
  platformTimeSlots?: Prisma.JsonValue | null;
  daysOfWeek: Prisma.JsonValue;
  startDate: Date;
  endDate: Date;
  generationMode: string;
  publishMode: StrategyPublishMode;
  publishExecutionMode: StrategyPublishExecutionMode;
  cta: string | null;
  link: string | null;
  goal: string | null;
  topicDirections: string | null;
  forbiddenTopics: string | null;
  createdAt: Date;
  updatedAt: Date;
  brand: { id: string; name: string };
  tasks?: Array<{
    id: string;
    status: StrategyArticleTaskStatus;
    platform: string;
    scheduledAt: Date;
    topic?: string | null;
    title?: string | null;
    contentFormat?: string | null;
    tone?: string | null;
    mainThesis?: string | null;
    error?: string | null;
    articleId?: string | null;
    attempts?: number;
    article?: { id: string; title: string; status: AssetStatus } | null;
  }>;
}) {
  const limits = platformDailyLimits(strategy);
  const taskCounts = (strategy.tasks ?? []).reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});
  const nextTask = (strategy.tasks ?? []).find(
    (task) =>
      task.scheduledAt >= new Date() &&
      !( [
        StrategyArticleTaskStatus.PUBLISHED,
        StrategyArticleTaskStatus.FAILED,
        StrategyArticleTaskStatus.SKIPPED,
      ] as StrategyArticleTaskStatus[]).includes(task.status),
  );

  return {
    id: strategy.id,
    brandId: strategy.brandId,
    brandName: strategy.brand.name,
    name: strategy.name,
    status: strategy.status,
    platforms: readStringArray(strategy.platforms),
    articlesPerDay: strategy.articlesPerDay,
    distributionMode: strategy.distributionMode,
    vcPerDay: limits.vc,
    dzenPerDay: limits.dzen,
    timeSlots: readStringArray(strategy.timeSlots),
    platformTimeSlots: readPlatformTimeSlots(strategy.platformTimeSlots),
    daysOfWeek: readNumberArray(strategy.daysOfWeek),
    startDate: strategy.startDate.toISOString(),
    endDate: strategy.endDate.toISOString(),
    generationMode: strategy.generationMode,
    publishMode: strategy.publishMode,
    publishExecutionMode: strategy.publishExecutionMode,
    cta: strategy.cta,
    link: strategy.link,
    goal: strategy.goal,
    topicDirections: strategy.topicDirections,
    forbiddenTopics: strategy.forbiddenTopics,
    createdAt: strategy.createdAt.toISOString(),
    updatedAt: strategy.updatedAt.toISOString(),
    nextRunAt: nextTask?.scheduledAt.toISOString() ?? null,
    taskCounts,
    tasks: (strategy.tasks ?? []).map((task) => ({
      id: task.id,
      platform: task.platform,
      scheduledAt: task.scheduledAt.toISOString(),
      status: task.status,
      topic: task.topic ?? task.article?.title ?? null,
      title: task.title ?? task.article?.title ?? null,
      contentFormat: task.contentFormat ?? null,
      tone: task.tone ?? null,
      mainThesis: task.mainThesis ?? null,
      articleId: task.articleId ?? null,
      error: task.error ?? null,
      attempts: task.attempts ?? 0,
    })),
  };
}
