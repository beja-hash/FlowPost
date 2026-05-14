"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Loader2,
  Minus,
  Pause,
  Plus,
  Play,
  Rocket,
  Square,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandOption } from "@/features/brands/types";
import type { PlatformOption } from "@/features/distribution/types";

type StrategyListItem = {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  status: string;
  platforms: string[];
  articlesPerDay: number;
  distributionMode: string;
  vcPerDay: number | null;
  dzenPerDay: number | null;
  timeSlots: string[];
  platformTimeSlots?: {
    vc?: string[];
    dzen?: string[];
  };
  daysOfWeek: number[];
  startDate: string;
  endDate: string;
  generationMode: string;
  publishMode: string;
  publishExecutionMode?: string;
  cta: string | null;
  link: string | null;
  goal: string | null;
  topicDirections: string | null;
  forbiddenTopics: string | null;
  nextRunAt: string | null;
  taskCounts: Record<string, number>;
  tasks: Array<{
    id: string;
    platform: string;
    scheduledAt: string;
    status: string;
    topic: string | null;
    title?: string | null;
    contentFormat?: string | null;
    tone?: string | null;
    mainThesis?: string | null;
    articleId: string | null;
    error: string | null;
    attempts?: number;
  }>;
};

type StrategyAutopilotPageProps = {
  brands: BrandOption[];
  platforms: PlatformOption[];
  strategies: StrategyListItem[];
};

type FormState = {
  name: string;
  brandId: string;
  platforms: string[];
  articlesPerDay: number;
  distributionMode: string;
  vcPerDay: number;
  dzenPerDay: number;
  timeSlots: string[];
  platformTimeSlots: {
    vc?: string[];
    dzen?: string[];
  } | null;
  daysOfWeek: number[];
  startDate: string;
  endDate: string;
  generationMode: string;
  publishMode: string;
  cta: string;
  link: string;
  goal: string;
  topicDirections: string;
  forbiddenTopics: string;
};

const dayLabels = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const defaultSlots = ["09:00", "12:00", "15:00", "18:00", "21:00"];
const defaultPlatformSlots = {
  dzen: ["09:00", "13:00", "17:00"],
  vc: ["10:00", "15:00", "20:00"],
};
const taskTabs = [
  { id: "all", label: "Все" },
  { id: "dzen", label: "Дзен" },
  { id: "vc", label: "VC.ru" },
] as const;

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildInitialForm(brands: BrandOption[]): FormState {
  const today = new Date();

  return {
    name: "Органический трафик через VC.ru и Дзен",
    brandId: brands[0]?.id ?? "",
    platforms: ["vc", "dzen"],
    articlesPerDay: 6,
    distributionMode: "EQUAL",
    vcPerDay: 3,
    dzenPerDay: 3,
    timeSlots: defaultSlots,
    platformTimeSlots: defaultPlatformSlots,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startDate: toDateInput(today),
    endDate: toDateInput(addDays(today, 30)),
    generationMode: "QUALITY",
    publishMode: "GENERATE_AND_SCHEDULE",
    cta: "Посмотреть демо",
    link: "",
    goal: "",
    topicDirections: "",
    forbiddenTopics: "Не обещать гарантированные лиды и продажи. Не писать про неподдерживаемые площадки.",
  };
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Не запланировано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "Черновик",
    ACTIVE: "Активна",
    PAUSED: "Пауза",
    STOPPED: "Остановлена",
    PLANNED: "Запланировано",
    BRIEF_GENERATED: "Бриф создан",
    ARTICLE_GENERATED: "Статья создана",
    SCHEDULED: "Ожидает публикации",
    WAITING_AGENT: "Ждёт компьютер клиента",
    MISSED: "Пропущено, требуется действие",
    CATCHUP_PENDING: "Опубликуется при следующем запуске",
    PUBLISHING: "Публикуется",
    PUBLISHED: "Опубликовано",
    FAILED: "Ошибка",
    SKIPPED: "Пропущено",
    WAITING_CONNECTION: "Требуется подключить браузер",
  };

  return labels[status] ?? status;
}

function statusTone(status: string): "positive" | "warning" | "danger" | "neutral" | "info" {
  if (status === "ACTIVE" || status === "PUBLISHED") {
    return "positive";
  }

  if (status === "FAILED" || status === "STOPPED") {
    return "danger";
  }

  if (
    status === "PAUSED" ||
    status === "WAITING_CONNECTION" ||
    status === "MISSED"
  ) {
    return "warning";
  }

  if (
    status === "SCHEDULED" ||
    status === "ARTICLE_GENERATED" ||
    status === "CATCHUP_PENDING" ||
    status === "WAITING_AGENT"
  ) {
    return "info";
  }

  return "neutral";
}

function platformLabel(platform: string) {
  return platform === "dzen" ? "Дзен" : "VC.ru";
}

function toIsoDate(dateInput: string, endOfDay = false) {
  const date = new Date(`${dateInput}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return date.toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function minutesFromSlot(slot: string) {
  const [hours = "0", minutes = "0"] = slot.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function slotFromMinutes(totalMinutes: number) {
  const rounded = Math.round(totalMinutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function generateEvenSlots(count: number, start: string, end: string) {
  if (count <= 1) {
    return [start];
  }

  const startMinutes = minutesFromSlot(start);
  const endMinutes = Math.max(minutesFromSlot(end), startMinutes + 60);
  const step = (endMinutes - startMinutes) / count;

  return Array.from({ length: count }, (_, index) =>
    slotFromMinutes(startMinutes + step * index),
  );
}

function uniqueSortedSlots(slots: string[]) {
  return Array.from(new Set(slots)).sort();
}

function platformSlotsFromForm(form: FormState, platform: "vc" | "dzen") {
  const configured = form.platformTimeSlots?.[platform];
  if (configured?.length) {
    return uniqueSortedSlots(configured);
  }

  const limit = platform === "dzen" ? form.dzenPerDay : form.vcPerDay;
  return uniqueSortedSlots(form.timeSlots.length ? form.timeSlots.slice(0, limit) : defaultSlots);
}

function allSlotsFromPlatformSlots(slots: NonNullable<FormState["platformTimeSlots"]>) {
  return uniqueSortedSlots([...(slots.dzen ?? []), ...(slots.vc ?? [])]);
}

function groupTasksByDay(tasks: StrategyListItem["tasks"]) {
  return tasks.reduce<Record<string, StrategyListItem["tasks"]>>((acc, task) => {
    const key = task.scheduledAt.slice(0, 10);
    acc[key] = [...(acc[key] ?? []), task];
    return acc;
  }, {});
}

export function StrategyAutopilotPage({
  brands,
  platforms,
  strategies,
}: StrategyAutopilotPageProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => buildInitialForm(brands));
  const [activeStrategyId, setActiveStrategyId] = useState(strategies[0]?.id ?? "");
  const [newSlots, setNewSlots] = useState<Record<"dzen" | "vc", string>>({
    dzen: "10:00",
    vc: "10:00",
  });
  const [autoRanges, setAutoRanges] = useState<
    Record<"dzen" | "vc", { start: string; end: string }>
  >({
    dzen: { start: "09:00", end: "21:00" },
    vc: { start: "09:00", end: "21:00" },
  });
  const [taskTab, setTaskTab] = useState<(typeof taskTabs)[number]["id"]>("all");
  const [isPending, startTransition] = useTransition();
  const activeStrategy =
    strategies.find((strategy) => strategy.id === activeStrategyId) ?? strategies[0];

  const preview = useMemo(() => {
    const start = new Date(`${form.startDate}T00:00:00`);
    const end = new Date(`${form.endDate}T23:59:59`);
    const days = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / 86_400_000),
    );
    const activeDays = Array.from({ length: days }, (_, index) => {
      const next = new Date(start);
      next.setDate(start.getDate() + index);
      return form.daysOfWeek.includes(next.getDay());
    }).filter(Boolean).length;
    const dzenPerDay = form.platforms.includes("dzen") ? form.dzenPerDay : 0;
    const vcPerDay = form.platforms.includes("vc") ? form.vcPerDay : 0;
    const dzenSlots = platformSlotsFromForm(form, "dzen");
    const vcSlots = platformSlotsFromForm(form, "vc");
    const perDay = dzenPerDay + vcPerDay;
    const total = activeDays * perDay;

    return {
      activeDays,
      total,
      perDay,
      perWeek: perDay * form.daysOfWeek.length,
      vcTotal: activeDays * vcPerDay,
      dzenTotal: activeDays * dzenPerDay,
      weekVc: vcPerDay * 7,
      weekDzen: dzenPerDay * 7,
      weekTotal: perDay * 7,
      dzenSlots,
      vcSlots,
      volumeWarning:
        perDay > 10
          ? "Высокий темп публикаций. Проверьте лимиты тарифа и качество тем."
          : null,
    };
  }, [form]);

  const activeTasks = activeStrategy?.tasks ?? [];
  const filteredTasks = activeTasks
    .filter((task) => taskTab === "all" || task.platform === taskTab)
    .sort(
      (left, right) =>
        new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime(),
    );
  const groupedTasks = groupTasksByDay(filteredTasks);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePlatform(platform: string) {
    setForm((current) => {
      const nextPlatforms = current.platforms.includes(platform)
        ? current.platforms.filter((item) => item !== platform)
        : [...current.platforms, platform];
      const vcPerDay =
        platform === "vc" && nextPlatforms.includes("vc")
          ? Math.max(1, current.vcPerDay)
          : current.vcPerDay;
      const dzenPerDay =
        platform === "dzen" && nextPlatforms.includes("dzen")
          ? Math.max(1, current.dzenPerDay)
          : current.dzenPerDay;

      return {
        ...current,
        platforms: nextPlatforms,
        vcPerDay,
        dzenPerDay,
        articlesPerDay:
          (nextPlatforms.includes("vc") ? vcPerDay : 0) +
          (nextPlatforms.includes("dzen") ? dzenPerDay : 0),
        distributionMode: "CUSTOM",
      };
    });
  }

  function updatePlatformLimit(platform: "vc" | "dzen", value: number) {
    setForm((current) => {
      const nextValue = clamp(value, current.platforms.includes(platform) ? 1 : 0, 10);
      const vcPerDay = platform === "vc" ? nextValue : current.vcPerDay;
      const dzenPerDay = platform === "dzen" ? nextValue : current.dzenPerDay;
      const articlesPerDay =
        (current.platforms.includes("vc") ? vcPerDay : 0) +
        (current.platforms.includes("dzen") ? dzenPerDay : 0);

      return {
        ...current,
        vcPerDay,
        dzenPerDay,
        articlesPerDay,
        distributionMode: "CUSTOM",
      };
    });
  }

  function updatePlatformSlots(platform: "vc" | "dzen", slots: string[]) {
    setForm((current) => {
      const currentSlots = {
        dzen: platformSlotsFromForm(current, "dzen"),
        vc: platformSlotsFromForm(current, "vc"),
      };
      const platformTimeSlots = {
        ...currentSlots,
        [platform]: uniqueSortedSlots(slots),
      };

      return {
        ...current,
        platformTimeSlots,
        timeSlots: allSlotsFromPlatformSlots(platformTimeSlots),
      };
    });
  }

  function setPlatformAutoRange(
    platform: "vc" | "dzen",
    key: "start" | "end",
    value: string,
  ) {
    setAutoRanges((current) => ({
      ...current,
      [platform]: {
        ...current[platform],
        [key]: value,
      },
    }));
  }

  function setPlatformNewSlot(platform: "vc" | "dzen", value: string) {
    setNewSlots((current) => ({
      ...current,
      [platform]: value,
    }));
  }

  function applyDistributionPreset(preset: "equal" | "more_dzen" | "more_vc") {
    setForm((current) => {
      const selected = current.platforms;
      if (selected.length < 2) {
        return current;
      }

      const total = Math.max(2, current.articlesPerDay);
      const dzenPerDay =
        preset === "more_dzen" ? Math.ceil((total * 2) / 3) : preset === "more_vc" ? Math.floor(total / 3) : Math.ceil(total / 2);
      const vcPerDay = total - dzenPerDay;

      return {
        ...current,
        dzenPerDay: clamp(dzenPerDay, 1, 10),
        vcPerDay: clamp(vcPerDay, 1, 10),
        distributionMode:
          preset === "more_dzen" ? "MORE_DZEN" : preset === "more_vc" ? "MORE_VC" : "EQUAL",
      };
    });
  }

  function toggleDay(day: number) {
    setForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((item) => item !== day)
        : [...current.daysOfWeek, day].sort((a, b) => a - b),
    }));
  }

  function submitStrategy(status: "DRAFT" | "ACTIVE") {
    if (!form.brandId) {
      toast.error("Сначала выберите бренд.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            articlesPerDay: preview.perDay,
            distributionMode: "CUSTOM",
            vcPerDay: form.platforms.includes("vc") ? form.vcPerDay : 0,
            dzenPerDay: form.platforms.includes("dzen") ? form.dzenPerDay : 0,
            status,
            startDate: toIsoDate(form.startDate),
            endDate: toIsoDate(form.endDate, true),
          }),
        });
        const payload = (await response.json()) as {
          strategy?: StrategyListItem;
          error?: { message?: string };
        };

        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Не удалось сохранить стратегию.");
        }

        toast.success(status === "ACTIVE" ? "Автопилот запущен." : "Стратегия сохранена.");
        setActiveStrategyId(payload.strategy?.id ?? "");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Не удалось сохранить стратегию.",
        );
      }
    });
  }

  function runAction(strategyId: string, action: string, successMessage: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/strategies/${strategyId}/${action}`, {
          method: "POST",
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Действие не выполнено.");
        }

        toast.success(successMessage);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Действие не выполнено.");
      }
    });
  }

  function runTaskAction(
    taskId: string,
    action: string,
    successMessage: string,
    body?: Record<string, unknown>,
  ) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/agent/tasks/${taskId}/${action}`, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Действие не выполнено.");
        }

        toast.success(successMessage);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Действие не выполнено.");
      }
    });
  }

  function runStrategyTaskAction(
    strategyId: string,
    taskId: string,
    action: string,
    successMessage: string,
  ) {
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/strategies/${strategyId}/tasks/${taskId}/${action}`,
          { method: "POST" },
        );
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Действие не выполнено.");
        }

        toast.success(successMessage);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Действие не выполнено.");
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm font-medium">Контент-автопилот</p>
        <h1 className="font-heading text-4xl font-semibold tracking-[-0.05em]">
          Стратегия публикаций
        </h1>
        <p className="text-muted-foreground max-w-3xl text-base leading-7">
          Настройте частоту, площадки и параметры контента — система будет сама
          создавать, планировать и публиковать статьи.
        </p>
        <div className="mt-2 max-w-4xl rounded-2xl border border-primary/15 bg-primary/8 p-4 text-sm leading-6 text-muted-foreground">
          Автопубликация на тарифах Standard и Middle работает через
          подключённый браузер клиента. Если компьютер был выключен или в
          спящем режиме, пропущенные публикации будут обработаны при следующем
          запуске.
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.55fr)]">
        <Card className="rounded-[2rem] border-border/35 bg-card/70">
          <CardHeader>
            <CardTitle className="text-2xl">Настройки стратегии</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <Field label="Название стратегии">
              <Input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="Например: Органический трафик для B2B SaaS"
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Бренд">
                <select
                  value={form.brandId}
                  onChange={(event) => updateField("brandId", event.target.value)}
                  className="h-10 rounded-xl border border-input/80 bg-card/80 px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring"
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Режим публикации">
                <select
                  value={form.publishMode}
                  onChange={(event) => updateField("publishMode", event.target.value)}
                  className="h-10 rounded-xl border border-input/80 bg-card/80 px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring"
                >
                  <option value="DRAFT_ONLY">Только создавать черновики</option>
                  <option value="GENERATE_AND_SCHEDULE">
                    Генерировать и планировать
                  </option>
                  <option value="AUTO_PUBLISH">
                    Генерировать и публиковать автоматически
                  </option>
                </select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Площадки">
                <div className="flex flex-wrap gap-2">
                  {platforms
                    .filter((platform) => ["vc", "dzen"].includes(platform.slug))
                    .map((platform) => (
                      <button
                        key={platform.id}
                        type="button"
                        onClick={() => togglePlatform(platform.slug)}
                        className={`rounded-xl border px-3 py-2 text-sm transition ${
                          form.platforms.includes(platform.slug)
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border/45 bg-muted/25 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {platform.slug === "dzen" ? "Дзен" : "VC.ru"}
                      </button>
                    ))}
                </div>
              </Field>
              <div className="rounded-2xl border border-border/35 bg-muted/20 p-4">
                <p className="text-sm font-medium">Быстрое распределение</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => applyDistributionPreset("equal")}
                    disabled={form.platforms.length < 2}
                  >
                    Поровну
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => applyDistributionPreset("more_dzen")}
                    disabled={form.platforms.length < 2}
                  >
                    Больше в Дзен
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => applyDistributionPreset("more_vc")}
                    disabled={form.platforms.length < 2}
                  >
                    Больше в VC.ru
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <PlatformCounter
                label="Дзен"
                value={form.dzenPerDay}
                disabled={!form.platforms.includes("dzen")}
                onChange={(value) => updatePlatformLimit("dzen", value)}
              />
              <PlatformCounter
                label="VC.ru"
                value={form.vcPerDay}
                disabled={!form.platforms.includes("vc")}
                onChange={(value) => updatePlatformLimit("vc", value)}
              />
              <div className="md:col-span-2 rounded-2xl bg-muted/30 p-4 text-sm text-muted-foreground">
                <span className="text-foreground font-medium">
                  Итого: {preview.perDay} статей в день
                </span>
                {" · "}За неделю: {preview.perWeek} статей{" · "}За 30 дней:
                примерно {preview.perDay * 30} статей
                {preview.volumeWarning ? (
                  <p className="mt-2 text-amber-300">{preview.volumeWarning}</p>
                ) : null}
              </div>
            </div>

            <Field label="Время публикаций">
              <div className="grid gap-4">
                <p className="text-muted-foreground text-sm leading-6">
                  Настройте времена отдельно для каждой площадки. Одинаковое время
                  для разных площадок разрешено: Дзен 10:00 и VC.ru 10:00 не
                  конфликтуют.
                </p>
                {form.platforms.includes("dzen") ? (
                  <PlatformTimeCard
                    platform="dzen"
                    label="Дзен"
                    dailyLimit={form.dzenPerDay}
                    slots={preview.dzenSlots}
                    newSlot={newSlots.dzen}
                    autoRange={autoRanges.dzen}
                    onNewSlotChange={(value) => setPlatformNewSlot("dzen", value)}
                    onAutoRangeChange={(key, value) =>
                      setPlatformAutoRange("dzen", key, value)
                    }
                    onSlotsChange={(slots) => updatePlatformSlots("dzen", slots)}
                  />
                ) : null}
                {form.platforms.includes("vc") ? (
                  <PlatformTimeCard
                    platform="vc"
                    label="VC.ru"
                    dailyLimit={form.vcPerDay}
                    slots={preview.vcSlots}
                    newSlot={newSlots.vc}
                    autoRange={autoRanges.vc}
                    onNewSlotChange={(value) => setPlatformNewSlot("vc", value)}
                    onAutoRangeChange={(key, value) =>
                      setPlatformAutoRange("vc", key, value)
                    }
                    onSlotsChange={(slots) => updatePlatformSlots("vc", slots)}
                  />
                ) : null}
              </div>
            </Field>

            <Field label="Дни публикаций">
              <div className="flex flex-wrap gap-2">
                {dayLabels.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(index)}
                    className={`rounded-xl border px-3 py-2 text-sm transition ${
                      form.daysOfWeek.includes(index)
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/45 bg-muted/25 text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Старт">
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => updateField("startDate", event.target.value)}
                />
              </Field>
              <Field label="Окончание">
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(event) => updateField("endDate", event.target.value)}
                />
              </Field>
              <Field label="Режим генерации">
                <select
                  value={form.generationMode}
                  onChange={(event) =>
                    updateField("generationMode", event.target.value)
                  }
                  className="h-10 rounded-xl border border-input/80 bg-card/80 px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring"
                >
                  <option value="QUALITY">Quality</option>
                  <option value="FAST">Fast</option>
                </select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="CTA">
                <Input
                  value={form.cta}
                  onChange={(event) => updateField("cta", event.target.value)}
                  placeholder="Посмотреть демо"
                />
              </Field>
              <Field label="Ссылка">
                <Input
                  value={form.link}
                  onChange={(event) => updateField("link", event.target.value)}
                  placeholder="https://site.ru"
                />
              </Field>
            </div>

            <Field label="Общая цель стратегии">
              <Textarea
                value={form.goal}
                onChange={(event) => updateField("goal", event.target.value)}
                placeholder="Например: получать органический трафик и первые заявки через VC.ru и Дзен без зависимости только от рекламы"
              />
            </Field>
            <Field label="Тематические направления">
              <Textarea
                value={form.topicDirections}
                onChange={(event) =>
                  updateField("topicDirections", event.target.value)
                }
                placeholder="Например: SEO, дорогая реклама, контент-дистрибуция, ошибки маркетинга, сравнение каналов привлечения"
              />
            </Field>
            <Field label="Запрещённые темы / ограничения">
              <Textarea
                value={form.forbiddenTopics}
                onChange={(event) =>
                  updateField("forbiddenTopics", event.target.value)
                }
                placeholder="Например: не обещать гарантированные лиды, не писать про неподдерживаемые платформы"
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => submitStrategy("DRAFT")}
              >
                {isPending ? <Loader2 className="animate-spin" /> : null}
                Сохранить стратегию
              </Button>
              <Button
                type="button"
                disabled={isPending}
                onClick={() => submitStrategy("ACTIVE")}
              >
                <Rocket />
                Запустить автопилот
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[2rem] border-border/35 bg-card/70">
            <CardHeader>
              <CardTitle>Preview плана</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-muted-foreground text-sm leading-6">
                Будет создано примерно{" "}
                <span className="text-foreground font-semibold">{preview.total}</span>{" "}
                статей за {preview.activeDays} дней: {preview.vcTotal} для VC.ru и{" "}
                {preview.dzenTotal} для Дзена.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <PreviewMetric label="В день" value={preview.perDay} />
                <PreviewMetric label="В неделю" value={preview.perWeek} />
                <PreviewMetric label="VC.ru за 7 дней" value={preview.weekVc} />
                <PreviewMetric label="Дзен за 7 дней" value={preview.weekDzen} />
              </div>
              <div className="rounded-2xl bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
                <p className="text-foreground font-medium">На ближайшие 7 дней</p>
                {form.platforms.includes("dzen") ? (
                  <p className="mt-2">
                    Дзен: {form.dzenPerDay} статьи/день × 7 = {preview.weekDzen}.
                    Время: {preview.dzenSlots.join(", ")}
                  </p>
                ) : null}
                {form.platforms.includes("vc") ? (
                  <p>
                    VC.ru: {form.vcPerDay} статьи/день × 7 = {preview.weekVc}.
                    Время: {preview.vcSlots.join(", ")}
                  </p>
                ) : null}
                <p className="mt-2 text-foreground">
                  Всего: {preview.weekTotal} статей. Одинаковое время для разных
                  площадок разрешено.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-border/35 bg-card/70">
            <CardHeader>
              <CardTitle>Активные стратегии</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {strategies.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Пока нет стратегий. Настройте первую и запустите автопилот.
                </p>
              ) : null}
              {strategies.map((strategy) => (
                <button
                  key={strategy.id}
                  type="button"
                  onClick={() => setActiveStrategyId(strategy.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition hover:bg-muted/40 ${
                    activeStrategy?.id === strategy.id
                      ? "border-primary/35 bg-primary/8"
                      : "border-border/35 bg-muted/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{strategy.name}</p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {strategy.brandName} · {strategy.articlesPerDay} статей/день
                      </p>
                    </div>
                    <StatusBadge tone={statusTone(strategy.status)}>
                      {statusLabel(strategy.status)}
                    </StatusBadge>
                  </div>
                  <p className="text-muted-foreground mt-3 text-xs">
                    Следующий запуск: {formatDateTime(strategy.nextRunAt)}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {activeStrategy ? (
        <Card className="rounded-[2rem] border-border/35 bg-card/70">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-2xl">{activeStrategy.name}</CardTitle>
              <p className="text-muted-foreground mt-2 text-sm">
                {activeStrategy.brandName} · {activeStrategy.platforms.map(platformLabel).join(", ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    activeStrategy.id,
                    "generate-week",
                    "Генерация недели запущена.",
                  )
                }
              >
                <CalendarClock />
                Сгенерировать неделю
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    activeStrategy.id,
                    "fill-week-buffer",
                    "Неделя догенерирована до буфера.",
                  )
                }
              >
                <WandSparkles />
                Догенерировать до 7 дней
              </Button>
              <Button
                type="button"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    activeStrategy.id,
                    "generate-next-24h",
                    "Ближайшие статьи отправлены в генерацию.",
                  )
                }
              >
                <WandSparkles />
                Сгенерировать 24 часа
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  runAction(activeStrategy.id, "pause", "Стратегия поставлена на паузу.")
                }
              >
                <Pause />
                Пауза
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  runAction(activeStrategy.id, "resume", "Стратегия продолжена.")
                }
              >
                <Play />
                Продолжить
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() =>
                  runAction(activeStrategy.id, "stop", "Стратегия остановлена.")
                }
              >
                <Square />
                Остановить
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <PreviewMetric
                label="Запланировано"
                value={activeStrategy.taskCounts.PLANNED ?? 0}
              />
              <PreviewMetric
                label="Ожидает клиента"
                value={
                  (activeStrategy.taskCounts.CATCHUP_PENDING ?? 0) +
                  (activeStrategy.taskCounts.WAITING_AGENT ?? 0) +
                  (activeStrategy.taskCounts.WAITING_CONNECTION ?? 0)
                }
              />
              <PreviewMetric
                label="Опубликовано"
                value={activeStrategy.taskCounts.PUBLISHED ?? 0}
              />
              <PreviewMetric
                label="Ошибки"
                value={activeStrategy.taskCounts.FAILED ?? 0}
              />
            </div>

            <div className="rounded-2xl border border-border/30 bg-muted/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Недельный план</h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Дзен: {activeStrategy.dzenPerDay ?? 0} / день · VC.ru:{" "}
                    {activeStrategy.vcPerDay ?? 0} / день
                  </p>
                </div>
                <div className="flex rounded-xl bg-muted/35 p-1">
                  {taskTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setTaskTab(tab.id)}
                      className={`rounded-lg px-3 py-1.5 text-sm transition ${
                        taskTab === tab.id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredTasks.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-border/40 p-8 text-center">
                  <p className="font-medium">Пока нет запланированных статей.</p>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Настройте параметры и нажмите «Сгенерировать неделю».
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-5">
                  {Object.entries(groupedTasks).map(([day, tasks]) => (
                    <section key={day} className="space-y-3">
                      <h4 className="text-muted-foreground text-sm font-medium capitalize">
                        {formatDay(`${day}T00:00:00`)}
                      </h4>
                      <div className="space-y-2">
                        {tasks.map((task) => (
                          <StrategyTaskRow
                            key={task.id}
                            task={task}
                            onAction={runTaskAction}
                            onStrategyAction={(taskId, action, successMessage) =>
                              runStrategyTaskAction(
                                activeStrategy.id,
                                taskId,
                                action,
                                successMessage,
                              )
                            }
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PlatformTimeCard({
  label,
  dailyLimit,
  slots,
  newSlot,
  autoRange,
  onNewSlotChange,
  onAutoRangeChange,
  onSlotsChange,
}: {
  platform: "vc" | "dzen";
  label: string;
  dailyLimit: number;
  slots: string[];
  newSlot: string;
  autoRange: { start: string; end: string };
  onNewSlotChange: (value: string) => void;
  onAutoRangeChange: (key: "start" | "end", value: string) => void;
  onSlotsChange: (slots: string[]) => void;
}) {
  const hasTooFewSlots = slots.length < dailyLimit;
  const hasExtraSlots = slots.length > dailyLimit;

  return (
    <section className="rounded-2xl border border-border/35 bg-muted/20 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">{label}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {dailyLimit} {dailyLimit === 1 ? "статья" : "статей"} в день. Выберите{" "}
            {dailyLimit} {dailyLimit === 1 ? "время" : "времени"} публикации.
          </p>
        </div>
        <StatusBadge tone={hasTooFewSlots ? "warning" : "info"}>
          {slots.length} / {dailyLimit}
        </StatusBadge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {slots.map((slot) => (
          <button
            key={slot}
            type="button"
            onClick={() => onSlotsChange(slots.filter((item) => item !== slot))}
            className="rounded-xl border border-border/45 bg-background/40 px-3 py-2 text-sm transition hover:bg-muted"
            title="Удалить время"
          >
            {slot}
          </button>
        ))}
      </div>

      {hasTooFewSlots ? (
        <p className="mt-3 text-sm text-amber-300">
          Времён меньше, чем статей. Некоторые статьи выйдут близко друг к другу
          или будут распределены автоматически.
        </p>
      ) : null}
      {hasExtraSlots ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Времён больше, чем статей. При планировании будут использованы первые
          подходящие слоты.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-border/25 bg-background/25 p-3">
          <p className="text-sm font-medium">Авто-распределение</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-sm">С</span>
            <Input
              type="time"
              value={autoRange.start}
              onChange={(event) => onAutoRangeChange("start", event.target.value)}
              className="w-28"
            />
            <span className="text-muted-foreground text-sm">до</span>
            <Input
              type="time"
              value={autoRange.end}
              onChange={(event) => onAutoRangeChange("end", event.target.value)}
              className="w-28"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                onSlotsChange(
                  generateEvenSlots(Math.max(1, dailyLimit), autoRange.start, autoRange.end),
                )
              }
            >
              Распределить для {label}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/25 bg-background/25 p-3">
          <p className="text-sm font-medium">Добавить вручную</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              type="time"
              value={newSlot}
              onChange={(event) => onNewSlotChange(event.target.value)}
              className="w-32"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!slots.includes(newSlot)) {
                  onSlotsChange([...slots, newSlot]);
                }
              }}
            >
              Добавить
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlatformCounter({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 transition ${
        disabled
          ? "border-border/20 bg-muted/10 opacity-55"
          : "border-border/35 bg-muted/20"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-muted-foreground mt-1 text-sm">Статей в день</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            disabled={disabled}
            onClick={() => onChange(value - 1)}
          >
            <Minus />
          </Button>
          <Input
            type="number"
            min={disabled ? 0 : 1}
            max={10}
            disabled={disabled}
            value={disabled ? 0 : value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-20 text-center"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            disabled={disabled}
            onClick={() => onChange(value + 1)}
          >
            <Plus />
          </Button>
        </div>
      </div>
    </div>
  );
}

function StrategyTaskRow({
  task,
  onAction,
  onStrategyAction,
}: {
  task: StrategyListItem["tasks"][number];
  onAction: (
    taskId: string,
    action: string,
    successMessage: string,
    body?: Record<string, unknown>,
  ) => void;
  onStrategyAction: (taskId: string, action: string, successMessage: string) => void;
}) {
  const title = task.title ?? task.topic ?? "Тема появится после генерации";

  return (
    <div className="grid gap-3 rounded-2xl border border-border/25 bg-background/35 p-4 text-sm transition hover:border-border/45 md:grid-cols-[80px_90px_minmax(0,1fr)_140px_190px] md:items-center">
      <div className="font-medium">{formatTime(task.scheduledAt)}</div>
      <div className="text-muted-foreground">{platformLabel(task.platform)}</div>
      <div className="min-w-0">
        <p className="truncate font-medium" title={task.error ?? title}>
          {task.error ?? title}
        </p>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {[task.contentFormat, task.tone].filter(Boolean).join(" · ") || "Формат появится после брифа"}
        </p>
      </div>
      <StatusBadge tone={statusTone(task.status)}>{statusLabel(task.status)}</StatusBadge>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {task.articleId ? (
          <a href={`/articles/${task.articleId}/edit`} className="text-primary hover:underline">
            Открыть
          </a>
        ) : (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() =>
              onStrategyAction(task.id, "generate", "Статья отправлена в генерацию.")
            }
          >
            Сгенерировать
          </button>
        )}
        {[
          "CATCHUP_PENDING",
          "WAITING_AGENT",
          "MISSED",
          "WAITING_CONNECTION",
        ].includes(task.status) ? (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() =>
              onAction(
                task.id,
                task.status === "WAITING_CONNECTION" ? "retry" : "publish",
                task.status === "WAITING_CONNECTION"
                  ? "Задача возвращена в очередь."
                  : "Публикация запущена.",
                task.status === "MISSED" ? { force: true } : undefined,
              )
            }
          >
            {task.status === "WAITING_CONNECTION" ? "Повторить" : "Опубликовать"}
          </button>
        ) : null}
        {task.status === "FAILED" ? (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onAction(task.id, "retry", "Задача возвращена в очередь.")}
          >
            Повторить
          </button>
        ) : null}
        {["MISSED", "FAILED", "WAITING_CONNECTION"].includes(task.status) ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onAction(task.id, "skip", "Задача пропущена.")}
          >
            Пропустить
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-muted/35 p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}
