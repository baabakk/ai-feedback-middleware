-- llm-feedback-middleware v2.1: feedback_outbox
--
-- Per-event publish queue with retry state. Inserted in the same
-- transaction as the event log append, so an outbox row exists if and only
-- if the event is durable. See spec §9.2.

CREATE TABLE IF NOT EXISTS feedback_outbox (
  event_id          TEXT PRIMARY KEY,
  artifact_id       TEXT NOT NULL,
  topics            TEXT[] NOT NULL,
  event             JSONB NOT NULL,
  enqueued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at      TIMESTAMPTZ,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_outbox_unpublished
  ON feedback_outbox(next_attempt_at)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_outbox_artifact
  ON feedback_outbox(artifact_id, enqueued_at);
