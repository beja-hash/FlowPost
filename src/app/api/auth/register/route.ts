import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { UserStatus } from "@prisma/client";

import { hashPassword } from "@/infrastructure/auth/password";
import { prisma } from "@/infrastructure/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  email: z.string().trim().email("Введите корректный email.").max(320),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов.").max(128),
});

function toErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REGISTER_PAYLOAD",
          message: error.issues[0]?.message ?? "Проверьте email и пароль.",
        },
      },
      { status: 400 },
    );
  }

  console.error("[api/auth/register:error]", error);
  return NextResponse.json(
    {
      error: {
        code: "REGISTER_FAILED",
        message: "Не удалось создать аккаунт.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = registerSchema.parse(await request.json());
    const email = payload.email.toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        {
          error: {
            code: "EMAIL_ALREADY_EXISTS",
            message: "Этот email уже занят. Войдите в аккаунт или используйте другой email.",
          },
        },
        { status: 409 },
      );
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(payload.password),
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        email: true,
      },
    });

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return toErrorResponse(error);
  }
}
