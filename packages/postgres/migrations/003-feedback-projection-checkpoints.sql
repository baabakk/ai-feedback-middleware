-- llm-feedback-middleware: per-projection checkpoint
--
-- Tracks the last event_id that each projection has processed. Used for
-- rebuild bookkeeping and for catch-up after downtime. Async projection
-- workers update this as they consume the bus or replay the log.

CREATE TABLE IF NOT EXISTS feedback_projection_checkpoints (
  projection_name   TEXT PRIMARY KEY,
  last_event_id     TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
