-- 009_email_delivery.sql
-- Delivery tracking for email campaigns so a campaign is no longer just "queued":
-- it records how many recipients were actually delivered, how many failed, and
-- the resulting delivery state. Additive only.

ALTER TABLE platform_campaigns ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'queued'
  CHECK (delivery_state IN ('queued','sending','sent','partial','failed','skipped'));
ALTER TABLE platform_campaigns ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_campaigns ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_campaigns ADD COLUMN last_error TEXT;
ALTER TABLE platform_campaigns ADD COLUMN delivered_at TEXT;

UPDATE platform_campaigns SET delivery_state = COALESCE(status, 'queued');
UPDATE platform_campaigns SET delivery_state = 'sent' WHERE status = 'sent';
UPDATE platform_campaigns SET delivery_state = 'failed' WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS platform_campaigns_delivery_idx
  ON platform_campaigns(user_id, delivery_state, created_at DESC);
