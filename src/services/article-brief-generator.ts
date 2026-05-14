import { z } from "zod";

import { prisma } from "@/infrastructure/db/prisma";
import type { GeneratedTextResult } from "@/lib/llm";
import { generateText } from "@/lib/llm";

export type BriefFieldTarget =
  | "targetAudience"
  | "readerPain"
  | "mainThesis"
  | "factsExample"
  | "topic";

export type BriefGenerationContext = {
  targetAudience?: string;
  readerPain?: string;
  mainThesis?: string;
  factsExample?: string;
  cta?: string;
  link?: string;
};

export type GenerateBriefFieldInput = {
  targetField: BriefFieldTarget;
  brandId: string;
  platform: "vc" | "dzen";
  topic?: string;
  keyword?: string;
  contentFormat?: string;
  tone?: string;
  currentBrief?: BriefGenerationContext;
};

export type GenerateBriefFieldResult = {
  value: string;
  reason: string;
};

export type GenerateFullBriefInput = Omit<
  GenerateBriefFieldInput,
  "targetField"
>;

export type GenerateFullBriefResult = {
  targetAudience: string;
  readerPain: string;
  mainThesis: string;
  factsExample: string;
  suggestedTopic: string;
  reasoning: Record<
    "targetAudience" | "readerPain" | "mainThesis" | "factsExample",
    string
  >;
};

export class BriefGenerationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BriefGenerationError";
  }
}

const fieldResultSchema = z.object({
  value: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

const fullBriefResultSchema = z.object({
  targetAudience: z.string().trim().min(1),
  readerPain: z.string().trim().min(1),
  mainThesis: z.string().trim().min(1),
  factsExample: z.string().trim().min(1),
  suggestedTopic: z.string().trim().min(1),
  reasoning: z.object({
    targetAudience: z.string().trim().min(1),
    readerPain: z.string().trim().min(1),
    mainThesis: z.string().trim().min(1),
    factsExample: z.string().trim().min(1),
  }),
});

function devLog(step: string, context: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[article-brief-generator]", { step, ...context });
  }
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

function parseJson<T>(text: string, schema: z.ZodType<T>, label: string): T {
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
      return schema.parse(JSON.parse(candidate));
    } catch {
      // Try next recovery variant.
    }
  }

  devLog("json_parse_failed", { label, length: text.length });
  throw new BriefGenerationError(
    502,
    "BRIEF_GENERATION_INVALID_JSON",
    "Модель вернула некорректный ответ. Попробуйте сгенерировать поле еще раз.",
  );
}

async function getBrandContext(userId: string, brandId: string) {
  const brand = await prisma.brand.findFirst({
    where: {
      id: brandId,
      workspace: {
        members: {
          some: { userId },
        },
      },
    },
    select: {
      id: true,
      name: true,
      siteUrl: true,
      description: true,
      industry: true,
      geography: true,
      targetAudience: true,
      primaryCta: true,
    },
  });

  if (!brand) {
    throw new BriefGenerationError(
      404,
      "BRAND_NOT_FOUND",
      "Сначала выберите доступный бренд.",
    );
  }

  return {
    id: brand.id,
    name: brand.name,
    description: brand.description,
    offer: brand.primaryCta,
    audience: brand.targetAudience,
    website: brand.siteUrl,
    category: brand.industry,
    geography: brand.geography,
  };
}

function formatInput(input: GenerateFullBriefInput) {
  return JSON.stringify(
    {
      platform: input.platform,
      topic: input.topic ?? "",
      keyword: input.keyword ?? "",
      contentFormat: input.contentFormat ?? "",
      tone: input.tone ?? "",
      currentBrief: input.currentBrief ?? {},
    },
    null,
    2,
  );
}

function basePrompt() {
  return `Пиши на русском. Не используй markdown. Не выдумывай реальные кейсы, цифры и метрики как факт. Если нужны цифры или ситуация, используй "условный пример", "типичная ситуация", "например". Поле должно помогать будущей статье быть живой, конкретной и не похожей на AI-мусор. Не хардкодь B2B SaaS, SEO или рекламу: выбирай боль по бренду, теме и нише.`;
}

function usageLog(
  result: GeneratedTextResult,
  context: Pick<GenerateBriefFieldInput, "platform" | "contentFormat" | "tone"> & {
    brandId: string;
    targetField?: BriefFieldTarget;
  },
) {
  devLog("generated", {
    brandId: context.brandId,
    targetField: context.targetField,
    platform: context.platform,
    contentFormat: context.contentFormat,
    tone: context.tone,
    generatedLength: result.text.length,
  });
}

export async function generateBriefField(
  userId: string,
  input: GenerateBriefFieldInput,
): Promise<GenerateBriefFieldResult> {
  const brand = await getBrandContext(userId, input.brandId);

  const result = await generateText([
    {
      role: "system",
      content: `Ты редактор product/content brief. ${basePrompt()}`,
    },
    {
      role: "user",
      content: `Сгенерируй только поле ${input.targetField}.

Brand context:
${JSON.stringify(brand, null, 2)}

Form context:
${formatInput(input)}

Логика:
- targetAudience: коротко и конкретно, кто именно читатель.
- readerPain: бизнес-проблема читателя, не боль копирайтинга.
- mainThesis: "Люди думают, что проблема в X, но на самом деле проблема в Y. Поэтому нужно Z."
- factsExample: дай материал для конкретики; можно условный пример.
- topic: короткая тема, не SEO-заголовок.

Верни строго JSON:
{"value":"...","reason":"коротко почему так"}`,
    },
  ]);

  usageLog(result, { ...input, brandId: input.brandId });
  return parseJson(result.text, fieldResultSchema, input.targetField);
}

export async function generateFullBrief(
  userId: string,
  input: GenerateFullBriefInput,
): Promise<GenerateFullBriefResult> {
  const brand = await getBrandContext(userId, input.brandId);

  const result = await generateText([
    {
      role: "system",
      content: `Ты редактор product/content brief. ${basePrompt()}`,
    },
    {
      role: "user",
      content: `Сгенерируй бриф для статьи одним ответом.

Brand context:
${JSON.stringify(brand, null, 2)}

Form context:
${formatInput(input)}

Сгенерируй targetAudience, readerPain, mainThesis, factsExample и suggestedTopic.
Заполняй под конкретную нишу бренда. Не делай всё про одну и ту же боль, если тема другая.

Верни строго JSON:
{
  "targetAudience": "...",
  "readerPain": "...",
  "mainThesis": "...",
  "factsExample": "...",
  "suggestedTopic": "...",
  "reasoning": {
    "targetAudience": "...",
    "readerPain": "...",
    "mainThesis": "...",
    "factsExample": "..."
  }
}`,
    },
  ]);

  usageLog(result, { ...input, brandId: input.brandId });
  return parseJson(result.text, fullBriefResultSchema, "fullBrief");
}
