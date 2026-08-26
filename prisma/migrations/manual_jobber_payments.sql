-- Migrates the database from Stripe-based payments to Jobber Payments.
--
-- Run against the target database once, then verify with `npx prisma db pull`.
-- The two enum rewrites below fail if any existing row still holds a removed
-- value, so old values are remapped before the type is swapped.
--
--   psql "$DATABASE_URL" -f prisma/migrations/manual_jobber_payments.sql

BEGIN;

-- Any Stripe intent that was still awaiting card action is now simply unpaid.
UPDATE "payments" SET "status" = 'PROCESSING' WHERE "status" = 'REQUIRES_ACTION';

-- Historic Stripe webhook audit rows have no meaning under the new flow.
DELETE FROM "webhook_events" WHERE "source" = 'STRIPE';

CREATE TYPE "PaymentMethod" AS ENUM ('JOBBER_ONLINE', 'CASH', 'CHECK', 'OTHER');

CREATE TYPE "PaymentStatus_new" AS ENUM ('AWAITING_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payments" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'AWAITING_PAYMENT';

CREATE TYPE "WebhookSource_new" AS ENUM ('JOBBER');
ALTER TABLE "webhook_events" ALTER COLUMN "source" TYPE "WebhookSource_new" USING ("source"::text::"WebhookSource_new");
ALTER TYPE "WebhookSource" RENAME TO "WebhookSource_old";
ALTER TYPE "WebhookSource_new" RENAME TO "WebhookSource";
DROP TYPE "WebhookSource_old";

DROP INDEX IF EXISTS "customers_stripe_customer_id_key";
DROP INDEX IF EXISTS "payments_stripe_payment_intent_id_key";

ALTER TABLE "bookings"
  DROP COLUMN IF EXISTS "stripe_payment_method_id",
  ADD COLUMN "deposit_invoice_id" TEXT,
  ADD COLUMN "deposit_invoice_url" TEXT,
  ADD COLUMN "balance_invoice_id" TEXT,
  ADD COLUMN "balance_invoice_url" TEXT;

ALTER TABLE "customers" DROP COLUMN IF EXISTS "stripe_customer_id";

ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "retry_count",
  DROP COLUMN IF EXISTS "stripe_charge_id",
  DROP COLUMN IF EXISTS "stripe_payment_intent_id",
  DROP COLUMN IF EXISTS "stripe_refund_id",
  ADD COLUMN "jobber_invoice_id" TEXT,
  ADD COLUMN "jobber_invoice_number" TEXT,
  ADD COLUMN "jobber_payment_id" TEXT,
  ADD COLUMN "client_hub_uri" TEXT,
  ADD COLUMN "method" "PaymentMethod" NOT NULL DEFAULT 'JOBBER_ONLINE';

CREATE UNIQUE INDEX "bookings_deposit_invoice_id_key" ON "bookings"("deposit_invoice_id");
CREATE UNIQUE INDEX "bookings_balance_invoice_id_key" ON "bookings"("balance_invoice_id");
CREATE UNIQUE INDEX "payments_jobber_invoice_id_key" ON "payments"("jobber_invoice_id");

COMMIT;
