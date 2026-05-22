"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Clock3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const MINIMUM_LEAD_TIME_MS = 2 * 60 * 1000;
const RECOMMENDED_LEAD_TIME_MS = 5 * 60 * 1000;

type SchedulePublicationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: string | null;
  platformName?: string | null;
  agentDisconnected?: boolean;
  isPending?: boolean;
  onConfirm: (payload: {
    publishAt: string;
    selectedLocalTime: string;
    browserTimezone: string | null;
  }) => Promise<void> | void;
};

type QuickOption = {
  label: string;
  getDate: () => Date;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInputValue(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLocalInputValue(date: Date) {
  return `${toDateInputValue(date)}T${toTimeInputValue(date)}`;
}

function combineLocalDateTime(dateValue: string, timeValue: string) {
  if (!dateValue || !timeValue) {
    return null;
  }

  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);

  if ([year, month, day, hours, minutes].some((value) => Number.isNaN(value))) {
    return null;
  }

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000);
}

function tomorrowAt(hours: number, minutes = 0) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function todayEvening() {
  const date = new Date();
  date.setHours(19, 0, 0, 0);

  if (date.getTime() <= Date.now() + RECOMMENDED_LEAD_TIME_MS) {
    return tomorrowAt(19);
  }

  return date;
}

function nextBusinessDayAt(hours: number, minutes = 0) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hours, minutes, 0, 0);

  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }

  return date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatScheduleDateTime(value?: string | Date | null) {
  if (!value) {
    return "не выбрано";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "не выбрано";
  }

  const now = new Date();
  const today = startOfLocalDay(now);
  const targetDay = startOfLocalDay(date);
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  if (targetDay === today) {
    return `Сегодня, ${time}`;
  }

  if (targetDay === today + 24 * 60 * 60 * 1000) {
    return `Завтра, ${time}`;
  }

  const day = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);

  return `${day}, ${time}`;
}

function previewText(date: Date | null) {
  if (!date) {
    return "Выберите дату и время публикации.";
  }

  const datePart = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  return `Статья будет опубликована ${datePart} в ${timePart}`;
}

function createQuickOptions(): QuickOption[] {
  return [
    { label: "Через 10 минут", getDate: () => addMinutes(10) },
    { label: "Через 30 минут", getDate: () => addMinutes(30) },
    { label: "Через 1 час", getDate: () => addMinutes(60) },
    { label: "Сегодня вечером", getDate: todayEvening },
    { label: "Завтра утром", getDate: () => tomorrowAt(9) },
    { label: "Завтра в 12:00", getDate: () => tomorrowAt(12) },
    {
      label: "Следующий будний день в 10:00",
      getDate: () => nextBusinessDayAt(10),
    },
  ];
}

export function SchedulePublicationDialog({
  open,
  onOpenChange,
  initialValue,
  platformName,
  agentDisconnected,
  isPending,
  onConfirm,
}: SchedulePublicationDialogProps) {
  const initialDate = useMemo(() => {
    const parsed = initialValue ? new Date(initialValue) : addMinutes(10);
    return Number.isNaN(parsed.getTime()) ? addMinutes(10) : parsed;
  }, [initialValue]);
  const [dateValue, setDateValue] = useState(() => toDateInputValue(initialDate));
  const [timeValue, setTimeValue] = useState(() => toTimeInputValue(initialDate));
  const [error, setError] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());
  const quickOptions = useMemo(() => createQuickOptions(), []);
  const browserTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  const selectedDate = combineLocalDateTime(dateValue, timeValue);
  const delta = selectedDate ? selectedDate.getTime() - nowMs : null;
  const closeTimeWarning =
    delta !== null && delta >= MINIMUM_LEAD_TIME_MS && delta < RECOMMENDED_LEAD_TIME_MS
      ? "Слишком близкое время. Лучше выбрать минимум через 5 минут, чтобы агент успел обработать задачу."
      : null;

  function applyQuickOption(option: QuickOption) {
    const nextDate = option.getDate();
    setDateValue(toDateInputValue(nextDate));
    setTimeValue(toTimeInputValue(nextDate));
    setError(null);
  }

  async function handleConfirm() {
    const nextDate = combineLocalDateTime(dateValue, timeValue);

    if (!nextDate) {
      setError("Выберите дату и время публикации.");
      return;
    }

    const nextDelta = nextDate.getTime() - Date.now();

    if (nextDelta < 0) {
      setError("Нельзя запланировать публикацию на прошедшее время.");
      return;
    }

    if (nextDelta < MINIMUM_LEAD_TIME_MS) {
      setError(
        "Слишком близкое время. Лучше выбрать минимум через 5 минут, чтобы агент успел обработать задачу.",
      );
      return;
    }

    await onConfirm({
      publishAt: nextDate.toISOString(),
      selectedLocalTime: toLocalInputValue(nextDate),
      browserTimezone,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(720px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Запланировать публикацию</DialogTitle>
          <DialogDescription>
            Время указано по вашему локальному часовому поясу.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {agentDisconnected ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              Agent не подключён. Запланированные публикации не будут выполнены.
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="schedule-date">
                Дата
              </label>
              <Input
                id="schedule-date"
                type="date"
                value={dateValue}
                min={toDateInputValue(new Date(nowMs))}
                onChange={(event) => {
                  setDateValue(event.target.value);
                  setError(null);
                }}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="schedule-time">
                Время
              </label>
              <Input
                id="schedule-time"
                type="time"
                step={60}
                value={timeValue}
                onChange={(event) => {
                  setTimeValue(event.target.value);
                  setError(null);
                }}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-medium">Быстрый выбор</p>
            <div className="flex flex-wrap gap-2">
              {quickOptions.map((option) => (
                <Button
                  key={option.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyQuickOption(option)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-border/60 bg-background/35 p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Площадка</p>
              <p className="mt-1 text-sm font-medium">
                {platformName ?? "Не выбрана"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Локальное время браузера
              </p>
              <p className="mt-1 text-sm font-medium">
                {browserTimezone ?? "не определено"}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-primary/15 bg-primary/10 px-4 py-3">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-4 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  {selectedDate ? formatScheduleDateTime(selectedDate) : "Не выбрано"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {previewText(selectedDate)}
                </p>
              </div>
            </div>
          </div>

          {closeTimeWarning ? (
            <div className="flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              <Clock3 className="mt-0.5 size-4 shrink-0" />
              <span>{closeTimeWarning}</span>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Отмена
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Планируем..." : "Запланировать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
