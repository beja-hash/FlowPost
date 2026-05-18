import { createHash, randomBytes } from "node:crypto";

import {
  AssetStatus,
  AgentDeviceStatus,
  AgentJobStatus,
  AgentJobType,
  PlatformAccountStatus,
  PublicationStatus,
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
      state: "none",
      activeAgent: false,
      lastSeenAt: null,
    });

    return {
      state: "none" as const,
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
  const state = active ? (busyJob ? "busy" : "active") : "offline";

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

  if (!device || device.status !== AgentDeviceStatus.ACTIVE) {
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
  const cutoff = new Date(Date.now() - ACTIVE_AGENT_WINDOW_MS);
  const devices = await prisma.agentDevice.findMany({
    where: {
      userId,
      status: AgentDeviceStatus.ACTIVE,
      lastSeenAt: {
        gte: cutoff,
      },
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

export async function createConnectPlatformJob({
  userId,
  platform,
}: {
  userId: string;
  platform: PlatformSlug;
}) {
  const config = getPlatformConfig(platform);

  if (!config) {
    throw new AgentServiceError(
      400,
      "INVALID_PLATFORM",
      "Эта площадка не поддерживается.",
    );
  }

  const agent = await getAgentConnectionState(userId);
  const activeDevice =
    agent.state === "active" || agent.state === "busy"
      ? await getActiveAgentDevice(userId)
      : null;

  if (!activeDevice) {
    console.log("[agent-service] connect-job:requires-agent", {
      userId,
      platform: config.slug,
      agentState: agent.state,
    });

    return {
      status: "requires_agent" as const,
      message:
        agent.state === "offline"
          ? "FlowPost Agent не запущен. Откройте приложение FlowPost Agent и повторите действие."
          : "Для запуска браузера установите и подключите FlowPost Agent.",
      agentState: agent.state,
      agentDevice: null,
      job: null,
    };
  }

  if (agent.state === "busy") {
    return {
      status: "busy" as const,
      message: "Agent уже выполняет задачу. Дождитесь завершения.",
      agentState: agent.state,
      agentDevice: publicAgentDevice(activeDevice),
      job: agent.busyJob,
    };
  }

  const existingJob = await prisma.agentJob.findFirst({
    where: {
      userId,
      type: AgentJobType.CONNECT_PLATFORM,
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
      message: "Браузер уже запускается или Agent выполняет задачу.",
      agentState: "busy" as const,
      agentDevice: publicAgentDevice(activeDevice),
      job: publicAgentJob(existingJob),
    };
  }

  const job = await prisma.agentJob.create({
    data: {
      userId,
      agentDeviceId: activeDevice.id,
      type: AgentJobType.CONNECT_PLATFORM,
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
}: {
  userId: string;
  articleId: string;
}) {
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

  if (!activeDevice) {
    console.log("[agent-service] publish-job:requires-agent", {
      userId,
      articleId,
      platform: config.slug,
      agentState: agent.state,
    });

    return {
      status: "requires_agent" as const,
      message:
        agent.state === "offline"
          ? "FlowPost Agent не запущен. Откройте Agent и повторите публикацию."
          : "Для публикации установите и подключите FlowPost Agent.",
      agentState: agent.state,
      agentDevice: null,
      job: null,
    };
  }

  if (agent.state === "busy") {
    return {
      status: "busy" as const,
      message: "Agent уже выполняет задачу. Дождитесь завершения.",
      agentState: agent.state,
      agentDevice: publicAgentDevice(activeDevice),
      job: agent.busyJob,
    };
  }

  const existingJob = await prisma.agentJob.findFirst({
    where: {
      userId,
      type: AgentJobType.PUBLISH_ARTICLE,
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
    return {
      status: "busy" as const,
      message: "Публикация уже отправлена в Agent.",
      agentState: "busy" as const,
      agentDevice: publicAgentDevice(activeDevice),
      job: publicAgentJob(existingJob),
    };
  }

  const body = formatArticleForPlatform(article.canonicalBody, config.slug);
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
        agentDeviceId: activeDevice.id,
        type: AgentJobType.PUBLISH_ARTICLE,
        platform: config.slug,
        payload: {
          articleId: article.id,
          platform: config.slug,
          platformName: config.name,
          editorUrl: config.editorUrl,
          title: article.title,
          body,
          ctaText: article.ctaText,
          ctaUrl: article.ctaUrl,
        },
        status: AgentJobStatus.QUEUED,
      },
    });
  });

  console.log("[agent-service] publish-job:created", {
    userId,
    articleId,
    agentDeviceId: activeDevice.id,
    jobId: job.id,
    type: job.type,
    platform: config.slug,
  });

  return {
    status: "queued" as const,
    message:
      "Задание публикации создано. FlowPost Agent откроет браузер на вашем компьютере.",
    agentState: agent.state,
    agentDevice: publicAgentDevice(activeDevice),
    job: publicAgentJob(job),
  };
}

export async function getNextAgentJob(authorization: string | null) {
  const device = await authenticateAgent(authorization);

  const job = await prisma.agentJob.findFirst({
    where: {
      userId: device.userId,
      status: AgentJobStatus.QUEUED,
      OR: [{ agentDeviceId: device.id }, { agentDeviceId: null }],
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!job) {
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

  if (
    updatedJob.type === AgentJobType.CONNECT_PLATFORM &&
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
              where: {},
              data: { status: VariantStatus.PUBLISHED },
            },
          },
          publications: {
            updateMany: {
              where: {},
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
    }
  }

  if (
    updatedJob.type === AgentJobType.PUBLISH_ARTICLE &&
    updatedJob.status === AgentJobStatus.FAILED
  ) {
    const payload = updatedJob.payload as {
      articleId?: string;
    };

    if (payload.articleId) {
      await prisma.articleAsset.update({
        where: { id: payload.articleId },
        data: {
          variants: {
            updateMany: {
              where: {},
              data: { status: VariantStatus.FAILED },
            },
          },
          publications: {
            updateMany: {
              where: {},
              data: {
                status: PublicationStatus.FAILED,
                lastError: updatedJob.error ?? "Publish failed in Agent.",
              },
            },
          },
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
