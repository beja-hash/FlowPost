import { redirect } from "next/navigation";

import { Brand } from "@/components/brand";
import { Card, CardContent } from "@/components/ui/card";
import { GoogleSignInButton } from "@/features/auth/components/google-sign-in-button";
import { RegisterForm } from "@/features/auth/components/register-form";
import { auth } from "@/infrastructure/auth/session";
import { debugLog } from "@/lib/debug-log";

export default async function RegisterPage() {
  const session = await auth();

  if (session?.user?.id) {
    debugLog("[auth:register-page] redirect authenticated user to /dashboard", {
      userId: session.user.id,
    });
    redirect("/dashboard");
  }

  return (
    <div className="w-full max-w-md">
      <Card className="rounded-[1.8rem] border-border/35 bg-card/84 py-0 shadow-[0_34px_120px_-62px_rgba(15,23,42,0.72)] ring-1 ring-white/12 backdrop-blur-xl">
        <CardContent className="space-y-6 px-5 py-6 sm:px-7 sm:py-7">
          <div className="flex justify-center">
            <Brand />
          </div>

          <div className="text-center">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              Создать аккаунт
            </h1>
          </div>

          <GoogleSignInButton>Продолжить через Google</GoogleSignInButton>

          <RegisterForm />
        </CardContent>
      </Card>
    </div>
  );
}
