"use client";

import { FormEvent, useState, useTransition } from "react";
import Link from "next/link";
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

export function RegisterForm() {
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
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    startTransition(() => {
      void fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => ({}))) as {
            error?: { message?: string };
          };

          if (!response.ok) {
            throw new Error(body.error?.message ?? "Не удалось создать аккаунт.");
          }

          const result = await signIn("credentials", {
            email,
            password,
            redirect: false,
            callbackUrl,
          });

          if (!result || result.error) {
            router.push("/sign-in");
            router.refresh();
            return;
          }

          router.push(toLocalPath(result.url ?? callbackUrl));
          router.refresh();
        })
        .catch((nextError) => {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Не удалось создать аккаунт.",
          );
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
          autoComplete="new-password"
          placeholder="Пароль"
          minLength={8}
          required
          className="h-12 rounded-2xl border-border/45 bg-background/70 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.38)] focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/20"
        />
        <Input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Повторите пароль"
          minLength={8}
          required
          className="h-12 rounded-2xl border-border/45 bg-background/70 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.38)] focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/20"
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button
        type="submit"
        className="h-12 w-full rounded-2xl text-sm"
        size="lg"
        disabled={isPending}
      >
        {isPending ? <Loader2 className="animate-spin" /> : null}
        Зарегистрироваться
        <ArrowRight />
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Уже есть аккаунт?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-foreground transition-colors hover:text-primary"
        >
          Войти
        </Link>
      </p>
    </form>
  );
}
