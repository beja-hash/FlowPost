import { ZodError } from "zod";
import { NextRequest, NextResponse } from "next/server";

import {
  createDistributionAsset,
  DistributionServiceError,
  listDistributionAssetsByUser,
  listPlatformOptions,
} from "@/features/distribution/server/distribution-service";
import { createDistributionAssetSchema } from "@/features/distribution/server/distribution-schemas";
import { listBrandOptions } from "@/features/brands/server/brand-service";
import { requireSession } from "@/infrastructure/auth/session";

function toErrorResponse(error: unknown) {
  if (error instanceof DistributionServiceError) {
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
          code: "INVALID_DISTRIBUTION_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректные данные публикации.",
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
        message: "Не удалось обработать запрос публикации.",
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

    const [assets, brands, platforms] = await Promise.all([
      listDistributionAssetsByUser(session.user.id),
      listBrandOptions(session.user.id),
      listPlatformOptions(),
    ]);

    return NextResponse.json({
      assets,
      brands,
      platforms,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const payload = createDistributionAssetSchema.parse(await request.json());
    const asset = await createDistributionAsset(session.user.id, payload);

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
