import { ZodError } from "zod";
import { NextRequest, NextResponse } from "next/server";

import {
  archiveDistributionAsset,
  DistributionServiceError,
  updateDistributionAsset,
} from "@/features/distribution/server/distribution-service";
import {
  assetIdSchema,
  updateDistributionAssetSchema,
} from "@/features/distribution/server/distribution-schemas";
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
          code: "INVALID_DISTRIBUTION_REQUEST",
          message: error.issues[0]?.message ?? "Некорректный запрос публикации.",
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

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { assetId: rawAssetId } = await context.params;
    const assetId = assetIdSchema.parse(rawAssetId);
    const payload = updateDistributionAssetSchema.parse(await request.json());

    const asset = await updateDistributionAsset(session.user.id, assetId, payload);

    return NextResponse.json({ asset });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { assetId: rawAssetId } = await context.params;
    const assetId = assetIdSchema.parse(rawAssetId);

    await archiveDistributionAsset(session.user.id, assetId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
