import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  ArticleWorkflowError,
  generateArticleForUser,
} from "@/services/article-workflow";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const generateSchema = z.object({
  articleId: z.string().cuid(),
});

function toErrorResponse(error: unknown) {
  console.error("[api/articles/generate:error]", {
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
  });

  if (error instanceof ArticleWorkflowError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ARTICLE_GENERATE_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректный запрос.",
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "ARTICLE_GENERATION_FAILED",
        message:
          error instanceof Error ? error.message : "Не удалось сгенерировать статью.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Требуется авторизация." } },
        { status: 401 },
      );
    }

    const payload = generateSchema.parse(await request.json());
    const article = await generateArticleForUser(session.user.id, payload.articleId);

    return NextResponse.json({ article });
  } catch (error) {
    return toErrorResponse(error);
  }
}
