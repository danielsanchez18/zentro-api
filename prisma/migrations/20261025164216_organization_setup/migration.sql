-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "setupCompletedAt" TIMESTAMP(3),
ADD COLUMN     "setupSkippedAt" TIMESTAMP(3);
