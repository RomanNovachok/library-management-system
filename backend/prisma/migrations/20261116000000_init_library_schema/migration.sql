-- Apply the initial schema atomically, including the custom CHECK constraints.
BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'LIBRARIAN');

-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST');

-- CreateEnum
CREATE TYPE "DamageOutcome" AS ENUM ('AVAILABLE', 'MAINTENANCE', 'LOST');

-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('ACTIVE', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('DEPOSIT_IN', 'REFUND_OUT', 'TOPUP_IN');

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'LIBRARIAN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReaderCategory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ReaderCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reader" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fullName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "Reader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "dailyPrice" DECIMAL(12,2) NOT NULL,
    "depositAmount" DECIMAL(12,2) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookCopy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookId" UUID NOT NULL,
    "inventoryCode" TEXT NOT NULL,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "BookCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "penaltyPercent" DECIMAL(5,2) NOT NULL,
    "outcome" "DamageOutcome" NOT NULL,

    CONSTRAINT "DamageRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rental" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "readerId" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "issuedById" UUID NOT NULL,
    "closedById" UUID,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "status" "RentalStatus" NOT NULL DEFAULT 'ACTIVE',
    "pricePerDaySnapshot" DECIMAL(12,2) NOT NULL,
    "depositSnapshot" DECIMAL(12,2) NOT NULL,
    "discountPercentSnapshot" DECIMAL(5,2) NOT NULL,
    "readerCategorySnapshot" TEXT NOT NULL,
    "rentalFee" DECIMAL(12,2),
    "damageFine" DECIMAL(12,2),
    "damagePercentSnapshot" DECIMAL(5,2),
    "refundAmount" DECIMAL(12,2),
    "additionalPayment" DECIMAL(12,2),
    "damageRuleId" UUID,

    CONSTRAINT "Rental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rentalId" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID NOT NULL,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ReaderCategory_name_key" ON "ReaderCategory"("name");

-- CreateIndex
CREATE INDEX "Reader_categoryId_idx" ON "Reader"("categoryId");

-- CreateIndex
CREATE INDEX "Reader_fullName_idx" ON "Reader"("fullName");

-- CreateIndex
CREATE INDEX "Book_title_idx" ON "Book"("title");

-- CreateIndex
CREATE INDEX "Book_author_idx" ON "Book"("author");

-- CreateIndex
CREATE INDEX "Book_genre_idx" ON "Book"("genre");

-- CreateIndex
CREATE UNIQUE INDEX "BookCopy_inventoryCode_key" ON "BookCopy"("inventoryCode");

-- CreateIndex
CREATE INDEX "BookCopy_bookId_status_idx" ON "BookCopy"("bookId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DamageRule_code_key" ON "DamageRule"("code");

-- CreateIndex
CREATE INDEX "Rental_readerId_issuedAt_idx" ON "Rental"("readerId", "issuedAt");

-- CreateIndex
CREATE INDEX "Rental_copyId_issuedAt_idx" ON "Rental"("copyId", "issuedAt");

-- CreateIndex
CREATE INDEX "Rental_issuedById_idx" ON "Rental"("issuedById");

-- CreateIndex
CREATE INDEX "Rental_closedById_idx" ON "Rental"("closedById");

-- CreateIndex
CREATE INDEX "Rental_damageRuleId_idx" ON "Rental"("damageRuleId");

-- CreateIndex
CREATE INDEX "Rental_status_dueAt_idx" ON "Rental"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Rental_closedAt_idx" ON "Rental"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rental_one_active_copy_key" ON "Rental"("copyId") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE INDEX "CashMovement_rentalId_idx" ON "CashMovement"("rentalId");

-- CreateIndex
CREATE INDEX "CashMovement_recordedById_idx" ON "CashMovement"("recordedById");

-- CreateIndex
CREATE INDEX "CashMovement_createdAt_type_idx" ON "CashMovement"("createdAt", "type");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Reader" ADD CONSTRAINT "Reader_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ReaderCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookCopy" ADD CONSTRAINT "BookCopy_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "Reader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "BookCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_damageRuleId_fkey" FOREIGN KEY ("damageRuleId") REFERENCES "DamageRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "Rental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma Schema does not currently represent PostgreSQL CHECK constraints.
-- Exclude numeric NaN as well as negative monetary values.
ALTER TABLE "Book"
  ADD CONSTRAINT "Book_dailyPrice_check" CHECK ("dailyPrice" >= 0 AND "dailyPrice" <> 'NaN'::numeric),
  ADD CONSTRAINT "Book_depositAmount_check" CHECK ("depositAmount" >= 0 AND "depositAmount" <> 'NaN'::numeric);

ALTER TABLE "ReaderCategory"
  ADD CONSTRAINT "ReaderCategory_discountPercent_check" CHECK ("discountPercent" BETWEEN 0 AND 100);

ALTER TABLE "DamageRule"
  ADD CONSTRAINT "DamageRule_penaltyPercent_check" CHECK ("penaltyPercent" BETWEEN 0 AND 100);

ALTER TABLE "Rental"
  ADD CONSTRAINT "Rental_pricePerDaySnapshot_check" CHECK ("pricePerDaySnapshot" >= 0 AND "pricePerDaySnapshot" <> 'NaN'::numeric),
  ADD CONSTRAINT "Rental_depositSnapshot_check" CHECK ("depositSnapshot" >= 0 AND "depositSnapshot" <> 'NaN'::numeric),
  ADD CONSTRAINT "Rental_discountPercentSnapshot_check" CHECK ("discountPercentSnapshot" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Rental_rentalFee_check" CHECK ("rentalFee" >= 0 AND "rentalFee" <> 'NaN'::numeric),
  ADD CONSTRAINT "Rental_damageFine_check" CHECK ("damageFine" >= 0 AND "damageFine" <> 'NaN'::numeric),
  ADD CONSTRAINT "Rental_damagePercentSnapshot_check" CHECK ("damagePercentSnapshot" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Rental_refundAmount_check" CHECK ("refundAmount" >= 0 AND "refundAmount" <> 'NaN'::numeric),
  ADD CONSTRAINT "Rental_additionalPayment_check" CHECK ("additionalPayment" >= 0 AND "additionalPayment" <> 'NaN'::numeric),
  ADD CONSTRAINT "Rental_dueAt_check" CHECK ("dueAt" > "issuedAt"),
  ADD CONSTRAINT "Rental_closedAt_check" CHECK ("closedAt" IS NULL OR "closedAt" >= "issuedAt"),
  ADD CONSTRAINT "Rental_closure_check" CHECK (
    (
      "status" = 'ACTIVE' AND "closedAt" IS NULL AND "closedById" IS NULL
      AND "rentalFee" IS NULL AND "damageFine" IS NULL AND "damagePercentSnapshot" IS NULL
      AND "refundAmount" IS NULL AND "additionalPayment" IS NULL AND "damageRuleId" IS NULL
    ) OR (
      "status" IN ('RETURNED', 'LOST') AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL
      AND "rentalFee" IS NOT NULL AND "damageFine" IS NOT NULL AND "damagePercentSnapshot" IS NOT NULL
      AND "refundAmount" IS NOT NULL AND "additionalPayment" IS NOT NULL
    )
  );

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_amount_check" CHECK ("amount" >= 0 AND "amount" <> 'NaN'::numeric);

COMMIT;
