import { AssetStatus, PublicationStatus, TopicIntent } from "@prisma/client";
import { z } from "zod";

export const assetIdSchema = z.string().cuid("Некорректный идентификатор статьи.");

const contentBriefSchema = z
  .object({
    contentFormat: z
      .enum([
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
      ])
      .optional()
      .or(z.literal("")),
    tone: z
      .enum([
        "calm_expert",
        "direct",
        "provocative_soft",
        "painful",
        "founder_style",
        "analytical",
        "practical",
      ])
      .optional()
      .or(z.literal("")),
    targetAudience: z.string().trim().max(500).optional().or(z.literal("")),
    readerPain: z.string().trim().max(800).optional().or(z.literal("")),
    mainThesis: z.string().trim().max(800).optional().or(z.literal("")),
  })
  .optional()
  .nullable();

export const createDistributionAssetSchema = z.object({
  title: z
    .string()
    .trim()
    .min(4, "Заголовок должен содержать минимум 4 символа.")
    .max(240, "Заголовок не должен превышать 240 символов."),
  canonicalBody: z
    .string()
    .trim()
    .max(50000, "Текст статьи не должен превышать 50000 символов."),
  brandId: z.string().cuid("Некорректный идентификатор бренда."),
  platformId: z.string().cuid("Некорректный идентификатор площадки."),
  summary: z
    .string()
    .trim()
    .max(10000, "Краткое описание не должно превышать 10000 символов.")
    .optional()
    .or(z.literal("")),
  primaryKeyword: z
    .string()
    .trim()
    .max(160, "Ключевой запрос не должен превышать 160 символов.")
    .optional()
    .or(z.literal("")),
  ctaText: z
    .string()
    .trim()
    .max(10000, "Текст призыва к действию не должен превышать 10000 символов.")
    .optional()
    .or(z.literal("")),
  ctaUrl: z
    .string()
    .trim()
    .max(2048, "Ссылка призыва к действию не должна превышать 2048 символов.")
    .optional()
    .or(z.literal("")),
  intent: z.nativeEnum(TopicIntent).nullable().optional(),
  contentBrief: contentBriefSchema,
  scheduledAt: z.string().datetime().nullable().optional(),
});

export const updateDistributionAssetSchema =
  createDistributionAssetSchema
    .omit({
      brandId: true,
      platformId: true,
    })
    .extend({
      brandId: z.string().cuid("Некорректный идентификатор бренда.").optional(),
      platformId: z.string().cuid("Некорректный идентификатор площадки.").optional(),
      status: z.nativeEnum(AssetStatus).optional(),
      publicationStatus: z.nativeEnum(PublicationStatus).optional(),
    })
    .refine(
      (value) => Object.keys(value).length > 0,
      "Для обновления статьи нужно изменить хотя бы одно поле.",
    );

export type CreateDistributionAssetInput = z.infer<
  typeof createDistributionAssetSchema
>;
export type UpdateDistributionAssetInput = z.infer<
  typeof updateDistributionAssetSchema
>;
