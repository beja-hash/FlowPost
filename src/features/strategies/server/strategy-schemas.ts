import {
  ContentStrategyStatus,
  StrategyDistributionMode,
  StrategyGenerationMode,
  StrategyPublishMode,
} from "@prisma/client";
import { z } from "zod";

export const strategyIdSchema = z.string().cuid("Некорректный идентификатор стратегии.");

const platformSchema = z.enum(["vc", "dzen"]);
const timeSlotSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате HH:mm.");
const platformTimeSlotsSchema = z
  .object({
    vc: z.array(timeSlotSchema).max(24).optional(),
    dzen: z.array(timeSlotSchema).max(24).optional(),
  })
  .optional()
  .nullable();

const strategyPayloadBaseSchema = z.object({
    name: z.string().trim().min(3).max(180),
    brandId: z.string().cuid(),
    platforms: z.array(platformSchema).min(1),
    articlesPerDay: z.number().int().min(1).max(20),
    distributionMode: z.nativeEnum(StrategyDistributionMode),
    vcPerDay: z.number().int().min(0).max(20).nullable().optional(),
    dzenPerDay: z.number().int().min(0).max(20).nullable().optional(),
    timeSlots: z.array(timeSlotSchema).min(1).max(24),
    platformTimeSlots: platformTimeSlotsSchema,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    generationMode: z.nativeEnum(StrategyGenerationMode),
    publishMode: z.nativeEnum(StrategyPublishMode),
    cta: z.string().trim().max(10000).optional().or(z.literal("")),
    link: z.string().trim().max(2048).optional().or(z.literal("")),
    goal: z.string().trim().max(10000).optional().or(z.literal("")),
    topicDirections: z.string().trim().max(10000).optional().or(z.literal("")),
    forbiddenTopics: z.string().trim().max(10000).optional().or(z.literal("")),
  });

export const strategyPayloadSchema = strategyPayloadBaseSchema.refine(
    (value) => new Date(value.endDate).getTime() >= new Date(value.startDate).getTime(),
    "Дата окончания должна быть позже даты старта.",
  );

export const createStrategySchema = strategyPayloadBaseSchema
  .extend({
    status: z.nativeEnum(ContentStrategyStatus).optional(),
  })
  .refine(
    (value) => new Date(value.endDate).getTime() >= new Date(value.startDate).getTime(),
    "Дата окончания должна быть позже даты старта.",
  );

export const updateStrategySchema = strategyPayloadBaseSchema
  .partial()
  .extend({
    status: z.nativeEnum(ContentStrategyStatus).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Для обновления стратегии нужно изменить хотя бы одно поле.",
  });

export type CreateStrategyInput = z.infer<typeof createStrategySchema>;
export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>;
