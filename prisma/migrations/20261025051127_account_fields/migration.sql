-- AlterTable
ALTER TABLE "PasswordResetCode" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'RESET_PASSWORD';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordSetAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT;

-- Las cuentas existentes se crearon con contraseña propia.
UPDATE "User" SET "passwordSetAt" = "createdAt" WHERE "passwordSetAt" IS NULL;
