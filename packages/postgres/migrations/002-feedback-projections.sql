-- llm-feedback-middleware: generic projection state
--
-- One table holds state for all projections, keyed by (projection_name, key).
-- Each row records the event_id of the most recent event that produced the
-- current state, supporting incremental rebuild and audit trails.

CREATE TABLE IF NOT EXISTS feedback_projections (
  projection_name   TEXT NOT NULL,
  key               TEXT NOT NULL,
  state             JSONB NOT NULL,
  last_event_id     TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (projection_name, key)
);

CREATE INDEX IF NOT EXISTS idx_feedback_projections_name
  ON feedback_projections(projection_name);

CREATE INDEX IF NOT EXISTS idx_feedback_projections_updated
  ON feedback_projections(projection_name, updated_at DESC);
