import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json(
    {
      error: {
        code: "ROUTE_MOVED",
        message: "Проекты заменены брендами. Используйте /api/brands/:brandId.",
      },
    },
    {
      status: 410,
    },
  );
}

export const DELETE = PATCH;
