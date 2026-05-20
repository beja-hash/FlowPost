import OpenAI from "openai";

import { debugLog } from "@/lib/debug-log";

export const DEFAULT_ARTICLE_GENERATION_MODEL = "openai/gpt-4.1-mini";
export const POLZA_BASE_URL = "https://polza.ai/api/v1";

let client: OpenAI | null = null;

export type LlmUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

export type GeneratedTextResult = {
  text: string;
  usage: LlmUsage;
};

const MODEL_PRICING_USD_PER_1M_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "openai/gpt-4.1-mini": {
    input: 0.4,
    output: 1.6,
  },
};

export function getArticleGenerationModel() {
  return process.env.MODEL_ARTICLE_GENERATION ?? DEFAULT_ARTICLE_GENERATION_MODEL;
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const pricing = MODEL_PRICING_USD_PER_1M_TOKENS[model];

  if (!pricing) {
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return Number((inputCost + outputCost).toFixed(6));
}

export function getLlmClient() {
  if (!process.env.POLZA_API_KEY) {
    throw new Error("POLZA_API_KEY is not configured.");
  }

  client ??= new OpenAI({
    apiKey: process.env.POLZA_API_KEY,
    baseURL: POLZA_BASE_URL,
  });

  return client;
}

export async function generateText(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  options: { maxTokens?: number } = {},
): Promise<GeneratedTextResult> {
  const model = getArticleGenerationModel();
  const completion = await getLlmClient().chat.completions.create({
    model,
    temperature: 0.7,
    max_tokens: options.maxTokens,
    messages,
  });

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;
  const estimatedCost = estimateCostUsd(model, inputTokens, outputTokens);

  debugLog("[llm]", {
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost: estimatedCost,
  });

  return {
    text: completion.choices[0]?.message.content?.trim() ?? "",
    usage: {
      model,
      inputTokens,
      outputTokens,
      totalTokens: completion.usage?.total_tokens ?? inputTokens + outputTokens,
      estimatedCost,
    },
  };
}
