-- CreateIndex
CREATE INDEX "Package_workflowStatus_idx" ON "Package"("workflowStatus");

-- CreateIndex
CREATE INDEX "Package_verdict_workflowStatus_idx" ON "Package"("verdict", "workflowStatus");

-- CreateIndex
CREATE INDEX "PackageImage_packageId_sequence_idx" ON "PackageImage"("packageId", "sequence");

-- CreateIndex
CREATE INDEX "TamperCheck_packageId_idx" ON "TamperCheck"("packageId");

-- CreateIndex
CREATE INDEX "TamperCheck_status_idx" ON "TamperCheck"("status");
