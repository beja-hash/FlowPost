import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { ArticleWorkflowError } from "@/services/article-workflow-error";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const publishSchema = z.object({
  articleId: z.string().cuid(),
});

function toErrorResponse(error: unknown) {
  console.error("[api/articles/publish:error]", {
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
          code: "INVALID_ARTICLE_PUBLISH_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректный запрос.",
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "ARTICLE_PUBLISH_FAILED",
        message: error instanceof Error ? error.message : "Не удалось опубликовать статью.",
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

    const payload = publishSchema.parse(await request.json());
    const { publishArticleForUser } = await import("@/services/article-workflow");
    const result = await publishArticleForUser(session.user.id, payload.articleId);

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
