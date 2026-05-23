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

export type ScheduledPublicationWakeResult =
  | {
      status: "success";
      awake: AgentAwakeForActionResult;
    }
  | {
      status: "failed" | "locked";
      awake: null;
    };

const SCHEDULED_WAKE_LOCK_TTL_MS = 60 * 1000;

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
  startingMessage = "Запускаем FlowPost Agent...",
  readyMessage = "Agent запущен. Отправляем задачу...",
}: {
  onStatus?: (message: string) => void;
  startingMessage?: string;
  readyMessage?: string;
} = {}) {
  const wakeStartedAt = new Date();

  onStatus?.(startingMessage);
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

export async function wakeAgentForScheduledPublication(
  publicationId: string,
  {
    onStatus,
  }: {
    onStatus?: (message: string) => void;
  } = {},
): Promise<ScheduledPublicationWakeResult> {
  const lockKey = `flowpost:scheduler-wake:${publicationId}`;
  const now = Date.now();

  try {
    const lockedAt = Number(window.localStorage.getItem(lockKey));
    if (Number.isFinite(lockedAt) && now - lockedAt < SCHEDULED_WAKE_LOCK_TTL_MS) {
      console.info("[Scheduler Wake] lock skipped", {
        publicationId,
        lockedAt: new Date(lockedAt).toISOString(),
      });
      return { status: "locked", awake: null };
    }

    window.localStorage.setItem(lockKey, String(now));
  } catch {
    // Protocol wake still works when storage is unavailable.
  }

  console.info("[Scheduler Wake] triggering flowpost-agent://wake", {
    publicationId,
  });

  const awake = await ensureAgentAwakeForAction({
    onStatus,
    startingMessage: "Запускаем agent для запланированной публикации...",
    readyMessage: "Agent запущен. Публикация начнётся автоматически.",
  });

  if (!awake) {
    console.error("[Scheduler Wake] wake failed", { publicationId });
    onStatus?.("Не удалось запустить FlowPost Agent для автопубликации.");
    return { status: "failed", awake: null };
  }

  console.info("[Scheduler Wake] wake success", {
    publicationId,
    deviceId: awake.device.id,
  });
  return { status: "success", awake };
}

export async function openAgentAndWait({
  onStatus,
}: {
  onStatus?: (message: string) => void;
} = {}) {
  const result = await ensureAgentAwakeForAction({ onStatus });

  return result?.agent ?? fetchAgentState();
}
