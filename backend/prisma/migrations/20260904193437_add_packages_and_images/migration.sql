-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PRE_SHIP_UPLOADED', 'SHIPPED', 'CHECKING', 'RECEIVED', 'CHECK_FAILED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('INTACT', 'OPENED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "VerdictSource" AS ENUM ('API', 'MANUAL');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('PRE_SHIP', 'POST_RECEIVE');

-- AlterTable
ALTER TABLE "Delivery" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "label" INTEGER NOT NULL,
    "workflowStatus" "WorkflowStatus" NOT NULL DEFAULT 'SHIPPED',
    "verdict" "Verdict",
    "verdictSource" "VerdictSource",
    "verdictOverriddenBy" TEXT,
    "overriddenAt" TIMESTAMPTZ(3),
    "overrideNote" TEXT,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageImage" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "PackageImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Package_deliveryId_label_key" ON "Package"("deliveryId", "label");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageImage" ADD CONSTRAINT "PackageImage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
