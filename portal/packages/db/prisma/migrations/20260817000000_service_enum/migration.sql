-- CreateEnum
CREATE TYPE "Service" AS ENUM ('google', 'monday', 'hubspot');

-- AlterTable
ALTER TABLE "oauth_tokens" ADD COLUMN "service" "Service";

UPDATE "oauth_tokens" AS tokens
SET "service" = services."slug"::"Service"
FROM "services" AS services
WHERE tokens."service_id" = services."id"
  AND services."slug" IN ('google', 'monday', 'hubspot');

DELETE FROM "oauth_tokens" WHERE "service" IS NULL;

ALTER TABLE "oauth_tokens" ALTER COLUMN "service" SET NOT NULL;

ALTER TABLE "oauth_tokens" DROP CONSTRAINT "oauth_tokens_service_id_fkey";

DROP INDEX "oauth_tokens_user_id_service_id_key";

ALTER TABLE "oauth_tokens" DROP COLUMN "service_id";

CREATE UNIQUE INDEX "oauth_tokens_user_id_service_key" ON "oauth_tokens"("user_id", "service");

-- DropTable
DROP TABLE "services";
