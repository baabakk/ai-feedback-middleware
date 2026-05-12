-- llm-feedback-middleware v2.1: event_dedupe
--
-- Idempotency key store. Used by the idempotency middleware to suppress
-- duplicate deliveries to a subscriber. See spec §9.3.

CREATE TABLE IF NOT EXISTS event_dedupe (
  idempotency_key   TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_dedupe_expires_at
  ON event_dedupe(expires_at);
