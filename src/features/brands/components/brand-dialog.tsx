"use client";

import { useState, useTransition } from "react";
import { Edit3 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { BrandListItem } from "../types";

type BrandDialogProps = {
  brand: BrandListItem;
  onSaved: (brand: BrandListItem) => void;
};

function getInitialForm(brand: BrandListItem) {
  return {
    name: brand.name,
    siteUrl: brand.siteUrl,
    description: brand.description ?? "",
    industry: brand.industry ?? "",
    geography: brand.geography ?? "",
    targetAudience: brand.targetAudience ?? "",
    primaryCta: brand.primaryCta ?? "",
  };
}

export function BrandDialog({ brand, onSaved }: BrandDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => getInitialForm(brand));
  const [isPending, startTransition] = useTransition();

  function updateField<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = await fetch(`/api/brands/${brand.id}`, {
          method: "PATCH",
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

        onSaved(body.brand);
        toast.success("Бренд обновлен.");
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Не удалось сохранить бренд.",
        );
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setForm(getInitialForm(brand));
        }
      }}
    >
      <DialogTrigger
        render={<Button size="sm" variant="outline" />}
      >
        <Edit3 />
        Изменить
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Редактировать бренд</DialogTitle>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={`${brand?.id ?? "new"}-brand-name`}>
              Название
            </label>
            <Input
              id={`${brand?.id ?? "new"}-brand-name`}
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="Например, ФинТрек"
              required
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={`${brand?.id ?? "new"}-brand-url`}>
              Сайт
            </label>
            <Input
              id={`${brand?.id ?? "new"}-brand-url`}
              value={form.siteUrl}
              onChange={(event) => updateField("siteUrl", event.target.value)}
              placeholder="https://site.ru"
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor={`${brand?.id ?? "new"}-brand-industry`}>
                Ниша
              </label>
              <Input
                id={`${brand?.id ?? "new"}-brand-industry`}
                value={form.industry}
                onChange={(event) => updateField("industry", event.target.value)}
                placeholder="ИТ, медицина, юристы"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor={`${brand?.id ?? "new"}-brand-geo`}>
                Гео
              </label>
              <Input
                id={`${brand?.id ?? "new"}-brand-geo`}
                value={form.geography}
                onChange={(event) => updateField("geography", event.target.value)}
                placeholder="СНГ"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={`${brand?.id ?? "new"}-brand-audience`}>
              Аудитория
            </label>
            <Input
              id={`${brand?.id ?? "new"}-brand-audience`}
              value={form.targetAudience}
              onChange={(event) => updateField("targetAudience", event.target.value)}
              placeholder="Кому продаем"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={`${brand?.id ?? "new"}-brand-cta`}>
              Призыв к действию
            </label>
            <Input
              id={`${brand?.id ?? "new"}-brand-cta`}
              value={form.primaryCta}
              onChange={(event) => updateField("primaryCta", event.target.value)}
              placeholder="Оставить заявку"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor={`${brand?.id ?? "new"}-brand-description`}>
              Описание продукта
            </label>
            <Textarea
              id={`${brand?.id ?? "new"}-brand-description`}
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
              rows={4}
              placeholder="Коротко: что продаем и кому"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
