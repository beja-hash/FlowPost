import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: {
        code: "ROUTE_MOVED",
        message: "Проекты заменены брендами. Используйте /api/brands.",
      },
    },
    {
      status: 410,
    },
  );
}

export const POST = GET;
