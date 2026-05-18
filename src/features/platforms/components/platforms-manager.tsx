"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
import {
  agentProtocolHint,
  openAgentAndWait,
  type AgentConnectionState,
  type AgentStateName,
} from "@/features/agent/client/agent-wake";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlatformConnection } from "@/features/platforms/types";

const statusTone: Record<
  PlatformConnection["status"],
  "neutral" | "positive" | "warning"
> = {
  not_connected: "neutral",
  connected: "positive",
  expired: "warning",
};

const statusLabels: Record<PlatformConnection["status"], string> = {
  not_connected: "не подключена",
  connected: "подключена",
  expired: "требует входа",
};

type PlatformsManagerProps = {
  initialPlatforms: PlatformConnection[];
};

type AgentJobStatus =
  | "queued"
  | "picked_up"
  | "running"
  | "waiting_user_login"
  | "completed"
  | "failed"
  | "cancelled";

type AgentJob = {
  id: string;
  type: string;
  platform: string | null;
  status: AgentJobStatus;
};

type AgentDevice = {
  id: string;
  name: string;
  status: string;
  platform: string | null;
  appVersion: string | null;
  lastSeenAt: string | null;
};

type AgentConnectState = {
  job: AgentJob;
};

const agentStatusLabels: Record<AgentJobStatus, string> = {
  queued: "Задача отправлена в Agent",
  picked_up: "Открываем браузер на вашем компьютере...",
  running: "Открываем браузер на вашем компьютере...",
  waiting_user_login: "Браузер открыт. Ожидаем входа в платформу",
  completed: "Подключение завершено",
  failed: "Ошибка подключения",
  cancelled: "Подключение отменено",
};

const defaultAgentState: AgentConnectionState = {
  state: "none",
  device: null,
  busyJob: null,
  lastSeenAt: null,
};

export function PlatformsManager({ initialPlatforms }: PlatformsManagerProps) {
  const [platforms, setPlatforms] = useState(initialPlatforms);
  const [selectedPlatform, setSelectedPlatform] =
    useState<PlatformConnection | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<
    PlatformConnection["platform"] | null
  >(null);
  const [launchingPlatform, setLaunchingPlatform] = useState<
    PlatformConnection["platform"] | null
  >(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<
    PlatformConnection["platform"] | null
  >(null);
  const [agentConnect, setAgentConnect] = useState<AgentConnectState | null>(
    null,
  );
  const [agentDevices, setAgentDevices] = useState<AgentDevice[]>([]);
  const [agentState, setAgentState] =
    useState<AgentConnectionState>(defaultAgentState);
  const [agentNotice, setAgentNotice] = useState<AgentStateName | null>(null);

  async function refreshAgentDevices() {
    try {
      const response = await fetch("/api/agent/devices");
      const body = (await response.json()) as {
        devices?: AgentDevice[];
        agent?: AgentConnectionState;
      };

      if (response.ok) {
        setAgentDevices(body.devices ?? []);
        setAgentState(body.agent ?? defaultAgentState);
      }
    } catch (error) {
      console.error("[platform-agent-devices]", error);
    }
  }

  async function refreshAgentJob(jobId: string) {
    try {
      const response = await fetch(`/api/agent/jobs/${jobId}/status`);
      const body = (await response.json()) as {
        job?: AgentJob;
        error?: {
          message?: string;
        };
      };

      if (!response.ok || !body.job) {
        throw new Error(body.error?.message ?? "Не удалось обновить статус.");
      }

      const nextJob = body.job;
      setAgentConnect((current) =>
        current ? { ...current, job: nextJob } : current,
      );

      if (nextJob.status === "completed" && nextJob.platform) {
        setPlatforms((current) =>
          current.map((platform) =>
            platform.platform === nextJob.platform
              ? { ...platform, status: "connected" }
              : platform,
          ),
        );
        toast.success("Браузер подключен через FlowPost Agent.");
      }
    } catch (error) {
      console.error("[platform-agent-status]", error);
    }
  }

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshAgentDevices();
    }, 0);
    const interval = window.setInterval(() => {
      void refreshAgentDevices();
    }, 10_000);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!agentConnect?.job.id || agentConnect.job.status === "completed") {
      return;
    }

    if (
      agentConnect.job.status === "failed" ||
      agentConnect.job.status === "cancelled"
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshAgentJob(agentConnect.job.id);
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [agentConnect?.job.id, agentConnect?.job.status]);

  useEffect(() => {
    if (!selectedPlatform) {
      return;
    }

    const initialRefresh = window.setTimeout(() => {
      void refreshAgentDevices();
    }, 0);
    const interval = window.setInterval(() => {
      void refreshAgentDevices();
    }, 3000);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [selectedPlatform]);

  function openAgent() {
    window.location.href = "flowpost-agent://wake";
    toast.info("Запускаем FlowPost Agent...");
  }

  function showAgentSetup(nextState: AgentStateName = agentState.state) {
    setAgentNotice(nextState);
  }

  async function ensureAgentReady() {
    if (agentState.state === "active" || agentState.state === "busy") {
      return agentState;
    }

    if (agentState.state === "none") {
      showAgentSetup("none");
      toast.info("Для запуска браузера установите и подключите FlowPost Agent.");
      return agentState;
    }

    showAgentSetup("paired_offline");
    const nextAgent = await openAgentAndWait({
      onStatus: (message) => toast.info(message),
    });
    setAgentState(nextAgent);

    if (nextAgent.state !== "active" && nextAgent.state !== "busy") {
      showAgentSetup(nextAgent.state);
    }

    return nextAgent;
  }

  async function handleConnect(platform: PlatformConnection) {
    const readyAgent = await ensureAgentReady();

    if (readyAgent.state === "busy") {
      toast.info("Agent уже выполняет задачу. Дождитесь завершения.");
      return;
    }

    if (readyAgent.state !== "active") {
      return;
    }

    setConnectingPlatform(platform.platform);
    setAgentConnect(null);
    setAgentNotice(null);

    try {
      const response = await fetch("/api/platforms/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform: platform.platform,
        }),
      });

      const body = (await response.json()) as {
        status?: "requires_agent" | "queued" | "busy";
        message?: string;
        agentState?: AgentStateName;
        platform?: PlatformConnection;
        agentDevice?: AgentDevice | null;
        job?: AgentJob;
        error?: {
          message?: string;
        };
      };

      if (!response.ok) {
        throw new Error(
          body.error?.message ?? "Не удалось подключить платформу.",
        );
      }

      if (body.status === "requires_agent" || !body.job) {
        showAgentSetup(body.agentState ?? agentState.state);
        toast.info(
          body.message ??
            "FlowPost Agent не подключен. Откройте Agent или создайте новый код подключения.",
        );
        return;
      }

      if (body.status === "busy") {
        setAgentConnect(body.job ? { job: body.job } : null);
        toast.info(body.message ?? "Agent уже выполняет задачу. Дождитесь завершения.");
        return;
      }

      setAgentConnect({ job: body.job });
      toast.info("Задача отправлена в Agent.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось подключить платформу.",
      );
    } finally {
      setConnectingPlatform(null);
    }
  }

  async function handleLaunch(platform: PlatformConnection) {
    const readyAgent = await ensureAgentReady();

    if (readyAgent.state === "busy") {
      toast.info("Agent уже выполняет задачу. Дождитесь завершения.");
      return;
    }

    if (readyAgent.state !== "active") {
      return;
    }

    setLaunchingPlatform(platform.platform);
    setAgentNotice(null);

    try {
      const response = await fetch("/api/platforms/launch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform: platform.platform,
        }),
      });

      const body = (await response.json()) as {
        status?: "requires_agent" | "queued" | "busy";
        message?: string;
        agentState?: AgentStateName;
        agentDevice?: AgentDevice | null;
        job?: AgentJob;
        error?: {
          message?: string;
        };
      };

      if (!response.ok) {
        throw new Error(
          body.error?.message ?? "Не удалось запустить платформу.",
        );
      }

      if (body.status === "requires_agent" || !body.job) {
        showAgentSetup(body.agentState ?? agentState.state);
        toast.info(
          body.message ??
            "FlowPost Agent не подключен. Откройте Agent или создайте новый код подключения.",
        );
        return;
      }

      if (body.status === "busy") {
        setAgentConnect(body.job ? { job: body.job } : null);
        toast.info(body.message ?? "Agent уже выполняет задачу. Дождитесь завершения.");
        return;
      }

      setAgentConnect({ job: body.job });
      toast.info("Открываем браузер на вашем компьютере...");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось открыть браузер. Перезапустите Agent и попробуйте снова.",
      );
    } finally {
      setLaunchingPlatform(null);
    }
  }

  async function handleDisconnect(platform: PlatformConnection) {
    setDisconnectingPlatform(platform.platform);

    try {
      const response = await fetch("/api/platforms/disconnect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform: platform.platform,
        }),
      });

      const body = (await response.json()) as {
        platform?: PlatformConnection;
        error?: {
          message?: string;
        };
      };

      if (!response.ok || !body.platform) {
        throw new Error(
          body.error?.message ?? "Не удалось отключить платформу.",
        );
      }

      setPlatforms((current) =>
        current.map((currentPlatform) =>
          currentPlatform.platform === body.platform?.platform
            ? body.platform
            : currentPlatform,
        ),
      );
      toast.success("Платформа отключена.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось отключить платформу.",
      );
    } finally {
      setDisconnectingPlatform(null);
    }
  }

  const activeAgent =
    agentState.state === "active" || agentState.state === "busy"
      ? agentState.device
      : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Платформы</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Площадки для публикации статей.
        </p>
      </div>

      <AgentStatePanel
        agent={agentState}
        notice={agentNotice}
        onOpenAgent={openAgent}
        onDismissNotice={() => setAgentNotice(null)}
      />

      {agentConnect ? (
        <div className="border-border/70 bg-muted/25 space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              tone={
                agentConnect.job.status === "completed"
                  ? "positive"
                  : agentConnect.job.status === "failed" ||
                      agentConnect.job.status === "cancelled"
                    ? "warning"
                    : "neutral"
              }
            >
              {agentStatusLabels[agentConnect.job.status]}
            </StatusBadge>
            <span className="text-muted-foreground text-xs">
              Job ID: {agentConnect.job.id}
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3">
        {platforms.map((platform) => (
          <Card
            key={platform.name}
            className="border-border/70 rounded-xl shadow-none"
          >
            <CardHeader className="grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <CardTitle className="truncate">{platform.name}</CardTitle>
                <div className="mt-2">
                  <StatusBadge tone={statusTone[platform.status]}>
                    {statusLabels[platform.status]}
                  </StatusBadge>
                </div>
              </div>
              <CardAction>
                <PlatformActions
                  platform={platform}
                  isLaunching={launchingPlatform === platform.platform}
                  isDisconnecting={disconnectingPlatform === platform.platform}
                  onConnect={() => void handleConnect(platform)}
                  onLaunch={() => void handleLaunch(platform)}
                  onDisconnect={() => void handleDisconnect(platform)}
                />
              </CardAction>
            </CardHeader>
            <CardContent className="sr-only">
              {platform.name}: {statusLabels[platform.status]}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={selectedPlatform !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedPlatform(null);
            setAgentConnect(null);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Подключение браузера</DialogTitle>
            <DialogDescription>
              {selectedPlatform
                ? `Платформа: ${selectedPlatform.name}`
                : "Подключение платформы"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="border-border/70 bg-muted/25 rounded-xl border p-4">
              <h3 className="text-base font-semibold">
                Для публикации нужен FlowPost Agent
              </h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                Agent открывает отдельный браузер на вашем компьютере и
                помогает подключать площадки для публикации.
              </p>
            </div>

            <div className="border-border/70 bg-muted/25 grid gap-4 rounded-xl border p-4 text-sm leading-6 md:grid-cols-2">
              <div>
                <p className="font-medium">Что FlowPost НЕ получает</p>
                <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
                  <li>пароль от Dzen/VC.ru</li>
                  <li>cookies площадок</li>
                  <li>доступ к вашему основному браузеру</li>
                  <li>данные банковской карты</li>
                  <li>личные файлы на компьютере</li>
                </ul>
              </div>
              <div>
                <p className="font-medium">Что FlowPost получает</p>
                <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
                  <li>ID задачи публикации</li>
                  <li>выбранную платформу</li>
                  <li>статус выполнения задачи</li>
                  <li>технические логи без паролей и cookies</li>
                  <li>результат выполнения: успешно / ошибка</li>
                </ul>
              </div>
            </div>

            <ol className="grid gap-3 text-sm leading-6">
              {[
                "Скачайте FlowPost Agent",
                "Создайте код подключения на странице скачивания",
                "Дождитесь открытия браузера",
                "Войдите в нужную платформу",
                "Вернитесь в FlowPost",
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="bg-primary/12 text-primary grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <div className="grid gap-3 sm:grid-cols-2">
              <a
                href="/downloads/mac"
                className="border-border/70 bg-muted/25 hover:bg-muted/40 rounded-xl border p-4 text-sm font-medium transition-colors"
              >
                Скачать для macOS
              </a>
              <a
                href="/downloads/windows"
                className="border-border/70 bg-muted/25 hover:bg-muted/40 rounded-xl border p-4 text-sm font-medium transition-colors"
              >
                Скачать для Windows
              </a>
            </div>
            <p className="text-muted-foreground text-xs">
              На странице скачивания будет инструкция и код подключения.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge
                tone={agentDevices.length > 0 ? "positive" : "neutral"}
              >
                {activeAgent ? "Agent подключен" : "Agent не подключен"}
              </StatusBadge>
              <span className="text-muted-foreground text-xs">
                {activeAgent?.lastSeenAt
                  ? `Последняя активность: ${new Date(activeAgent.lastSeenAt).toLocaleString()}`
                  : "Чтобы открыть браузер на вашем компьютере, установите FlowPost Agent."}
              </span>
            </div>

            {agentConnect ? (
              <div className="border-border/70 bg-muted/25 space-y-4 rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge
                    tone={
                      agentConnect.job.status === "completed"
                        ? "positive"
                        : agentConnect.job.status === "failed" ||
                            agentConnect.job.status === "cancelled"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {agentStatusLabels[agentConnect.job.status]}
                  </StatusBadge>
                  <span className="text-muted-foreground text-xs">
                    Job ID: {agentConnect.job.id}
                  </span>
                </div>
              </div>
            ) : null}

            <TrustBlocks />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedPlatform(null);
                setAgentConnect(null);
              }}
              disabled={connectingPlatform !== null}
            >
              Закрыть
            </Button>
            <Button
              onClick={() =>
                selectedPlatform ? void handleConnect(selectedPlatform) : null
              }
              disabled={
                connectingPlatform !== null ||
                agentConnect !== null ||
                agentDevices.length === 0
              }
            >
              {connectingPlatform ? "Создание задания..." : "Открыть браузер"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlatformActions({
  platform,
  isLaunching,
  isDisconnecting,
  onConnect,
  onLaunch,
  onDisconnect,
}: {
  platform: PlatformConnection;
  isLaunching: boolean;
  isDisconnecting: boolean;
  onConnect: () => void;
  onLaunch: () => void;
  onDisconnect: () => void;
}) {
  if (platform.status === "connected") {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={onLaunch}
          disabled={isLaunching}
        >
          {isLaunching ? "Запуск..." : "Запустить"}
        </Button>
        <Button variant="outline" size="sm" onClick={onConnect}>
          Переподключить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDisconnect}
          disabled={isDisconnecting}
        >
          {isDisconnecting ? "Отключение..." : "Отключить"}
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={onConnect}>
      {platform.status === "expired" ? "Переподключить" : "Подключить"}
    </Button>
  );
}

function AgentStatePanel({
  agent,
  notice,
  onOpenAgent,
  onDismissNotice,
}: {
  agent: AgentConnectionState;
  notice: AgentStateName | null;
  onOpenAgent: () => void;
  onDismissNotice: () => void;
}) {
  const state = notice ?? agent.state;
  const lastSeenAt = agent.device?.lastSeenAt
    ? new Date(agent.device.lastSeenAt).toLocaleString()
    : null;
  const isNotice = notice !== null;

  if (state === "active") {
    return (
      <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="positive">Agent подключен</StatusBadge>
              <span className="text-muted-foreground text-xs">
                {lastSeenAt ? `Последняя активность: ${lastSeenAt}` : null}
              </span>
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              Браузер будет открыт на вашем компьютере.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === "busy") {
    return (
      <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warning">Agent занят</StatusBadge>
          <span className="text-muted-foreground text-xs">
            {lastSeenAt ? `Последняя активность: ${lastSeenAt}` : null}
          </span>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          Agent уже выполняет задачу. Дождитесь завершения перед новым запуском.
        </p>
      </div>
    );
  }

  if (state === "paired_offline") {
    return (
      <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <StatusBadge tone="warning">FlowPost Agent не запущен</StatusBadge>
            <h2 className="mt-3 text-base font-semibold">
              FlowPost Agent не запущен
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Мы попробуем открыть его автоматически.
            </p>
            {lastSeenAt ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Последняя активность: {lastSeenAt}
              </p>
            ) : null}
          </div>
          {isNotice ? (
            <Button variant="ghost" size="sm" onClick={onDismissNotice}>
              Скрыть
            </Button>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={onOpenAgent}>
            Открыть Agent
          </Button>
          <a
            className="border-border/80 bg-card/78 text-foreground hover:bg-muted/70 inline-flex h-9 items-center justify-center rounded-xl border px-3 text-[0.82rem] font-medium transition-colors"
            href="/downloads"
          >
            Скачать Agent
          </a>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          {agentProtocolHint}
        </p>
      </div>
    );
  }

  return (
    <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <StatusBadge tone="neutral">FlowPost Agent не подключен</StatusBadge>
          <h2 className="mt-3 text-base font-semibold">
            Для публикации нужен FlowPost Agent
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Установите FlowPost Agent, чтобы открывать браузер и публиковать
            статьи через ваш компьютер.
          </p>
        </div>
        {isNotice ? (
          <Button variant="ghost" size="sm" onClick={onDismissNotice}>
            Скрыть
          </Button>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="bg-foreground text-background hover:-translate-y-0.5 inline-flex h-9 items-center justify-center rounded-xl px-3 text-[0.82rem] font-medium transition-all"
          href="/downloads"
        >
          Скачать Agent
        </a>
        <a
          className="border-border/80 bg-card/78 text-foreground hover:bg-muted/70 inline-flex h-9 items-center justify-center rounded-xl border px-3 text-[0.82rem] font-medium transition-colors"
          href="/downloads"
        >
          Создать код подключения
        </a>
      </div>
    </div>
  );
}

function TrustBlocks() {
  return (
    <div className="grid gap-4">
      <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">
          Ваши данные остаются на вашем компьютере
        </h3>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          FlowPost Agent запускает браузер локально на вашем устройстве. Сессии
          площадок, cookies и авторизация в Dzen/VC.ru хранятся в локальном
          профиле браузера и не передаются на сервер FlowPost. Сервер получает
          только статус выполнения задачи: браузер открыт, публикация запущена,
          завершена или произошла ошибка.
        </p>
        <ul className="text-muted-foreground mt-3 grid gap-2 text-sm leading-6">
          <li>Браузер открывается на вашем компьютере, а не на сервере.</li>
          <li>Логины и пароли от площадок не передаются в FlowPost.</li>
          <li>Cookies и сессии хранятся локально в профиле Agent.</li>
          <li>
            FlowPost получает только технические статусы выполнения задач.
          </li>
          <li>
            Agent работает только после подключения через одноразовый код.
          </li>
        </ul>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Что FlowPost НЕ получает</h3>
          <ul className="text-muted-foreground mt-3 grid gap-2 text-sm leading-6">
            <li>пароль от Dzen/VC.ru</li>
            <li>cookies площадок</li>
            <li>доступ к вашему основному браузеру</li>
            <li>данные банковской карты</li>
            <li>личные файлы на компьютере</li>
          </ul>
        </div>
        <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Что FlowPost получает</h3>
          <ul className="text-muted-foreground mt-3 grid gap-2 text-sm leading-6">
            <li>ID задачи публикации</li>
            <li>выбранную платформу</li>
            <li>статус выполнения задачи</li>
            <li>технические логи без паролей и cookies</li>
            <li>результат выполнения: успешно / ошибка</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
