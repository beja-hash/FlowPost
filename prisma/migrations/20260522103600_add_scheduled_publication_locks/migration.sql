ALTER TYPE "PublicationStatus" ADD VALUE IF NOT EXISTS 'PUBLISHING';
ALTER TYPE "AgentJobType" ADD VALUE IF NOT EXISTS 'SCHEDULED_PUBLISH';

ALTER TABLE "Publication"
  ADD COLUMN IF NOT EXISTS "processingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Publication_status_scheduledAt_lockedAt_idx"
  ON "Publication"("status", "scheduledAt", "lockedAt");
