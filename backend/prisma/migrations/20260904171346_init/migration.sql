-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('EXPORT', 'IMPORT');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SUBMITTED');

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "internalNumber" SERIAL NOT NULL,
    "direction" "Direction" NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_internalNumber_key" ON "Delivery"("internalNumber");
