"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  Eye,
  Loader2,
  Minus,
  Pause,
  Plus,
  Play,
  Rocket,
  Square,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  agentProtocolHint,
  ensureAgentAwakeForAction,
} from "@/features/agent/client/agent-wake";
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
    weekKey?: string | null;
    generationBatchId?: string | null;
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
    GENERATING: "Генерируется",
    BRIEF_GENERATED: "Бриф создан",
    ARTICLE_GENERATED: "Статья создана",
    SCHEDULED: "Ожидает публикации",
    WAITING_AGENT: "Ожидает FlowPost Agent",
    MISSED: "Пропущено, требуется действие",
    CATCHUP_PENDING: "Agent занят, публикация в очереди",
    PUBLISHING: "Публикуется через FlowPost Agent",
    PUBLISHED: "Опубликовано",
    FAILED: "Ошибка",
    SKIPPED: "Пропущено",
    WAITING_CONNECTION: "Сессия площадки истекла",
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
    status === "GENERATING" ||
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

function getWeekTasks(strategy?: StrategyListItem | null) {
  if (!strategy) {
    return [];
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return strategy.tasks.filter((task) => {
    const scheduledAt = new Date(task.scheduledAt);
    return scheduledAt >= start && scheduledAt < end;
  });
}

function summarizeTasks(tasks: StrategyListItem["tasks"]) {
  const readyStatuses = new Set([
    "ARTICLE_GENERATED",
    "SCHEDULED",
    "WAITING_AGENT",
    "MISSED",
    "CATCHUP_PENDING",
    "PUBLISHING",
    "PUBLISHED",
  ]);

  return tasks.reduce(
    (acc, task) => {
      if (task.status === "FAILED") {
        acc.error += 1;
      } else if (readyStatuses.has(task.status) || task.articleId) {
        acc.ready += 1;
      } else {
        acc.planned += 1;
      }

      return acc;
    },
    { planned: 0, ready: 0, error: 0 },
  );
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
  const [generationState, setGenerationState] = useState<{
    active: boolean;
    total: number;
    done: number;
    errors: number;
    message: string;
    taskStatus: Record<string, "generating" | "ready" | "error">;
  }>({
    active: false,
    total: 0,
    done: 0,
    errors: 0,
    message: "",
    taskStatus: {},
  });
  const [isPending, startTransition] = useTransition();
  const activeStrategy =
    strategies.find((strategy) => strategy.id === activeStrategyId) ?? strategies[0];
  const activeWeekTasks = getWeekTasks(activeStrategy);
  const activeWeekSummary = summarizeTasks(activeWeekTasks);
  const activeFailedTasks = activeWeekTasks.filter((task) => task.status === "FAILED");
  const canLaunchAutopublish =
    Boolean(activeStrategy) &&
    activeWeekTasks.length > 0 &&
    activeWeekSummary.planned === 0 &&
    activeWeekSummary.error === 0;

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

  async function postStrategyEndpoint(strategyId: string, action: string) {
    const response = await fetch(`/api/strategies/${strategyId}/${action}`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | Record<string, unknown>
      | null;

    if (!response.ok) {
      const errorPayload = payload as { error?: { message?: string } } | null;
      throw new Error(
        errorPayload?.error?.message
          ? errorPayload.error.message
          : "Действие не выполнено.",
      );
    }

    return payload;
  }

  function generateWeeklyPlan() {
    if (!activeStrategy) {
      toast.error("Сначала сохраните стратегию.");
      return;
    }

    setGenerationState({
      active: true,
      total: preview.weekTotal,
      done: 0,
      errors: 0,
      message: "Создаём недельный план и уникальные углы подачи...",
      taskStatus: {},
    });

    startTransition(async () => {
      try {
        const payload = (await postStrategyEndpoint(
          activeStrategy.id,
          "generate-plan",
        )) as { titled?: number; failed?: number; planned?: number };
        const failed = payload.failed ?? 0;
        setGenerationState((current) => ({
          ...current,
          active: false,
          total: payload.planned ?? current.total,
          done: payload.titled ?? current.total,
          errors: failed,
          message:
            failed > 0
              ? `План создан, но ${failed} тем требуют повтора.`
              : "План на ближайшие 7 дней создан.",
        }));
        toast.success("План на ближайшие 7 дней создан.");
        router.refresh();
      } catch (error) {
        setGenerationState((current) => ({
          ...current,
          active: false,
          errors: Math.max(1, current.errors),
          message: error instanceof Error ? error.message : "Не удалось создать план.",
        }));
        toast.error(error instanceof Error ? error.message : "Не удалось создать план.");
      }
    });
  }

  async function generateTaskText(strategyId: string, taskId: string) {
    const response = await fetch(`/api/strategies/${strategyId}/tasks/${taskId}/generate`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "Не удалось сгенерировать статью.");
    }
  }

  function generateWeeklyTexts(onlyFailed = false) {
    if (!activeStrategy) {
      toast.error("Сначала выберите стратегию.");
      return;
    }

    const candidates = activeWeekTasks.filter((task) => {
      if (task.articleId) {
        return false;
      }

      if (onlyFailed) {
        return task.status === "FAILED";
      }

      return ["PLANNED", "BRIEF_GENERATED"].includes(task.status);
    });

    if (!candidates.length) {
      toast.info(
        onlyFailed
          ? "Ошибочных статей для перегенерации нет."
          : "Сначала создайте план на неделю.",
      );
      return;
    }

    setGenerationState({
      active: true,
      total: candidates.length,
      done: 0,
      errors: 0,
      message: onlyFailed
        ? "Перегенерируем ошибочные статьи..."
        : "Генерируем тексты пачками по 4 статьи...",
      taskStatus: Object.fromEntries(
        candidates.map((task) => [task.id, "generating" as const]),
      ),
    });

    startTransition(async () => {
      let done = 0;
      let errors = 0;

      for (let index = 0; index < candidates.length; index += 4) {
        const chunk = candidates.slice(index, index + 4);
        const results = await Promise.allSettled(
          chunk.map((task) => generateTaskText(activeStrategy.id, task.id)),
        );

        setGenerationState((current) => {
          const taskStatus = { ...current.taskStatus };
          results.forEach((result, resultIndex) => {
            const taskId = chunk[resultIndex]?.id;
            if (!taskId) {
              return;
            }
            taskStatus[taskId] = result.status === "fulfilled" ? "ready" : "error";
          });

          done += results.filter((result) => result.status === "fulfilled").length;
          errors += results.filter((result) => result.status === "rejected").length;

          return {
            ...current,
            done,
            errors,
            taskStatus,
            message: `Сгенерировано ${done} из ${candidates.length} статей.`,
          };
        });

        router.refresh();
      }

      setGenerationState((current) => ({
        ...current,
        active: false,
        message:
          errors > 0
            ? `Готово ${done} из ${candidates.length}. Ошибок: ${errors}.`
            : `Готово ${done} из ${candidates.length} статей.`,
      }));

      if (errors > 0) {
        toast.error(`Генерация завершена с ошибками: ${errors}.`);
      } else {
        toast.success("Тексты на неделю сгенерированы.");
      }
      router.refresh();
    });
  }

  function deleteActiveStrategy(strategyId: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/strategies/${strategyId}`, {
          method: "DELETE",
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Не удалось удалить стратегию.");
        }

        toast.success("Стратегия удалена.");
        setActiveStrategyId("");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось удалить стратегию.");
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
        let agentWakeStartedAt: string | undefined;

        if (action === "publish") {
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

        const requestBody = {
          ...body,
          ...(agentWakeStartedAt ? { agentWakeStartedAt } : {}),
        };
        const response = await fetch(`/api/agent/tasks/${taskId}/${action}`, {
          method: "POST",
          headers:
            Object.keys(requestBody).length > 0
              ? { "Content-Type": "application/json" }
              : undefined,
          body:
            Object.keys(requestBody).length > 0
              ? JSON.stringify(requestBody)
              : undefined,
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

  const progressPercent =
    generationState.total > 0
      ? Math.round(((generationState.done + generationState.errors) / generationState.total) * 100)
      : 0;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
      <header className="flex flex-col gap-4">
        <p className="text-muted-foreground text-base font-medium">Контент-автопилот</p>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h1 className="font-heading text-5xl font-semibold tracking-[-0.04em]">
              Стратегия
            </h1>
            <p className="text-muted-foreground mt-4 max-w-3xl text-lg leading-8">
              План создаётся только на ближайшие 7 дней. Месячный объём показан
              как прогноз и не запускает генерацию сотен статей заранее.
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            disabled={isPending}
            onClick={() => submitStrategy("DRAFT")}
          >
            {isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            Сохранить настройки
          </Button>
        </div>
      </header>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_390px]">
        <main className="space-y-7">
          <Card className="rounded-[1.75rem] border-border/35 bg-card/75">
            <CardHeader className="pb-3">
              <p className="text-muted-foreground text-sm font-medium">1. Цель стратегии</p>
              <CardTitle className="text-3xl">Что продвигаем и к чему ведём</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Название стратегии">
                  <Input
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    placeholder="Органический трафик через VC.ru и Дзен"
                    className="h-12 text-base"
                  />
                </Field>
                <Field label="Бренд">
                  <select
                    value={form.brandId}
                    onChange={(event) => updateField("brandId", event.target.value)}
                    className="h-12 rounded-xl border border-input/80 bg-card/80 px-3 text-base outline-none focus-visible:ring-4 focus-visible:ring-ring"
                  >
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Общая цель">
                <Textarea
                  value={form.goal}
                  onChange={(event) => updateField("goal", event.target.value)}
                  placeholder="Получать органический трафик и первые заявки через внешние публикации"
                  className="min-h-28 text-base"
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="CTA">
                  <Input
                    value={form.cta}
                    onChange={(event) => updateField("cta", event.target.value)}
                    placeholder="Посмотреть демо"
                    className="h-12 text-base"
                  />
                </Field>
                <Field label="Ссылка">
                  <Input
                    value={form.link}
                    onChange={(event) => updateField("link", event.target.value)}
                    placeholder="https://site.ru"
                    className="h-12 text-base md:col-span-2"
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-border/35 bg-card/75">
            <CardHeader className="pb-3">
              <p className="text-muted-foreground text-sm font-medium">2. Темы и ограничения</p>
              <CardTitle className="text-3xl">О чём можно писать</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Field label="Тематические направления">
                <Textarea
                  value={form.topicDirections}
                  onChange={(event) => updateField("topicDirections", event.target.value)}
                  placeholder="SEO, дорогая реклама, контент-дистрибуция, ошибки маркетинга"
                  className="min-h-32 text-base"
                />
              </Field>
              <Field label="Запрещённые темы / ограничения">
                <Textarea
                  value={form.forbiddenTopics}
                  onChange={(event) => updateField("forbiddenTopics", event.target.value)}
                  placeholder="Не обещать гарантированные лиды, продажи и быстрый SEO-эффект"
                  className="min-h-28 text-base"
                />
              </Field>
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-border/35 bg-card/75">
            <CardHeader className="pb-3">
              <p className="text-muted-foreground text-sm font-medium">3. Площадки</p>
              <CardTitle className="text-3xl">Сколько статей в день</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="flex flex-wrap gap-3">
                {platforms
                  .filter((platform) => ["vc", "dzen"].includes(platform.slug))
                  .map((platform) => (
                    <button
                      key={platform.id}
                      type="button"
                      onClick={() => togglePlatform(platform.slug)}
                      className={`rounded-xl border px-5 py-3 text-base font-medium transition ${
                        form.platforms.includes(platform.slug)
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/45 bg-muted/25 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {platformLabel(platform.slug)}
                    </button>
                  ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => applyDistributionPreset("equal")}
                  disabled={form.platforms.length < 2}
                >
                  Поровну
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => applyDistributionPreset("more_dzen")}
                  disabled={form.platforms.length < 2}
                >
                  Больше в Дзен
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => applyDistributionPreset("more_vc")}
                  disabled={form.platforms.length < 2}
                >
                  Больше в VC.ru
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-border/35 bg-card/75">
            <CardHeader className="pb-3">
              <p className="text-muted-foreground text-sm font-medium">4. Расписание</p>
              <CardTitle className="text-3xl">Когда публиковать</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="flex flex-wrap gap-2">
                {dayLabels.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(index)}
                    className={`rounded-xl border px-4 py-3 text-base transition ${
                      form.daysOfWeek.includes(index)
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/45 bg-muted/25 text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Старт">
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={(event) => updateField("startDate", event.target.value)}
                    className="h-12 text-base"
                  />
                </Field>
                <Field label="Окончание">
                  <Input
                    type="date"
                    value={form.endDate}
                    onChange={(event) => updateField("endDate", event.target.value)}
                    className="h-12 text-base"
                  />
                </Field>
                <Field label="Режим генерации">
                  <select
                    value={form.generationMode}
                    onChange={(event) => updateField("generationMode", event.target.value)}
                    className="h-12 rounded-xl border border-input/80 bg-card/80 px-3 text-base outline-none focus-visible:ring-4 focus-visible:ring-ring"
                  >
                    <option value="QUALITY">Quality</option>
                    <option value="FAST">Fast</option>
                  </select>
                </Field>
              </div>

              <Field label="Режим публикации">
                <select
                  value={form.publishMode}
                  onChange={(event) => updateField("publishMode", event.target.value)}
                  className="h-12 rounded-xl border border-input/80 bg-card/80 px-3 text-base outline-none focus-visible:ring-4 focus-visible:ring-ring"
                >
                  <option value="DRAFT_ONLY">Только создавать черновики</option>
                  <option value="GENERATE_AND_SCHEDULE">Генерировать и планировать</option>
                  <option value="AUTO_PUBLISH">Генерировать и публиковать автоматически</option>
                </select>
              </Field>

              {form.platforms.includes("dzen") ? (
                <PlatformTimeCard
                  platform="dzen"
                  label="Дзен"
                  dailyLimit={form.dzenPerDay}
                  slots={preview.dzenSlots}
                  newSlot={newSlots.dzen}
                  autoRange={autoRanges.dzen}
                  onNewSlotChange={(value) => setPlatformNewSlot("dzen", value)}
                  onAutoRangeChange={(key, value) => setPlatformAutoRange("dzen", key, value)}
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
                  onAutoRangeChange={(key, value) => setPlatformAutoRange("vc", key, value)}
                  onSlotsChange={(slots) => updatePlatformSlots("vc", slots)}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-border/35 bg-card/75">
            <CardHeader className="pb-3">
              <p className="text-muted-foreground text-sm font-medium">5. Генерация контента на неделю</p>
              <CardTitle className="text-3xl">Генерация статей на неделю</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewMetric label="План недели" value={activeWeekTasks.length} />
                <PreviewMetric label="Тексты готовы" value={activeWeekSummary.ready} />
                <PreviewMetric label="С ошибкой" value={activeWeekSummary.error} />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  size="lg"
                  disabled={!activeStrategy || generationState.active || isPending}
                  onClick={generateWeeklyPlan}
                >
                  {generationState.active ? <Loader2 className="animate-spin" /> : <CalendarClock />}
                  Сгенерировать план на неделю
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="secondary"
                  disabled={!activeStrategy || activeWeekTasks.length === 0 || generationState.active}
                  onClick={() => generateWeeklyTexts(false)}
                >
                  <WandSparkles />
                  Сгенерировать тексты на неделю
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!activeStrategy || activeFailedTasks.length === 0 || generationState.active}
                  onClick={() => generateWeeklyTexts(true)}
                >
                  Перегенерировать ошибочные
                </Button>
                <a
                  href="/distribution"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition hover:bg-muted/75 hover:text-foreground"
                >
                  <Eye className="size-4" />
                  Посмотреть статьи
                </a>
              </div>

              <div className="rounded-2xl border border-border/30 bg-muted/15 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">
                    {generationState.message || `Готово ${activeWeekSummary.ready} из ${activeWeekTasks.length} статей`}
                  </p>
                  <StatusBadge tone={generationState.errors ? "warning" : "info"}>
                    {generationState.active ? "loading" : generationState.errors ? "error" : "success"}
                  </StatusBadge>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(progressPercent, activeWeekTasks.length ? Math.round((activeWeekSummary.ready / activeWeekTasks.length) * 100) : 0)}%` }}
                  />
                </div>
                <p className="text-muted-foreground mt-3 text-sm">
                  Сгенерировано {generationState.done || activeWeekSummary.ready} из{" "}
                  {generationState.total || activeWeekTasks.length} статей. Ошибок:{" "}
                  {generationState.errors || activeWeekSummary.error}.
                </p>
              </div>

              <div className="space-y-3">
                {activeWeekTasks.slice(0, 8).map((task) => (
                  <StrategyTaskRow
                    key={task.id}
                    task={task}
                    transientStatus={generationState.taskStatus[task.id]}
                    onAction={runTaskAction}
                    onStrategyAction={(taskId, action, successMessage) =>
                      runStrategyTaskAction(activeStrategy?.id ?? "", taskId, action, successMessage)
                    }
                  />
                ))}
                {activeWeekTasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/40 p-8 text-center">
                    <p className="font-medium">Недельный план ещё не создан.</p>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {activeStrategy ? (
            <Card className="rounded-[1.75rem] border-border/35 bg-card/75">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-muted-foreground text-sm font-medium">7. Активные стратегии</p>
                  <CardTitle className="mt-2 text-3xl">{activeStrategy.name}</CardTitle>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {activeStrategy.brandName} · {activeStrategy.platforms.map(platformLabel).join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => runAction(activeStrategy.id, "pause", "Стратегия поставлена на паузу.")}
                  >
                    <Pause />
                    Пауза
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => runAction(activeStrategy.id, "resume", "Стратегия продолжена.")}
                  >
                    <Play />
                    Продолжить
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => runAction(activeStrategy.id, "stop", "Стратегия остановлена.")}
                  >
                    <Square />
                    Остановить
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => deleteActiveStrategy(activeStrategy.id)}
                  >
                    <Trash2 />
                    Удалить
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <PreviewMetric label="Planned" value={activeWeekSummary.planned} />
                  <PreviewMetric label="Ready" value={activeWeekSummary.ready} />
                  <PreviewMetric label="Error" value={activeWeekSummary.error} />
                  <PreviewMetric label="Опубликовано" value={activeStrategy.taskCounts.PUBLISHED ?? 0} />
                </div>

                <div className="rounded-2xl border border-border/30 bg-muted/10 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold">Ближайшие публикации</h3>
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
                      <p className="font-medium">Нет запланированных статей.</p>
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
                                transientStatus={generationState.taskStatus[task.id]}
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
        </main>

        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Card className="rounded-[1.75rem] border-border/35 bg-card/80">
            <CardHeader>
              <p className="text-muted-foreground text-sm font-medium">6. Preview стратегии</p>
              <CardTitle className="text-2xl">Ближайшая неделя</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-muted-foreground text-sm leading-6">
                Будет создано {preview.weekTotal} статей на ближайшие 7 дней:
                {form.platforms.includes("dzen") ? ` ${preview.weekDzen} для Dzen` : ""}
                {form.platforms.includes("dzen") && form.platforms.includes("vc") ? " и" : ""}
                {form.platforms.includes("vc") ? ` ${preview.weekVc} для VC.ru` : ""}.
                Прогноз на месяц — примерно {preview.perDay * 30} статей, но сейчас
                генерируется только ближайшая неделя.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <PreviewMetric label="В день" value={preview.perDay} />
                <PreviewMetric label="За неделю" value={preview.weekTotal} />
                <PreviewMetric label="За месяц" value={preview.perDay * 30} />
                <PreviewMetric label="Готово" value={activeWeekSummary.ready} />
              </div>
              <div className="rounded-2xl bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
                {form.platforms.includes("dzen") ? (
                  <p>Дзен: {form.dzenPerDay} / день · {preview.dzenSlots.join(", ")}</p>
                ) : null}
                {form.platforms.includes("vc") ? (
                  <p>VC.ru: {form.vcPerDay} / день · {preview.vcSlots.join(", ")}</p>
                ) : null}
                <p className="mt-2 text-foreground">
                  Planned: {activeWeekSummary.planned} · Ready: {activeWeekSummary.ready} · Error: {activeWeekSummary.error}
                </p>
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={!activeStrategy || !canLaunchAutopublish || isPending}
                onClick={() =>
                  activeStrategy
                    ? runAction(activeStrategy.id, "resume", "Автопубликация запущена.")
                    : undefined
                }
              >
                <Rocket />
                Запустить автопубликацию
              </Button>
              {!canLaunchAutopublish ? (
                <p className="text-muted-foreground text-sm">
                  Сначала сгенерируйте тексты на неделю и исправьте ошибки.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-border/35 bg-card/80">
            <CardHeader>
              <CardTitle className="text-2xl">Стратегии</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {strategies.length === 0 ? (
                <p className="text-muted-foreground text-sm">Сохраните первую стратегию.</p>
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
        </aside>
      </div>
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
  transientStatus,
  onAction,
  onStrategyAction,
}: {
  task: StrategyListItem["tasks"][number];
  transientStatus?: "generating" | "ready" | "error";
  onAction: (
    taskId: string,
    action: string,
    successMessage: string,
    body?: Record<string, unknown>,
  ) => void;
  onStrategyAction: (taskId: string, action: string, successMessage: string) => void;
}) {
  const title = task.title ?? task.topic ?? "Тема появится после генерации";
  const visibleStatus =
    transientStatus === "generating"
      ? "GENERATING"
      : transientStatus === "ready"
        ? "ARTICLE_GENERATED"
        : transientStatus === "error"
          ? "FAILED"
          : task.status;

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
      <StatusBadge tone={statusTone(visibleStatus)}>{statusLabel(visibleStatus)}</StatusBadge>
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
            onClick={() =>
              onStrategyAction(task.id, "generate", "Статья отправлена в генерацию.")
            }
          >
            Перегенерировать
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
