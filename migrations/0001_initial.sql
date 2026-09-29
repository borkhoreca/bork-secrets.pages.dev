CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  kv_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','consumed','expired','revoked','failed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_ip_hash TEXT,
  consumed_user_agent TEXT,
  sender_id TEXT,
  sender_name TEXT,
  sender_email TEXT,
  sender_role TEXT,
  recipient_email TEXT NOT NULL,
  customer_id TEXT,
  customer_name TEXT,
  secret_name TEXT NOT NULL,
  source_app TEXT NOT NULL DEFAULT 'support-hub',
  ttl_seconds INTEGER NOT NULL,
  email_message_id TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending','sent','failed','skipped')),
  create_request_id TEXT
);

CREATE INDEX idx_shares_status_expires ON shares (status, expires_at);

-- Append-only, no automatic retention. Metadata only: never secrets, tokens or keys.
CREATE TABLE permanent_secret_share_logs (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  share_id TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  sender_email TEXT,
  sender_role TEXT,
  recipient_email TEXT NOT NULL,
  customer_id TEXT,
  customer_name TEXT,
  secret_name TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT
);

CREATE INDEX idx_logs_at ON permanent_secret_share_logs (at DESC, id DESC);
CREATE INDEX idx_logs_recipient ON permanent_secret_share_logs (recipient_email);
CREATE INDEX idx_logs_customer ON permanent_secret_share_logs (customer_id);
CREATE INDEX idx_logs_sender ON permanent_secret_share_logs (sender_email);
CREATE INDEX idx_logs_share ON permanent_secret_share_logs (share_id);

CREATE TRIGGER permanent_logs_no_update BEFORE UPDATE ON permanent_secret_share_logs
BEGIN SELECT RAISE(ABORT, 'permanent_secret_share_logs is append-only'); END;

CREATE TRIGGER permanent_logs_no_delete BEFORE DELETE ON permanent_secret_share_logs
BEGIN SELECT RAISE(ABORT, 'permanent_secret_share_logs is append-only'); END;

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  response_json TEXT NOT NULL
);
