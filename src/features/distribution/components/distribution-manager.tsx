"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Edit3,
  Eye,
  Loader2,
  Plus,
  Send,
  Zap,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  agentProtocolHint,
  ensureAgentAwakeForAction,
} from "@/features/agent/client/agent-wake";
import type { BrandOption } from "@/features/brands/types";
import type {
  DistributionAssetListItem,
  PlatformOption,
} from "@/features/distribution/types";

type DistributionManagerProps = {
  initialAssets: DistributionAssetListItem[];
  brandOptions: BrandOption[];
  platformOptions: PlatformOption[];
};

const statusLabels = {
  DRAFT: "черновик",
  READY: "готово",
  DISTRIBUTING: "в работе",
  PUBLISHED: "опубликовано",
  ARCHIVED: "архив",
  PLANNED: "черновик",
  SCHEDULED: "запланировано",
  FAILED: "ошибка",
  CANCELED: "отменено",
} as const;

function publicationTone(
  status: DistributionAssetListItem["publicationStatus"],
) {
  if (status === "PUBLISHED") {
    return "positive";
  }

  if (status === "FAILED") {
    return "danger";
  }

  if (status === "SCHEDULED") {
    return "info";
  }

  return "neutral";
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DistributionManager({
  initialAssets,
  platformOptions,
}: DistributionManagerProps) {
  const [assets, setAssets] = useState(initialAssets);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialAssets[0]?.id ?? null,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingActionsRef = useRef(new Set<string>());
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null,
    [assets, selectedId],
  );

  async function reloadAssets(nextSelectedId?: string) {
    const response = await fetch("/api/assets");
    const body = (await response.json()) as
      | { assets: DistributionAssetListItem[] }
      | { error: { message: string } };

    if (!response.ok || !("assets" in body)) {
      throw new Error(
        "error" in body
          ? body.error.message
          : "Не удалось обновить список статей.",
      );
    }

    setAssets(body.assets);
    setSelectedId(nextSelectedId ?? body.assets[0]?.id ?? null);
  }

  async function reloadAsset(assetId: string) {
    const response = await fetch(`/api/assets/${assetId}`, {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as
      | { asset: DistributionAssetListItem }
      | { error?: { message?: string } };

    if (!response.ok || !("asset" in body)) {
      throw new Error(
        "error" in body
          ? body.error?.message ?? "Не удалось обновить статью."
          : "Не удалось обновить статью.",
      );
    }

    setAssets((current) =>
      current.map((asset) => (asset.id === assetId ? body.asset : asset)),
    );
    setSelectedId(assetId);
    return body.asset;
  }

  function hasGeneratedContent(asset: DistributionAssetListItem) {
    const content = asset.canonicalBody.trim();
    return content.length > 80 && !/^черновик будет сгенерирован/i.test(content);
  }

  async function recoverGeneratedAsset(assetId: string) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[article-generate-ui] fetch failed, refetching article", {
        assetId,
      });
    }

    const asset = await reloadAsset(assetId);
    if (hasGeneratedContent(asset)) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[article-generate-ui] recovered from refetch", {
          assetId,
          contentLength: asset.canonicalBody.length,
        });
      }
      toast.success("Статья сгенерирована.");
      return true;
    }

    return false;
  }

  async function runArticleAction(
    assetId: string,
    endpoint:
      | "/api/articles/generate"
      | "/api/articles/schedule"
      | "/api/articles/publish",
    successMessage: string,
    payload: Record<string, unknown> = {},
  ) {
    if (pendingActionsRef.current.has(assetId)) {
      return;
    }

    pendingActionsRef.current.add(assetId);
    setPendingId(assetId);
    const generationMessages = [
      "Генерируем статью...",
      "Это может занять до 30–60 секунд...",
      "Создание структуры...",
      "Пишем компактный черновик...",
      "Сохраняем результат...",
    ];
    let generationTimer: number | null = null;

    try {
      let agentWakeStartedAt: string | undefined;

      if (endpoint === "/api/articles/publish") {
        toast.info(agentProtocolHint);
        const awake = await ensureAgentAwakeForAction({
          onStatus: (message) => toast.info(message),
          readyMessage: "Agent запущен. Отправляем публикацию...",
        });

        if (!awake) {
          toast.error("Не удалось открыть FlowPost Agent.");
          return;
        }

        agentWakeStartedAt = awake.wakeStartedAt;
      }

      if (endpoint === "/api/articles/generate") {
        if (process.env.NODE_ENV !== "production") {
          console.log("[article-generate-ui] start", { assetId });
        }
        let messageIndex = 0;
        setGenerationStatus(generationMessages[messageIndex]);
        generationTimer = window.setInterval(() => {
          messageIndex = Math.min(
            messageIndex + 1,
            generationMessages.length - 1,
          );
          setGenerationStatus(generationMessages[messageIndex]);
        }, 2500);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: assetId,
          ...(agentWakeStartedAt ? { agentWakeStartedAt } : {}),
          ...payload,
        }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        asset?: DistributionAssetListItem;
        status?: "requires_agent" | "queued" | "busy";
        message?: string;
        job?: { id: string };
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(
          body.error?.message ?? "Не удалось выполнить действие.",
        );
      }

      if (endpoint === "/api/articles/generate" && body.asset) {
        setAssets((current) =>
          current.map((asset) => (asset.id === assetId ? body.asset! : asset)),
        );
        setSelectedId(assetId);
        if (process.env.NODE_ENV !== "production") {
          console.log("[article-generate-ui] success", {
            assetId,
            contentLength: body.asset.canonicalBody.length,
          });
        }
      } else {
        await reloadAssets(assetId);
      }
      if (body.status === "requires_agent") {
        toast.info(
          body.message ??
            "Подключите FlowPost Agent, чтобы открыть браузер на вашем компьютере.",
        );
      } else if (body.status === "busy") {
        toast.info(
          body.message ??
            "FlowPost Agent занят. Agent уже выполняет задачу. Новая задача запустится после завершения текущей.",
        );
      } else if (endpoint === "/api/articles/publish" && body.job) {
        toast.success("Публикация отправлена в FlowPost Agent. Браузер не будет показываться.");
      } else {
        toast.success(successMessage);
      }
    } catch (error) {
      if (endpoint === "/api/articles/generate") {
        try {
          if (await recoverGeneratedAsset(assetId)) {
            return;
          }
        } catch (refetchError) {
          console.error("[article-generate-ui] recovery failed", refetchError);
        }
        if (process.env.NODE_ENV !== "production") {
          console.log("[article-generate-ui] failed", { assetId, error });
        }
      }
      toast.error(
        endpoint === "/api/articles/generate"
          ? "Не удалось завершить генерацию. Попробуйте еще раз."
          : error instanceof Error
            ? error.message
            : "Не удалось выполнить действие.",
      );
    } finally {
      if (generationTimer) {
        window.clearInterval(generationTimer);
      }
      setGenerationStatus(null);
      setPendingId(null);
      pendingActionsRef.current.delete(assetId);
    }
  }

  async function archiveAsset(assetId: string) {
    setPendingId(assetId);

    try {
      const response = await fetch(`/api/assets/${assetId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? "Не удалось удалить статью.");
      }

      setAssets((current) => current.filter((asset) => asset.id !== assetId));
      setSelectedId((current) => (current === assetId ? null : current));
      toast.success("Статья удалена.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось удалить статью.",
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Центр публикаций
          </p>
          <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight">
            Публикации
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Компактная очередь статей и быстрые действия по выпуску.
          </p>
        </div>
        <Button
          size="sm"
          nativeButton={false}
          render={<Link href="/articles/new" />}
        >
          <Plus />
          Новая статья
        </Button>
      </div>

      <div className="grid min-h-[680px] gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="rounded-[1.5rem] border-border/40 bg-card/78 py-0 ring-1 ring-white/10">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border/25 px-4 py-4">
              <div>
                <p className="text-sm font-semibold">Статьи</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {assets.length} в рабочем списке
                </p>
              </div>
            </div>

            <div className="space-y-2 p-3">
              {assets.length === 0 ? (
                <div className="rounded-[1.1rem] bg-background/28 px-4 py-10 text-center text-sm text-muted-foreground">
                  Статей пока нет.
                </div>
              ) : (
                assets.map((asset) => {
                  const isSelected = selectedAsset?.id === asset.id;

                  return (
                    <button
                      key={asset.id}
                      type="button"
                      className={`w-full rounded-[1.1rem] border px-3 py-3 text-left transition ${
                        isSelected
                          ? "border-primary/20 bg-primary/[0.08] shadow-[0_18px_42px_-34px_rgba(59,130,246,0.55)]"
                          : "border-transparent bg-background/20 hover:border-border/30 hover:bg-muted/45"
                      }`}
                      onClick={() => setSelectedId(asset.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-sm font-semibold leading-5">
                            {asset.title}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{asset.platformName}</span>
                            <span className="size-1 rounded-full bg-border" />
                            <span>{formatDate(asset.updatedAt)}</span>
                          </div>
                        </div>
                        <StatusBadge
                          tone={publicationTone(asset.publicationStatus)}
                          className="shrink-0"
                        >
                          {statusLabels[asset.publicationStatus]}
                        </StatusBadge>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-border/40 bg-card/78 py-0 ring-1 ring-white/10">
          <CardContent className="p-0">
            {!selectedAsset ? (
              <div className="flex min-h-[520px] items-center justify-center px-6 text-sm text-muted-foreground">
                Выберите статью слева.
              </div>
            ) : (
              <div className="grid min-h-[680px] grid-rows-[1fr_auto]">
                <div className="space-y-5 p-5 lg:p-6">
                  <section className="rounded-[1.45rem] bg-background/28 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            tone={publicationTone(
                              selectedAsset.publicationStatus,
                            )}
                          >
                            {statusLabels[selectedAsset.publicationStatus]}
                          </StatusBadge>
                          <span className="text-xs text-muted-foreground">
                            {selectedAsset.platformName}
                          </span>
                        </div>
                        <h2 className="mt-4 max-w-4xl font-heading text-2xl font-semibold tracking-tight">
                          {selectedAsset.title}
                        </h2>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {selectedAsset.brandName} · {selectedAsset.brandDomain}
                        </p>
                        {selectedAsset.publicationStatus === "FAILED" &&
                        selectedAsset.publicationLastError ? (
                          <p className="text-destructive mt-3 max-w-3xl text-sm">
                            {selectedAsset.publicationLastError}
                          </p>
                        ) : null}
                      </div>

                      <div className="grid shrink-0 gap-3 rounded-[1.2rem] border border-border/25 bg-card/55 px-4 py-3 sm:grid-cols-2 lg:grid-cols-1">
                        <div>
                          <p className="text-xs text-muted-foreground">Обновлено</p>
                          <p className="mt-1 text-sm font-medium">
                            {formatDate(selectedAsset.updatedAt)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Публикация</p>
                          <p className="mt-1 text-sm font-medium">
                            {formatDate(
                              selectedAsset.publishedAt ??
                                selectedAsset.scheduledAt,
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="flex flex-wrap gap-2 rounded-[1.35rem] bg-background/22 p-3">
                    <Button
                      size="sm"
                      onClick={() =>
                        void runArticleAction(
                          selectedAsset.id,
                          "/api/articles/publish",
                          "Публикация запущена.",
                        )
                      }
                      disabled={
                        pendingId === selectedAsset.id ||
                        selectedAsset.publicationStatus === "PUBLISHED"
                      }
                    >
                      <Send />
                      Опубликовать
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      nativeButton={false}
                      render={
                        <Link href={`/articles/${selectedAsset.id}/edit`} />
                      }
                    >
                      <Edit3 />
                      Изменить
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      nativeButton={false}
                      render={
                        <Link href={`/articles/${selectedAsset.id}/preview`} />
                      }
                    >
                      <Eye />
                      Просмотр
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void runArticleAction(
                          selectedAsset.id,
                          "/api/articles/generate",
                          "Статья сгенерирована.",
                        )
                      }
                      disabled={pendingId === selectedAsset.id}
                    >
                      {pendingId === selectedAsset.id && generationStatus ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Zap />
                      )}
                      {pendingId === selectedAsset.id && generationStatus
                        ? generationStatus
                        : "Сгенерировать"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void runArticleAction(
                          selectedAsset.id,
                          "/api/articles/schedule",
                          "Статья запланирована.",
                          {
                            publishAt:
                              selectedAsset.scheduledAt ??
                              new Date(
                                Date.now() + 24 * 60 * 60 * 1000,
                              ).toISOString(),
                          },
                        )
                      }
                      disabled={
                        pendingId === selectedAsset.id ||
                        selectedAsset.publicationStatus === "PUBLISHED"
                      }
                    >
                      <CalendarClock />
                      Запланировать
                    </Button>
                  </section>

                  <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[1.2rem] bg-background/24 p-4">
                      <p className="text-xs text-muted-foreground">Площадка</p>
                      <p className="mt-2 text-sm font-semibold">
                        {selectedAsset.platformName}
                      </p>
                    </div>
                    <div className="rounded-[1.2rem] bg-background/24 p-4">
                      <p className="text-xs text-muted-foreground">Статус</p>
                      <div className="mt-2">
                        <StatusBadge
                          tone={publicationTone(
                            selectedAsset.publicationStatus,
                          )}
                        >
                          {statusLabels[selectedAsset.publicationStatus]}
                        </StatusBadge>
                      </div>
                    </div>
                    <div className="rounded-[1.2rem] bg-background/24 p-4">
                      <p className="text-xs text-muted-foreground">Интент</p>
                      <p className="mt-2 text-sm font-semibold">
                        {selectedAsset.intent ?? "Не указан"}
                      </p>
                    </div>
                    <div className="rounded-[1.2rem] bg-background/24 p-4">
                      <p className="text-xs text-muted-foreground">Ключ</p>
                      <p className="mt-2 line-clamp-2 text-sm font-semibold">
                        {selectedAsset.primaryKeyword ?? "Не указан"}
                      </p>
                    </div>
                  </section>

                  <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div className="rounded-[1.35rem] bg-background/24 p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Кратко о статье
                      </p>
                      <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
                        {selectedAsset.summary ??
                          "Краткое описание пока не сформировано. Карточка оставлена легкой, чтобы фокус был на заголовке, площадке и выпуске."}
                      </p>
                    </div>

                    <div className="rounded-[1.35rem] bg-background/24 p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Площадки
                      </p>
                      <div className="mt-4 space-y-3">
                        {platformOptions.map((platform) => {
                          const isCurrent =
                            platform.id === selectedAsset.platformId;

                          return (
                            <div
                              key={platform.id}
                              className="flex items-center justify-between gap-3 text-sm"
                            >
                              <span
                                className={
                                  isCurrent
                                    ? "font-semibold text-foreground"
                                    : "text-muted-foreground"
                                }
                              >
                                {platform.name}
                              </span>
                              {isCurrent ? (
                                <StatusBadge
                                  tone={publicationTone(
                                    selectedAsset.publicationStatus,
                                  )}
                                >
                                  выбрана
                                </StatusBadge>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                </div>

                <div className="flex flex-col gap-3 border-t border-border/25 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
                  <p className="text-sm text-muted-foreground">
                    Последнее обновление: {formatDate(selectedAsset.updatedAt)}
                  </p>
                  <Button
                    variant="ghost"
                    className="justify-start text-destructive hover:text-destructive"
                    onClick={() => void archiveAsset(selectedAsset.id)}
                    disabled={pendingId === selectedAsset.id}
                  >
                    <Trash2 />
                    Удалить
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
