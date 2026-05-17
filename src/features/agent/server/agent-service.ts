import { createHash, randomBytes } from "node:crypto";

import {
  AgentJobStatus,
  AgentJobType,
  AgentSessionStatus,
  PlatformAccountStatus,
  type AgentJob,
} from "@prisma/client";

import { prisma } from "@/infrastructure/db/prisma";
import {
  getPlatformConfig,
  type PlatformSlug,
} from "@/infrastructure/platforms/platform-registry";

const TOKEN_PREFIX = "fp_agent_";

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

export async function createAgentSession(userId: string, name?: string) {
  const token = createAgentToken();
  const session = await prisma.agentSession.create({
    data: {
      userId,
      tokenHash: hashAgentToken(token),
      name: name?.trim() || "FlowPost Local Agent",
    },
  });

  return {
    session: {
      id: session.id,
      name: session.name,
      status: session.status.toLowerCase(),
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
    },
    token,
  };
}

export async function authenticateAgent(authorization: string | null) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new AgentServiceError(
      401,
      "AGENT_TOKEN_REQUIRED",
      "Передайте FLOWPOST_AGENT_TOKEN в Bearer token.",
    );
  }

  const session = await prisma.agentSession.findUnique({
    where: {
      tokenHash: hashAgentToken(token),
    },
  });

  if (!session || session.status !== AgentSessionStatus.ACTIVE) {
    throw new AgentServiceError(
      401,
      "INVALID_AGENT_TOKEN",
      "Agent token недействителен или отозван.",
    );
  }

  await prisma.agentSession.update({
    where: {
      id: session.id,
    },
    data: {
      lastSeenAt: new Date(),
    },
  });

  return session;
}

export async function createConnectPlatformJob({
  userId,
  platform,
  sessionName,
}: {
  userId: string;
  platform: PlatformSlug;
  sessionName?: string;
}) {
  const config = getPlatformConfig(platform);

  if (!config) {
    throw new AgentServiceError(
      400,
      "INVALID_PLATFORM",
      "Эта площадка не поддерживается.",
    );
  }

  const { session, token } = await createAgentSession(userId, sessionName);
  const job = await prisma.agentJob.create({
    data: {
      userId,
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

  return {
    session,
    token,
    job: publicAgentJob(job),
  };
}

export async function getNextAgentJob(authorization: string | null) {
  const session = await authenticateAgent(authorization);

  const job = await prisma.agentJob.findFirst({
    where: {
      userId: session.userId,
      status: AgentJobStatus.QUEUED,
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
      sessionId: session.id,
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
  const session = await authenticateAgent(authorization);

  const job = await prisma.agentJob.findFirst({
    where: {
      id: jobId,
      userId: session.userId,
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
      sessionId: job.sessionId ?? session.id,
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
        sessionPath: `local-agent:${session.id}:${updatedJob.platform}`,
      },
      update: {
        status: PlatformAccountStatus.CONNECTED,
        sessionPath: `local-agent:${session.id}:${updatedJob.platform}`,
      },
    });
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
  const session = await authenticateAgent(authorization);
  const job = await prisma.agentJob.findFirst({
    where: {
      id: jobId,
      userId: session.userId,
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
