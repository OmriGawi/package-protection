-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PENDING', 'COMPLETE', 'ERROR');

-- CreateTable
CREATE TABLE "TamperCheck" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "verdict" "Verdict",
    "confidenceScore" DOUBLE PRECISION,
    "rawResponse" JSONB,
    "status" "CheckStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TamperCheck_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TamperCheck" ADD CONSTRAINT "TamperCheck_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
