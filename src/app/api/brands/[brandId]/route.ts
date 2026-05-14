import { ZodError } from "zod";
import { NextRequest, NextResponse } from "next/server";

import {
  archiveBrand,
  BrandServiceError,
  updateBrand,
} from "@/features/brands/server/brand-service";
import {
  brandIdSchema,
  updateBrandSchema,
} from "@/features/brands/server/brand-schemas";
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
          code: "INVALID_BRAND_REQUEST",
          message: error.issues[0]?.message ?? "Некорректный запрос бренда.",
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

type RouteContext = {
  params: Promise<{
    brandId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { brandId: rawBrandId } = await context.params;
    const brandId = brandIdSchema.parse(rawBrandId);
    const payload = updateBrandSchema.parse(await request.json());

    const brand = await updateBrand(session.user.id, brandId, payload);

    return NextResponse.json({ brand });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { brandId: rawBrandId } = await context.params;
    const brandId = brandIdSchema.parse(rawBrandId);

    await archiveBrand(session.user.id, brandId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
