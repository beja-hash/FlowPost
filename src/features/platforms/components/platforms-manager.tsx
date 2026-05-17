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

const macDownloadUrl = process.env.NEXT_PUBLIC_AGENT_MAC_DOWNLOAD_URL;
const windowsDownloadUrl = process.env.NEXT_PUBLIC_AGENT_WINDOWS_DOWNLOAD_URL;

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

type PairingState = {
  code: string;
  expiresAt: string;
};

type AgentConnectState = {
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
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [agentDevices, setAgentDevices] = useState<AgentDevice[]>([]);
  const [creatingPairing, setCreatingPairing] = useState(false);

  async function refreshAgentDevices() {
    try {
      const response = await fetch("/api/agent/devices");
      const body = (await response.json()) as {
        devices?: AgentDevice[];
      };

      if (response.ok) {
        setAgentDevices(body.devices ?? []);
      }
    } catch (error) {
      console.error("[platform-agent-devices]", error);
    }
  }

  async function createPairingCode() {
    setCreatingPairing(true);

    try {
      const response = await fetch("/api/agent/pairing/create", {
        method: "POST",
      });
      const body = (await response.json()) as {
        pairing?: PairingState;
        error?: {
          message?: string;
        };
      };

      if (!response.ok || !body.pairing) {
        throw new Error(body.error?.message ?? "Не удалось создать код.");
      }

      setPairing(body.pairing);
      toast.info("Код подключения создан.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось создать код подключения.",
      );
    } finally {
      setCreatingPairing(false);
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
        status?: "requires_agent" | "queued";
        message?: string;
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
        toast.info(
          body.message ??
            "Чтобы открыть браузер на вашем компьютере, установите FlowPost Agent.",
        );
        return;
      }

      setAgentConnect({ job: body.job });
      toast.info("Agent подключен. Задание на открытие браузера создано.");
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
            setPairing(null);
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
            <p className="text-muted-foreground text-sm leading-6">
              FlowPost Agent запускает браузер локально на вашем устройстве.
              Сессии площадок, cookies и авторизация в Dzen/VC.ru хранятся в
              локальном профиле браузера и не передаются на сервер FlowPost.
              Сервер получает только статус выполнения задачи: браузер открыт,
              публикация запущена, завершена или произошла ошибка.
            </p>

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
                "Установите FlowPost Agent",
                "Введите код подключения",
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
              {macDownloadUrl ? (
                <a
                  href={macDownloadUrl}
                  className="border-border/70 bg-muted/25 hover:bg-muted/40 rounded-xl border p-4 text-sm font-medium transition-colors"
                >
                  Скачать для macOS Apple Silicon
                </a>
              ) : (
                <span className="border-border/70 bg-muted/25 text-muted-foreground rounded-xl border p-4 text-sm font-medium">
                  macOS: скоро
                </span>
              )}
              {windowsDownloadUrl ? (
                <a
                  href={windowsDownloadUrl}
                  className="border-border/70 bg-muted/25 hover:bg-muted/40 rounded-xl border p-4 text-sm font-medium transition-colors"
                >
                  Скачать для Windows
                </a>
              ) : (
                <span className="border-border/70 bg-muted/25 text-muted-foreground rounded-xl border p-4 text-sm font-medium">
                  Windows: скоро
                </span>
              )}
            </div>

            <div className="border-border/70 bg-muted/25 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Код подключения</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Одноразовый код действует 15 минут.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void createPairingCode()}
                  disabled={creatingPairing}
                >
                  {creatingPairing ? "Создание..." : "Создать код"}
                </Button>
              </div>
              {pairing ? (
                <div className="bg-background/80 mt-4 rounded-lg p-4">
                  <p className="font-mono text-2xl font-semibold tracking-[0.18em]">
                    {pairing.code}
                  </p>
                  <p className="text-muted-foreground mt-2 text-xs">
                    Истекает: {new Date(pairing.expiresAt).toLocaleString()}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge
                tone={agentDevices.length > 0 ? "positive" : "neutral"}
              >
                {agentDevices.length > 0
                  ? "Agent подключен. Можно открыть браузер."
                  : "Agent не подключен"}
              </StatusBadge>
              <span className="text-muted-foreground text-xs">
                Чтобы открыть браузер на вашем компьютере, установите FlowPost
                Agent.
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
                setPairing(null);
              }}
              disabled={connectingPlatform !== null}
            >
              Закрыть
            </Button>
            <Button
              onClick={() => void handleConnect()}
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
