CREATE TABLE "StaffSession" (
    "tokenHash" CHAR(64) NOT NULL,
    "staffUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("tokenHash"),
    CONSTRAINT "StaffSession_staffUserId_fkey" FOREIGN KEY ("staffUserId")
        REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StaffSession_staffUserId_idx" ON "StaffSession"("staffUserId");
CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");
