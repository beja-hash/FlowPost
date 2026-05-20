"use client";

export type AgentStateName =
  | "not_paired"
  | "paired_offline"
  | "starting"
  | "active"
  | "busy";

export type AgentConnectionState = {
  state: AgentStateName;
  device: {
    id: string;
    name: string;
    status: string;
    platform: string | null;
    appVersion: string | null;
    lastSeenAt: string | null;
  } | null;
  busyJob: {
    id: string;
    type: string;
    platform: string | null;
    status: string;
  } | null;
  lastSeenAt: string | null;
};

export const agentProtocolHint =
  "При первом запуске браузер может спросить разрешение открыть FlowPost Agent. Отметьте 'Запомнить мой выбор', чтобы в следующий раз Agent открывался автоматически.";

const defaultAgentState: AgentConnectionState = {
  state: "not_paired",
  device: null,
  busyJob: null,
  lastSeenAt: null,
};

export type AgentAwakeForActionResult = {
  agent: AgentConnectionState;
  device: NonNullable<AgentConnectionState["device"]>;
  wakeStartedAt: string;
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function fetchAgentState() {
  const response = await fetch("/api/agent/devices", {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as {
    agent?: AgentConnectionState;
  };

  if (!response.ok) {
    return defaultAgentState;
  }

  return body.agent ?? defaultAgentState;
}

export async function waitForFreshAgentHeartbeat(
  wakeStartedAt: Date,
  {
    onStatus,
    timeoutMs = 7000,
    intervalMs = 500,
  }: {
    onStatus?: (message: string) => void;
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastAgent = await fetchAgentState();

  while (Date.now() < deadline) {
    await wait(intervalMs);
    lastAgent = await fetchAgentState();

    const lastSeenAt = lastAgent.device?.lastSeenAt ?? lastAgent.lastSeenAt;
    const lastSeenTime = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;

    if (lastSeenTime >= wakeStartedAt.getTime() && lastAgent.device) {
      return {
        agent: lastAgent,
        device: lastAgent.device,
        wakeStartedAt: wakeStartedAt.toISOString(),
      };
    }
  }

  onStatus?.(
    "Не удалось открыть FlowPost Agent. Откройте приложение вручную или установите его заново.",
  );
  return null;
}

export async function ensureAgentAwakeForAction({
  onStatus,
  readyMessage = "Agent запущен. Отправляем задачу...",
}: {
  onStatus?: (message: string) => void;
  readyMessage?: string;
} = {}) {
  const wakeStartedAt = new Date();

  onStatus?.("Запускаем FlowPost Agent...");
  window.location.href = "flowpost-agent://wake";

  const result = await waitForFreshAgentHeartbeat(wakeStartedAt, {
    onStatus,
  });

  if (!result) {
    return null;
  }

  if (result.agent.state === "busy") {
    onStatus?.("Agent запущен, но сейчас занят.");
    return result;
  }

  onStatus?.(readyMessage);
  return result;
}

export async function openAgentAndWait({
  onStatus,
}: {
  onStatus?: (message: string) => void;
} = {}) {
  const result = await ensureAgentAwakeForAction({ onStatus });

  return result?.agent ?? fetchAgentState();
}
