import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function authorizeCron(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.CRON_SECRET && token === env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Cron secret is invalid." } },
      { status: 401 },
    );
  }

  try {
    const { publishDueScheduledArticles } = await import(
      "@/services/article-workflow"
    );
    const result = await publishDueScheduledArticles();

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/articles/scheduler/run:error]", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
    });

    return NextResponse.json(
      {
        error: {
          code: "SCHEDULER_FAILED",
          message: "Не удалось запустить планировщик статей.",
        },
      },
      { status: 500 },
    );
  }
}
