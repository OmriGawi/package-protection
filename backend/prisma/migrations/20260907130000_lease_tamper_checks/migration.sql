-- AlterTable
ALTER TABLE "TamperCheck" ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "leaseExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "recoveryAttempts" INTEGER NOT NULL DEFAULT 0;

-- A check already in flight when this deploys has no lease, and the sweep that
-- replaces the old boot-time recovery only sees expired ones — NULL is not
-- less-than anything in SQL. Backfilled to its own request time, which is
-- already in the past, so those rows are reclaimable immediately rather than
-- invisible forever.
UPDATE "TamperCheck" SET "leaseExpiresAt" = "requestedAt" WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "TamperCheck_status_leaseExpiresAt_idx" ON "TamperCheck"("status", "leaseExpiresAt");
