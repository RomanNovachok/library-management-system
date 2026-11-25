BEGIN;

CREATE TYPE "CopyCondition" AS ENUM ('GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'LOST', 'UNKNOWN');

ALTER TABLE "BookCopy"
  ADD COLUMN "condition" "CopyCondition" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "conditionNotes" TEXT;

-- An existing LOST status identifies the loss. Other statuses cannot reconstruct physical condition.
UPDATE "BookCopy" SET "condition" = 'LOST' WHERE "status" = 'LOST';

ALTER TABLE "BookCopy"
  ALTER COLUMN "condition" SET DEFAULT 'GOOD',
  ADD CONSTRAINT "BookCopy_condition_status_check" CHECK (
    ("condition" = 'LOST') = ("status" = 'LOST')
    AND ("condition" <> 'MAJOR_DAMAGE' OR "status" = 'MAINTENANCE')
  ),
  ADD CONSTRAINT "BookCopy_condition_notes_check" CHECK (
    ("conditionNotes" IS NULL OR "conditionNotes" ~ '[^[:space:]]')
    AND CASE
      WHEN "condition" IN ('GOOD', 'UNKNOWN') THEN "conditionNotes" IS NULL
      WHEN "condition" IN ('MINOR_DAMAGE', 'MAJOR_DAMAGE') THEN "conditionNotes" IS NOT NULL
      ELSE TRUE
    END
  );

-- Missing historical assessments remain NULL, including for rentals already closed.
ALTER TABLE "Rental"
  ADD COLUMN "conditionAtIssue" "CopyCondition",
  ADD COLUMN "conditionNotesAtIssue" TEXT,
  ADD COLUMN "conditionAtReturn" "CopyCondition",
  ADD COLUMN "conditionNotesAtReturn" TEXT,
  ADD COLUMN "newDamageNotes" TEXT,
  ADD CONSTRAINT "Rental_issue_condition_check" CHECK (
    CASE
      WHEN "conditionAtIssue" IS NULL OR "conditionAtIssue" = 'GOOD' THEN "conditionNotesAtIssue" IS NULL
      WHEN "conditionAtIssue" = 'MINOR_DAMAGE' THEN COALESCE("conditionNotesAtIssue" ~ '[^[:space:]]', FALSE)
      ELSE FALSE
    END
  ),
  ADD CONSTRAINT "Rental_return_condition_check" CHECK (
    CASE
      WHEN "conditionAtReturn" IS NULL THEN
        "conditionNotesAtReturn" IS NULL AND "newDamageNotes" IS NULL
        AND ("status" = 'ACTIVE' OR "conditionAtIssue" IS NULL)
      WHEN "status" = 'ACTIVE' OR "damageRuleId" IS NULL THEN FALSE
      WHEN "conditionAtReturn" = 'GOOD' THEN
        "status" = 'RETURNED' AND "conditionNotesAtReturn" IS NULL AND "newDamageNotes" IS NULL
      WHEN "conditionAtReturn" IN ('MINOR_DAMAGE', 'MAJOR_DAMAGE') THEN
        "status" = 'RETURNED' AND COALESCE("conditionNotesAtReturn" ~ '[^[:space:]]', FALSE)
        AND ("newDamageNotes" IS NULL OR "newDamageNotes" ~ '[^[:space:]]')
      WHEN "conditionAtReturn" = 'LOST' THEN
        "status" = 'LOST' AND "newDamageNotes" IS NULL
        AND ("conditionNotesAtReturn" IS NULL OR "conditionNotesAtReturn" ~ '[^[:space:]]')
      ELSE FALSE
    END
  );

COMMIT;
