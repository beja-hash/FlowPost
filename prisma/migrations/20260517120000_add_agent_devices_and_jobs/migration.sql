DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentDeviceStatus') THEN
    CREATE TYPE "AgentDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentJobType') THEN
    CREATE TYPE "AgentJobType" AS ENUM ('CONNECT_PLATFORM', 'PUBLISH_ARTICLE');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentJobStatus') THEN
    CREATE TYPE "AgentJobStatus" AS ENUM ('QUEUED', 'PICKED_UP', 'RUNNING', 'WAITING_USER_LOGIN', 'COMPLETED', 'FAILED', 'CANCELLED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "AgentHeartbeat" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" VARCHAR(120) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" VARCHAR(160) NOT NULL DEFAULT 'FlowPost Agent',
  "tokenHash" VARCHAR(128) NOT NULL,
  "status" "AgentDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
  "platform" VARCHAR(80),
  "appVersion" VARCHAR(40),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AgentDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentPairingCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" VARCHAR(128) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentPairingCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agentDeviceId" TEXT,
  "type" "AgentJobType" NOT NULL,
  "platform" VARCHAR(64),
  "payload" JSONB NOT NULL,
  "status" "AgentJobStatus" NOT NULL DEFAULT 'QUEUED',
  "result" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentJobLog" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "level" VARCHAR(24) NOT NULL DEFAULT 'info',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentJobLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentHeartbeat_userId_deviceId_key" ON "AgentHeartbeat"("userId", "deviceId");
CREATE INDEX IF NOT EXISTS "AgentHeartbeat_userId_lastSeenAt_idx" ON "AgentHeartbeat"("userId", "lastSeenAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentDevice_tokenHash_key" ON "AgentDevice"("tokenHash");
CREATE INDEX IF NOT EXISTS "AgentDevice_userId_status_lastSeenAt_idx" ON "AgentDevice"("userId", "status", "lastSeenAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentPairingCode_codeHash_key" ON "AgentPairingCode"("codeHash");
CREATE INDEX IF NOT EXISTS "AgentPairingCode_userId_expiresAt_usedAt_idx" ON "AgentPairingCode"("userId", "expiresAt", "usedAt");
CREATE INDEX IF NOT EXISTS "AgentJob_userId_status_createdAt_idx" ON "AgentJob"("userId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentJob_agentDeviceId_status_createdAt_idx" ON "AgentJob"("agentDeviceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentJob_type_status_createdAt_idx" ON "AgentJob"("type", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentJobLog_jobId_createdAt_idx" ON "AgentJobLog"("jobId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentHeartbeat_userId_fkey') THEN
    ALTER TABLE "AgentHeartbeat" ADD CONSTRAINT "AgentHeartbeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentDevice_userId_fkey') THEN
    ALTER TABLE "AgentDevice" ADD CONSTRAINT "AgentDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentPairingCode_userId_fkey') THEN
    ALTER TABLE "AgentPairingCode" ADD CONSTRAINT "AgentPairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentJob_userId_fkey') THEN
    ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentJob_agentDeviceId_fkey') THEN
    ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_agentDeviceId_fkey" FOREIGN KEY ("agentDeviceId") REFERENCES "AgentDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentJobLog_jobId_fkey') THEN
    ALTER TABLE "AgentJobLog" ADD CONSTRAINT "AgentJobLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AgentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
