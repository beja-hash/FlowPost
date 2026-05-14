import { ZodError } from "zod";
import { NextRequest, NextResponse } from "next/server";

import {
  BrandServiceError,
  createBrand,
  listBrandsByUser,
} from "@/features/brands/server/brand-service";
import { createBrandSchema } from "@/features/brands/server/brand-schemas";
import { requireSession } from "@/infrastructure/auth/session";

function toErrorResponse(error: unknown) {
  if (error instanceof BrandServiceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      {
        status: error.statusCode,
      },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BRAND_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректные данные бренда.",
        },
      },
      {
        status: 400,
      },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Не удалось обработать запрос бренда.",
      },
    },
    {
      status: 500,
    },
  );
}

export async function GET() {
  try {
    const session = await requireSession();
    const result = await listBrandsByUser(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const payload = createBrandSchema.parse(await request.json());
    const brand = await createBrand(session.user.id, payload);

    return NextResponse.json({ brand }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
