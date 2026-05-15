import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { Brand } from "@/components/brand";
import { GoogleSignInButton } from "@/features/auth/components/google-sign-in-button";
import { auth } from "@/infrastructure/auth/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { debugLog } from "@/lib/debug-log";

export default async function SignInPage() {
  const session = await auth();

  if (session?.user?.id) {
    debugLog("[auth:sign-in-page] redirect authenticated user to /dashboard", {
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
              Вход в аккаунт
            </h1>
          </div>

          <form className="space-y-4">
            <div className="space-y-3">
              <Input
                type="email"
                autoComplete="email"
                placeholder="Рабочая почта"
                className="h-12 rounded-2xl border-border/45 bg-background/70 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.38)] focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/20"
              />
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Пароль"
                className="h-12 rounded-2xl border-border/45 bg-background/70 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.38)] focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Забыли пароль?
              </button>
            </div>

            <Button className="h-12 w-full rounded-2xl text-sm" size="lg">
              Продолжить
              <ArrowRight />
            </Button>
          </form>

          <GoogleSignInButton />

          <p className="text-center text-sm text-muted-foreground">
            Нет аккаунта?{" "}
            <button
              type="button"
              className="font-medium text-foreground transition-colors hover:text-primary"
            >
              Создать
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
