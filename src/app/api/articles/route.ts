import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: {
        code: "ROUTE_MOVED",
        message: "Статьи теперь управляются через материалы публикаций. Используйте /api/assets.",
      },
    },
    {
      status: 410,
    },
  );
}

export const POST = GET;
