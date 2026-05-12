-- llm-feedback-middleware v2.1: captured_evaluated_reactions
--
-- Immutable. Each reaction event (user-driven, framework-fired by Lifecycle
-- Worker, or tombstone) is one row. Per-axis evaluations from Layer 3 are
-- embedded as columns on the same row. See spec §9.1 and §10.

CREATE TABLE IF NOT EXISTS captured_evaluated_reactions (
  event_id                TEXT PRIMARY KEY,
  event_version           INTEGER NOT NULL DEFAULT 2,
  event_position          BIGSERIAL UNIQUE NOT NULL,

  artifact_id             TEXT NOT NULL REFERENCES captured_artifacts(artifact_id),
  artifact_type           TEXT NOT NULL,
  artifact_version        INTEGER NOT NULL,
  partition_key           TEXT NOT NULL,
  producer                TEXT NOT NULL,
  task_type               TEXT NOT NULL,

  source                  TEXT NOT NULL CHECK (source IN ('explicit', 'implicit', 'meta')),
  action                  TEXT NOT NULL,

  occurred_at             TIMESTAMPTZ NOT NULL,
  captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance              JSONB NOT NULL,

  -- Layer 3 embedded evaluation. NULL means "no signal on this axis".
  classifier_version      TEXT NOT NULL,
  detection_polarity      TEXT CHECK (detection_polarity IS NULL OR detection_polarity IN ('positive', 'negative')),
  content_polarity        TEXT CHECK (content_polarity   IS NULL OR content_polarity   IN ('positive', 'negative')),
  timing_polarity         TEXT CHECK (timing_polarity    IS NULL OR timing_polarity    IN ('positive', 'negative')),
  channel_polarity        TEXT CHECK (channel_polarity   IS NULL OR channel_polarity   IN ('positive', 'negative')),

  -- Tombstone references
  correction_of_event_id  TEXT REFERENCES captured_evaluated_reactions(event_id) ON DELETE SET NULL,
  successor_artifact_id   TEXT REFERENCES captured_artifacts(artifact_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reactions_artifact
  ON captured_evaluated_reactions(artifact_id, event_position);

CREATE INDEX IF NOT EXISTS idx_reactions_partition
  ON captured_evaluated_reactions(partition_key, event_position);

CREATE INDEX IF NOT EXISTS idx_reactions_producer
  ON captured_evaluated_reactions(producer, task_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_reactions_action
  ON captured_evaluated_reactions(action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_reactions_captured
  ON captured_evaluated_reactions(captured_at);

-- Per-axis polarity indices for Layer 4 candidate scans.
CREATE INDEX IF NOT EXISTS idx_reactions_content_polarity
  ON captured_evaluated_reactions(content_polarity, occurred_at DESC)
  WHERE content_polarity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reactions_detection_polarity
  ON captured_evaluated_reactions(detection_polarity, occurred_at DESC)
  WHERE detection_polarity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reactions_timing_polarity
  ON captured_evaluated_reactions(timing_polarity, occurred_at DESC)
  WHERE timing_polarity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reactions_channel_polarity
  ON captured_evaluated_reactions(channel_polarity, occurred_at DESC)
  WHERE channel_polarity IS NOT NULL;
