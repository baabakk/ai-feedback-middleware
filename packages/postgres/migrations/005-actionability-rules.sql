-- llm-feedback-middleware v2.1: actionability_rules
--
-- Per-axis threshold rules consumed by Layer 4. The framework ships zero
-- default rules; consumers seed via admin UI / migrations / seed scripts.
-- See spec §12.

CREATE TABLE IF NOT EXISTS actionability_rules (
  rule_id           TEXT PRIMARY KEY,
  rule_version      TEXT NOT NULL,
  applies_when      JSONB NOT NULL,
  axis              TEXT NOT NULL CHECK (axis IN ('detection', 'content', 'timing', 'channel')),
  threshold         INTEGER NOT NULL CHECK (threshold > 0),
  window_ms         BIGINT NOT NULL CHECK (window_ms > 0),
  result_if_met     TEXT NOT NULL CHECK (result_if_met IN ('actionable_positive', 'actionable_negative')),
  result_if_unmet   TEXT NOT NULL DEFAULT 'continue_to_observe' CHECK (result_if_unmet IN ('actionable_positive', 'actionable_negative', 'continue_to_observe')),
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actionability_rules_active
  ON actionability_rules(active, axis)
  WHERE active = TRUE;
