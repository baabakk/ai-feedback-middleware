-- llm-feedback-middleware v2.1: projections
--
-- Per-projection state, keyed by (projection_name, key). State is JSONB so
-- consumers may store any shape their builder produces. See spec §13.

CREATE TABLE IF NOT EXISTS feedback_projections (
  projection_name   TEXT NOT NULL,
  key               TEXT NOT NULL,
  state             JSONB NOT NULL,
  last_event_id     TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (projection_name, key)
);

CREATE INDEX IF NOT EXISTS idx_feedback_projections_updated
  ON feedback_projections(projection_name, updated_at DESC);

-- Per-projection checkpoint cursor used by rebuilds and async subscribers.
CREATE TABLE IF NOT EXISTS feedback_projection_checkpoints (
  projection_name   TEXT PRIMARY KEY,
  last_event_id     TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
