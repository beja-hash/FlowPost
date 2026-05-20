"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
import {
  agentProtocolHint,
  ensureAgentAwakeForAction,
  fetchAgentState,
  openAgentAndWait,
  type AgentAwakeForActionResult,
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
  cancelled: "Задача отменена",
};

const defaultAgentState: AgentConnectionState = {
  state: "not_paired",
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
  const [agentDisconnectOpen, setAgentDisconnectOpen] = useState(false);
  const [disconnectingAgent, setDisconnectingAgent] = useState(false);

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
      if (nextJob.status === "cancelled") {
        setAgentConnect(null);
        return;
      }

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

  async function openAgent() {
    const nextAgent = await openAgentAndWait({
      onStatus: (message) => toast.info(message),
    });
    setAgentState(nextAgent);

    if (nextAgent.state === "active") {
      setAgentNotice(null);
    }
  }

  function showAgentSetup(nextState: AgentStateName = agentState.state) {
    setAgentNotice(nextState);
  }

  async function ensureAgentReadyForAction(
    readyMessage: string,
  ): Promise<AgentAwakeForActionResult | null> {
    showAgentSetup("starting");
    toast.info(agentProtocolHint);

    const result = await ensureAgentAwakeForAction({
      onStatus: (message) => toast.info(message),
      readyMessage,
    });

    if (!result) {
      const nextAgent = await fetchAgentState();
      setAgentState(nextAgent);
      showAgentSetup(nextAgent.device ? "paired_offline" : "not_paired");
      toast.error(
        "Не удалось открыть FlowPost Agent. Откройте приложение вручную или переустановите Agent.",
      );
      return null;
    }

    setAgentState(result.agent);
    setAgentNotice(null);
    return result;
  }

  async function handleConnect(platform: PlatformConnection) {
    setConnectingPlatform(platform.platform);
    const readyAgent = await ensureAgentReadyForAction(
      "Agent запущен. Открываем браузер...",
    );

    if (!readyAgent) {
      setConnectingPlatform(null);
      return;
    }

    if (readyAgent.agent.state === "busy") {
      toast.info(
        "FlowPost Agent занят. Agent уже выполняет задачу. Дождитесь завершения или обновите статус.",
      );
      setConnectingPlatform(null);
      return;
    }

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
          mode: platform.status === "not_connected" ? "connect" : "reconnect",
          agentWakeStartedAt: readyAgent.wakeStartedAt,
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
        toast.info(
          body.message ??
            "FlowPost Agent занят. Agent уже выполняет задачу. Дождитесь завершения или обновите статус.",
        );
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
    setLaunchingPlatform(platform.platform);
    const readyAgent = await ensureAgentReadyForAction(
      "Agent запущен. Открываем браузер...",
    );

    if (!readyAgent) {
      setLaunchingPlatform(null);
      return;
    }

    if (readyAgent.agent.state === "busy") {
      toast.info(
        "FlowPost Agent занят. Agent уже выполняет задачу. Дождитесь завершения или обновите статус.",
      );
      setLaunchingPlatform(null);
      return;
    }

    setAgentNotice(null);

    try {
      const response = await fetch("/api/platforms/launch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform: platform.platform,
          agentWakeStartedAt: readyAgent.wakeStartedAt,
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
        toast.info(
          body.message ??
            "FlowPost Agent занят. Agent уже выполняет задачу. Дождитесь завершения или обновите статус.",
        );
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

  async function handleDisconnectAgent() {
    setDisconnectingAgent(true);

    try {
      const response = await fetch("/api/agent/devices/disconnect", {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || body.ok !== true) {
        throw new Error(body.error?.message ?? "Не удалось отключить Agent.");
      }

      setAgentDisconnectOpen(false);
      setAgentNotice(null);
      setAgentConnect(null);
      setAgentDevices([]);
      setAgentState(defaultAgentState);
      await refreshAgentDevices();
      toast.success("FlowPost Agent отключен от аккаунта.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось отключить Agent.",
      );
    } finally {
      setDisconnectingAgent(false);
    }
  }

  const pairedAgent = agentState.device;

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
        onOpenAgent={() => void openAgent()}
        onDismissNotice={() => setAgentNotice(null)}
        onDisconnectAgent={() => setAgentDisconnectOpen(true)}
      />

      {agentConnect && agentConnect.job.status !== "cancelled" ? (
        <div className="border-border/70 bg-muted/25 space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              tone={
                agentConnect.job.status === "completed"
                  ? "positive"
                  : agentConnect.job.status === "failed"
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
                  isConnecting={connectingPlatform === platform.platform}
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
                {pairedAgent ? "Agent подключен" : "Agent не подключен"}
              </StatusBadge>
              <span className="text-muted-foreground text-xs">
                {pairedAgent?.lastSeenAt
                  ? `Последняя активность: ${new Date(pairedAgent.lastSeenAt).toLocaleString()}`
                  : "Чтобы открыть браузер на вашем компьютере, установите FlowPost Agent."}
              </span>
            </div>

            {agentConnect && agentConnect.job.status !== "cancelled" ? (
              <div className="border-border/70 bg-muted/25 space-y-4 rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge
                    tone={
                      agentConnect.job.status === "completed"
                        ? "positive"
                        : agentConnect.job.status === "failed"
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
                !agentState.device
              }
            >
              {connectingPlatform ? "Создание задания..." : "Открыть браузер"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={agentDisconnectOpen} onOpenChange={setAgentDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отключить FlowPost Agent?</DialogTitle>
            <DialogDescription>
              Agent будет отвязан от этого аккаунта. Чтобы снова использовать
              публикации через браузер, нужно будет создать новый код
              подключения и подключить Agent заново.
            </DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm leading-6">
            Подключенные площадки и локальные профили браузера не удаляются
            автоматически.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAgentDisconnectOpen(false)}
              disabled={disconnectingAgent}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDisconnectAgent()}
              disabled={disconnectingAgent}
            >
              {disconnectingAgent ? "Отключаем..." : "Отключить Agent"}
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
  isConnecting,
  isDisconnecting,
  onConnect,
  onLaunch,
  onDisconnect,
}: {
  platform: PlatformConnection;
  isConnecting: boolean;
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
        <Button
          variant="outline"
          size="sm"
          onClick={onConnect}
          disabled={isConnecting}
        >
          {isConnecting ? "Запуск..." : "Переподключить"}
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
    <Button
      variant="outline"
      size="sm"
      onClick={onConnect}
      disabled={isConnecting}
    >
      {isConnecting
        ? "Запуск..."
        : platform.status === "expired"
          ? "Переподключить"
          : "Подключить"}
    </Button>
  );
}

function AgentStatePanel({
  agent,
  notice,
  onOpenAgent,
  onDismissNotice,
  onDisconnectAgent,
}: {
  agent: AgentConnectionState;
  notice: AgentStateName | null;
  onOpenAgent: () => void;
  onDismissNotice: () => void;
  onDisconnectAgent: () => void;
}) {
  const state = notice ?? agent.state;
  const lastSeenAt = agent.device?.lastSeenAt
    ? new Date(agent.device.lastSeenAt).toLocaleString()
    : null;
  const isNotice = notice !== null;
  const canDisconnectAgent = Boolean(
    agent.device && (agent.state === "active" || agent.state === "paired_offline"),
  );

  if (state === "starting") {
    return (
      <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warning">Запускаем Agent</StatusBadge>
          <span className="text-muted-foreground text-xs">
            {lastSeenAt ? `Последняя активность: ${lastSeenAt}` : null}
          </span>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          Ждем свежий heartbeat после открытия FlowPost Agent.
        </p>
      </div>
    );
  }

  if (state === "active") {
    return (
      <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="positive">Agent запущен</StatusBadge>
              <span className="text-muted-foreground text-xs">
                {lastSeenAt ? `Последняя активность: ${lastSeenAt}` : null}
              </span>
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              Agent привязан к аккаунту и сейчас отвечает.
            </p>
          </div>
          {canDisconnectAgent ? (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive"
              onClick={onDisconnectAgent}
            >
              Отключить Agent
            </Button>
          ) : null}
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
          Agent уже выполняет задачу. Дождитесь завершения или обновите статус. Новая задача запустится после текущей, если она уже поставлена в очередь.
        </p>
      </div>
    );
  }

  if (state === "paired_offline") {
    return (
      <div className="border-border/70 bg-muted/20 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <StatusBadge tone="warning">Agent подключен</StatusBadge>
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
          ) : canDisconnectAgent ? (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive"
              onClick={onDisconnectAgent}
            >
              Отключить Agent
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
