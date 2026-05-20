import type { ArticleAsset, Brand, TopicIntent } from "@prisma/client";

import type { ArticleContentBrief } from "@/features/distribution/types";
import type { LlmUsage } from "@/lib/llm";
import { generateText } from "@/lib/llm";
import { hasUnsafeDzenMarkdown } from "@/services/article-formatting";

export type ArticleContentFormat =
  | "case_story"
  | "failure_story"
  | "teardown"
  | "personal_experience"
  | "comparison"
  | "guide"
  | "opinion"
  | "myth_busting"
  | "checklist"
  | "mistakes"
  | "trend_analysis"
  | "decision_guide";

export type ArticleTone =
  | "calm_expert"
  | "direct"
  | "provocative_soft"
  | "painful"
  | "founder_style"
  | "analytical"
  | "practical";

export type ArticleTargetLength = {
  minChars: number;
  maxChars: number;
  reason: string;
};

export type ArticleBrief = {
  topic: string;
  keyword: string | null;
  platform: "vc" | "dzen";
  brand: ArticleGenerationInput["brand"];
  contentFormat: ArticleContentFormat | null;
  tone: ArticleTone | null;
  targetAudience: string | null;
  readerPain: string | null;
  mainThesis: string | null;
  facts: string | null;
  cta: string | null;
  link: string | null;
  intent: TopicIntent | null;
};

export type NormalizedArticleBrief = ArticleBrief & {
  contentFormat: ArticleContentFormat;
  tone: ArticleTone;
  targetAudience: string;
  readerPain: string;
  mainThesis: string;
  angle: string;
  proofIdeas: string[];
};

export type ArticleStrategy = {
  platform: "vc" | "dzen";
  contentFormat: ArticleContentFormat;
  tone: ArticleTone;
  targetAudience: string;
  readerPain: string;
  mainThesis: string;
  angle: string;
  targetLength: ArticleTargetLength;
  titles: string[];
  selectedTitle: string;
  hook: string;
  outline: Array<{
    heading: string;
    goal: string;
    keyPoints: string[];
  }>;
  proofIdeas: string[];
  productMentionStrategy: string;
  ctaStrategy: string;
};

export type ArticleDraft = {
  title: string;
  content: string;
};

export type PolishedArticle = {
  title: string;
  content: string;
  qualityScore: number;
  changed: string[];
  warnings: string[];
  detectedIssues: string[];
  platformFit: "vc" | "dzen";
};

export type ArticleQualityReport = {
  titleStrength: number;
  hookStrength: number;
  specificity: number;
  platformFit: number;
  humanTone: number;
  structure: number;
  usefulness: number;
  productMentionNaturalness: number;
  antiAiScore: number;
  lengthFit: number;
  overallScore: number;
  detectedIssues: string[];
  warnings: string[];
  rewriteRequired: boolean;
};

type ArticleGenerationInput = {
  brand: Pick<
    Brand,
    | "name"
    | "siteUrl"
    | "industry"
    | "targetAudience"
    | "primaryCta"
    | "description"
  >;
  article: Pick<
    ArticleAsset,
    "title" | "primaryKeyword" | "summary" | "ctaText" | "ctaUrl"
  > & {
    intent: TopicIntent | null;
    platform: string;
    contentBrief?: ArticleContentBrief | null;
  };
};

type ArticleGenerationOptions = {
  onStep?: (
    step:
      | "normalize"
      | "strategy"
      | "draft"
      | "polish"
      | "quality_check"
      | "rewrite"
      | "polish_fallback",
  ) => void;
};

export type GeneratedArticle = {
  title: string;
  content: string;
  platformDraft: string;
  strategy: ArticleStrategy;
  draft: ArticleDraft;
  polished: PolishedArticle;
  qualityReport: ArticleQualityReport | null;
  warnings: string[];
  usage: LlmUsage;
};

export class ArticleGenerationContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleGenerationContentError";
  }
}

function devLog(step: string, context: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[article-generator]", { step, ...context });
  }
}

function formatBrandContext(brand: ArticleGenerationInput["brand"]) {
  return [
    `Бренд: ${brand.name}`,
    `Сайт: ${brand.siteUrl}`,
    `Ниша: ${brand.industry ?? "не указана"}`,
    `Аудитория: ${brand.targetAudience ?? "не указана"}`,
    `Описание продукта: ${brand.description ?? "не указано"}`,
    `Основной CTA бренда: ${brand.primaryCta ?? "не указан"}`,
  ].join("\n");
}

function formatArticleContext(article: ArticleGenerationInput["article"]) {
  return [
    `Рабочий заголовок/тема: ${article.title}`,
    `Ключевой запрос: ${article.primaryKeyword ?? "не указан"}`,
    `Интент: ${article.intent ?? "не указан"}`,
    `Угол/заметки: ${article.summary ?? "не указаны"}`,
    `CTA: ${article.ctaText ?? "не указан"}`,
    `Ссылка: ${article.ctaUrl ?? "не указана"}`,
    `Площадка: ${normalizePlatform(article.platform)}`,
    `Формат подачи: ${article.contentBrief?.contentFormat || "выбрать автоматически"}`,
    `Тон: ${article.contentBrief?.tone || "выбрать автоматически"}`,
    `Кому пишем: ${article.contentBrief?.targetAudience || "придумать по контексту"}`,
    `Главная боль читателя: ${article.contentBrief?.readerPain || "придумать по контексту"}`,
    `Главный тезис: ${article.contentBrief?.mainThesis || "придумать по контексту"}`,
  ].join("\n");
}

function mergeUsage(...usages: LlmUsage[]): LlmUsage {
  const firstUsage = usages[0];

  return {
    model: firstUsage.model,
    inputTokens: usages.reduce((total, usage) => total + usage.inputTokens, 0),
    outputTokens: usages.reduce((total, usage) => total + usage.outputTokens, 0),
    totalTokens: usages.reduce((total, usage) => total + usage.totalTokens, 0),
    estimatedCost: Number(
      usages
        .reduce((total, usage) => total + usage.estimatedCost, 0)
        .toFixed(6),
    ),
  };
}

function normalizePlatform(platform: string): "vc" | "dzen" {
  const normalized = platform.trim().toLowerCase();
  return normalized.includes("vc") ? "vc" : "dzen";
}

const contentFormats: ArticleContentFormat[] = [
  "case_story",
  "failure_story",
  "teardown",
  "personal_experience",
  "comparison",
  "guide",
  "opinion",
  "myth_busting",
  "checklist",
  "mistakes",
  "trend_analysis",
  "decision_guide",
];

const tones: ArticleTone[] = [
  "calm_expert",
  "direct",
  "provocative_soft",
  "painful",
  "founder_style",
  "analytical",
  "practical",
];

const targetLengthMatrix: Record<
  "vc" | "dzen",
  Record<ArticleContentFormat, Omit<ArticleTargetLength, "reason">>
> = {
  vc: {
    opinion: { minChars: 2500, maxChars: 4000 },
    personal_experience: { minChars: 2800, maxChars: 4200 },
    teardown: { minChars: 3000, maxChars: 4500 },
    guide: { minChars: 3200, maxChars: 4800 },
    comparison: { minChars: 3000, maxChars: 4500 },
    case_story: { minChars: 3000, maxChars: 4500 },
    failure_story: { minChars: 3000, maxChars: 4500 },
    myth_busting: { minChars: 2800, maxChars: 4200 },
    checklist: { minChars: 2600, maxChars: 4000 },
    mistakes: { minChars: 2800, maxChars: 4200 },
    trend_analysis: { minChars: 3000, maxChars: 4500 },
    decision_guide: { minChars: 3000, maxChars: 4500 },
  },
  dzen: {
    opinion: { minChars: 2500, maxChars: 3800 },
    personal_experience: { minChars: 2700, maxChars: 4000 },
    teardown: { minChars: 2800, maxChars: 4200 },
    guide: { minChars: 3000, maxChars: 4500 },
    comparison: { minChars: 2900, maxChars: 4300 },
    case_story: { minChars: 2900, maxChars: 4300 },
    failure_story: { minChars: 2900, maxChars: 4300 },
    myth_busting: { minChars: 2800, maxChars: 4200 },
    checklist: { minChars: 2600, maxChars: 4000 },
    mistakes: { minChars: 2800, maxChars: 4200 },
    trend_analysis: { minChars: 2900, maxChars: 4300 },
    decision_guide: { minChars: 2900, maxChars: 4300 },
  },
};

function isArticleContentFormat(value?: string | null): value is ArticleContentFormat {
  return Boolean(value && contentFormats.includes(value as ArticleContentFormat));
}

function isArticleTone(value?: string | null): value is ArticleTone {
  return Boolean(value && tones.includes(value as ArticleTone));
}

function getTargetLength(
  platform: "vc" | "dzen",
  contentFormat: ArticleContentFormat,
): ArticleTargetLength {
  const range = targetLengthMatrix[platform][contentFormat];

  return {
    ...range,
    reason: `${platform === "vc" ? "VC.ru" : "Дзен"} / ${contentFormat}: компактная production-статья на 2500-4000 знаков, максимум около 5000 без воды и повторов.`,
  };
}

function chooseFallbackFormat(input: ArticleGenerationInput): ArticleContentFormat {
  if (input.article.intent === "COMPARISON") {
    return "comparison";
  }

  if (input.article.intent === "COMMERCIAL") {
    return "decision_guide";
  }

  return "teardown";
}

function chooseFallbackTone(platform: "vc" | "dzen"): ArticleTone {
  return platform === "vc" ? "direct" : "practical";
}

export function normalizeArticleBrief(
  input: ArticleGenerationInput,
): NormalizedArticleBrief {
  const platform = normalizePlatform(input.article.platform);
  const contentFormat = isArticleContentFormat(input.article.contentBrief?.contentFormat)
    ? input.article.contentBrief.contentFormat
    : chooseFallbackFormat(input);
  const tone = isArticleTone(input.article.contentBrief?.tone)
    ? input.article.contentBrief.tone
    : chooseFallbackTone(platform);
  const targetAudience =
    input.article.contentBrief?.targetAudience?.trim() ||
    input.brand.targetAudience?.trim() ||
    "люди, которые сталкиваются с этой задачей в работе или бизнесе";
  const readerPain =
    input.article.contentBrief?.readerPain?.trim() ||
    "текущий способ решения задачи тратит время, деньги или внимание, но не дает предсказуемого результата";
  const mainThesis =
    input.article.contentBrief?.mainThesis?.trim() ||
    "проблема обычно не в одном инструменте, а в том, как выстроен процесс и где он ломается";
  const topic = input.article.title.trim();
  const facts = input.article.summary?.trim() || null;
  const proofIdeas = [
    facts
      ? `Использовать предоставленные факты как контекст: ${facts}`
      : "Добавлять только условные примеры и типичные ситуации без выдуманных метрик.",
    "Показывать ограничения подхода и не обещать гарантированный результат.",
  ];

  const brief: NormalizedArticleBrief = {
    topic,
    keyword: input.article.primaryKeyword?.trim() || null,
    platform,
    brand: input.brand,
    contentFormat,
    tone,
    targetAudience,
    readerPain,
    mainThesis,
    facts,
    cta: input.article.ctaText?.trim() || input.brand.primaryCta?.trim() || null,
    link: input.article.ctaUrl?.trim() || input.brand.siteUrl?.trim() || null,
    intent: input.article.intent,
    angle: `${mainThesis}. Показать через боль аудитории: ${readerPain}`,
    proofIdeas,
  };

  devLog("brief:normalized", {
    platform: brief.platform,
    contentFormat: brief.contentFormat,
    tone: brief.tone,
    targetAudience: brief.targetAudience,
    readerPain: brief.readerPain,
    mainThesis: brief.mainThesis,
    hasFacts: Boolean(brief.facts),
  });

  return brief;
}

function normalizeGeneratedContent(content: string) {
  return content
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
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

function parseJsonObject<T>(text: string, stage: string): T {
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
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next recovery candidate.
    }
  }

  try {
    const repaired = payload.slice(payload.indexOf("{"), payload.lastIndexOf("}") + 1);
    return JSON.parse(repaired) as T;
  } catch {
    throw new ArticleGenerationContentError(
      `LLM returned invalid JSON at ${stage}. Попробуйте сгенерировать статью еще раз.`,
    );
  }
}

function assertString(value: unknown, field: string, stage: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ArticleGenerationContentError(
      `LLM response is missing ${field} at ${stage}.`,
    );
  }
}

function assertValidGeneratedContent(content: string, stage: string) {
  if (!content.trim()) {
    throw new ArticleGenerationContentError(
      `Generated content is empty at ${stage}.`,
    );
  }

  if (content.includes("\uFFFD") || content.includes("��")) {
    throw new ArticleGenerationContentError(
      `Generated content contains broken UTF-8 replacement characters at ${stage}.`,
    );
  }
}

function validateStrategy(value: ArticleStrategy) {
  assertString(value.platform, "platform", "strategy");
  assertString(value.contentFormat, "contentFormat", "strategy");
  assertString(value.tone, "tone", "strategy");
  assertString(value.selectedTitle, "selectedTitle", "strategy");
  assertString(value.hook, "hook", "strategy");
  if (
    !value.targetLength ||
    typeof value.targetLength.minChars !== "number" ||
    typeof value.targetLength.maxChars !== "number"
  ) {
    throw new ArticleGenerationContentError(
      "LLM strategy must include targetLength.",
    );
  }

  if (!Array.isArray(value.titles) || value.titles.length < 5) {
    throw new ArticleGenerationContentError(
      "LLM strategy must include 5 title options.",
    );
  }

  if (!Array.isArray(value.outline) || value.outline.length < 3) {
    throw new ArticleGenerationContentError(
      "LLM strategy must include a useful outline.",
    );
  }
}

function validateDraft(value: ArticleDraft) {
  assertString(value.title, "title", "draft");
  assertString(value.content, "content", "draft");
  assertValidGeneratedContent(value.content, "draft");
}

function validatePolished(value: PolishedArticle) {
  assertString(value.title, "title", "polish");
  assertString(value.content, "content", "polish");
  assertValidGeneratedContent(value.content, "polish");

  if (typeof value.qualityScore !== "number") {
    value.qualityScore = 8;
  }

  value.changed = Array.isArray(value.changed) ? value.changed : [];
  value.warnings = Array.isArray(value.warnings) ? value.warnings : [];
  value.detectedIssues = Array.isArray(value.detectedIssues)
    ? value.detectedIssues
    : [];
  value.platformFit =
    value.platformFit === "vc" || value.platformFit === "dzen"
      ? value.platformFit
      : "vc";
}

function validateQualityReport(value: ArticleQualityReport) {
  const scoreKeys: Array<keyof Omit<
    ArticleQualityReport,
    "detectedIssues" | "warnings" | "rewriteRequired"
  >> = [
    "titleStrength",
    "hookStrength",
    "specificity",
    "platformFit",
    "humanTone",
    "structure",
    "usefulness",
    "productMentionNaturalness",
    "antiAiScore",
    "lengthFit",
    "overallScore",
  ];

  scoreKeys.forEach((key) => {
    if (typeof value[key] !== "number") {
      value[key] = 0;
    }
  });
  value.detectedIssues = Array.isArray(value.detectedIssues)
    ? value.detectedIssues
    : [];
  value.warnings = Array.isArray(value.warnings) ? value.warnings : [];
  value.rewriteRequired = Boolean(value.rewriteRequired);
}

function hasUnsupportedPlatformMention(content: string) {
  return /\b(Medium|Habr|Хабр|Spark|Rusbase|Русбейс|Cossa)\b/i.test(content);
}

function hasFakeCaseSignal(content: string) {
  return /в одном из проектов|наш клиент|после внедрения у клиента|мы получили \d+|получили \d+ лид/i.test(
    content,
  );
}

function hasGuaranteeSignal(content: string) {
  return /гарантированн|гарантия (роста|лидов|продаж|трафика)|точно получите|окупаемость|рост продаж/i.test(
    content,
  );
}

function getActualLength(article: Pick<ArticleDraft, "title" | "content">) {
  return `${article.title}\n${article.content}`.length;
}

function getLengthFit(
  actualLength: number,
  targetLength: ArticleTargetLength,
) {
  if (actualLength < targetLength.minChars) {
    return "too_short";
  }

  if (actualLength > targetLength.maxChars) {
    return "too_long";
  }

  return "ok";
}

function logPolishQuality(params: {
  draft: ArticleDraft;
  polished: PolishedArticle;
  unsupportedPlatformFoundInDraft: boolean;
  fakeCaseFoundInDraft: boolean;
  retried: boolean;
}) {
  devLog("polish:quality-check", {
    draftTitle: params.draft.title,
    finalTitle: params.polished.title,
    qualityScore: params.polished.qualityScore,
    warnings: params.polished.warnings,
    detectedIssues: params.polished.detectedIssues,
    removedUnsupportedPlatforms:
      params.unsupportedPlatformFoundInDraft &&
      !hasUnsupportedPlatformMention(
        `${params.polished.title}\n${params.polished.content}`,
      ),
    fakeCaseFound:
      params.fakeCaseFoundInDraft || hasFakeCaseSignal(params.polished.content),
    guaranteeFound: hasGuaranteeSignal(params.polished.content),
    retried: params.retried,
  });
}

function jsonInstruction() {
  return "Верни только валидный JSON. Без markdown, без комментариев, без текста до или после JSON.";
}

export async function generateArticleStrategy(
  input: ArticleGenerationInput,
  brief = normalizeArticleBrief(input),
): Promise<{ strategy: ArticleStrategy; usage: LlmUsage }> {
  const platform = brief.platform;
  const targetLength = getTargetLength(platform, brief.contentFormat);
  const result = await generateText([
    {
      role: "system",
      content:
        "Ты сильный редактор VC.ru и Дзена. Проектируешь нативные статьи с конфликтом, конкретикой, человеческим голосом и мягкой продуктовой интеграцией. Не обещай гарантированный рост, лиды, деньги или SEO-результаты.",
    },
    {
      role: "user",
      content: `${jsonInstruction()}

Собери editorial strategy для продаваемой статьи.

Контекст бренда:
${formatBrandContext(input.brand)}

Контекст статьи:
${formatArticleContext(input.article)}

Нормализованный brief:
${JSON.stringify({ ...brief, brand: undefined }, null, 2)}

Площадка: ${platform}
Целевая длина:
${JSON.stringify(targetLength, null, 2)}

Выход строго в форме:
{
  "platform": "vc" | "dzen",
  "contentFormat": "case_story" | "failure_story" | "teardown" | "personal_experience" | "comparison" | "guide" | "opinion" | "myth_busting" | "checklist" | "mistakes" | "trend_analysis" | "decision_guide",
  "tone": "calm_expert" | "direct" | "provocative_soft" | "painful" | "founder_style" | "analytical" | "practical",
  "targetAudience": "...",
  "readerPain": "...",
  "mainThesis": "...",
  "angle": "...",
  "targetLength": {"minChars": number, "maxChars": number, "reason": "..."},
  "titles": ["...", "...", "...", "...", "..."],
  "selectedTitle": "...",
  "hook": "...",
  "outline": [{"heading": "...", "goal": "...", "keyPoints": ["...", "..."]}],
  "proofIdeas": ["...", "..."],
  "productMentionStrategy": "...",
  "ctaStrategy": "..."
}

Правила:
- используй normalized brief как источник правды;
- contentFormat и tone из brief менять нельзя;
- targetAudience, readerPain, mainThesis из brief использовать строго;
- targetLength вернуть без изменения чисел;
- всегда дай ровно 5 сильных заголовков;
- заголовки не должны звучать как SEO-блог;
- в заголовке нужен конфликт, боль, опыт, цифра, результат или конкретика;
- без дешевого кликбейта;
- VC.ru: прямой опытный стиль, позиция, без воды;
- Дзен: проще, понятнее, структурнее, ближе к массовому читателю;
- product mention только ближе к концу и нативно;
- структура должна соответствовать contentFormat:
  case_story = ситуация → проблема → действия → выводы;
  failure_story = что пошло не так → почему → как исправить;
  teardown = разбор проблемы по слоям;
  personal_experience = наблюдение → опыт → выводы;
  comparison = критерии сравнения → варианты → кому что подходит;
  guide = последовательные шаги;
  opinion = позиция → аргументы → ограничения;
  myth_busting = миф → почему он неверен → что вместо него;
  checklist = проверочные пункты;
  mistakes = ошибки → последствия → как избежать;
  trend_analysis = сдвиг рынка → причины → что делать;
  decision_guide = критерии выбора → сценарии → решение.`,
    },
  ], { maxTokens: 1200 });

  const strategy = parseJsonObject<ArticleStrategy>(result.text, "strategy");
  strategy.platform = platform;
  strategy.contentFormat = brief.contentFormat;
  strategy.tone = brief.tone;
  strategy.targetLength = targetLength;
  validateStrategy(strategy);

  return { strategy, usage: result.usage };
}

export async function generateArticleDraft(
  input: ArticleGenerationInput,
  strategy: ArticleStrategy,
  brief = normalizeArticleBrief(input),
): Promise<{ draft: ArticleDraft; usage: LlmUsage }> {
  const productLink = input.article.ctaUrl ?? input.brand.siteUrl;
  const result = await generateText([
    {
      role: "system",
      content:
        "Ты пишешь русскоязычные статьи для VC.ru и Дзена как живой практик: конкретно, нативно, без AI-стиля и SEO-воды. Не выдумывай реальные факты о клиенте.",
    },
    {
      role: "user",
      content: `${jsonInstruction()}

Напиши draft статьи по strategy.

Strategy JSON:
${JSON.stringify(strategy, null, 2)}

Контекст бренда:
${formatBrandContext(input.brand)}

Контекст статьи:
${formatArticleContext(input.article)}

Нормализованный brief:
${JSON.stringify({ ...brief, brand: undefined }, null, 2)}

Единственная разрешенная ссылка:
${productLink ?? "не указана"}

Выход:
{
  "title": "...",
  "content": "markdown text..."
}

Правила:
- пиши живо, как человек, а не корпоративный блог;
- сгенерируй статью объемом 2500-4000 знаков;
- не превышай 5000 знаков ни при каких условиях;
- пиши компактно, без воды, без повторов, без длинных вступлений;
- используй 3-5 смысловых блоков, не делай слишком много разделов;
- выдерживай целевую длину ${strategy.targetLength.minChars}-${strategy.targetLength.maxChars} символов, но не растягивай водой;
- product block входит в общий объем;
- структура должна реально соответствовать contentFormat: ${strategy.contentFormat};
- тон должен реально менять язык статьи: ${strategy.tone};
- не начинай с общих фраз;
- первый абзац: боль, конфликт, наблюдение, провал, цифра или спорный тезис;
- запрещены фразы: "в современном мире", "одним из ключевых", "важным инструментом является", "на практике бывает сложно", "данный подход", "позволяет повысить эффективность", "комплексный подход", "актуальные и полезные материалы", "освобождает ресурсы для стратегических задач", "открывает новые возможности", "масштабирование процессов", "оптимизация работы команды";
- короткие и средние предложения;
- добавляй конкретику: цифры, ситуации, мини-кейсы, ограничения;
- поле "Угол/заметки" используй как факты, детали или пример;
- не выдавай факты из заметок за реальные, если это не следует из контекста;
- если данных нет или они выглядят условными, используй "условный пример", "типичная ситуация", "например";
- не упоминай неподдерживаемые площадки: Medium, Habr, Spark, Rusbase, Cossa, RBK;
- не перегружай SEO-ключами;
- не продавай в каждом блоке;
- продукт упомяни ближе к концу;
- в конце сделай отдельный аккуратный product block: что это за продукт, какие боли закрывает, кому подходит, мягкий CTA;
- если link передан, используй его один раз в product block;
- не заканчивай словом "купить";
- markdown разрешен только для подзаголовков и списков, без таблиц.`,
    },
  ], { maxTokens: 1800 });

  const draft = parseJsonObject<ArticleDraft>(result.text, "draft");
  draft.content = normalizeGeneratedContent(draft.content);
  validateDraft(draft);

  return { draft, usage: result.usage };
}

export async function polishArticleForPlatform(
  draft: ArticleDraft,
  strategy: ArticleStrategy,
  input?: ArticleGenerationInput,
  qualityIssues: string[] = [],
): Promise<{ polished: PolishedArticle; usage: LlmUsage }> {
  const productName = input?.brand.name ?? "AI Content Distribution Platform";
  const productLink = input?.article.ctaUrl ?? input?.brand.siteUrl ?? "не указана";
  const productCta =
    input?.article.ctaText ?? input?.brand.primaryCta ?? "Посмотреть демо";
  const platformName = strategy.platform === "vc" ? "VC.ru" : "Дзен";
  const unsupportedPlatformFoundInDraft = hasUnsupportedPlatformMention(
    `${draft.title}\n${draft.content}`,
  );
  const fakeCaseFoundInDraft = hasFakeCaseSignal(draft.content);

  const buildPolishMessages = (
    currentDraft: ArticleDraft,
    previousIssues: string[] = [],
  ) =>
    [
      {
        role: "system" as const,
        content:
          "Ты сильный выпускающий редактор VC.ru и Дзена. Твоя задача — довести статью до уровня 9/10: убрать корпоративный блог, добавить человеческую позицию, конфликт, конкретику и честный мягкий product block. Не обещай гарантированные лиды, SEO-рост, продажи или окупаемость.",
      },
      {
        role: "user" as const,
        content: `${jsonInstruction()}

Отполируй статью под платформу ${platformName}.

Strategy:
${JSON.stringify(strategy, null, 2)}

Draft:
${JSON.stringify(currentDraft, null, 2)}

Продукт:
- Название: ${productName}
- Что делает: AI-платформа для регулярной генерации, адаптации и публикации статей на VC.ru и Дзене.
- Позиционирование: органическое привлечение клиентов через контент-дистрибуцию.
- CTA: ${productCta}
- Ссылка: ${productLink}

${[...qualityIssues, ...previousIssues].length > 0 ? `Проблемы предыдущей версии, которые надо исправить:\n${[...qualityIssues, ...previousIssues].map((issue) => `- ${issue}`).join("\n")}` : ""}

Выход строго:
{
  "title": "...",
  "content": "...",
  "qualityScore": 1-10,
  "changed": ["что было улучшено"],
  "warnings": ["что осталось рискованным"],
  "detectedIssues": ["найденные проблемы до правки"],
  "platformFit": "vc" | "dzen"
}

Жесткие правила редактора:
- Заголовок не должен звучать как SEO-блог. Плохие паттерны: "Как повысить...", "Как улучшить...", "Почему бизнесу нужен...".
- Хороший заголовок содержит боль, конфликт, опыт, цифру, конкретику или честное ограничение.
- Первые 3-5 строк должны начинаться с боли, конфликта, денег, наблюдения, спорного тезиса или конкретной ситуации.
- Запрещены общие начала: "В современном мире", "Многие компании сталкиваются", "Контент-маркетинг является", "Одним из ключевых инструментов".
- Добавь человеческую позицию опытного основателя/маркетолога: "На практике проблема обычно не в текстах", "Чаще всё ломается раньше", "Три-четыре статьи в месяц почти ничего не меняют", "Если у сайта ещё нет авторитета, ждать SEO можно месяцами" — используй естественно, не обязательно дословно.
- Перепиши корпоративные фразы проще: "автоматизация позволяет масштабировать", "открывает доступ к новой аудитории", "освобождает ресурсы для стратегических задач", "повысить эффективность", "централизованный контроль", "релевантные площадки", "популярные ресурсы", "комплексный подход", "инструмент для оптимизации".
- В финальной статье можно упоминать только VC.ru и Дзен. Удали Medium, Habr, Spark, Rusbase, Cossa и любые неподдерживаемые площадки, если они появились.
- Не выдумывай реальные кейсы. Запрещено: "в одном из проектов", "наш клиент", "после внедрения у клиента вырос трафик", "мы получили X лидов".
- Если нужен пример, пиши: "условный пример", "типичная ситуация", "например", "в такой схеме".
- Убери любые гарантии: гарантированный рост трафика, гарантированные лиды, гарантированный SEO-эффект, продажи, окупаемость.
- Правильный смысл: это не гарантия лидов на следующий день, а способ быстрее тестировать темы, получать охваты и строить органический канал, который не зависит только от рекламного бюджета.
- Финал должен быть короче draft-финала: не повторять статью, честно объяснять продукт, показывать кому подходит, мягко вести к CTA и ссылке.
- Product block: ${productName} помогает запускать регулярную дистрибуцию статей на VC.ru и Дзене: генерировать материалы, адаптировать их под площадки и публиковать без ручной рутины. Это не замена стратегии и не гарантия лидов.
- Целевая длина всей статьи с product block: ${strategy.targetLength.minChars}-${strategy.targetLength.maxChars} символов, hard max 5000 знаков. Если длиннее — жестко сократи повторы, вступления и корпоративные абзацы.
- Не расширяй статью ради объема: 3-5 смысловых блоков достаточно.
- Формат ${strategy.contentFormat} должен быть виден в структуре, а не только указан в metadata.
- Тон ${strategy.tone} должен быть слышен в языке текста.
- Если платформа Дзен, не используй markdown-разметку: никаких ###, ##, **bold**, [text](url), backticks. Подзаголовки должны быть обычными строками.
- Запрещены AI/корпоративные фразы: "в современном мире", "одним из ключевых", "важным инструментом является", "данный подход", "позволяет повысить эффективность", "комплексный подход", "актуальные и полезные материалы", "освобождает ресурсы для стратегических задач", "открывает новые возможности", "масштабирование процессов", "оптимизация работы команды".

Quality gate:
- Не ставь qualityScore 8+ если заголовок SEO-блоговый, первый абзац общий, нет конфликта, нет конкретики, есть фальшивый кейс, есть неподдерживаемая площадка, есть гарантия результата, финал звучит как реклама, текст похож на корпоративный блог, статья сильно короче targetLength или структура не соответствует contentFormat.
- Если после первой оценки score ниже 8, перепиши слабые части внутри этого же ответа и верни уже исправленную версию.

Стиль платформы:
- VC.ru: больше позиции, меньше воды, чуть прямее и смелее, голос опытного фаундера/маркетолога, конфликт, цифры, честные ограничения.
- Дзен: проще язык, больше объяснения и структуры, меньше резкости, но без SEO-воды и корпоративного тона.`,
      },
    ];

  const result = await generateText(buildPolishMessages(draft), {
    maxTokens: 1800,
  });

  let polished = parseJsonObject<PolishedArticle>(result.text, "polish");
  polished.content = normalizeGeneratedContent(polished.content);
  validatePolished(polished);
  polished.platformFit = strategy.platform;

  if (polished.qualityScore < 8) {
    const retryDraft = {
      title: polished.title,
      content: polished.content,
    };
    const retry = await generateText(
      buildPolishMessages(retryDraft, [
        ...polished.detectedIssues,
        ...polished.warnings,
        `qualityScore ниже 8: ${polished.qualityScore}`,
      ]),
      { maxTokens: 1800 },
    );
    const retryPolished = parseJsonObject<PolishedArticle>(
      retry.text,
      "polish_retry",
    );
    retryPolished.content = normalizeGeneratedContent(retryPolished.content);
    validatePolished(retryPolished);
    retryPolished.platformFit = strategy.platform;
    polished = {
      ...retryPolished,
      changed: [
        ...polished.changed,
        "Повторная редактура после qualityScore ниже 8",
        ...retryPolished.changed,
      ],
      warnings: [...polished.warnings, ...retryPolished.warnings],
      detectedIssues: [
        ...polished.detectedIssues,
        ...retryPolished.detectedIssues,
      ],
    };
    logPolishQuality({
      draft,
      polished,
      unsupportedPlatformFoundInDraft,
      fakeCaseFoundInDraft,
      retried: true,
    });
    return {
      polished,
      usage: mergeUsage(result.usage, retry.usage),
    };
  }

  logPolishQuality({
    draft,
    polished,
    unsupportedPlatformFoundInDraft,
    fakeCaseFoundInDraft,
    retried: false,
  });

  return { polished, usage: result.usage };
}

export async function qualityCheckArticle(
  article: PolishedArticle,
  strategy: ArticleStrategy,
  brief: NormalizedArticleBrief,
): Promise<{ report: ArticleQualityReport; usage: LlmUsage }> {
  const actualArticleLength = getActualLength(article);
  const lengthFit = getLengthFit(actualArticleLength, strategy.targetLength);
  const result = await generateText([
    {
      role: "system",
      content:
        "Ты строгий quality editor для статей VC.ru и Дзена. Оцениваешь не комплиментарно, а как выпускающий редактор: слабые заголовки, общий первый абзац, корпоративный тон, вода, выдуманные кейсы и неверная структура должны снижать score.",
    },
    {
      role: "user",
      content: `${jsonInstruction()}

Оцени статью.

Brief:
${JSON.stringify({ ...brief, brand: undefined }, null, 2)}

Strategy:
${JSON.stringify(strategy, null, 2)}

Actual article length: ${actualArticleLength}
Length fit by deterministic check: ${lengthFit}
Dzen markdown safety: ${
        brief.platform === "dzen"
          ? hasUnsafeDzenMarkdown(article.content)
            ? "unsafe markdown found"
            : "ok"
          : "not applicable"
      }

Article:
${JSON.stringify(article, null, 2)}

Верни строго:
{
  "titleStrength": 1-10,
  "hookStrength": 1-10,
  "specificity": 1-10,
  "platformFit": 1-10,
  "humanTone": 1-10,
  "structure": 1-10,
  "usefulness": 1-10,
  "productMentionNaturalness": 1-10,
  "antiAiScore": 1-10,
  "lengthFit": 1-10,
  "overallScore": 1-10,
  "detectedIssues": ["..."],
  "warnings": ["..."],
  "rewriteRequired": boolean
}

Правила оценки:
- overallScore не может быть 8+, если заголовок общий или SEO-блоговый.
- overallScore не может быть 8+, если первый абзац общий.
- overallScore не может быть 8+, если нет конфликта/боли.
- overallScore не может быть 8+, если мало конкретики.
- overallScore не может быть 8+, если текст похож на корпоративный блог.
- overallScore не может быть 8+, если продукт впаривается.
- overallScore не может быть 8+, если есть выдуманные факты или фальшивые кейсы.
- overallScore не может быть 8+, если есть Medium, Habr, Spark, Rusbase, Cossa, RBK или другие неподдерживаемые площадки.
- overallScore не может быть 8+, если статья слишком короткая для targetLength.
- overallScore не может быть 8+, если статья растянута водой.
- overallScore не может быть 8+, если структура не соответствует contentFormat ${strategy.contentFormat}.
- Для Дзен overallScore не может быть 8+, если в статье есть ###, ##, **bold**, [text](url) или backticks.
- Если ${lengthFit} !== "ok", снизь lengthFit и overallScore.
- rewriteRequired = true, если overallScore < 8 или есть критичные нарушения.`,
    },
  ], { maxTokens: 1200 });

  const report = parseJsonObject<ArticleQualityReport>(result.text, "quality_check");
  validateQualityReport(report);

  if (lengthFit !== "ok") {
    report.lengthFit = Math.min(report.lengthFit, 6);
    report.overallScore = Math.min(report.overallScore, 7);
    report.rewriteRequired = true;
    report.detectedIssues.push(
      lengthFit === "too_short"
        ? `Статья короче минимума ${strategy.targetLength.minChars} символов.`
        : `Статья длиннее максимума ${strategy.targetLength.maxChars} символов.`,
    );
  }

  if (brief.platform === "dzen" && hasUnsafeDzenMarkdown(article.content)) {
    report.overallScore = Math.min(report.overallScore, 7);
    report.antiAiScore = Math.min(report.antiAiScore, 6);
    report.rewriteRequired = true;
    report.detectedIssues.push(
      "Для Дзена найдена markdown-разметка, которую нужно убрать перед публикацией.",
    );
  }

  if (
    hasUnsupportedPlatformMention(`${article.title}\n${article.content}`) ||
    hasFakeCaseSignal(article.content) ||
    hasGuaranteeSignal(article.content)
  ) {
    report.overallScore = Math.min(report.overallScore, 7);
    report.rewriteRequired = true;
  }

  return { report, usage: result.usage };
}

export async function generateArticle(
  input: ArticleGenerationInput,
  options: ArticleGenerationOptions = {},
): Promise<GeneratedArticle> {
  options.onStep?.("normalize");
  const brief = normalizeArticleBrief(input);

  options.onStep?.("strategy");
  devLog("strategy:start");
  const { strategy, usage: strategyUsage } = await generateArticleStrategy(
    input,
    brief,
  );
  devLog("strategy:done", {
    platform: strategy.platform,
    format: strategy.contentFormat,
    title: strategy.selectedTitle,
    targetLength: strategy.targetLength,
  });

  options.onStep?.("draft");
  devLog("draft:start");
  const { draft, usage: draftUsage } = await generateArticleDraft(
    input,
    strategy,
    brief,
  );
  devLog("draft:done", { length: draft.content.length });

  let finalArticle: PolishedArticle;
  let polishUsage: LlmUsage | null = null;
  let qualityUsage: LlmUsage | null = null;
  let rewriteUsage: LlmUsage | null = null;
  let qualityReport: ArticleQualityReport | null = null;
  const warnings: string[] = [];

  try {
    options.onStep?.("polish");
    devLog("polish:start");
    const polishedResult = await polishArticleForPlatform(draft, strategy, input);
    finalArticle = polishedResult.polished;
    polishUsage = polishedResult.usage;

    options.onStep?.("quality_check");
    const qualityResult = await qualityCheckArticle(finalArticle, strategy, brief);
    qualityReport = qualityResult.report;
    qualityUsage = qualityResult.usage;
    devLog("quality:done", {
      contentFormat: strategy.contentFormat,
      tone: strategy.tone,
      selectedTitle: strategy.selectedTitle,
      targetLength: strategy.targetLength,
      actualArticleLength: getActualLength(finalArticle),
      qualityScore: qualityReport.overallScore,
      lengthFit: qualityReport.lengthFit,
      detectedIssues: qualityReport.detectedIssues,
      warnings: qualityReport.warnings,
      rewriteTriggered: qualityReport.rewriteRequired,
    });

    if (qualityReport.rewriteRequired || qualityReport.overallScore < 8) {
      options.onStep?.("rewrite");
      const rewriteResult = await polishArticleForPlatform(
        {
          title: finalArticle.title,
          content: finalArticle.content,
        },
        strategy,
        input,
        [
          ...qualityReport.detectedIssues,
          ...qualityReport.warnings,
          `overallScore: ${qualityReport.overallScore}`,
          `targetLength: ${strategy.targetLength.minChars}-${strategy.targetLength.maxChars}`,
        ],
      );
      finalArticle = rewriteResult.polished;
      rewriteUsage = rewriteResult.usage;

      const secondQuality = await qualityCheckArticle(finalArticle, strategy, brief);
      qualityReport = secondQuality.report;
      qualityUsage = qualityUsage
        ? mergeUsage(qualityUsage, secondQuality.usage)
        : secondQuality.usage;
    }

    warnings.push(...finalArticle.warnings);
    warnings.push(...(qualityReport?.warnings ?? []));
    devLog("polish:done", {
      qualityScore: finalArticle.qualityScore,
      length: finalArticle.content.length,
    });
  } catch (error) {
    options.onStep?.("polish_fallback");
    const message =
      error instanceof Error ? error.message : "Polish stage failed.";
    warnings.push(`Polish fallback: ${message}`);
    devLog("polish:fallback", { error: message });
    finalArticle = {
      title: draft.title,
      content: draft.content,
      qualityScore: 7,
      changed: [],
      warnings,
      detectedIssues: [],
      platformFit: strategy.platform,
    };
  }

  return {
    title: finalArticle.title,
    content: finalArticle.content,
    platformDraft: draft.content,
    strategy,
    draft,
    polished: finalArticle,
    qualityReport,
    warnings,
    usage: mergeUsage(
      strategyUsage,
      draftUsage,
      ...(polishUsage ? [polishUsage] : []),
      ...(qualityUsage ? [qualityUsage] : []),
      ...(rewriteUsage ? [rewriteUsage] : []),
    ),
  };
}
