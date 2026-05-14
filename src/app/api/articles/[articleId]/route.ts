import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json(
    {
      error: {
        code: "ROUTE_MOVED",
        message:
          "Статьи теперь управляются через материалы публикаций. Используйте /api/assets/:assetId.",
      },
    },
    {
      status: 410,
    },
  );
}

export const DELETE = PATCH;
