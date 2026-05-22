"use client";

import { useState, useTransition } from "react";
import { PublicationStatus, TopicIntent } from "@prisma/client";
import { Edit3, Plus } from "lucide-react";
import { toast } from "sonner";

import type { BrandOption } from "@/features/brands/types";
import type {
  CreateDistributionAssetPayload,
  DistributionAssetListItem,
  PlatformOption,
  UpdateDistributionAssetPayload,
} from "@/features/distribution/types";
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

type AssetEditorDialogProps = {
  mode: "create" | "edit";
  brands: BrandOption[];
  platforms: PlatformOption[];
  asset?: DistributionAssetListItem;
  onCreated?: (asset: DistributionAssetListItem) => void;
  onUpdated?: (asset: DistributionAssetListItem) => void;
};

function toDatetimeLocalValue(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocalValue(value: string) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function getInitialState(
  brands: BrandOption[],
  platforms: PlatformOption[],
  asset?: DistributionAssetListItem,
) {
  return {
    title: asset?.title ?? "",
    canonicalBody: asset?.canonicalBody ?? "",
    brandId: asset?.brandId ?? brands[0]?.id ?? "",
    platformId: asset?.platformId ?? platforms[0]?.id ?? "",
    summary: asset?.summary ?? "",
    primaryKeyword: asset?.primaryKeyword ?? "",
    ctaText: asset?.ctaText ?? "",
    ctaUrl: asset?.ctaUrl ?? "",
    intent: asset?.intent ?? "",
    scheduledAt: toDatetimeLocalValue(asset?.scheduledAt),
    publicationStatus: asset?.publicationStatus ?? PublicationStatus.PLANNED,
  };
}

export function AssetEditorDialog({
  mode,
  brands,
  platforms,
  asset,
  onCreated,
  onUpdated,
}: AssetEditorDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(() => getInitialState(brands, platforms, asset));
  const bodyLength = form.canonicalBody.trim().length;
  const bodyTooShort = bodyLength > 0 && bodyLength < 40;

  function updateField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (form.canonicalBody.trim().length < 40) {
      toast.error("Текст статьи должен быть минимум 40 символов.");
      return;
    }

    startTransition(async () => {
      try {
        const payload: CreateDistributionAssetPayload | UpdateDistributionAssetPayload = {
          title: form.title,
          canonicalBody: form.canonicalBody,
          brandId: form.brandId,
          platformId: form.platformId,
          summary: form.summary,
          primaryKeyword: form.primaryKeyword,
          ctaText: form.ctaText,
          ctaUrl: form.ctaUrl,
          intent: form.intent ? (form.intent as TopicIntent) : null,
          scheduledAt: fromDatetimeLocalValue(form.scheduledAt),
          publicationStatus: form.publicationStatus,
        };

        const response = await fetch(
          mode === "create" ? "/api/assets" : `/api/assets/${asset?.id}`,
          {
            method: mode === "create" ? "POST" : "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        const body = (await response.json()) as
          | { asset: DistributionAssetListItem }
          | { error: { message: string } };

        if (!response.ok || !("asset" in body)) {
          const message =
            "error" in body &&
            body.error.message ===
              "Текст статьи должен быть минимум 40 символов."
              ? "Текст статьи должен быть минимум 40 символов."
              : "error" in body
                ? body.error.message
                : "Не удалось сохранить статью.";

          throw new Error(
            message,
          );
        }

        if (mode === "create") {
          onCreated?.(body.asset);
          toast.success("Статья создана.");
        } else {
          onUpdated?.(body.asset);
          toast.success("Статья обновлена.");
        }

        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Не удалось сохранить статью.",
        );
      }
    });
  }

  const title = mode === "create" ? "Новая статья" : "Редактировать статью";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (nextOpen) {
          setForm(getInitialState(brands, platforms, asset));
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={mode === "create" ? "default" : "outline"} />}>
        {mode === "create" ? <Plus /> : <Edit3 />}
        {mode === "create" ? "Новая статья" : "Изменить"}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-[min(1100px,calc(100vw-2rem))] overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form className="grid max-h-[calc(90vh-81px)] grid-rows-[1fr_auto]" onSubmit={handleSubmit}>
          <div className="grid gap-6 overflow-y-auto px-6 py-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-title`}>
                Заголовок
              </label>
              <Input
                id={`${mode}-asset-title`}
                value={form.title}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="Как снизить стоимость привлечения клиентов"
                required
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-keyword`}>
                Ключевой запрос
              </label>
              <Input
                id={`${mode}-asset-keyword`}
                value={form.primaryKeyword}
                onChange={(event) => updateField("primaryKeyword", event.target.value)}
                placeholder="контент-маркетинг"
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)_minmax(0,0.9fr)]">
            <div className="grid min-w-0 gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-brand`}>
                Бренд
              </label>
              <select
                id={`${mode}-asset-brand`}
                className="h-11 w-full min-w-0 truncate rounded-xl border border-input bg-background px-3 text-sm"
                value={form.brandId}
                onChange={(event) => updateField("brandId", event.target.value)}
                required
              >
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name} · {brand.domain}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid min-w-0 gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-platform`}>
                Площадка
              </label>
              <select
                id={`${mode}-asset-platform`}
                className="h-11 w-full min-w-0 truncate rounded-xl border border-input bg-background px-3 text-sm"
                value={form.platformId}
                onChange={(event) => updateField("platformId", event.target.value)}
                required
              >
                {platforms.map((platform) => (
                  <option key={platform.id} value={platform.id}>
                    {platform.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid min-w-0 gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-intent`}>
                Интент
              </label>
              <select
                id={`${mode}-asset-intent`}
                className="h-11 w-full min-w-0 truncate rounded-xl border border-input bg-background px-3 text-sm"
                value={form.intent}
                onChange={(event) => updateField("intent", event.target.value)}
              >
                <option value="">Не выбран</option>
                <option value={TopicIntent.INFORMATIONAL}>Информационный</option>
                <option value={TopicIntent.COMPARISON}>Сравнение</option>
                <option value={TopicIntent.COMMERCIAL}>Коммерческий</option>
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-summary`}>
              Краткое описание
            </label>
            <Textarea
              id={`${mode}-asset-summary`}
              className="min-h-[140px] resize-y"
              value={form.summary}
              onChange={(event) => updateField("summary", event.target.value)}
              placeholder="Коротко: о чем статья и какой угол подачи."
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-body`}>
              Текст статьи
            </label>
            <Textarea
              id={`${mode}-asset-body`}
              className="min-h-[300px] resize-y font-mono text-[13px] leading-6"
              value={form.canonicalBody}
              onChange={(event) => updateField("canonicalBody", event.target.value)}
              placeholder="Основной текст статьи."
              aria-invalid={bodyTooShort}
              required
            />
            <p
              className={`text-xs ${
                bodyTooShort ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              Минимум 40 символов. Сейчас: {bodyLength}.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-cta-text`}>
                Призыв к действию
              </label>
              <Textarea
                id={`${mode}-asset-cta-text`}
                className="min-h-24 resize-y"
                value={form.ctaText}
                onChange={(event) => updateField("ctaText", event.target.value)}
                placeholder="Оставить заявку"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-cta-url`}>
                Ссылка
              </label>
              <Input
                id={`${mode}-asset-cta-url`}
                value={form.ctaUrl}
                onChange={(event) => updateField("ctaUrl", event.target.value)}
                placeholder="https://site.ru"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor={`${mode}-asset-scheduled`}>
                Дата публикации
              </label>
              <Input
                id={`${mode}-asset-scheduled`}
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(event) => updateField("scheduledAt", event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor={`${mode}-asset-publication-status`}
            >
              Статус публикации
            </label>
            <select
              id={`${mode}-asset-publication-status`}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={form.publicationStatus}
              onChange={(event) =>
                updateField(
                  "publicationStatus",
                  event.target.value as PublicationStatus,
                )
              }
            >
              <option value={PublicationStatus.PLANNED}>Черновик</option>
              <option value={PublicationStatus.SCHEDULED}>Запланировано</option>
              <option value={PublicationStatus.PUBLISHING}>Публикуется</option>
              <option value={PublicationStatus.PUBLISHED}>Опубликовано</option>
              <option value={PublicationStatus.FAILED}>Ошибка</option>
              <option value={PublicationStatus.CANCELED}>Отменено</option>
            </select>
          </div>
          </div>

          <DialogFooter className="border-t border-border/70 bg-muted/35 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? mode === "create"
                  ? "Создание..."
                  : "Сохранение..."
                : mode === "create"
                  ? "Создать"
                  : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
