-- llm-feedback-middleware v2.1: actionability_decisions
--
-- Layer 4 outputs. One row per (rule_run, artifact, axis). Append-only —
-- old decisions are historical fact and never mutate. See spec §9.1 and
-- §12.

CREATE TABLE IF NOT EXISTS actionability_decisions (
  decision_id           TEXT PRIMARY KEY,
  rule_id               TEXT NOT NULL,
  rule_version          TEXT NOT NULL,
  rule_run_at           TIMESTAMPTZ NOT NULL,
  artifact_id           TEXT NOT NULL,
  axis                  TEXT NOT NULL CHECK (axis IN ('detection', 'content', 'timing', 'channel')),
  inference             TEXT NOT NULL CHECK (inference IN ('actionable_positive', 'actionable_negative', 'continue_to_observe')),
  evidence_event_ids    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_actionability_decisions_artifact
  ON actionability_decisions(artifact_id, rule_run_at DESC);

CREATE INDEX IF NOT EXISTS idx_actionability_decisions_axis
  ON actionability_decisions(axis, inference, rule_run_at DESC);

CREATE INDEX IF NOT EXISTS idx_actionability_decisions_rule
  ON actionability_decisions(rule_id, rule_run_at DESC);
