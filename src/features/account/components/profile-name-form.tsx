"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProfileNameFormProps = {
  initialName?: string | null;
};

export function ProfileNameForm({ initialName }: ProfileNameFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? "");
  const [isPending, startTransition] = useTransition();

  const trimmedName = name.trim();
  const hasChanges = trimmedName !== (initialName ?? "").trim();

  async function saveName() {
    if (!trimmedName) {
      toast.error("Укажите имя.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/account/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Не удалось сохранить имя.");
        }

        toast.success("Имя обновлено.");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Не удалось сохранить имя.",
        );
      }
    });
  }

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Ваше имя"
        aria-label="Имя пользователя"
        className="h-11 bg-background/70"
      />
      <Button
        type="button"
        onClick={saveName}
        disabled={isPending || !hasChanges}
        className="h-11"
      >
        <Save />
        {isPending ? "Сохраняем" : "Изменить имя"}
      </Button>
    </div>
  );
}
