import { z } from "zod";

export const brandIdSchema = z.string().cuid("Некорректный идентификатор бренда.");

export const createBrandSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Название бренда должно содержать минимум 2 символа.")
    .max(160, "Название бренда не должно превышать 160 символов."),
  siteUrl: z
    .string()
    .trim()
    .min(3, "Укажите адрес сайта бренда.")
    .max(2048, "Адрес сайта бренда не должен превышать 2048 символов."),
  description: z
    .string()
    .trim()
    .max(1200, "Описание не должно превышать 1200 символов.")
    .optional()
    .or(z.literal("")),
  industry: z
    .string()
    .trim()
    .max(120, "Ниша не должна превышать 120 символов.")
    .optional()
    .or(z.literal("")),
  geography: z
    .string()
    .trim()
    .max(120, "География не должна превышать 120 символов.")
    .optional()
    .or(z.literal("")),
  targetAudience: z
    .string()
    .trim()
    .max(500, "Описание аудитории не должно превышать 500 символов.")
    .optional()
    .or(z.literal("")),
  primaryCta: z
    .string()
    .trim()
    .max(240, "Призыв к действию не должен превышать 240 символов.")
    .optional()
    .or(z.literal("")),
});

export const updateBrandSchema = createBrandSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Для обновления бренда нужно изменить хотя бы одно поле.",
);

export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
