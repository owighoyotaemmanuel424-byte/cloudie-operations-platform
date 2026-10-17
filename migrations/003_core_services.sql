-- Cloudie Neon migration phase 3: core service records and commerce.
-- Additive schema only; test in a disposable branch before production.
BEGIN;
CREATE TABLE IF NOT EXISTS service_subscriptions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 service_key TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('active','paused','cancelled','provisioning')),
 resource_id TEXT, resource_label TEXT, plan_label TEXT, usage_label TEXT,
 renewal_at TIMESTAMPTZ, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS service_subscriptions_user_updated_idx ON service_subscriptions(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS service_subscriptions_user_status_idx ON service_subscriptions(user_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS shipments (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 tracking_number TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK (status IN ('pending','picked_up','in_transit','out_for_delivery','delivered','failed','cancelled')),
 sender_name TEXT NOT NULL, sender_phone TEXT NOT NULL, sender_email TEXT NOT NULL,
 sender_address TEXT NOT NULL, sender_city TEXT NOT NULL, sender_state TEXT NOT NULL,
 sender_country TEXT NOT NULL, sender_postal_code TEXT NOT NULL,
 recipient_name TEXT NOT NULL, recipient_phone TEXT NOT NULL, recipient_email TEXT NOT NULL,
 recipient_address TEXT NOT NULL, recipient_city TEXT NOT NULL, recipient_state TEXT NOT NULL,
 recipient_country TEXT NOT NULL, recipient_postal_code TEXT NOT NULL,
 package_description TEXT NOT NULL, weight NUMERIC(12,3) NOT NULL CHECK (weight > 0),
 dimensions TEXT, service_type TEXT NOT NULL, estimated_delivery TIMESTAMPTZ,
 notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shipments_user_created_idx ON shipments(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS shipments_status_created_idx ON shipments(status,created_at DESC);

CREATE TABLE IF NOT EXISTS shipment_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
 status TEXT NOT NULL, location TEXT, description TEXT NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shipment_events_shipment_time_idx ON shipment_events(shipment_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS user_documents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 document_type TEXT NOT NULL CHECK (document_type IN ('flight','hotel','invoice','customs')),
 title TEXT NOT NULL, data JSONB NOT NULL, points_cost NUMERIC(20,2) NOT NULL DEFAULT 0,
 price_ngn NUMERIC(20,2), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_documents_user_created_idx ON user_documents(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS kyc_records (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenant_sites(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 status TEXT NOT NULL CHECK (status IN ('submitted','under_review','approved','rejected','resubmission_required')),
 full_name TEXT NOT NULL, date_of_birth DATE, document_storage_key TEXT, document_name TEXT,
 resubmission_count INTEGER NOT NULL DEFAULT 0 CHECK (resubmission_count >= 0),
 rejection_reason TEXT, notes TEXT, reviewed_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
 reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kyc_tenant_created_idx ON kyc_records(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_user_created_idx ON kyc_records(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_status_created_idx ON kyc_records(status,created_at DESC);

CREATE TABLE IF NOT EXISTS storage_files (
 id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL, original_name TEXT NOT NULL,
 mime_type TEXT, size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
 visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','tenant','public')),
 tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(storage_provider,storage_key)
);
CREATE INDEX IF NOT EXISTS storage_files_owner_created_idx ON storage_files(owner_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_products (
 id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
 sku TEXT, name TEXT NOT NULL, description TEXT, category TEXT NOT NULL,
 provider TEXT, provider_product_id TEXT, price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
 currency CHAR(3) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id,sku)
);
CREATE INDEX IF NOT EXISTS catalog_products_active_category_idx ON catalog_products(is_active,category);
CREATE INDEX IF NOT EXISTS catalog_products_tenant_updated_idx ON catalog_products(tenant_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS commerce_orders (
 id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 status TEXT NOT NULL CHECK (status IN ('pending','paid','escrow','completed','refunded','disputed','cancelled')),
 currency CHAR(3) NOT NULL, subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
 fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
 total_minor BIGINT NOT NULL CHECK (total_minor = subtotal_minor + fee_minor),
 idempotency_key TEXT UNIQUE, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commerce_orders_user_created_idx ON commerce_orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_orders_tenant_status_idx ON commerce_orders(tenant_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_order_items (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
 product_id TEXT REFERENCES catalog_products(id) ON DELETE RESTRICT,
 product_name_snapshot TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0),
 unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
 line_total_minor BIGINT NOT NULL CHECK (line_total_minor = quantity * unit_price_minor),
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS commerce_order_items_order_idx ON commerce_order_items(order_id);

CREATE TABLE IF NOT EXISTS user_notifications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 tenant_id TEXT REFERENCES tenant_sites(id) ON DELETE RESTRICT,
 category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 read_at TIMESTAMPTZ, action_url TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON user_notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON user_notifications(user_id,created_at DESC) WHERE read_at IS NULL;

COMMIT;