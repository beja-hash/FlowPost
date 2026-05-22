"use client";

import { FormEvent, useState, useTransition } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function toLocalPath(url: string) {
  try {
    const nextUrl = new URL(url);
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return url;
  }
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    startTransition(() => {
      void signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      })
        .then((result) => {
          if (!result || result.error) {
            setError("Неверный email или пароль.");
            return;
          }

          router.push(toLocalPath(result.url ?? callbackUrl));
          router.refresh();
        })
        .catch(() => {
          setError("Не удалось войти. Попробуйте ещё раз.");
        });
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-3">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Рабочая почта"
          required
          className="h-12 rounded-2xl border-border/45 bg-background/70 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.38)] focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/20"
        />
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Пароль"
          required
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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button
        type="submit"
        className="h-12 w-full rounded-2xl text-sm"
        size="lg"
        disabled={isPending}
      >
        {isPending ? <Loader2 className="animate-spin" /> : null}
        Продолжить
        <ArrowRight />
      </Button>
    </form>
  );
}
