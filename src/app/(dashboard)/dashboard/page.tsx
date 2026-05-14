import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CircleCheckBig,
  CircleX,
  FileText,
  Globe2,
  Layers3,
} from "lucide-react";

import { StatusBadge } from "@/components/saas/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardOverview } from "@/features/dashboard/server/get-dashboard-overview";
import type {
  DashboardActivityItem,
  DashboardPlatformAnalytics,
} from "@/features/dashboard/types";
import { requireSession } from "@/infrastructure/auth/session";

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Нет активности";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function MetricTile({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <Card className="rounded-[1.4rem] border-border/45 bg-card/78 py-4 shadow-[0_22px_70px_-48px_rgba(15,23,42,0.4)] ring-1 ring-white/10">
      <CardContent className="flex items-start justify-between gap-4 px-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
        </div>
        <span className={`grid size-10 place-items-center rounded-2xl ${accent}`}>
          <Icon className="size-4.5" />
        </span>
      </CardContent>
    </Card>
  );
}

function PlatformIndicator({
  analytics,
}: {
  analytics: DashboardPlatformAnalytics;
}) {
  const ratioLabel = `${analytics.successfulPublications}/${analytics.failedPublications}`;
  const barValue =
    analytics.totalPublications === 0 ? 0 : Math.max(analytics.successRate, 8);

  return (
    <div className="rounded-[1.2rem] border border-border/40 bg-background/34 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">{analytics.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatNumber(analytics.totalPublications)} публикаций
          </p>
        </div>
        <StatusBadge
          tone={
            analytics.indicator === "healthy"
              ? "positive"
              : analytics.indicator === "watch"
                ? "warning"
                : "neutral"
          }
        >
          {analytics.indicator === "healthy"
            ? "стабильно"
            : analytics.indicator === "watch"
              ? "внимание"
              : "нет данных"}
        </StatusBadge>
      </div>

      <div className="mt-4 h-2 rounded-full bg-muted/70">
        <div
          className="h-2 rounded-full bg-[linear-gradient(90deg,var(--color-chart-2),var(--color-chart-1))]"
          style={{ width: `${barValue}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Успех / сбой</p>
          <p className="mt-1 font-medium">{ratioLabel}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Последняя</p>
          <p className="mt-1 font-medium">{formatDate(analytics.lastPublicationAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Переходы</p>
          <p className="mt-1 font-medium">{formatNumber(analytics.trackedClicks)}</p>
        </div>
      </div>
    </div>
  );
}

function ActivityDot({ kind }: { kind: DashboardActivityItem["kind"] }) {
  const className =
    kind === "published"
      ? "bg-emerald-500"
      : kind === "failed"
        ? "bg-red-500"
        : kind === "scheduled"
          ? "bg-sky-500"
          : "bg-primary";

  return <span className={`mt-1 size-2 rounded-full ${className}`} />;
}

export default async function DashboardPage() {
  const session = await requireSession();
  const overview = await getDashboardOverview(session.user.id);
  const maxTimeline = Math.max(
    ...overview.publicationsOverTime.map((point) => point.total),
    1,
  );
  const platformTotal = Math.max(
    overview.platformAnalytics.reduce(
      (total, platform) => total + platform.totalPublications,
      0,
    ),
    1,
  );

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[1.8rem] border border-border/35 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-card)_92%,white_8%),color-mix(in_srgb,var(--color-primary)_10%,var(--color-card)_90%))] p-6 shadow-[0_34px_120px_-68px_rgba(15,23,42,0.6)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Аналитика
            </p>
            <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight">
              Дашборд продукта
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Сводка по генерации контента, публикациям и площадкам без лишнего шума.
            </p>
          </div>

          <div className="grid gap-3 rounded-[1.4rem] border border-border/35 bg-background/45 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Следующий выпуск</p>
              <p className="mt-1 text-sm font-medium">
                {formatDate(overview.nextDistributionAt)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Последняя активность</p>
              <p className="mt-1 text-sm font-medium">
                {formatDate(overview.lastActivityAt)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <MetricTile
          label="Всего брендов"
          value={formatNumber(overview.totalBrands)}
          icon={Globe2}
          accent="bg-primary/10 text-primary"
        />
        <MetricTile
          label="Всего статей"
          value={formatNumber(overview.totalArticles)}
          icon={FileText}
          accent="bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
        />
        <MetricTile
          label="Публикации"
          value={formatNumber(overview.totalPublications)}
          icon={Layers3}
          accent="bg-violet-500/10 text-violet-600 dark:text-violet-300"
        />
        <MetricTile
          label="Успешные"
          value={formatNumber(overview.successfulPublications)}
          icon={CircleCheckBig}
          accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
        />
        <MetricTile
          label="С ошибкой"
          value={formatNumber(overview.failedPublications)}
          icon={CircleX}
          accent="bg-red-500/10 text-red-600 dark:text-red-300"
        />
        <MetricTile
          label="Запланированы"
          value={formatNumber(overview.scheduledPublications)}
          icon={CalendarClock}
          accent="bg-amber-500/10 text-amber-600 dark:text-amber-300"
        />
        <MetricTile
          label="Доля успеха"
          value={`${overview.successRate}%`}
          icon={ArrowUpRight}
          accent="bg-teal-500/10 text-teal-600 dark:text-teal-300"
        />
      </div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.45fr)_420px]">
        <Card className="rounded-[1.6rem] border-border/40 bg-card/78 ring-1 ring-white/10">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardDescription>Динамика</CardDescription>
            <CardTitle className="flex items-center gap-2 text-xl">
              <BarChart3 className="size-5 text-primary" />
              Публикации по дням
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex min-h-[250px] items-end gap-3 rounded-[1.4rem] border border-border/30 bg-background/32 p-4">
              {overview.publicationsOverTime.map((point) => (
                <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-3">
                  <div className="flex h-[180px] items-end justify-center rounded-full bg-muted/35 px-2">
                    <div
                      className="w-full rounded-full bg-[linear-gradient(180deg,var(--color-chart-1),var(--color-chart-2))]"
                      style={{
                        height: `${Math.max((point.total / maxTimeline) * 100, point.total ? 14 : 4)}%`,
                      }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium">{point.total}</p>
                    <p className="mt-1 text-[0.68rem] text-muted-foreground">
                      {point.label}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.3rem] border border-border/30 bg-background/32 p-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Соотношение успехов и сбоев
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-tight">
                  {overview.successRate}%
                </p>
                <div className="mt-4 h-2 rounded-full bg-red-500/12">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${overview.successRate}%` }}
                  />
                </div>
                <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                  <span>{overview.successfulPublications} успешно</span>
                  <span>{overview.failedPublications} с ошибкой</span>
                </div>
              </div>

              <div className="rounded-[1.3rem] border border-border/30 bg-background/32 p-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Отслеженные переходы
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-tight">
                  {formatNumber(overview.trackedClicks)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Переходы по отслеживаемым ссылкам публикаций.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.6rem] border-border/40 bg-card/78 ring-1 ring-white/10">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardDescription>Каналы</CardDescription>
            <CardTitle className="text-xl">Распределение по площадкам</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {overview.platformAnalytics.map((platform) => (
              <div key={platform.key}>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{platform.name}</span>
                  <span className="text-muted-foreground">
                    {formatNumber(platform.totalPublications)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted/60">
                  <div
                    className="h-2 rounded-full bg-[linear-gradient(90deg,var(--color-chart-4),var(--color-chart-1))]"
                    style={{
                      width: `${Math.max(
                        (platform.totalPublications / platformTotal) * 100,
                        platform.totalPublications ? 12 : 4,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="rounded-[1.6rem] border-border/40 bg-card/78 ring-1 ring-white/10">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardDescription>Площадки</CardDescription>
            <CardTitle className="text-xl">Состояние публикаций</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 pt-5 xl:grid-cols-3">
            {overview.platformAnalytics.map((platform) => (
              <PlatformIndicator key={platform.key} analytics={platform} />
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-[1.6rem] border-border/40 bg-card/78 ring-1 ring-white/10">
          <CardHeader className="border-b border-border/30 pb-4">
            <CardDescription>Бренды</CardDescription>
            <CardTitle className="text-xl">Самые активные бренды</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {overview.brandAnalytics.length === 0 ? (
              <div className="rounded-[1.2rem] border border-border/30 bg-background/28 px-4 py-8 text-sm text-muted-foreground">
                Активность брендов появится после первых статей и публикаций.
              </div>
            ) : (
              overview.brandAnalytics.map((brand) => (
                <div
                  key={brand.id}
                  className="grid gap-3 rounded-[1.2rem] border border-border/30 bg-background/28 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{brand.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(brand.recentActivityAt)}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">Статьи</p>
                    <p className="mt-1 font-medium">{brand.articleCount}</p>
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">Публикации</p>
                    <p className="mt-1 font-medium">{brand.publicationCount}</p>
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">Успех</p>
                    <p className="mt-1 font-medium">{brand.successRate}%</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[1.6rem] border-border/40 bg-card/78 ring-1 ring-white/10">
        <CardHeader className="border-b border-border/30 pb-4">
          <CardDescription>Активность</CardDescription>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Activity className="size-5 text-primary" />
            Последние события
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          {overview.recentActivity.length === 0 ? (
            <div className="rounded-[1.2rem] border border-border/30 bg-background/28 px-4 py-8 text-sm text-muted-foreground">
              Здесь появятся новые статьи, публикации и ошибки доставки.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {overview.recentActivity.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-3 rounded-[1.2rem] border border-border/30 bg-background/28 px-4 py-3"
                >
                  <ActivityDot kind={item.kind} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(item.occurredAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
