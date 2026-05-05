-- llm-feedback-middleware: inference rules
--
-- Threshold-based rules that the classifier evaluates at capture time.
-- Rules are evaluated first-match-wins in registration order. The framework
-- ships zero default rules; consumers seed via seed-examples.sql or an
-- admin UI.

CREATE TABLE IF NOT EXISTS feedback_inference_rules (
  rule_id           TEXT PRIMARY KEY,
  applies_when      JSONB NOT NULL,
  threshold         INTEGER NOT NULL CHECK (threshold > 0),
  window_ms         BIGINT NOT NULL CHECK (window_ms > 0),
  result_if_met     TEXT NOT NULL CHECK (result_if_met IN ('whitelist', 'blacklist')),
  result_if_unmet   TEXT NOT NULL DEFAULT 'observe' CHECK (result_if_unmet IN ('whitelist', 'blacklist', 'observe')),
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_inference_rules_active
  ON feedback_inference_rules(active)
  WHERE active = TRUE;
