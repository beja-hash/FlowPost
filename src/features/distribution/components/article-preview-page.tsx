import Link from "next/link";
import { ArrowLeft, Edit3 } from "lucide-react";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DistributionAssetListItem } from "@/features/distribution/types";

type ArticlePreviewPageProps = {
  asset: DistributionAssetListItem;
};

const statusLabels = {
  PLANNED: "черновик",
  SCHEDULED: "запланировано",
  WAITING_AGENT: "ожидает agent",
  PUBLISHING: "публикуется",
  PUBLISHED: "опубликовано",
  FAILED: "ошибка",
  CANCELED: "отменено",
} as const;

function publicationTone(status: DistributionAssetListItem["publicationStatus"]) {
  if (status === "PUBLISHED") {
    return "positive";
  }

  if (status === "FAILED") {
    return "danger";
  }

  if (status === "PUBLISHING" || status === "WAITING_AGENT") {
    return "warning";
  }

  if (status === "SCHEDULED") {
    return "info";
  }

  return "neutral";
}

function getLineType(line: string) {
  const trimmed = line.trim();

  if (/^#{1,3}\s+/.test(trimmed)) {
    return "heading";
  }

  if (/^[А-ЯA-ZЁ][^.!?]{8,90}$/.test(trimmed)) {
    return "heading";
  }

  if (/^[-*]\s+/.test(trimmed)) {
    return "list";
  }

  return "paragraph";
}

function cleanLine(line: string) {
  return line.trim().replace(/^#{1,3}\s+/, "").replace(/^[-*]\s+/, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderLinkedText(
  text: string,
  options: { ctaText?: string | null; ctaUrl?: string | null; brandUrl?: string | null },
) {
  const ctaText = options.ctaText?.trim();
  const href = options.ctaUrl?.trim() || options.brandUrl?.trim();

  if (!ctaText || !href || !text.toLowerCase().includes(ctaText.toLowerCase())) {
    return text;
  }

  const pattern = new RegExp(`(${escapeRegExp(ctaText)})`, "gi");
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    if (part.toLowerCase() !== ctaText.toLowerCase()) {
      return part;
    }

    return (
      <a
        key={`${part}-${index}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-4"
      >
        {part}
      </a>
    );
  });
}

function renderArticleContent(asset: DistributionAssetListItem) {
  const content = asset.canonicalBody;
  const lines = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return (
      <p className="text-muted-foreground">
        Текст статьи пока не добавлен. Откройте редактор и нажмите «Сгенерировать».
      </p>
    );
  }

  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];

  function flushList(index: number) {
    if (listItems.length === 0) {
      return;
    }

    nodes.push(
      <ul key={`list-${index}`} className="my-6 list-disc space-y-2 pl-6">
        {listItems.map((item, itemIndex) => (
          <li key={`${item}-${itemIndex}`}>{renderLinkedText(item, asset)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  lines.forEach((line, index) => {
    const type = getLineType(line);

    if (type === "list") {
      listItems.push(cleanLine(line));
      return;
    }

    flushList(index);

    if (type === "heading") {
      nodes.push(
        <h2
          key={`${line}-${index}`}
          className="mt-10 scroll-m-24 text-2xl font-semibold tracking-tight text-foreground first:mt-0"
        >
          {cleanLine(line)}
        </h2>,
      );
      return;
    }

    nodes.push(
      <p key={`${line}-${index}`} className="my-5">
        {renderLinkedText(line, asset)}
      </p>,
    );
  });

  flushList(lines.length);

  return nodes;
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

function isOverdueScheduled(asset: DistributionAssetListItem) {
  return (
    asset.publicationStatus === "SCHEDULED" &&
    Boolean(asset.scheduledAt) &&
    new Date(asset.scheduledAt!).getTime() <= Date.now()
  );
}

function publicationStatusLabel(asset: DistributionAssetListItem) {
  if (asset.publicationStatus === "WAITING_AGENT") {
    return "agent offline";
  }

  if (asset.publicationStatus === "SCHEDULED" && asset.scheduledAt) {
    return isOverdueScheduled(asset)
      ? "ожидает публикации"
      : `запланировано на ${formatTime(asset.scheduledAt)}`;
  }

  if (asset.publicationStatus === "FAILED") {
    return "ошибка публикации";
  }

  return statusLabels[asset.publicationStatus];
}

export function ArticlePreviewPage({ asset }: ArticlePreviewPageProps) {
  return (
    <div className="space-y-8">
      <div className="sticky top-16 z-20 -mx-4 border-b border-border/70 bg-background/88 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
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
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {asset.title}
              </h1>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge tone={publicationTone(asset.publicationStatus)}>
                  {publicationStatusLabel(asset)}
                </StatusBadge>
                <span className="text-sm text-muted-foreground">
                  {asset.brandName} · {asset.platformName}
                </span>
              </div>
              {asset.publicationStatus === "WAITING_AGENT" ? (
                <p className="text-destructive mt-2 text-sm">
                  Время публикации прошло, но agent был offline.
                </p>
              ) : isOverdueScheduled(asset) ? (
                <p className="text-destructive mt-2 text-sm">
                  Время публикации прошло, но задача ещё не была обработана.
                  Проверьте agent/scheduler.
                </p>
              ) : null}
            </div>
          </div>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={`/articles/${asset.id}/edit`} />}
          >
            <Edit3 />
            Редактировать
          </Button>
        </div>
      </div>

      <Card className="mx-auto max-w-[840px] rounded-2xl border-border/70 shadow-none">
        <CardContent className="px-5 py-8 sm:px-10 lg:px-12">
          <article className="mx-auto max-w-[760px] text-[17px] leading-[1.75] text-foreground/88 sm:text-lg">
            <header className="mb-10 border-b border-border/70 pb-8">
              <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {asset.primaryKeyword ?? asset.platformName}
              </p>
              <h2 className="text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
                {asset.title}
              </h2>
              {asset.summary ? (
                <p className="mt-5 text-lg leading-8 text-muted-foreground">
                  {asset.summary}
                </p>
              ) : null}
            </header>

            {renderArticleContent(asset)}
          </article>
        </CardContent>
      </Card>
    </div>
  );
}
