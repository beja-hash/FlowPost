"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandListItem, CreateBrandPayload } from "@/features/brands/types";

type FormState = CreateBrandPayload;

const initialForm: FormState = {
  name: "",
  siteUrl: "",
  industry: "",
  geography: "",
  targetAudience: "",
  primaryCta: "",
  description: "",
};

function isValidUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return true;
  }

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return Boolean(url.hostname.includes("."));
  } catch {
    return false;
  }
}

export function BrandCreatePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField<K extends keyof FormState>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError("Укажите название бренда.");
      return;
    }

    if (!isValidUrl(form.siteUrl)) {
      setError("Укажите сайт в формате https://site.ru или site.ru.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/brands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });

        const body = (await response.json()) as
          | { brand: BrandListItem }
          | { error: { message: string } };

        if (!response.ok || !("brand" in body)) {
          throw new Error(
            "error" in body ? body.error.message : "Не удалось сохранить бренд.",
          );
        }

        toast.success("Бренд создан.");
        router.push("/brands");
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Не удалось сохранить бренд.",
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href="/brands" />}
            className="-ml-2 mb-3 text-muted-foreground"
          >
            <ArrowLeft />
            Назад к брендам
          </Button>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Новый бренд
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Добавьте продукт, для которого будут генерироваться статьи и публикации.
          </p>
        </div>
      </div>

      <form
        className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"
        onSubmit={handleSubmit}
      >
        <Card className="rounded-[1.5rem] border-border/45 bg-card/76 py-0 ring-1 ring-white/10">
          <CardContent className="space-y-6 p-5 sm:p-6">
            {error ? (
              <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Название бренда" htmlFor="brand-name" required>
                <Input
                  id="brand-name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="Например, ФинТрек"
                  autoFocus
                  aria-invalid={error === "Укажите название бренда."}
                />
              </Field>

              <Field label="Сайт" htmlFor="brand-site">
                <Input
                  id="brand-site"
                  value={form.siteUrl}
                  onChange={(event) => updateField("siteUrl", event.target.value)}
                  placeholder="https://site.ru"
                  inputMode="url"
                />
              </Field>

              <Field label="Ниша" htmlFor="brand-industry">
                <Input
                  id="brand-industry"
                  value={form.industry}
                  onChange={(event) => updateField("industry", event.target.value)}
                  placeholder="SaaS, медицина, юридические услуги"
                />
              </Field>

              <Field label="Гео" htmlFor="brand-geo">
                <Input
                  id="brand-geo"
                  value={form.geography}
                  onChange={(event) => updateField("geography", event.target.value)}
                  placeholder="СНГ"
                />
              </Field>

              <Field label="Аудитория" htmlFor="brand-audience">
                <Input
                  id="brand-audience"
                  value={form.targetAudience}
                  onChange={(event) =>
                    updateField("targetAudience", event.target.value)
                  }
                  placeholder="Кому продаем"
                />
              </Field>

              <Field label="Призыв к действию" htmlFor="brand-cta">
                <Input
                  id="brand-cta"
                  value={form.primaryCta}
                  onChange={(event) => updateField("primaryCta", event.target.value)}
                  placeholder="Оставить заявку"
                />
              </Field>
            </div>

            <Field label="Описание продукта" htmlFor="brand-description">
              <Textarea
                id="brand-description"
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
                rows={7}
                placeholder="Коротко: что продаем, кому и какую проблему решаем"
                className="min-h-40"
              />
            </Field>

            <div className="flex flex-col-reverse gap-3 border-t border-border/25 pt-5 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                nativeButton={false}
                render={<Link href="/brands" />}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                {isPending ? "Сохранение..." : "Сохранить бренд"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <aside className="space-y-4">
          <Card className="rounded-[1.5rem] border-border/45 bg-card/70 py-0 ring-1 ring-white/10">
            <CardContent className="p-5">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <h2 className="mt-5 text-base font-semibold">Зачем нужен бренд?</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Эти данные используются для генерации тем, статей и адаптации
                публикаций под разные платформы.
              </p>
            </CardContent>
          </Card>
        </aside>
      </form>
    </div>
  );
}

type FieldProps = {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
  required?: boolean;
};

function Field({ children, htmlFor, label, required = false }: FieldProps) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium text-foreground" htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </label>
      {children}
    </div>
  );
}
