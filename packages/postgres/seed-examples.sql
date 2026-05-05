-- =====================================================================
-- llm-feedback-middleware: EXAMPLE inference rules.
--
-- WARNING: These thresholds are guesses, not framework defaults.
-- Measure your actual feedback distribution for 2-4 weeks before adopting
-- them in production. They are provided so consumers can see the shape of
-- the inference_rules table; they should not be loaded blindly.
--
-- Run only if you have read the warning above and decided you want them:
--   psql $DATABASE_URL -f seed-examples.sql
-- =====================================================================

-- 5 expired approvals on the same task type within 7 days → blacklist.
-- "This task type is producing artifacts the user doesn't engage with."
INSERT INTO feedback_inference_rules
  (rule_id, applies_when, threshold, window_ms, result_if_met, result_if_unmet, notes)
VALUES (
  'example_expired_to_blacklist',
  '{"action": "expired"}'::jsonb,
  5,
  604800000,  -- 7 days in ms
  'blacklist',
  'observe',
  'EXAMPLE: tune threshold based on real expired-rate before relying on this'
)
ON CONFLICT (rule_id) DO NOTHING;

-- 3 silent_accept events on the same partition within 14 days → whitelist.
-- "User keeps sending these without edits; reinforce the pattern."
INSERT INTO feedback_inference_rules
  (rule_id, applies_when, threshold, window_ms, result_if_met, result_if_unmet, notes)
VALUES (
  'example_silent_accept_to_whitelist',
  '{"action": "silent_accept"}'::jsonb,
  3,
  1209600000,  -- 14 days in ms
  'whitelist',
  'observe',
  'EXAMPLE: only meaningful once you have a silence-scan adapter wired'
)
ON CONFLICT (rule_id) DO NOTHING;

-- 3 regenerates on the same task type within 7 days → blacklist.
-- "This kind of output keeps getting regenerated; stop suggesting it."
INSERT INTO feedback_inference_rules
  (rule_id, applies_when, threshold, window_ms, result_if_met, result_if_unmet, notes)
VALUES (
  'example_regenerate_to_blacklist',
  '{"action": "regenerate"}'::jsonb,
  3,
  604800000,
  'blacklist',
  'observe',
  'EXAMPLE: pairs with a regenerate button in the UI'
)
ON CONFLICT (rule_id) DO NOTHING;
