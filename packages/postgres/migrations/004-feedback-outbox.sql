-- llm-feedback-middleware: transactional outbox
--
-- Inserted in the same transaction as the event log append. A scanner
-- periodically picks up rows where published_at IS NULL AND
-- next_attempt_at <= NOW(), publishes them through the bus, and marks
-- them published. On failure, attempt_count is incremented and
-- next_attempt_at is rescheduled with backoff.
--
-- The full event payload is denormalized here so the scanner does not
-- need to JOIN against feedback_events for every publish.

CREATE TABLE IF NOT EXISTS feedback_outbox (
  event_id          TEXT PRIMARY KEY REFERENCES feedback_events(event_id) ON DELETE CASCADE,
  topics            TEXT[] NOT NULL,
  event             JSONB NOT NULL,
  enqueued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at      TIMESTAMPTZ,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON feedback_outbox(next_attempt_at)
  WHERE published_at IS NULL;
