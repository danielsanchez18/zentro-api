-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "roleId" TEXT;

-- CreateIndex
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
