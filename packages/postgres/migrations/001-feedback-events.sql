-- llm-feedback-middleware: event log
-- This is the source of truth. Append-only. Never UPDATE, never DELETE
-- (except for the optional retention scrub of old payloads, which NULLs
-- out PII fields but preserves event metadata).

CREATE TABLE IF NOT EXISTS feedback_events (
  event_id          TEXT PRIMARY KEY,
  event_version     INTEGER NOT NULL DEFAULT 1,
  event_position    BIGSERIAL UNIQUE NOT NULL,

  timestamp         TIMESTAMPTZ NOT NULL,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  partition_key     TEXT NOT NULL,

  source            TEXT NOT NULL CHECK (source IN ('explicit', 'implicit')),
  polarity          TEXT NOT NULL CHECK (polarity IN ('positive', 'negative', 'neutral')),
  inference         TEXT NOT NULL CHECK (inference IN ('whitelist', 'blacklist', 'observe')),
  action            TEXT NOT NULL,

  artifact_type     TEXT NOT NULL,
  artifact_id       TEXT NOT NULL,
  artifact_version  INTEGER NOT NULL,
  producer          TEXT NOT NULL,
  task_type         TEXT NOT NULL,

  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance        JSONB NOT NULL,

  -- Linkage. ON DELETE SET NULL so retention scrubbing of an original event
  -- never blocks because of correction references. Corrections themselves
  -- are events; this column is informational metadata.
  correction_of     TEXT REFERENCES feedback_events(event_id) ON DELETE SET NULL,
  correlates_with   TEXT[] DEFAULT ARRAY[]::TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_partition
  ON feedback_events(partition_key, event_position);

CREATE INDEX IF NOT EXISTS idx_feedback_events_producer
  ON feedback_events(producer, task_type, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_events_inference
  ON feedback_events(inference, polarity, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_events_captured
  ON feedback_events(captured_at);

CREATE INDEX IF NOT EXISTS idx_feedback_events_action
  ON feedback_events(action, timestamp DESC);
