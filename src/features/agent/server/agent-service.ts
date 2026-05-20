import { createHash, randomBytes } from "node:crypto";

import {
  AssetStatus,
  AgentDeviceStatus,
  AgentJobStatus,
  AgentJobType,
  PlatformAccountStatus,
  PublicationStatus,
  StrategyArticleTaskStatus,
  VariantStatus,
  type AgentDevice,
  type AgentJob,
} from "@prisma/client";

import { prisma } from "@/infrastructure/db/prisma";
import {
  getPlatformConfig,
  type PlatformSlug,
} from "@/infrastructure/platforms/platform-registry";
import { formatArticleForPlatform } from "@/services/article-formatting";

const TOKEN_PREFIX = "fp_agent_";
const PAIRING_TTL_MINUTES = 15;
const ACTIVE_AGENT_WINDOW_MS = 60 * 1000;
const STALE_RUNNING_JOB_MS = 10 * 60 * 1000;
const STALE_INTERACTIVE_JOB_MS = 2 * 60 * 1000;
const INTERACTIVE_PLATFORM_JOB_TYPES = [
  "CONNECT_PLATFORM",
  "OPEN_PLATFORM",
  "RECONNECT_PLATFORM",
] as AgentJobType[];

export class AgentServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentServiceError";
  }
}

export function hashAgentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizePairingCode(code: string) {
  return code.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function hashPairingCode(code: string) {
  return createHash("sha256").update(normalizePairingCode(code)).digest("hex");
}

function createPairingCode() {
  const raw = randomBytes(5).toString("hex").toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function createAgentToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function publicAgentJob(job: AgentJob) {
  return {
    id: job.id,
    type: job.type.toLowerCase(),
    platform: job.platform,
    payload: job.payload,
    status: job.status.toLowerCase(),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function publishBusyMessage() {
  return "FlowPost Agent занят. Agent уже выполняет задачу. Новая публикация поставлена в очередь и запустится после завершения текущей.";
}

function connectBusyMessage() {
  return "FlowPost Agent занят. Agent уже выполняет задачу. Дождитесь завершения или обновите статус.";
}

function payloadKeys(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  return Object.keys(payload);
}

function availableAgentJobTypes(types: string[]) {
  const knownTypes = new Set(Object.values(AgentJobType));
  return types.filter((type): type is AgentJobType =>
    knownTypes.has(type as AgentJobType),
  );
}

function interactivePlatformJobTypes() {
  return INTERACTIVE_PLATFORM_JOB_TYPES;
}

function publishAgentJobTypes() {
  return availableAgentJobTypes(["PUBLISH_ARTICLE", "SCHEDULED_PUBLISH"]);
}

function parseActionStartedAt(value?: string | Date | null) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFreshAfterAction(
  device: Pick<AgentDevice, "lastSeenAt"> | null,
  actionStartedAt?: string | Date | null,
) {
  const startedAt = parseActionStartedAt(actionStartedAt);

  if (!device || !isAgentDeviceFresh(device)) {
    return false;
  }

  if (!startedAt) {
    return true;
  }

  return Boolean(device.lastSeenAt && device.lastSeenAt >= startedAt);
}

function jobErrorCode(job: Pick<AgentJob, "result" | "error">) {
  const result =
    job.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? (job.result as Record<string, unknown>)
      : {};
  const explicitCode =
    typeof result.code === "string"
      ? result.code
      : typeof result.errorCode === "string"
        ? result.errorCode
        : null;
  const message = `${explicitCode ?? ""} ${job.error ?? ""}`.toUpperCase();

  if (
    explicitCode === "SESSION_EXPIRED" ||
    explicitCode === "DZEN_SESSION_EXPIRED" ||
    explicitCode === "VC_SESSION_EXPIRED" ||
    explicitCode === "NEED_RECONNECT" ||
    explicitCode === "WAITING_USER_LOGIN" ||
    message.includes("SESSION_EXPIRED") ||
    message.includes("NEED_RECONNECT") ||
    message.includes("WAITING_USER_LOGIN")
  ) {
    return "SESSION_EXPIRED";
  }

  return explicitCode;
}

function friendlyPublishError(job: Pick<AgentJob, "result" | "error">) {
  const code = jobErrorCode(job);

  if (code === "SESSION_EXPIRED") {
    return "Сессия площадки истекла. Нажмите «Переподключить», чтобы войти заново.";
  }

  if (code === "PAYLOAD_INCOMPLETE") {
    return "Недостаточно данных для публикации. Сохраните статью и попробуйте снова.";
  }

  if (
    code === "EDITOR_FIELDS_NOT_FOUND" ||
    code === "DZEN_EDITOR_NOT_FOUND" ||
    code === "VC_EDITOR_NOT_FOUND"
  ) {
    return "Agent открыл площадку, но не смог найти редактор. Нажмите «Переподключить», проверьте вход и попробуйте снова.";
  }

  if (
    code === "PUBLISH_BUTTON_NOT_FOUND" ||
    code === "DZEN_PUBLISH_BUTTON_NOT_FOUND" ||
    code === "VC_PUBLISH_BUTTON_NOT_FOUND"
  ) {
    return "Текст вставлен, но не найдена кнопка публикации. Проверьте страницу в открытом браузере.";
  }

  if (code === "VC_NATIVE_DIALOG_NOT_HANDLED") {
    return "VC.ru запросил подтверждение публикации, но Agent не смог его обработать. Попробуйте повторить публикацию.";
  }

  if (
    code === "CAPTCHA_REQUIRED" ||
    code === "WAITING_USER_ACTION" ||
    code === "DZEN_CAPTCHA_REQUIRED" ||
    code === "VC_CAPTCHA_REQUIRED"
  ) {
    return "Площадка запросила ручное подтверждение. Подтвердите действие в открытом браузере и повторите публикацию.";
  }

  return job.error ?? "Ошибка автоматизации публикации.";
}

export function publicAgentDevice(device: AgentDevice) {
  return {
    id: device.id,
    name: device.name,
    status: device.status.toLowerCase(),
    platform: device.platform,
    appVersion: device.appVersion,
    createdAt: device.createdAt.toISOString(),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
  };
}

export function isAgentDeviceFresh(device: Pick<AgentDevice, "lastSeenAt">) {
  return Boolean(
    device.lastSeenAt &&
      device.lastSeenAt.getTime() >= Date.now() - ACTIVE_AGENT_WINDOW_MS,
  );
}

export async function getAgentConnectionState(userId: string) {
  await cleanupStaleAgentJobs(userId);

  const latestDevice = await prisma.agentDevice.findFirst({
    where: {
      userId,
      status: AgentDeviceStatus.ACTIVE,
    },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
  });

  if (!latestDevice) {
    console.log("[agent-service] state", {
      userId,
      state: "not_paired",
      activeAgent: false,
      lastSeenAt: null,
    });

    return {
      state: "not_paired" as const,
      device: null,
      busyJob: null,
      lastSeenAt: null,
    };
  }

  const active = isAgentDeviceFresh(latestDevice);
  const busyJob = active
    ? await prisma.agentJob.findFirst({
        where: {
          userId,
          agentDeviceId: latestDevice.id,
          status: {
            in: [
              AgentJobStatus.PICKED_UP,
              AgentJobStatus.RUNNING,
              AgentJobStatus.WAITING_USER_LOGIN,
            ],
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      })
    : null;
  const state = active ? (busyJob ? "busy" : "active") : "paired_offline";

  console.log("[agent-service] state", {
    userId,
    state,
    activeAgent: active,
    deviceId: latestDevice.id,
    lastSeenAt: latestDevice.lastSeenAt,
    busyJobId: busyJob?.id ?? null,
  });

  return {
    state,
    device: publicAgentDevice(latestDevice),
    busyJob: busyJob ? publicAgentJob(busyJob) : null,
    lastSeenAt: latestDevice.lastSeenAt?.toISOString() ?? null,
  };
}

export async function createPairingCodeForUser(userId: string) {
  const code = createPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60 * 1000);

  await prisma.agentPairingCode.create({
    data: {
      userId,
      codeHash: hashPairingCode(code),
      expiresAt,
    },
  });

  return {
    code,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function cleanupStaleAgentJobs(userId?: string) {
  await cleanupStaleInteractivePlatformJobs({
    userId,
    reason: "Cancelled stale interactive platform launch before agent poll",
  });

  const cutoff = new Date(Date.now() - STALE_RUNNING_JOB_MS);
  const runningResult = await prisma.agentJob.updateMany({
    where: {
      ...(userId ? { userId } : {}),
      status: {
        in: [
          AgentJobStatus.PICKED_UP,
          AgentJobStatus.RUNNING,
          AgentJobStatus.WAITING_USER_LOGIN,
        ],
      },
      updatedAt: {
        lt: cutoff,
      },
    },
    data: {
      status: AgentJobStatus.FAILED,
      completedAt: new Date(),
      error:
        "Задача была остановлена: Agent долго не присылал обновления статуса.",
    },
  });

  const queuedResult = await prisma.agentJob.updateMany({
    where: {
      ...(userId ? { userId } : {}),
      status: AgentJobStatus.QUEUED,
      createdAt: {
        lt: cutoff,
      },
      OR: [
        { type: { in: interactivePlatformJobTypes() } },
        { agentDeviceId: { not: null } },
      ],
    },
    data: {
      status: AgentJobStatus.FAILED,
      completedAt: new Date(),
      error:
        "Задача была остановлена: Agent не забрал ее в течение длительного времени.",
    },
  });

  if (runningResult.count > 0 || queuedResult.count > 0) {
    console.log("[agent-service] stale-jobs:cleaned", {
      userId: userId ?? null,
      runningCount: runningResult.count,
      queuedCount: queuedResult.count,
      cutoff,
    });
  }
}

async function cleanupStaleInteractivePlatformJobs({
  userId,
  platform,
  agentDeviceId,
  reason,
}: {
  userId?: string;
  platform?: string;
  agentDeviceId?: string | null;
  reason: string;
}) {
  const types = interactivePlatformJobTypes();

  if (types.length === 0) {
    return 0;
  }

  const cutoff = new Date(Date.now() - STALE_INTERACTIVE_JOB_MS);
  const result = await prisma.agentJob.updateMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(platform ? { platform } : {}),
      ...(agentDeviceId !== undefined ? { agentDeviceId } : {}),
      type: { in: types },
      OR: [
        {
          status: AgentJobStatus.QUEUED,
          agentDeviceId: null,
        },
        {
          status: AgentJobStatus.QUEUED,
          createdAt: { lt: cutoff },
        },
        {
          status: {
            in: [
              AgentJobStatus.PICKED_UP,
              AgentJobStatus.RUNNING,
              AgentJobStatus.WAITING_USER_LOGIN,
            ],
          },
          updatedAt: { lt: cutoff },
        },
      ],
    },
    data: {
      status: AgentJobStatus.CANCELLED,
      completedAt: new Date(),
      error: reason,
    },
  });

  if (result.count > 0) {
    console.log("[agent-service] cleanup:interactive-jobs-cancelled", {
      userId: userId ?? null,
      platform: platform ?? null,
      agentDeviceId: agentDeviceId ?? null,
      count: result.count,
      cutoff,
      reason,
    });
  }

  return result.count;
}

async function cleanupInteractivePlatformJobsBeforePublish({
  userId,
  platform,
}: {
  userId: string;
  platform?: string;
}) {
  const cutoff = new Date(Date.now() - STALE_INTERACTIVE_JOB_MS);
  const reason = "Cancelled stale interactive launch before publish";
  const result = await prisma.agentJob.updateMany({
    where: {
      userId,
      ...(platform ? { platform } : {}),
      type: { in: interactivePlatformJobTypes() },
      OR: [
        {
          status: AgentJobStatus.QUEUED,
        },
        {
          status: {
            in: [
              AgentJobStatus.PICKED_UP,
              AgentJobStatus.RUNNING,
              AgentJobStatus.WAITING_USER_LOGIN,
            ],
          },
          updatedAt: { lt: cutoff },
        },
      ],
    },
    data: {
      status: AgentJobStatus.CANCELLED,
      completedAt: new Date(),
      error: reason,
    },
  });

  if (result.count > 0) {
    console.log("[agent-service] cleanup:interactive-jobs-before-publish", {
      userId,
      platform: platform ?? null,
      count: result.count,
      cutoff,
      reason,
    });
  }

  return result.count;
}

export async function confirmPairingCode({
  code,
  name,
  platform,
  appVersion,
}: {
  code: string;
  name?: string;
  platform?: string;
  appVersion?: string;
}) {
  const pairing = await prisma.agentPairingCode.findUnique({
    where: {
      codeHash: hashPairingCode(code),
    },
  });

  if (!pairing || pairing.usedAt || pairing.expiresAt.getTime() < Date.now()) {
    throw new AgentServiceError(
      400,
      "INVALID_PAIRING_CODE",
      "Код подключения недействителен или истек.",
    );
  }

  const token = createAgentToken();
  const device = await prisma.$transaction(async (tx) => {
    await tx.agentPairingCode.update({
      where: { id: pairing.id },
      data: { usedAt: new Date() },
    });

    return tx.agentDevice.create({
      data: {
        userId: pairing.userId,
        name: name?.trim() || "FlowPost Agent",
        tokenHash: hashAgentToken(token),
        platform: platform?.slice(0, 80),
        appVersion: appVersion?.slice(0, 40),
        lastSeenAt: new Date(),
      },
    });
  });

  return {
    token,
    device: publicAgentDevice(device),
  };
}

export async function authenticateAgent(authorization: string | null) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new AgentServiceError(
      401,
      "AGENT_TOKEN_REQUIRED",
      "Agent token обязателен.",
    );
  }

  const device = await prisma.agentDevice.findUnique({
    where: {
      tokenHash: hashAgentToken(token),
    },
  });

  if (!device) {
    throw new AgentServiceError(
      401,
      "INVALID_AGENT_TOKEN",
      "Agent token недействителен или отозван.",
    );
  }

  if (device.status === AgentDeviceStatus.REVOKED) {
    throw new AgentServiceError(
      401,
      "DEVICE_REVOKED",
      "Agent отключен от аккаунта.",
    );
  }

  if (device.status !== AgentDeviceStatus.ACTIVE) {
    throw new AgentServiceError(
      401,
      "INVALID_AGENT_TOKEN",
      "Agent token недействителен или отозван.",
    );
  }

  const updatedDevice = await prisma.agentDevice.update({
    where: {
      id: device.id,
    },
    data: {
      lastSeenAt: new Date(),
    },
  });

  console.log("[agent-service] heartbeat/authenticated", {
    userId: updatedDevice.userId,
    deviceId: updatedDevice.id,
    lastSeenAt: updatedDevice.lastSeenAt,
  });

  return updatedDevice;
}

export async function listAgentDevices(userId: string) {
  const devices = await prisma.agentDevice.findMany({
    where: {
      userId,
      status: AgentDeviceStatus.ACTIVE,
    },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
  });

  return devices.map(publicAgentDevice);
}

export async function getActiveAgentDevice(userId: string) {
  const cutoff = new Date(Date.now() - ACTIVE_AGENT_WINDOW_MS);
  const device = await prisma.agentDevice.findFirst({
    where: {
      userId,
      status: AgentDeviceStatus.ACTIVE,
      lastSeenAt: {
        gte: cutoff,
      },
    },
    orderBy: {
      lastSeenAt: "desc",
    },
  });

  console.log("[agent-service] active-agent", {
    userId,
    found: Boolean(device),
    deviceId: device?.id ?? null,
    cutoff,
    lastSeenAt: device?.lastSeenAt ?? null,
  });

  return device;
}

export const hasActiveAgentDevice = getActiveAgentDevice;

export async function revokeAgentDevice(userId: string, deviceId: string) {
  const device = await prisma.agentDevice.findFirst({
    where: { id: deviceId, userId },
  });

  if (!device) {
    throw new AgentServiceError(
      404,
      "AGENT_DEVICE_NOT_FOUND",
      "Agent не найден.",
    );
  }

  const revoked = await prisma.agentDevice.update({
    where: { id: device.id },
    data: { status: AgentDeviceStatus.REVOKED, revokedAt: new Date() },
  });

  return publicAgentDevice(revoked);
}

export async function disconnectAgentDevicesForUser(userId: string) {
  const devices = await prisma.agentDevice.findMany({
    where: {
      userId,
      status: AgentDeviceStatus.ACTIVE,
    },
    select: {
      id: true,
    },
  });
  const deviceIds = devices.map((device) => device.id);

  console.log("[agent-service] disconnect:requested", {
    userId,
    deviceIds,
  });

  if (deviceIds.length === 0) {
    console.log("[agent-service] disconnect:revoked", {
      userId,
      count: 0,
    });
    console.log("[agent-service] disconnect:jobs-cancelled", {
      userId,
      count: 0,
    });

    return {
      ok: true,
      revokedCount: 0,
      cancelledJobsCount: 0,
    };
  }

  const now = new Date();
  const [revoked, cancelledJobs] = await prisma.$transaction([
    prisma.agentDevice.updateMany({
      where: {
        userId,
        id: { in: deviceIds },
        status: AgentDeviceStatus.ACTIVE,
      },
      data: {
        status: AgentDeviceStatus.REVOKED,
        revokedAt: now,
      },
    }),
    prisma.agentJob.updateMany({
      where: {
        userId,
        agentDeviceId: { in: deviceIds },
        status: {
          in: [
            AgentJobStatus.QUEUED,
            AgentJobStatus.PICKED_UP,
            AgentJobStatus.RUNNING,
            AgentJobStatus.WAITING_USER_LOGIN,
          ],
        },
      },
      data: {
        status: AgentJobStatus.CANCELLED,
        completedAt: now,
        error: "Agent disconnected",
      },
    }),
  ]);

  console.log("[agent-service] disconnect:revoked", {
    userId,
    count: revoked.count,
  });
  console.log("[agent-service] disconnect:jobs-cancelled", {
    userId,
    count: cancelledJobs.count,
  });

  return {
    ok: true,
    revokedCount: revoked.count,
    cancelledJobsCount: cancelledJobs.count,
  };
}

export async function revokeAuthenticatedAgent(authorization: string | null) {
  const device = await authenticateAgent(authorization);
  const revoked = await prisma.agentDevice.update({
    where: { id: device.id },
    data: { status: AgentDeviceStatus.REVOKED, revokedAt: new Date() },
  });

  console.log("[agent-service] agent-device:revoked-by-agent", {
    userId: revoked.userId,
    deviceId: revoked.id,
  });

  return publicAgentDevice(revoked);
}

export async function createConnectPlatformJob({
  userId,
  platform,
  jobType = "CONNECT_PLATFORM" as AgentJobType,
  agentWakeStartedAt,
}: {
  userId: string;
  platform: PlatformSlug;
  jobType?: AgentJobType;
  agentWakeStartedAt?: string | Date | null;
}) {
  const config = getPlatformConfig(platform);

  if (!config) {
    throw new AgentServiceError(
      400,
      "INVALID_PLATFORM",
      "Эта площадка не поддерживается.",
    );
  }

  await cleanupStaleInteractivePlatformJobs({
    userId,
    platform: config.slug,
    reason: "Cancelled stale interactive platform launch before new request",
  });

  const agent = await getAgentConnectionState(userId);
  const activeDevice =
    agent.state === "active" || agent.state === "busy"
      ? await getActiveAgentDevice(userId)
      : null;

  if (!activeDevice || !isFreshAfterAction(activeDevice, agentWakeStartedAt)) {
    console.log("[agent-service] connect-job:requires-agent", {
      userId,
      platform: config.slug,
      agentState: agent.state,
      jobType,
      activeDeviceId: activeDevice?.id ?? null,
      activeDeviceLastSeenAt: activeDevice?.lastSeenAt ?? null,
      agentWakeStartedAt: agentWakeStartedAt ?? null,
    });

    return {
      status: "requires_agent" as const,
      message:
        agent.state === "paired_offline"
          ? "FlowPost Agent не запущен. Мы попробуем открыть его автоматически."
          : "Для запуска браузера установите и подключите FlowPost Agent.",
      agentState: agent.state,
      agentDevice: null,
      job: null,
    };
  }

  if (agent.state === "busy") {
    return {
      status: "busy" as const,
      message: connectBusyMessage(),
      agentState: agent.state,
      agentDevice: publicAgentDevice(activeDevice),
      job: agent.busyJob,
    };
  }

  const existingJob = await prisma.agentJob.findFirst({
    where: {
      userId,
      type: jobType,
      platform: config.slug,
      status: {
        in: [
          AgentJobStatus.QUEUED,
          AgentJobStatus.PICKED_UP,
          AgentJobStatus.RUNNING,
          AgentJobStatus.WAITING_USER_LOGIN,
        ],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existingJob) {
    return {
      status: "busy" as const,
      message: connectBusyMessage(),
      agentState: "busy" as const,
      agentDevice: publicAgentDevice(activeDevice),
      job: publicAgentJob(existingJob),
    };
  }

  const job = await prisma.agentJob.create({
    data: {
      userId,
      agentDeviceId: activeDevice.id,
      type: jobType,
      platform: config.slug,
      payload: {
        platform: config.slug,
        platformName: config.name,
        connectUrl: config.connectUrl,
        editorUrl: config.editorUrl,
      },
      status: AgentJobStatus.QUEUED,
    },
  });

  console.log("[agent-service] connect-job:created", {
    userId,
    agentDeviceId: activeDevice.id,
    jobId: job.id,
    type: job.type,
    platform: config.slug,
  });

  return {
    status: "queued" as const,
    message:
      "Задание создано. FlowPost Agent откроет браузер на вашем компьютере.",
    agentState: agent.state,
    agentDevice: publicAgentDevice(activeDevice),
    job: publicAgentJob(job),
  };
}

export async function createPublishArticleJob({
  userId,
  articleId,
  allowOfflineQueue = false,
  strategyTaskId,
  agentWakeStartedAt,
}: {
  userId: string;
  articleId: string;
  allowOfflineQueue?: boolean;
  strategyTaskId?: string;
  agentWakeStartedAt?: string | Date | null;
}) {
  console.log("[agent-service] publish-request:received", {
    userId,
    articleId,
    allowOfflineQueue,
    strategyTaskId: strategyTaskId ?? null,
    agentWakeStartedAt: agentWakeStartedAt ?? null,
  });

  const article = await prisma.articleAsset.findFirst({
    where: {
      id: articleId,
      workspace: {
        members: {
          some: { userId },
        },
      },
      status: {
        not: AssetStatus.ARCHIVED,
      },
    },
    include: {
      variants: {
        include: {
          platform: true,
        },
        take: 1,
      },
      publications: {
        take: 1,
        orderBy: {
          createdAt: "desc",
        },
      },
      workspace: {
        select: {
          id: true,
        },
      },
    },
  });

  const variant = article?.variants[0];
  const publication = article?.publications[0];

  if (!article || !variant || !publication) {
    throw new AgentServiceError(
      404,
      "ARTICLE_NOT_FOUND",
      "Статья для публикации не найдена.",
    );
  }

  const config = getPlatformConfig(variant.platform.slug);

  if (!config) {
    throw new AgentServiceError(
      400,
      "INVALID_PLATFORM",
      "Эта площадка не поддерживается.",
    );
  }

  const account = await prisma.platformAccount.findUnique({
    where: {
      userId_platform: {
        userId,
        platform: config.slug,
      },
    },
  });

  if (account?.status !== PlatformAccountStatus.CONNECTED) {
    console.log("[agent-service] publish-job:platform-not-connected", {
      userId,
      articleId,
      platform: config.slug,
      accountStatus: account?.status ?? null,
    });

    throw new AgentServiceError(
      409,
      "PLATFORM_NOT_CONNECTED",
      "Сначала подключите площадку через FlowPost Agent.",
    );
  }

  const agent = await getAgentConnectionState(userId);
  const activeDevice =
    agent.state === "active" || agent.state === "busy"
      ? await getActiveAgentDevice(userId)
      : null;

  console.log("[agent-service] publish-job:active-agent", {
    userId,
    articleId,
    platform: config.slug,
    agentState: agent.state,
    activeDeviceId: activeDevice?.id ?? null,
    busyJobId: agent.busyJob?.id ?? null,
  });

  await cleanupInteractivePlatformJobsBeforePublish({
    userId,
    platform: config.slug,
  });

  const activeDeviceReady = isFreshAfterAction(activeDevice, agentWakeStartedAt);

  if (!activeDeviceReady && !allowOfflineQueue) {
    console.log("[agent-service] publish-job:requires-agent", {
      userId,
      articleId,
      platform: config.slug,
      agentState: agent.state,
      activeDeviceId: activeDevice?.id ?? null,
      activeDeviceLastSeenAt: activeDevice?.lastSeenAt ?? null,
      agentWakeStartedAt: agentWakeStartedAt ?? null,
    });

    return {
      status: "requires_agent" as const,
      message:
        agent.state === "paired_offline"
          ? "FlowPost Agent не запущен. Мы попробуем открыть его автоматически."
          : "Для публикации установите и подключите FlowPost Agent.",
      agentState: agent.state,
      agentDevice: null,
      job: null,
    };
  }

  const existingJob = await prisma.agentJob.findFirst({
    where: {
      userId,
      type: AgentJobType.PUBLISH_ARTICLE,
      platform: config.slug,
      status: {
        in: [
          AgentJobStatus.QUEUED,
          AgentJobStatus.PICKED_UP,
          AgentJobStatus.RUNNING,
          AgentJobStatus.WAITING_USER_LOGIN,
        ],
      },
      payload: {
        path: ["articleId"],
        equals: article.id,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existingJob) {
    console.log("[agent-service] existing-publish-job:found", {
      userId,
      articleId,
      platform: config.slug,
      jobId: existingJob.id,
      status: existingJob.status,
    });

    return {
      status:
        existingJob.status === AgentJobStatus.QUEUED
          ? ("queued" as const)
          : ("busy" as const),
      message: "Публикация уже отправлена в Agent.",
      agentState: "busy" as const,
      agentDevice: activeDevice ? publicAgentDevice(activeDevice) : null,
      job: publicAgentJob(existingJob),
      existing: true,
    };
  }

  const body = formatArticleForPlatform(article.canonicalBody, config.slug);
  const publishPayload = {
    articleId: article.id,
    publicationId: publication.id,
    variantId: variant.id,
    brandId: article.brandId,
    workspaceId: article.workspace.id,
    userId,
    strategyTaskId: strategyTaskId ?? null,
    platform: config.slug,
    platformName: config.name,
    platformEditorUrl: config.editorUrl,
    editorUrl: config.editorUrl,
    title: article.title,
    content: body,
    body,
    ctaText: article.ctaText,
    ctaUrl: article.ctaUrl,
  };
  const job = await prisma.$transaction(async (tx) => {
    await tx.articleAsset.update({
      where: { id: article.id },
      data: {
        status: AssetStatus.DISTRIBUTING,
        variants: {
          update: {
            where: { id: variant.id },
            data: { status: VariantStatus.APPROVED },
          },
        },
        publications: {
          update: {
            where: { id: publication.id },
            data: { status: PublicationStatus.SCHEDULED, lastError: null },
          },
        },
      },
    });

    return tx.agentJob.create({
      data: {
        userId,
        agentDeviceId: activeDeviceReady ? activeDevice?.id : null,
        type: AgentJobType.PUBLISH_ARTICLE,
        platform: config.slug,
        payload: publishPayload,
        status: AgentJobStatus.QUEUED,
      },
    });
  });

  console.log("[agent-service] publish-job:created", {
    userId,
    articleId,
    agentDeviceId: activeDeviceReady ? activeDevice?.id ?? null : null,
    jobId: job.id,
    type: job.type,
    platform: config.slug,
    payloadKeys: payloadKeys(job.payload),
  });
  console.log("[agent-service] publication-status:updated", {
    userId,
    articleId,
    publicationId: publication.id,
    status: PublicationStatus.SCHEDULED,
    assetStatus: AssetStatus.DISTRIBUTING,
    reason: "publish_job_created",
  });

  return {
    status: "queued" as const,
    message:
      agent.state === "busy"
        ? publishBusyMessage()
        : "Задание публикации создано. FlowPost Agent выполнит публикацию в фоне.",
    agentState: agent.state,
    agentDevice: activeDeviceReady && activeDevice ? publicAgentDevice(activeDevice) : null,
    job: publicAgentJob(job),
  };
}

export async function getNextAgentJob(authorization: string | null) {
  const device = await authenticateAgent(authorization);
  await cleanupStaleAgentJobs(device.userId);

  console.log("[agent-service] jobs-next:request", {
    userId: device.userId,
    deviceId: device.id,
  });

  const baseWhere = {
    userId: device.userId,
    status: AgentJobStatus.QUEUED,
    OR: [{ agentDeviceId: device.id }, { agentDeviceId: null }],
  };
  const publishTypes = publishAgentJobTypes();
  const priorityJob =
    publishTypes.length > 0
      ? await prisma.agentJob.findFirst({
          where: {
            ...baseWhere,
            type: { in: publishTypes },
          },
          orderBy: {
            createdAt: "asc",
          },
        })
      : null;

  const job =
    priorityJob ??
    (await prisma.agentJob.findFirst({
      where: baseWhere,
      orderBy: {
        createdAt: "asc",
      },
    }));

  if (!job) {
    console.log("[agent-service] jobs-next:request", {
      userId: device.userId,
      deviceId: device.id,
      foundJobId: null,
      jobType: null,
      platform: null,
    });
    return null;
  }

  const claimedJob = await prisma.agentJob.update({
    where: {
      id: job.id,
    },
    data: {
      agentDeviceId: device.id,
      status: AgentJobStatus.PICKED_UP,
      startedAt: new Date(),
    },
  });

  console.log("[agent-service] job:picked_up", {
    userId: device.userId,
    deviceId: device.id,
    foundJobId: claimedJob.id,
    jobType: claimedJob.type,
    platform: claimedJob.platform,
    payloadKeys: payloadKeys(claimedJob.payload),
  });

  return publicAgentJob(claimedJob);
}

export async function getAgentJobForUser(userId: string, jobId: string) {
  const job = await prisma.agentJob.findFirst({
    where: {
      id: jobId,
      userId,
    },
  });

  if (!job) {
    throw new AgentServiceError(
      404,
      "AGENT_JOB_NOT_FOUND",
      "Задание не найдено.",
    );
  }

  return publicAgentJob(job);
}

export async function updateAgentJobStatus({
  authorization,
  jobId,
  status,
  result,
  error,
}: {
  authorization: string | null;
  jobId: string;
  status: AgentJobStatus;
  result?: unknown;
  error?: string | null;
}) {
  const device = await authenticateAgent(authorization);

  const job = await prisma.agentJob.findFirst({
    where: {
      id: jobId,
      userId: device.userId,
      OR: [{ agentDeviceId: device.id }, { agentDeviceId: null }],
    },
  });

  if (!job) {
    throw new AgentServiceError(
      404,
      "AGENT_JOB_NOT_FOUND",
      "Задание не найдено.",
    );
  }

  const now = new Date();
  const updatedJob = await prisma.agentJob.update({
    where: {
      id: job.id,
    },
    data: {
      agentDeviceId: job.agentDeviceId ?? device.id,
      status,
      result: result === undefined ? undefined : (result as object),
      error: error === undefined ? undefined : error,
      startedAt:
        job.startedAt ??
        (status === AgentJobStatus.RUNNING ||
        status === AgentJobStatus.WAITING_USER_LOGIN
          ? now
          : undefined),
      completedAt:
        status === AgentJobStatus.COMPLETED ||
        status === AgentJobStatus.FAILED ||
        status === AgentJobStatus.CANCELLED
          ? now
          : undefined,
    },
  });

  console.log("[agent-service] job:status-updated", {
    userId: updatedJob.userId,
    deviceId: device.id,
    jobId: updatedJob.id,
    jobType: updatedJob.type,
    platform: updatedJob.platform,
    status: updatedJob.status,
    error: updatedJob.error ?? null,
  });

  if (updatedJob.status === AgentJobStatus.RUNNING) {
    console.log("[agent-service] job:running", {
      userId: updatedJob.userId,
      deviceId: device.id,
      jobId: updatedJob.id,
      jobType: updatedJob.type,
      platform: updatedJob.platform,
    });
  }

  if (updatedJob.status === AgentJobStatus.COMPLETED) {
    console.log("[agent-service] job:completed", {
      userId: updatedJob.userId,
      deviceId: device.id,
      jobId: updatedJob.id,
      jobType: updatedJob.type,
      platform: updatedJob.platform,
    });
  }

  if (updatedJob.status === AgentJobStatus.FAILED) {
    console.log("[agent-service] job:failed", {
      userId: updatedJob.userId,
      deviceId: device.id,
      jobId: updatedJob.id,
      jobType: updatedJob.type,
      platform: updatedJob.platform,
      error: updatedJob.error ?? null,
      code: jobErrorCode(updatedJob),
    });
  }

  if (
    (updatedJob.type === ("CONNECT_PLATFORM" as AgentJobType) ||
      updatedJob.type === ("RECONNECT_PLATFORM" as AgentJobType)) &&
    updatedJob.platform &&
    updatedJob.status === AgentJobStatus.COMPLETED
  ) {
    await prisma.platformAccount.upsert({
      where: {
        userId_platform: {
          userId: updatedJob.userId,
          platform: updatedJob.platform,
        },
      },
      create: {
        userId: updatedJob.userId,
        platform: updatedJob.platform,
        status: PlatformAccountStatus.CONNECTED,
        sessionPath: `flowpost-agent:${device.id}:${updatedJob.platform}`,
      },
      update: {
        status: PlatformAccountStatus.CONNECTED,
        sessionPath: `flowpost-agent:${device.id}:${updatedJob.platform}`,
      },
    });
  }

  if (
    updatedJob.type === AgentJobType.PUBLISH_ARTICLE &&
    updatedJob.status === AgentJobStatus.COMPLETED
  ) {
    const payload = updatedJob.payload as {
      articleId?: string;
      publicationId?: string;
      variantId?: string;
      strategyTaskId?: string | null;
    };
    const resultPayload = updatedJob.result as {
      publishedUrl?: string;
    } | null;

    if (payload.articleId) {
      await prisma.articleAsset.update({
        where: { id: payload.articleId },
        data: {
          status: AssetStatus.PUBLISHED,
          variants: {
            updateMany: {
              where: payload.variantId ? { id: payload.variantId } : {},
              data: { status: VariantStatus.PUBLISHED },
            },
          },
          publications: {
            updateMany: {
              where: payload.publicationId ? { id: payload.publicationId } : {},
              data: {
                status: PublicationStatus.PUBLISHED,
                publishedAt: now,
                externalUrl: resultPayload?.publishedUrl ?? null,
                lastError: null,
              },
            },
          },
        },
      });
      console.log("[agent-service] publication-status:updated", {
        userId: updatedJob.userId,
        articleId: payload.articleId,
        publicationId: payload.publicationId ?? null,
        status: PublicationStatus.PUBLISHED,
        jobId: updatedJob.id,
      });
    }

    if (payload.strategyTaskId) {
      await prisma.strategyArticleTask.updateMany({
        where: {
          id: payload.strategyTaskId,
          strategy: { userId: updatedJob.userId },
        },
        data: {
          status: StrategyArticleTaskStatus.PUBLISHED,
          error: null,
        },
      });
    }
  }

  if (
    updatedJob.type === AgentJobType.PUBLISH_ARTICLE &&
    updatedJob.status === AgentJobStatus.FAILED
  ) {
    const payload = updatedJob.payload as {
      articleId?: string;
      publicationId?: string;
      variantId?: string;
      strategyTaskId?: string | null;
      platform?: string;
    };
    const code = jobErrorCode(updatedJob);
    const friendlyError = friendlyPublishError(updatedJob);

    if (payload.articleId) {
      await prisma.articleAsset.update({
        where: { id: payload.articleId },
        data: {
          variants: {
            updateMany: {
              where: payload.variantId ? { id: payload.variantId } : {},
              data: { status: VariantStatus.FAILED },
            },
          },
          publications: {
            updateMany: {
              where: payload.publicationId ? { id: payload.publicationId } : {},
              data: {
                status: PublicationStatus.FAILED,
                lastError: friendlyError,
              },
            },
          },
        },
      });
      console.log("[agent-service] publication-status:updated", {
        userId: updatedJob.userId,
        articleId: payload.articleId,
        publicationId: payload.publicationId ?? null,
        status: PublicationStatus.FAILED,
        jobId: updatedJob.id,
        error: friendlyError,
      });
    }

    if (code === "SESSION_EXPIRED" && payload.platform) {
      await prisma.platformAccount.updateMany({
        where: {
          userId: updatedJob.userId,
          platform: payload.platform,
        },
        data: {
          status: PlatformAccountStatus.EXPIRED,
        },
      });
    }

    if (payload.strategyTaskId) {
      await prisma.strategyArticleTask.updateMany({
        where: {
          id: payload.strategyTaskId,
          strategy: { userId: updatedJob.userId },
        },
        data: {
          status:
            code === "SESSION_EXPIRED"
              ? StrategyArticleTaskStatus.WAITING_CONNECTION
              : StrategyArticleTaskStatus.CATCHUP_PENDING,
          error: friendlyError,
        },
      });
    }
  }

  return publicAgentJob(updatedJob);
}

export async function appendAgentJobLog({
  authorization,
  jobId,
  message,
  level = "info",
}: {
  authorization: string | null;
  jobId: string;
  message: string;
  level?: string;
}) {
  const device = await authenticateAgent(authorization);
  const job = await prisma.agentJob.findFirst({
    where: {
      id: jobId,
      userId: device.userId,
      OR: [{ agentDeviceId: device.id }, { agentDeviceId: null }],
    },
    select: {
      id: true,
    },
  });

  if (!job) {
    throw new AgentServiceError(
      404,
      "AGENT_JOB_NOT_FOUND",
      "Задание не найдено.",
    );
  }

  const log = await prisma.agentJobLog.create({
    data: {
      jobId,
      message,
      level: level.slice(0, 24),
    },
  });

  return {
    id: log.id,
    level: log.level,
    message: log.message,
    createdAt: log.createdAt.toISOString(),
  };
}

export function parseAgentJobStatus(status: string) {
  const normalized = status.trim().toUpperCase();

  if (normalized === "QUEUED") return AgentJobStatus.QUEUED;
  if (normalized === "PICKED_UP") return AgentJobStatus.PICKED_UP;
  if (normalized === "RUNNING") return AgentJobStatus.RUNNING;
  if (normalized === "WAITING_USER_LOGIN") {
    return AgentJobStatus.WAITING_USER_LOGIN;
  }
  if (normalized === "COMPLETED") return AgentJobStatus.COMPLETED;
  if (normalized === "FAILED") return AgentJobStatus.FAILED;
  if (normalized === "CANCELLED" || normalized === "CANCELED") {
    return AgentJobStatus.CANCELLED;
  }

  throw new AgentServiceError(
    400,
    "INVALID_AGENT_JOB_STATUS",
    "Некорректный статус задания агента.",
  );
}
