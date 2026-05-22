"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import {
  agentProtocolHint,
  ensureAgentAwakeForAction,
} from "@/features/agent/client/agent-wake";
import type { BrandOption } from "@/features/brands/types";
import {
  formatScheduleDateTime,
  SchedulePublicationDialog,
} from "@/features/distribution/components/schedule-publication-dialog";
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

type AgentState = "active" | "busy" | "paired_offline" | "not_paired" | null;

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
  "Генерируем статью...",
  "Пишем текст одним быстрым запросом...",
  "Проверяем CTA...",
  "Очищаем ссылки и мусорный CTA...",
  "Сохраняем результат...",
];

const publicationLabels: Record<PublicationStatus, string> = {
  PLANNED: "Черновик",
  SCHEDULED: "Запланировано",
  WAITING_AGENT: "Ожидает agent",
  PUBLISHING: "Публикуется",
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

  if (
    status === PublicationStatus.PUBLISHING ||
    status === PublicationStatus.WAITING_AGENT
  ) {
    return "warning";
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
  const response = await fetch(`/api/assets/${assetId}`, {
    cache: "no-store",
  });
  const body = (await response.json()) as
    | { asset: DistributionAssetListItem }
    | { error: { message?: string } };

  if (!response.ok || !("asset" in body)) {
    throw new Error(
      "error" in body
        ? (body.error.message ?? "Не удалось обновить статью.")
        : "Не удалось обновить статью.",
    );
  }

  return body.asset;
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

type ArticleGenerationResponseBody =
  | {
      ok?: boolean;
      asset?: DistributionAssetListItem;
      status?: "requires_agent" | "queued" | "busy";
      message?: string;
      job?: { id: string };
      error?: string | { message?: string };
      details?: string;
      code?: string;
    }
  | Record<string, unknown>;

async function parseGenerationResponse(response: Response) {
  try {
    return (await response.json()) as ArticleGenerationResponseBody;
  } catch {
    return {
      error: "Article generation failed",
      details: "API returned a non-JSON response.",
    };
  }
}

function getGenerationErrorMessage(body: ArticleGenerationResponseBody) {
  const details = "details" in body && typeof body.details === "string"
    ? body.details
    : null;
  const error = "error" in body ? body.error : null;

  if (details) {
    return details;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  if ("message" in body && typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }

  return "Не удалось сгенерировать статью.";
}

function formatTime(value?: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isOverdueScheduled(asset?: DistributionAssetListItem) {
  return (
    asset?.publicationStatus === PublicationStatus.SCHEDULED &&
    Boolean(asset.scheduledAt) &&
    new Date(asset.scheduledAt!).getTime() <= Date.now()
  );
}

function isScheduledLikeStatus(status: PublicationStatus) {
  return (
    status === PublicationStatus.SCHEDULED ||
    status === PublicationStatus.WAITING_AGENT
  );
}

function publicationStatusLabel(asset: DistributionAssetListItem | undefined, fallback: PublicationStatus) {
  if (asset?.publicationStatus === PublicationStatus.WAITING_AGENT) {
    return "Agent offline";
  }

  if (asset?.publicationStatus === PublicationStatus.SCHEDULED && asset.scheduledAt) {
    return isOverdueScheduled(asset)
      ? "Ожидает публикации"
      : `Запланировано на ${formatTime(asset.scheduledAt)}`;
  }

  if (asset?.publicationStatus === PublicationStatus.FAILED) {
    return "Ошибка публикации";
  }

  return publicationLabels[asset?.publicationStatus ?? fallback];
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
  const generationInFlightRef = useRef(false);
  const [form, setForm] = useState(() =>
    getInitialState(brands, platforms, asset),
  );
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState<BriefLoadingTarget>(null);
  const [agentState, setAgentState] = useState<AgentState>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  const pageTitle =
    mode === "create" ? "Новая статья" : "Редактирование статьи";
  const canRunAssetActions = Boolean(currentAsset?.id);
  const selectedPlatform = platforms.find((platform) => platform.id === form.platformId);
  const selectedPlatformSlug =
    selectedPlatform?.slug?.toLowerCase().includes("vc") ? "vc" : "dzen";
  const isBriefLoading = Boolean(briefLoading);
  const agentDisconnected =
    isScheduledLikeStatus(form.publicationStatus) &&
    agentState !== null &&
    agentState !== "active" &&
    agentState !== "busy";
  const scheduleAgentDisconnected =
    agentState !== null && agentState !== "active" && agentState !== "busy";

  const selectedStatusLabel = useMemo(
    () => publicationStatusLabel(currentAsset, form.publicationStatus),
    [currentAsset, form.publicationStatus],
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function syncFromAsset(nextAsset: DistributionAssetListItem) {
    setCurrentAsset(nextAsset);
    setForm(getInitialState(brands, platforms, nextAsset));
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAgentState() {
      try {
        const response = await fetch("/api/agent/devices", {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          agent?: { state?: AgentState };
        };

        if (!cancelled) {
          setAgentState(body.agent?.state ?? "not_paired");
        }
      } catch {
        if (!cancelled) {
          setAgentState("not_paired");
        }
      }
    }

    void loadAgentState();
    const timer = window.setInterval(loadAgentState, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function hasGeneratedContent(nextAsset: DistributionAssetListItem) {
    const content = nextAsset.canonicalBody.trim();
    return content.length > 80 && !/^черновик будет сгенерирован/i.test(content);
  }

  async function recoverGeneratedAsset(assetId: string) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[article-generate-ui] fetch failed, refetching article", {
        assetId,
      });
    }

    const nextAsset = await reloadAsset(assetId);
    if (hasGeneratedContent(nextAsset)) {
      syncFromAsset(nextAsset);
      if (process.env.NODE_ENV !== "production") {
        console.log("[article-generate-ui] recovered from refetch", {
          assetId,
          contentLength: nextAsset.canonicalBody.length,
        });
      }
      toast.success("Статья сгенерирована.");
      return true;
    }

    return false;
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
    if (generationInFlightRef.current) {
      return;
    }

    startTransition(async () => {
      let timer: number | null = null;
      let generatedAssetId: string | null = currentAsset?.id ?? null;
      const startedAt = performance.now();

      try {
        generationInFlightRef.current = true;
        if (process.env.NODE_ENV !== "production") {
          console.log("[article-generate-ui] start", {
            assetId: currentAsset?.id ?? null,
          });
        }
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
        generatedAssetId = savedAsset.id;
        const generationPayload = { articleId: savedAsset.id };
        console.time("[ArticleGeneration UI] api-request");
        const response = await fetch("/api/articles/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(generationPayload),
        });
        console.timeEnd("[ArticleGeneration UI] api-request");
        const body = await parseGenerationResponse(response);

        if (!response.ok) {
          console.error("[ArticleGeneration] failed", {
            status: response.status,
            response: body,
            payload: generationPayload,
          });
          throw new Error(getGenerationErrorMessage(body));
        }

        const generatedAsset =
          "asset" in body && body.asset
            ? (body.asset as DistributionAssetListItem)
            : null;
        const nextAsset = generatedAsset ?? (await reloadAsset(savedAsset.id));
        syncFromAsset(nextAsset);
        if (process.env.NODE_ENV !== "production") {
          console.log("[article-generate-ui] success", {
            assetId: savedAsset.id,
            contentLength: nextAsset.canonicalBody.length,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }
        router.replace(`/articles/${savedAsset.id}/edit`);
        toast.success("Статья сгенерирована.");
      } catch (error) {
        if (generatedAssetId) {
          try {
            if (await recoverGeneratedAsset(generatedAssetId)) {
              return;
            }
          } catch (refetchError) {
            console.error("[article-generate-ui] recovery failed", refetchError);
          }
        }
        console.error("[ArticleGeneration] failed", {
          assetId: generatedAssetId,
          error,
        });
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось завершить генерацию. Попробуйте еще раз.",
        );
      } finally {
        if (timer) {
          window.clearInterval(timer);
        }
        setGenerationStatus(null);
        generationInFlightRef.current = false;
      }
    });
  }

  function handleSchedule(payload: {
    publishAt: string;
    selectedLocalTime: string;
    browserTimezone: string | null;
  }) {
    if (!currentAsset) {
      return;
    }

    startTransition(async () => {
      try {
        const savedAsset = await saveArticle();
        const response = await fetch("/api/articles/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articleId: savedAsset.id,
            publishAt: payload.publishAt,
            selectedLocalTime: payload.selectedLocalTime,
            browserTimezone: payload.browserTimezone,
          }),
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

        const nextAsset = await reloadAsset(savedAsset.id);
        syncFromAsset(nextAsset);
        setScheduleDialogOpen(false);
        toast.success(
          `Публикация запланирована на ${formatScheduleDateTime(nextAsset.scheduledAt)}.`,
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось запланировать статью.",
        );
      }
    });
  }

  function handleCancelSchedule() {
    if (!currentAsset) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/assets/${currentAsset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduledAt: null,
            publicationStatus: PublicationStatus.PLANNED,
          }),
        });
        const nextAsset = await parseAssetResponse(response);

        syncFromAsset(nextAsset);
        toast.success("Планирование отменено.");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось отменить планирование.",
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
        toast.info(agentProtocolHint);
        const awake = await ensureAgentAwakeForAction({
          onStatus: (message) => toast.info(message),
          readyMessage: "Agent запущен. Отправляем публикацию...",
        });

        if (!awake) {
          toast.error("Не удалось открыть FlowPost Agent.");
          return;
        }

        const savedAsset = await saveArticle();
        const response = await fetch("/api/articles/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articleId: savedAsset.id,
            agentWakeStartedAt: awake.wakeStartedAt,
          }),
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
            body.message ??
              "FlowPost Agent занят. Agent уже выполняет задачу. Новая задача запустится после завершения текущей.",
          );
          return;
        }

        toast.success(
          body.job
            ? "Публикация отправлена в FlowPost Agent. Браузер не будет показываться."
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
    <>
    {scheduleDialogOpen ? (
      <SchedulePublicationDialog
        open
        onOpenChange={setScheduleDialogOpen}
        initialValue={currentAsset?.scheduledAt ?? form.scheduledAt}
        platformName={selectedPlatform?.name}
        agentDisconnected={scheduleAgentDisconnected}
        isPending={isPending}
        onConfirm={handleSchedule}
      />
    ) : null}

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
              {form.publicationStatus === PublicationStatus.FAILED &&
              currentAsset?.publicationLastError ? (
                <p className="text-destructive mt-2 text-sm">
                  {currentAsset.publicationLastError}
                </p>
              ) : null}
              {form.publicationStatus === PublicationStatus.WAITING_AGENT ? (
                <p className="text-destructive mt-2 text-sm">
                  Время публикации прошло, но agent был offline. После запуска
                  agent задача будет взята в работу.
                </p>
              ) : isOverdueScheduled(currentAsset) ? (
                <p className="text-destructive mt-2 text-sm">
                  Время публикации прошло, но задача ещё не была обработана.
                  Проверьте agent/scheduler.
                </p>
              ) : null}
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
                  onClick={() => setScheduleDialogOpen(true)}
                  disabled={isPending || !canRunAssetActions}
                >
                  <CalendarClock />
                  {isScheduledLikeStatus(form.publicationStatus)
                    ? "Изменить время"
                    : "Запланировать"}
                </Button>
                {isScheduledLikeStatus(form.publicationStatus) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelSchedule}
                    disabled={isPending || !canRunAssetActions}
                  >
                    Отменить планирование
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={handlePublish}
                  disabled={
                    isPending ||
                    !canRunAssetActions ||
                    form.publicationStatus === PublicationStatus.PUBLISHED ||
                    form.publicationStatus === PublicationStatus.PUBLISHING
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

      {agentDisconnected ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          Agent не подключён. Запланированные публикации не будут выполнены.
        </div>
      ) : null}

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
                  Текст ссылки / продукт
                </label>
                <Input
                  id="article-cta"
                  value={form.ctaText}
                  onChange={(event) =>
                    updateField("ctaText", event.target.value)
                  }
                  placeholder="FlowPostAI"
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
                  Время указано по вашему локальному часовому поясу.
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/28 p-4">
                <p className="text-xs text-muted-foreground">
                  Запланированное время
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {currentAsset?.scheduledAt
                    ? formatScheduleDateTime(currentAsset.scheduledAt)
                    : "Не запланировано"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setScheduleDialogOpen(true)}
                    disabled={!canRunAssetActions || isPending}
                  >
                    <CalendarClock />
                    {currentAsset?.scheduledAt ? "Изменить время" : "Запланировать"}
                  </Button>
                  {currentAsset?.publicationStatus &&
                  isScheduledLikeStatus(currentAsset.publicationStatus) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleCancelSchedule}
                      disabled={isPending}
                    >
                      Отменить планирование
                    </Button>
                  ) : null}
                </div>
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
                    PublicationStatus.WAITING_AGENT,
                    PublicationStatus.PUBLISHING,
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
    </>
  );
}
