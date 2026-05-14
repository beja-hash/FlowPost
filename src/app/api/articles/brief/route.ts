import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  BriefGenerationError,
  generateBriefField,
  generateFullBrief,
} from "@/services/article-brief-generator";
import { requireSession } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const currentBriefSchema = z
  .object({
    targetAudience: z.string().optional(),
    readerPain: z.string().optional(),
    mainThesis: z.string().optional(),
    factsExample: z.string().optional(),
    cta: z.string().optional(),
    link: z.string().optional(),
  })
  .optional();

const requestSchema = z.object({
  mode: z.enum(["field", "full"]),
  targetField: z
    .enum(["targetAudience", "readerPain", "mainThesis", "factsExample", "topic"])
    .optional(),
  brandId: z.string().cuid(),
  platform: z.enum(["vc", "dzen"]),
  topic: z.string().optional(),
  keyword: z.string().optional(),
  contentFormat: z.string().optional(),
  tone: z.string().optional(),
  currentBrief: currentBriefSchema,
});

function toErrorResponse(error: unknown) {
  if (error instanceof BriefGenerationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BRIEF_GENERATION_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректный запрос.",
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "BRIEF_GENERATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Не удалось сгенерировать бриф.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const payload = requestSchema.parse(await request.json());

    if (payload.mode === "field") {
      if (!payload.targetField) {
        return NextResponse.json(
          {
            error: {
              code: "TARGET_FIELD_REQUIRED",
              message: "Укажите поле для генерации.",
            },
          },
          { status: 400 },
        );
      }

      const result = await generateBriefField(session.user.id, {
        ...payload,
        targetField: payload.targetField,
      });
      return NextResponse.json({ result });
    }

    const result = await generateFullBrief(session.user.id, payload);
    return NextResponse.json({ result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
