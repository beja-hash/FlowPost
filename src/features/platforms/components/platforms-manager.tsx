"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
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

type AgentConnectState = {
  token: string;
  command: string;
  job: AgentJob;
};

const agentStatusLabels: Record<AgentJobStatus, string> = {
  queued: "Ожидает запуска FlowPost Agent",
  picked_up: "Agent получил задание",
  running: "Agent запускает браузер",
  waiting_user_login: "Браузер открыт на вашем компьютере",
  completed: "Подключение завершено",
  failed: "Ошибка подключения",
  cancelled: "Подключение отменено",
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

  async function handleConnect() {
    if (!selectedPlatform) {
      return;
    }

    setConnectingPlatform(selectedPlatform.platform);
    setAgentConnect(null);

    try {
      const response = await fetch("/api/platforms/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform: selectedPlatform.platform,
        }),
      });

      const body = (await response.json()) as {
        platform?: PlatformConnection;
        agent?: {
          token: string;
          command: string;
        };
        job?: AgentJob;
        error?: {
          message?: string;
        };
      };

      if (!response.ok || !body.agent || !body.job) {
        throw new Error(
          body.error?.message ?? "Не удалось подключить платформу.",
        );
      }

      setAgentConnect({
        token: body.agent.token,
        command: body.agent.command,
        job: body.job,
      });
      toast.info("Задание создано. Запустите FlowPost Agent локально.");
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
        platform?: PlatformConnection;
        error?: {
          message?: string;
        };
      };

      if (!response.ok || !body.platform) {
        throw new Error(
          body.error?.message ?? "Не удалось запустить платформу.",
        );
      }

      toast.success("Сессия платформы запущена.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось запустить платформу.",
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Платформы</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Площадки для публикации статей.
        </p>
      </div>

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
                  onConnect={() => setSelectedPlatform(platform)}
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Подключение браузера</DialogTitle>
            <DialogDescription>
              {selectedPlatform
                ? `Платформа: ${selectedPlatform.name}`
                : "Подключение платформы"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <p className="text-muted-foreground text-sm leading-6">
              Для публикации через ваш аккаунт FlowPost открывает браузер на
              вашем компьютере. Cookies и сессии площадок хранятся локально и не
              передаются на сервер.
            </p>

            <ol className="grid gap-3 text-sm leading-6">
              {[
                "Скачайте или запустите FlowPost Agent",
                "Вставьте код подключения или используйте команду ниже",
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

            {agentConnect ? (
              <div className="border-border/70 bg-muted/25 space-y-4 rounded-xl border p-4">
                <div>
                  <p className="text-sm font-medium">Команда для MVP</p>
                  <pre className="bg-background/80 text-muted-foreground mt-2 overflow-x-auto rounded-lg p-3 text-xs leading-5">
                    <code>{agentConnect.command}</code>
                  </pre>
                </div>
                <div>
                  <p className="text-sm font-medium">Agent token</p>
                  <pre className="bg-background/80 text-muted-foreground mt-2 overflow-x-auto rounded-lg p-3 text-xs leading-5">
                    <code>{agentConnect.token}</code>
                  </pre>
                </div>
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
              onClick={() => void handleConnect()}
              disabled={connectingPlatform !== null || agentConnect !== null}
            >
              {connectingPlatform ? "Создание задания..." : "Создать задание"}
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
