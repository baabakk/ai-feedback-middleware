-- llm-feedback-middleware v2.1: captured_artifacts
--
-- Immutable registry of governed artifacts. Each `captureArtifact()` call
-- inserts exactly one row. No UPDATE, no DELETE (except for retention
-- scrubbing of old payloads, which NULLs out PII fields but preserves
-- metadata). See spec §9.1.

CREATE TABLE IF NOT EXISTS captured_artifacts (
  artifact_id           TEXT PRIMARY KEY,
  artifact_type         TEXT NOT NULL,
  artifact_version      INTEGER NOT NULL,
  partition_key         TEXT NOT NULL,
  producer              TEXT NOT NULL,
  task_type             TEXT NOT NULL,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance            JSONB NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL,
  captured_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_id              TEXT NOT NULL UNIQUE,
  event_version         INTEGER NOT NULL DEFAULT 2,
  event_position        BIGSERIAL UNIQUE NOT NULL,
  previous_artifact_id  TEXT REFERENCES captured_artifacts(artifact_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_captured_artifacts_partition
  ON captured_artifacts(partition_key, event_position);

CREATE INDEX IF NOT EXISTS idx_captured_artifacts_type
  ON captured_artifacts(artifact_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_captured_artifacts_producer
  ON captured_artifacts(producer, task_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_captured_artifacts_captured
  ON captured_artifacts(captured_at);
