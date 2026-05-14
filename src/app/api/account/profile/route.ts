import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { auth } from "@/infrastructure/auth/session";
import { prisma } from "@/infrastructure/db/prisma";

const profileSchema = z.object({
  name: z.string().trim().min(2, "Имя должно быть не короче 2 символов.").max(120),
});

function toErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PROFILE_PAYLOAD",
          message: error.issues[0]?.message ?? "Некорректные данные профиля.",
        },
      },
      { status: 400 },
    );
  }

  console.error("[api/account/profile:error]", error);

  return NextResponse.json(
    {
      error: {
        code: "PROFILE_UPDATE_FAILED",
        message: "Не удалось обновить профиль.",
      },
    },
    { status: 500 },
  );
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Требуется авторизация." } },
        { status: 401 },
      );
    }

    const payload = profileSchema.parse(await request.json());
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { name: payload.name },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    return toErrorResponse(error);
  }
}
