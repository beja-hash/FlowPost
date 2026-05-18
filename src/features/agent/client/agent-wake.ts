"use client";

export type AgentStateName = "none" | "paired_offline" | "active" | "busy";

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
  state: "none",
  device: null,
  busyJob: null,
  lastSeenAt: null,
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

export async function openAgentAndWait({
  onStatus,
}: {
  onStatus?: (message: string) => void;
} = {}) {
  onStatus?.("Запускаем FlowPost Agent...");
  window.location.href = "flowpost-agent://wake";

  await wait(1200);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const agent = await fetchAgentState();

    if (agent.state === "active") {
      onStatus?.("Agent запущен. Отправляем задачу...");
      return agent;
    }

    if (agent.state === "busy") {
      onStatus?.("Agent выполняет задачу. Дождитесь завершения.");
      return agent;
    }

    await wait(800);
  }

  onStatus?.(
    "Не удалось открыть Agent автоматически. Установите приложение или откройте его вручную.",
  );
  return fetchAgentState();
}
