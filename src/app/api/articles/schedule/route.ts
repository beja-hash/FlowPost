import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { scheduleArticleForUser } from "@/services/article-generation-workflow";
import { ArticleWorkflowError } from "@/services/article-workflow-error";
import { auth } from "@/infrastructure/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scheduleSchema = z.object({
  articleId: z.string().cuid(),
  publishAt: z.string().datetime(),
  selectedLocalTime: z.string().optional(),
  browserTimezone: z.string().optional().nullable(),
});

function toErrorResponse(error: unknown) {
  console.error("[api/articles/schedule:error]", {
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
          code: "INVALID_ARTICLE_SCHEDULE_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректный запрос.",
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { error: { code: "ARTICLE_SCHEDULE_FAILED", message: "Не удалось запланировать статью." } },
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

    const payload = scheduleSchema.parse(await request.json());
    const result = await scheduleArticleForUser(
      session.user.id,
      payload.articleId,
      payload.publishAt,
      {
        selectedLocalTime: payload.selectedLocalTime,
        browserTimezone: payload.browserTimezone,
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
