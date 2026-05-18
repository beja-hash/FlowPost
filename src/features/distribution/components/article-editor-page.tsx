"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublicationStatus, TopicIntent } from "@prisma/client";
import {
  ArrowLeft,
  CalendarClock,
  Loader2,
  Send,
  Zap,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandOption } from "@/features/brands/types";
import type {
  ArticleTone,
  ContentFormat,
  CreateDistributionAssetPayload,
  DistributionAssetListItem,
  PlatformOption,
  UpdateDistributionAssetPayload,
} from "@/features/distribution/types";

type ArticleEditorPageProps = {
  mode: "create" | "edit";
  brands: BrandOption[];
  platforms: PlatformOption[];
  asset?: DistributionAssetListItem;
};

type FormState = {
  title: string;
  canonicalBody: string;
  brandId: string;
  platformId: string;
  summary: string;
  primaryKeyword: string;
  ctaText: string;
  ctaUrl: string;
  contentFormat: ContentFormat | "";
  tone: ArticleTone | "";
  targetAudience: string;
  readerPain: string;
  mainThesis: string;
  scheduledAt: string;
  publicationStatus: PublicationStatus;
};

type BriefFieldTarget =
  | "targetAudience"
  | "readerPain"
  | "mainThesis"
  | "factsExample"
  | "topic";

type BriefLoadingTarget = BriefFieldTarget | "full" | null;

function BriefGenerateButton({
  targetField,
  isLoading,
  disabled,
  onGenerate,
}: {
  targetField: BriefFieldTarget;
  isLoading: boolean;
  disabled: boolean;
  onGenerate: (targetField: BriefFieldTarget) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() => onGenerate(targetField)}
      disabled={disabled}
    >
      {isLoading ? <Loader2 className="animate-spin" /> : null}
      Сгенерировать
    </Button>
  );
}

const generationMessages = [
  "Сбор стратегии...",
  "Написание черновика...",
  "Редакторская полировка...",
];

const publicationLabels: Record<PublicationStatus, string> = {
  PLANNED: "Черновик",
  SCHEDULED: "Запланировано",
  PUBLISHED: "Опубликовано",
  FAILED: "Ошибка",
  CANCELED: "Отменено",
};

const contentFormatLabels: Record<ContentFormat, string> = {
  teardown: "Разбор проблемы",
  case_story: "Кейс",
  failure_story: "Провал / ошибки",
  personal_experience: "Личный опыт",
  comparison: "Сравнение",
  guide: "Практический гайд",
  opinion: "Мнение / позиция",
  myth_busting: "Разбор мифа",
  checklist: "Чеклист",
  mistakes: "Ошибки",
  trend_analysis: "Разбор тренда",
  decision_guide: "Гайд по выбору",
};

const toneLabels: Record<ArticleTone, string> = {
  calm_expert: "Спокойный экспертный",
  direct: "Прямой разговорный",
  provocative_soft: "Мягко провокационный",
  painful: "Через боль клиента",
  founder_style: "От лица основателя/команды",
  analytical: "Аналитический",
  practical: "Практичный",
};

const contentFormatToIntent: Record<ContentFormat, TopicIntent> = {
  teardown: TopicIntent.INFORMATIONAL,
  case_story: TopicIntent.COMMERCIAL,
  failure_story: TopicIntent.INFORMATIONAL,
  personal_experience: TopicIntent.INFORMATIONAL,
  comparison: TopicIntent.COMPARISON,
  guide: TopicIntent.INFORMATIONAL,
  opinion: TopicIntent.INFORMATIONAL,
  myth_busting: TopicIntent.INFORMATIONAL,
  checklist: TopicIntent.INFORMATIONAL,
  mistakes: TopicIntent.INFORMATIONAL,
  trend_analysis: TopicIntent.INFORMATIONAL,
  decision_guide: TopicIntent.COMMERCIAL,
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
): FormState {
  return {
    title: asset?.title ?? "",
    canonicalBody: asset?.canonicalBody ?? "",
    brandId: asset?.brandId ?? brands[0]?.id ?? "",
    platformId: asset?.platformId ?? platforms[0]?.id ?? "",
    summary: asset?.summary ?? "",
    primaryKeyword: asset?.primaryKeyword ?? "",
    ctaText: asset?.ctaText ?? "",
    ctaUrl: asset?.ctaUrl ?? "",
    contentFormat: asset?.contentBrief?.contentFormat ?? "",
    tone: asset?.contentBrief?.tone ?? "",
    targetAudience: asset?.contentBrief?.targetAudience ?? "",
    readerPain: asset?.contentBrief?.readerPain ?? "",
    mainThesis: asset?.contentBrief?.mainThesis ?? "",
    scheduledAt: toDatetimeLocalValue(asset?.scheduledAt),
    publicationStatus: asset?.publicationStatus ?? PublicationStatus.PLANNED,
  };
}

function statusTone(status: PublicationStatus) {
  if (status === PublicationStatus.PUBLISHED) {
    return "positive";
  }

  if (status === PublicationStatus.FAILED) {
    return "danger";
  }

  if (status === PublicationStatus.SCHEDULED) {
    return "info";
  }

  return "neutral";
}

async function parseAssetResponse(response: Response) {
  const body = (await response.json()) as
    | { asset: DistributionAssetListItem }
    | { error: { message?: string } };

  if (!response.ok || !("asset" in body)) {
    throw new Error(
      "error" in body
        ? (body.error.message ?? "Не удалось сохранить статью.")
        : "Не удалось сохранить статью.",
    );
  }

  return body.asset;
}

async function reloadAsset(assetId: string) {
  const response = await fetch("/api/assets");
  const body = (await response.json()) as
    | { assets: DistributionAssetListItem[] }
    | { error: { message?: string } };

  if (!response.ok || !("assets" in body)) {
    throw new Error(
      "error" in body
        ? (body.error.message ?? "Не удалось обновить статью.")
        : "Не удалось обновить статью.",
    );
  }

  const asset = body.assets.find((item) => item.id === assetId);

  if (!asset) {
    throw new Error("Статья не найдена после обновления.");
  }

  return asset;
}

async function parseBriefResponse<T>(response: Response) {
  const body = (await response.json()) as
    | { result: T }
    | { error: { message?: string } };

  if (!response.ok || !("result" in body)) {
    throw new Error(
      "error" in body
        ? (body.error.message ?? "Не удалось сгенерировать бриф.")
        : "Не удалось сгенерировать бриф.",
    );
  }

  return body.result;
}

export function ArticleEditorPage({
  mode,
  brands,
  platforms,
  asset,
}: ArticleEditorPageProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [currentAsset, setCurrentAsset] = useState(asset);
  const [form, setForm] = useState(() =>
    getInitialState(brands, platforms, asset),
  );
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState<BriefLoadingTarget>(null);

  const pageTitle =
    mode === "create" ? "Новая статья" : "Редактирование статьи";
  const canRunAssetActions = Boolean(currentAsset?.id);
  const selectedPlatform = platforms.find((platform) => platform.id === form.platformId);
  const selectedPlatformSlug =
    selectedPlatform?.slug?.toLowerCase().includes("vc") ? "vc" : "dzen";
  const isBriefLoading = Boolean(briefLoading);

  const selectedStatusLabel = useMemo(
    () => publicationLabels[form.publicationStatus],
    [form.publicationStatus],
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function syncFromAsset(nextAsset: DistributionAssetListItem) {
    setCurrentAsset(nextAsset);
    setForm(getInitialState(brands, platforms, nextAsset));
  }

  function getBriefPayload(mode: "field" | "full", targetField?: BriefFieldTarget) {
    return {
      mode,
      targetField,
      brandId: form.brandId,
      platform: selectedPlatformSlug,
      topic: form.title,
      keyword: form.primaryKeyword,
      contentFormat: form.contentFormat,
      tone: form.tone,
      currentBrief: {
        targetAudience: form.targetAudience,
        readerPain: form.readerPain,
        mainThesis: form.mainThesis,
        factsExample: form.summary,
        cta: form.ctaText,
        link: form.ctaUrl,
      },
    };
  }

  function applyBriefField(targetField: BriefFieldTarget, value: string) {
    if (targetField === "factsExample") {
      updateField("summary", value);
      return;
    }

    if (targetField === "topic") {
      updateField("title", value);
      return;
    }

    updateField(targetField, value);
  }

  function getBriefFieldValue(targetField: BriefFieldTarget) {
    if (targetField === "factsExample") {
      return form.summary;
    }

    if (targetField === "topic") {
      return form.title;
    }

    return form[targetField];
  }

  async function handleGenerateBriefField(targetField: BriefFieldTarget) {
    if (!form.brandId) {
      toast.error("Сначала выберите бренд.");
      return;
    }

    const currentValue = getBriefFieldValue(targetField).trim();

    if (
      currentValue &&
      !window.confirm("Поле уже заполнено. Заменить его сгенерированным вариантом?")
    ) {
      return;
    }

    setBriefLoading(targetField);

    try {
      const response = await fetch("/api/articles/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getBriefPayload("field", targetField)),
      });
      const result = await parseBriefResponse<{ value: string; reason: string }>(
        response,
      );

      applyBriefField(targetField, result.value);
      toast.success("Поле заполнено.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось сгенерировать поле.",
      );
    } finally {
      setBriefLoading(null);
    }
  }

  async function handleGenerateFullBrief() {
    if (!form.brandId) {
      toast.error("Сначала выберите бренд.");
      return;
    }

    setBriefLoading("full");

    try {
      const response = await fetch("/api/articles/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getBriefPayload("full")),
      });
      const result = await parseBriefResponse<{
        targetAudience: string;
        readerPain: string;
        mainThesis: string;
        factsExample: string;
        suggestedTopic: string;
      }>(response);

      setForm((current) => ({
        ...current,
        title: current.title.trim() ? current.title : result.suggestedTopic,
        targetAudience: current.targetAudience.trim()
          ? current.targetAudience
          : result.targetAudience,
        readerPain: current.readerPain.trim()
          ? current.readerPain
          : result.readerPain,
        mainThesis: current.mainThesis.trim()
          ? current.mainThesis
          : result.mainThesis,
        summary: current.summary.trim() ? current.summary : result.factsExample,
      }));
      toast.success("Бриф заполнен.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось заполнить бриф.",
      );
    } finally {
      setBriefLoading(null);
    }
  }

  async function saveArticle() {
    const payload:
      | CreateDistributionAssetPayload
      | UpdateDistributionAssetPayload = {
      title: form.title,
      canonicalBody: form.canonicalBody,
      brandId: form.brandId,
      platformId: form.platformId,
      summary: form.summary,
      primaryKeyword: form.primaryKeyword,
      ctaText: form.ctaText,
      ctaUrl: form.ctaUrl,
      intent: form.contentFormat
        ? contentFormatToIntent[form.contentFormat]
        : null,
      contentBrief: {
        contentFormat: form.contentFormat,
        tone: form.tone,
        targetAudience: form.targetAudience,
        readerPain: form.readerPain,
        mainThesis: form.mainThesis,
      },
      scheduledAt: fromDatetimeLocalValue(form.scheduledAt),
      publicationStatus: form.publicationStatus,
    };

    const response = await fetch(
      currentAsset ? `/api/assets/${currentAsset.id}` : "/api/assets",
      {
        method: currentAsset ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const savedAsset = await parseAssetResponse(response);

    syncFromAsset(savedAsset);

    if (!currentAsset) {
      router.replace(`/articles/${savedAsset.id}/edit`);
    }

    return savedAsset;
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await saveArticle();
        toast.success("Статья сохранена.");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось сохранить статью.",
        );
      }
    });
  }

  function handleGenerate() {
    startTransition(async () => {
      let timer: number | null = null;

      try {
        let messageIndex = 0;
        setGenerationStatus(generationMessages[messageIndex]);
        timer = window.setInterval(() => {
          messageIndex = Math.min(
            messageIndex + 1,
            generationMessages.length - 1,
          );
          setGenerationStatus(generationMessages[messageIndex]);
        }, 2500);

        const savedAsset = await saveArticle();
        const response = await fetch("/api/articles/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId: savedAsset.id }),
        });
        const body = (await response.json()) as {
          status?: "requires_agent" | "queued" | "busy";
          message?: string;
          job?: { id: string };
          error?: { message?: string };
        };

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Не удалось сгенерировать статью.",
          );
        }

        syncFromAsset(await reloadAsset(savedAsset.id));
        router.replace(`/articles/${savedAsset.id}/edit`);
        toast.success("Статья сгенерирована.");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось сгенерировать статью.",
        );
      } finally {
        if (timer) {
          window.clearInterval(timer);
        }
        setGenerationStatus(null);
      }
    });
  }

  function handleSchedule() {
    if (!currentAsset) {
      return;
    }

    startTransition(async () => {
      try {
        const savedAsset = await saveArticle();
        const publishAt =
          fromDatetimeLocalValue(form.scheduledAt) ??
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const response = await fetch("/api/articles/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId: savedAsset.id, publishAt }),
        });
        const body = (await response.json()) as {
          status?: "requires_agent" | "queued" | "busy";
          message?: string;
          job?: { id: string };
          error?: { message?: string };
        };

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Не удалось запланировать статью.",
          );
        }

        syncFromAsset(await reloadAsset(savedAsset.id));
        toast.success("Статья запланирована.");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось запланировать статью.",
        );
      }
    });
  }

  function handlePublish() {
    if (!currentAsset) {
      return;
    }

    startTransition(async () => {
      try {
        const savedAsset = await saveArticle();
        const response = await fetch("/api/articles/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId: savedAsset.id }),
        });
        const body = (await response.json()) as {
          status?: "requires_agent" | "queued" | "busy";
          message?: string;
          job?: { id: string };
          error?: { message?: string };
        };

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Не удалось опубликовать статью.",
          );
        }

        syncFromAsset(await reloadAsset(savedAsset.id));
        if (body.status === "requires_agent") {
          toast.info(
            body.message ??
              "Подключите FlowPost Agent, чтобы открыть браузер на вашем компьютере.",
          );
          return;
        }

        if (body.status === "busy") {
          toast.info(
            body.message ?? "Agent уже выполняет задачу. Дождитесь завершения.",
          );
          return;
        }

        toast.success(
          body.job
            ? "Задача отправлена в FlowPost Agent."
            : "Публикация запущена.",
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось опубликовать статью.",
        );
      }
    });
  }

  function handleDelete() {
    if (!currentAsset) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/assets/${currentAsset.id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const body = (await response.json()) as {
            error?: { message?: string };
          };
          throw new Error(body.error?.message ?? "Не удалось удалить статью.");
        }

        toast.success("Статья удалена.");
        router.push("/distribution");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Не удалось удалить статью.",
        );
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="border-border/70 bg-background/88 sticky top-16 z-20 -mx-4 border-b px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="outline"
              size="icon-sm"
              nativeButton={false}
              render={<Link href="/distribution" />}
            >
              <ArrowLeft />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {pageTitle}
              </h1>
              <div className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
                <StatusBadge tone={statusTone(form.publicationStatus)}>
                  {selectedStatusLabel}
                </StatusBadge>
                <span>{form.canonicalBody.trim().length} символов</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {currentAsset ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/articles/${currentAsset.id}/preview`} />}
              >
                Посмотреть
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending && !generationStatus ? (
                <Loader2 className="animate-spin" />
              ) : null}
              Сохранить
            </Button>
            <Button size="sm" onClick={handleGenerate} disabled={isPending}>
              {generationStatus ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Zap />
              )}
              {generationStatus ?? "Сгенерировать"}
            </Button>
            {mode === "edit" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSchedule}
                  disabled={isPending || !canRunAssetActions}
                >
                  <CalendarClock />
                  Запланировать
                </Button>
                <Button
                  size="sm"
                  onClick={handlePublish}
                  disabled={
                    isPending ||
                    !canRunAssetActions ||
                    form.publicationStatus === PublicationStatus.PUBLISHED
                  }
                >
                  <Send />
                  Опубликовать
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  disabled={isPending || !canRunAssetActions}
                >
                  <Trash2 />
                  Удалить
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <Card className="border-border/70 rounded-xl shadow-none">
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium" htmlFor="article-title">
                  Тема статьи
                </label>
                <BriefGenerateButton
                  targetField="topic"
                  isLoading={briefLoading === "topic"}
                  disabled={!form.brandId || isBriefLoading || isPending}
                  onGenerate={(targetField) =>
                    void handleGenerateBriefField(targetField)
                  }
                />
              </div>
              <Input
                id="article-title"
                value={form.title}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="Например: Почему статьи не дают трафик"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="article-keyword">
                Ключевой запрос (необязательно)
              </label>
              <Input
                id="article-keyword"
                value={form.primaryKeyword}
                onChange={(event) =>
                  updateField("primaryKeyword", event.target.value)
                }
                placeholder="контент-маркетинг"
              />
              <p className="text-xs text-muted-foreground">
                Используется мягко, без SEO-переспама.
              </p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="article-brand">
                Бренд
              </label>
              <select
                id="article-brand"
                className="border-input bg-background h-11 w-full min-w-0 rounded-xl border px-3 text-sm"
                value={form.brandId}
                onChange={(event) => updateField("brandId", event.target.value)}
              >
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name} · {brand.domain}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="article-platform"
                >
                  Площадка
                </label>
                <select
                  id="article-platform"
                  className="border-input bg-background h-11 w-full rounded-xl border px-3 text-sm"
                  value={form.platformId}
                  onChange={(event) =>
                    updateField("platformId", event.target.value)
                  }
                >
                  {platforms.map((platform) => (
                    <option key={platform.id} value={platform.id}>
                      {platform.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="article-content-format"
                >
                  Формат подачи
                </label>
                <select
                  id="article-content-format"
                  className="border-input bg-background h-11 w-full rounded-xl border px-3 text-sm"
                  value={form.contentFormat}
                  onChange={(event) =>
                    updateField(
                      "contentFormat",
                      event.target.value as ContentFormat | "",
                    )
                  }
                >
                  <option value="">Автоматически</option>
                  {Object.entries(contentFormatLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-muted/25 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Бриф статьи</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Можно заполнить пустые поля по выбранному бренду.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void handleGenerateFullBrief()}
                  disabled={!form.brandId || isBriefLoading || isPending}
                >
                  {briefLoading === "full" ? (
                    <Loader2 className="animate-spin" />
                  ) : null}
                  Заполнить бриф
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium" htmlFor="article-audience">
                  Кому пишем
                </label>
                <BriefGenerateButton
                  targetField="targetAudience"
                  isLoading={briefLoading === "targetAudience"}
                  disabled={!form.brandId || isBriefLoading || isPending}
                  onGenerate={(targetField) =>
                    void handleGenerateBriefField(targetField)
                  }
                />
              </div>
              <Input
                id="article-audience"
                value={form.targetAudience}
                onChange={(event) =>
                  updateField("targetAudience", event.target.value)
                }
                placeholder="Например: владельцы сайтов, маркетологи, B2B SaaS, агентства"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium" htmlFor="article-pain">
                  Главная боль читателя
                </label>
                <BriefGenerateButton
                  targetField="readerPain"
                  isLoading={briefLoading === "readerPain"}
                  disabled={!form.brandId || isBriefLoading || isPending}
                  onGenerate={(targetField) =>
                    void handleGenerateBriefField(targetField)
                  }
                />
              </div>
              <Textarea
                id="article-pain"
                className="min-h-24"
                value={form.readerPain}
                onChange={(event) =>
                  updateField("readerPain", event.target.value)
                }
                placeholder="Например: статьи публикуются, но трафик и заявки не растут"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium" htmlFor="article-thesis">
                  Главный тезис
                </label>
                <BriefGenerateButton
                  targetField="mainThesis"
                  isLoading={briefLoading === "mainThesis"}
                  disabled={!form.brandId || isBriefLoading || isPending}
                  onGenerate={(targetField) =>
                    void handleGenerateBriefField(targetField)
                  }
                />
              </div>
              <Textarea
                id="article-thesis"
                className="min-h-24"
                value={form.mainThesis}
                onChange={(event) =>
                  updateField("mainThesis", event.target.value)
                }
                placeholder="Например: проблема не в текстах, а в отсутствии дистрибуции"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium" htmlFor="article-summary">
                  Факты, детали или пример
                </label>
                <BriefGenerateButton
                  targetField="factsExample"
                  isLoading={briefLoading === "factsExample"}
                  disabled={!form.brandId || isBriefLoading || isPending}
                  onGenerate={(targetField) =>
                    void handleGenerateBriefField(targetField)
                  }
                />
              </div>
              <Textarea
                id="article-summary"
                className="min-h-32"
                value={form.summary}
                onChange={(event) => updateField("summary", event.target.value)}
                placeholder="Например: команда выпускает 4–6 статей в месяц, тратит 30–40 часов, но получает 100–300 просмотров и почти нет переходов"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="article-tone">
                Тон
              </label>
              <select
                id="article-tone"
                className="border-input bg-background h-11 w-full rounded-xl border px-3 text-sm"
                value={form.tone}
                onChange={(event) =>
                  updateField("tone", event.target.value as ArticleTone | "")
                }
              >
                <option value="">Автоматически</option>
                {Object.entries(toneLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="article-cta">
                  Призыв к действию
                </label>
                <Input
                  id="article-cta"
                  value={form.ctaText}
                  onChange={(event) =>
                    updateField("ctaText", event.target.value)
                  }
                  placeholder="Получить консультацию"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="article-link">
                  Ссылка
                </label>
                <Input
                  id="article-link"
                  value={form.ctaUrl}
                  onChange={(event) =>
                    updateField("ctaUrl", event.target.value)
                  }
                  placeholder="https://site.ru"
                />
              </div>
            </div>

            <div className="space-y-4 border-t border-border/50 pt-5">
              <div>
                <h2 className="text-sm font-medium">Публикация</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Эти поля не влияют на идею статьи и используются для планирования.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="article-publish-at"
                >
                  Дата публикации
                </label>
                <Input
                  id="article-publish-at"
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(event) =>
                    updateField("scheduledAt", event.target.value)
                  }
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="article-status">
                  Статус
                </label>
                <select
                  id="article-status"
                  className="border-input bg-background h-11 w-full rounded-xl border px-3 text-sm"
                  value={form.publicationStatus}
                  onChange={(event) =>
                    updateField(
                      "publicationStatus",
                      event.target.value as PublicationStatus,
                    )
                  }
                >
                  {[
                    PublicationStatus.PLANNED,
                    PublicationStatus.SCHEDULED,
                    PublicationStatus.PUBLISHED,
                    PublicationStatus.FAILED,
                  ].map((status) => (
                    <option key={status} value={status}>
                      {publicationLabels[status]}
                    </option>
                  ))}
                </select>
              </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 rounded-xl shadow-none">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <label className="text-sm font-medium" htmlFor="article-content">
                Текст статьи
              </label>
              {generationStatus ? (
                <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  {generationStatus}
                </span>
              ) : null}
            </div>
            <Textarea
              id="article-content"
              className="min-h-[600px] resize-y text-base leading-[1.6]"
              value={form.canonicalBody}
              onChange={(event) =>
                updateField("canonicalBody", event.target.value)
              }
              placeholder="Здесь будет текст статьи. Можно написать вручную или нажать «Сгенерировать»."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
