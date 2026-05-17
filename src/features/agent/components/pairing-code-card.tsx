"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";

type PairingCodeCardProps = {
  isAuthenticated: boolean;
};

type PairingState = {
  code: string;
  expiresAt: string;
};

type PairingResponse =
  | {
      ok: true;
      code: string;
      expiresAt: string;
    }
  | {
      ok: false;
      error: "UNAUTHORIZED" | "DATABASE_ERROR" | "INTERNAL_ERROR";
      message: string;
    };

export function PairingCodeCard({ isAuthenticated }: PairingCodeCardProps) {
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function createPairingCode() {
    setIsCreating(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/agent/pairing/create", {
        method: "POST",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => null)) as
        | PairingResponse
        | null;

      if (!response.ok) {
        throw new Error(
          body && !body.ok
            ? body.message
            : "Не удалось создать код подключения. Попробуйте еще раз или напишите в поддержку.",
        );
      }

      if (!body?.ok) {
        throw new Error(
          body && !body.ok
            ? body.message
            : "Не удалось создать код подключения. Попробуйте еще раз или напишите в поддержку.",
        );
      }

      if (!body.code || !body.expiresAt) {
        throw new Error(
          "Не удалось создать код подключения. Попробуйте еще раз или напишите в поддержку.",
        );
      }

      setPairing({
        code: body.code,
        expiresAt: body.expiresAt,
      });
      toast.success("Код подключения создан.");
    } catch (error) {
      console.error("[agent-pairing:create]", error);
      const message =
        error instanceof TypeError
          ? "Нет связи с сервером. Проверьте интернет и повторите попытку."
          : error instanceof Error
            ? error.message
            : "Не удалось создать код подключения. Попробуйте еще раз или напишите в поддержку.";

      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  }

  async function copyCode() {
    if (!pairing) return;

    try {
      await navigator.clipboard.writeText(pairing.code);
      toast.success("Код скопирован.");
    } catch {
      toast.info("Скопируйте код вручную.");
    }
  }

  return (
    <section className="border-border/70 bg-card/70 rounded-2xl border p-6">
      <h2 className="text-2xl font-semibold">Код подключения</h2>
      <p className="text-muted-foreground mt-4 text-base leading-7">
        После установки FlowPost Agent откройте приложение и вставьте этот код.
        Код одноразовый и действует 15 минут.
      </p>

      {isAuthenticated ? (
        <div className="mt-5 space-y-5">
          <Button
            type="button"
            onClick={() => void createPairingCode()}
            disabled={isCreating}
          >
            {isCreating ? "Создаем код..." : "Создать код подключения"}
          </Button>

          {errorMessage ? (
            <p className="text-destructive text-sm">{errorMessage}</p>
          ) : null}

          {pairing ? (
            <div className="bg-background/80 border-border/60 rounded-xl border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-3xl font-semibold tracking-[0.18em]">
                  {pairing.code}
                </p>
                <Button type="button" variant="outline" onClick={copyCode}>
                  Скопировать
                </Button>
              </div>
              <p className="text-muted-foreground mt-3 text-sm">
                Код действует 15 минут.
              </p>
              <ol className="text-muted-foreground mt-4 grid gap-2 text-sm leading-6">
                {[
                  "Скачайте и откройте FlowPost Agent",
                  "Вставьте код в приложение",
                  "Дождитесь статуса “Agent подключен”",
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="bg-primary/12 text-primary grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-muted-foreground text-sm">
            Войдите в аккаунт FlowPost, чтобы создать код подключения.
          </p>
          <Link href="/sign-in" className={buttonVariants({ className: "mt-4" })}>
            Войти
          </Link>
        </div>
      )}
    </section>
  );
}
